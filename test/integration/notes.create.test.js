// dw1 · dw2 · dw5 — POST /notes 를 **실제 Postgres 위에서** 관측한다.
//
// 이음매: 테스트가 연 커넥션에서 `BEGIN` 한 뒤 그 커넥션을 그대로 `createApp({ db })`에 주입한다.
// 그래서 (a) 앱이 쓴 행이 같은 트랜잭션 안에서 보이고, (b) 케이스는 `ROLLBACK`으로 끝나 공유
// 테이블에 아무것도 남기지 않는다(docs/QA.md "DB isolation", docs/TECHNICAL.md §Testing Strategy).
// 앱이 자기 pool로 다른 커넥션을 쓰는 구현은 (a)에서, 롤백을 무시하는 구현은 dw1의 마지막 절에서 떨어진다.
//
// 단언은 전부 repo 모듈을 거치지 않은 생 SQL로 읽는다 — 구현이 자기 자신을 확인하지 않게.
import { afterEach, describe, expect, test } from "vitest";
import { once } from "node:events";
import { createApp } from "../../src/app.js";
import { makeMarker, makeNote } from "../fixtures/notes.js";
import { connect, openCase } from "./helpers/db.js";

const CASE_TIMEOUT_MS = 60000;
const opened = [];

// 케이스별 트랜잭션 커넥션. afterEach가 ROLLBACK까지 책임진다 — 실패 경로에서도 행이 남지 않는다.
async function openTransaction() {
  const handle = await openCase();
  opened.push(handle);
  return handle.db;
}

// 고정 포트를 쓰지 않는다 — new-test-repeat이 이 파일을 전체 스위트와 동시에 돌린다.
const servers = [];
async function startApp(options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function postNote(url, payload) {
  const res = await fetch(`${url}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  while (opened.length) await opened.pop().finish();
});

// 케이스마다 다른 조회 키. 워커 프로세스가 여럿이어도 서로의 행을 보지 않게 pid를 섞는다
// (난수가 아니다 — 값 자체는 어떤 단언에도 쓰이지 않고 "이 케이스의 행"을 가리키는 데만 쓴다).
function caseMarker(label) {
  return `${makeMarker(label)}-p${process.pid}`;
}

describe("issue #2 — POST /notes against postgres", () => {
  // dw1: 201 + 정확히 네 키, 같은 트랜잭션 안에 트림된 행이 1건, ROLLBACK 뒤 새 커넥션에는 0건.
  test("test_2_create_note_persists_in_caller_transaction", async () => {
    const db = await openTransaction();
    const url = await startApp({ db });
    const marker = caseMarker("create");
    // 앞뒤 공백은 트림돼 저장된다(내용 절단이 아니다) — 마커는 트림 뒤 값이다.
    const sent = makeNote({ title: `  ${marker}  `, body: `\t${marker}-body \n` });

    const { status, body } = await postNote(url, sent);

    expect(status).toBe(201);
    // 정확히 네 키다. 내부 컬럼(예: updated_at)이나 요청 에코가 새면 떨어진다.
    expect(Object.keys(body).sort()).toEqual(["body", "created_at", "id", "title"]);
    expect(body.title).toBe(marker);
    expect(body.body).toBe(`${marker}-body`);
    expect(typeof body.created_at).toBe("string");

    // 같은 트랜잭션에서 생 SQL로 읽는다 — repo를 거치지 않는다.
    const seen = await db.query("select title, body from notes where id = $1", [body.id]);
    expect(seen.rows).toHaveLength(1);
    expect(seen.rows[0]).toEqual({ title: marker, body: `${marker}-body` });

    // 응답의 id가 진짜 그 행의 id다: 다른 id로 조회하면 이 마커가 나오지 않는다.
    const byMarker = await db.query("select id from notes where title = $1", [marker]);
    expect(byMarker.rows).toEqual([{ id: body.id }]);

    // ROLLBACK 뒤에는 새 커넥션 어디에도 남지 않는다(앱이 자기 pool로 커밋했다면 여기서 드러난다).
    await opened.pop().finish();
    const outside = await connect();
    try {
      const after = await outside.query("select id from notes where title = $1", [marker]);
      expect(after.rows).toEqual([]);
    } finally {
      await outside.close();
    }
  }, CASE_TIMEOUT_MS);

  // dw2: 검증 실패는 400 + 필드명이 든 message이고, 행을 만들지 않는다.
  test("test_2_invalid_request_rejected_and_creates_no_row", async () => {
    const db = await openTransaction();
    const url = await startApp({ db });
    const rejected = caseMarker("no-title");
    const accepted = caseMarker("with-title");

    // title이 없다. 조회 키는 body에 실은 마커다 — title로는 이 케이스를 찾을 수 없다.
    const { status, body } = await postNote(url, { body: rejected });

    expect(status).toBe(400);
    expect(body).toEqual({ error: { code: "invalid_request", message: expect.any(String) } });
    // 범용 "invalid request"는 무엇이 틀렸는지 말하지 않는다(docs/PROJECT.md 원칙 3).
    expect(body.error.message).toContain("title");

    const rows = await db.query("select id from notes where body = $1", [rejected]);
    expect(rows.rows).toEqual([]);

    // 위 0건이 "이 앱은 아무것도 못 쓴다"라서 성립하는 것이 아님을 같은 트랜잭션에서 보인다:
    // 유효한 요청은 같은 조회 모양으로 1건이 보인다. 이 대조가 없으면 dw2는 공허하게 통과한다.
    const ok = await postNote(url, makeNote({ title: "control", body: accepted }));
    expect(ok.status).toBe(201);
    const control = await db.query("select id from notes where body = $1", [accepted]);
    expect(control.rows).toHaveLength(1);
  }, CASE_TIMEOUT_MS);

  // dw5: created_at의 출처는 주입된 시계다 — DDL의 default now()가 값을 만들면 떨어진다.
  test("test_2_created_at_comes_from_injected_clock", async () => {
    const db = await openTransaction();
    const instant = new Date("2026-01-01T00:00:00Z");
    const url = await startApp({ db, now: () => instant });
    const marker = caseMarker("clock");

    const { status, body } = await postNote(url, makeNote({ title: marker }));

    expect(status).toBe(201);
    expect(body.created_at).toBe(instant.toISOString());

    // 응답만 시계를 쓰고 INSERT는 컬럼을 빠뜨리는 구현을 떨어뜨린다: 저장된 값도 같은 순간이다.
    const stored = await db.query("select created_at from notes where title = $1", [marker]);
    expect(stored.rows).toHaveLength(1);
    expect(new Date(stored.rows[0].created_at).toISOString()).toBe(instant.toISOString());

    // 벽시계가 아니다. 서버의 now()가 값을 만들었다면 지금 이 순간과 몇 ms 차이일 수밖에 없다.
    const drift = Date.now() - new Date(stored.rows[0].created_at).getTime();
    expect(drift).toBeGreaterThan(60_000);
  }, CASE_TIMEOUT_MS);
});
