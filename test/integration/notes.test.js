// dw1 · dw3 — 실제 PostgreSQL 16(docker-compose.test.yml) 위에서 `POST /notes`를 관측한다.
//
// 이 파일이 닫는 간극은 세 회차가 게이트 GREEN인 채로 닫지 못한 그것이다: 지금까지 모든 단언은
// **테스트가 주입한 가짜 실행자**를 보았고, `npm start`(= `node src/app.js`)가 실제로 타는 배선은
// 한 번도 실제 드라이버·실제 DB 앞에 서지 않았다(review must_fix spec1·qa1, 재현 로그
// `.factory/out/qa/2-real-pg-repro-round2.log`: 503 db_unavailable, count(*) = 0).
// `pg`는 사람이 머지했다(커밋 d7f7996) — 따라서 이 파일에는 "드라이버가 없으면"이라는 조건절이 없다.
//
// 격리: 케이스들은 **테스트가 만든 자기 소유 스키마**(`test_2_<pid>_<rand>`) 안에서만 돈다.
// 공유 `public.notes`에 한 행도 커밋하지 않는다 — 002의 `{items:[],total:0}` AC가 태생부터
// 증명 불가능해지는 것을 막고, 실패 경로에서 행이 새지 않는다(plan handoff, operator 반박은 dissent_log).
// 스키마 이름이 프로세스마다 고유하므로 advisory lock도 `42P07` 흡수도 필요 없다.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createApp } from "../../src/app.js";
import { makeNote } from "../fixtures/notes.js";

// DSN의 단일 출처. 값은 `docker-compose.test.yml`의 서비스 정의(postgres:16, POSTGRES_PASSWORD=test,
// POSTGRES_DB=demo, 5432 노출)에서 온다. 러너가 DATABASE_URL을 주면 그것을 쓴다.
const DSN = process.env.DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:5432/demo";
const APP_ENTRYPOINT = fileURLToPath(new URL("../../src/app.js", import.meta.url));
const MIGRATION = fileURLToPath(new URL("../../db/migrations/001_create_notes.sql", import.meta.url));
const LOOPBACK = "127.0.0.1";
const READY_LINE = "listening on ";
const BOOT_TIMEOUT_MS = 30000;

// 스키마 이름과 케이스 마커는 **프로세스·실행마다 달라야 한다**: vitest는 파일을 병렬로 돌리고
// prove-test의 new-test-repeat은 같은 파일을 전체 스위트와 동시에 3번 돌린다. docs/QA.md의
// "Random seed" 규칙은 *데이터*를 결정적으로 만들라는 것이지 격리 이름을 충돌시키라는 것이 아니다 —
// 여기서 고정 이름을 쓰면 동시에 도는 두 실행이 서로의 스키마를 드롭한다.
const unique = (label) => `${label}_${process.pid}_${randomBytes(4).toString("hex")}`;
const SCHEMA = unique("test_2");

async function connect() {
  const client = new pg.Client({ connectionString: DSN });
  await client.connect();
  return client;
}

// 127.0.0.1의 빈 포트를 동적으로 확보한다(고정 포트 금지 — test/smoke.test.js와 같은 이유).
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK);
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

// 출하되는 진입점을 그대로 띄운다 — `package.json`의 start와 playwright webServer가 부르는 바로 그 명령.
// 테스트가 바꾸는 것은 환경변수 셋뿐이다(PORT · DATABASE_URL · PGOPTIONS): 코드 경로는 프로덕션과 같다.
async function startShippedEntrypoint() {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [APP_ENTRYPOINT], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: DSN,
      // 앱이 여는 커넥션만 전용 스키마를 보게 한다. pg는 `options`를 config에서 먼저 찾고 없으면
      // PGOPTIONS를 쓴다(node_modules/pg/lib/connection-parameters.js:83) — 구현이 Pool config에
      // `options`를 직접 넣으면 이 격리가 깨지고 dw1 (b)·(c)가 함께 떨어진다.
      PGOPTIONS: `-c search_path=${SCHEMA}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const dead = () => child.exitCode !== null || child.signalCode !== null;
  const stop = async () => {
    if (dead()) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };

  try {
    // 조건 대기만 한다(docs/QA.md "No sleep").
    await vi.waitFor(
      () => {
        if (dead()) throw new Error(`entrypoint stopped before listening: ${stderr}${stdout}`);
        if (!stdout.includes(READY_LINE + port)) {
          throw new Error(`entrypoint has not bound port ${port} yet: ${JSON.stringify(stdout)}`);
        }
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    child,
    port,
    url: `http://${LOOPBACK}:${port}`,
    get stderr() { return stderr; },
    get stdout() { return stdout; },
    stop,
    alive: () => !dead(),
  };
}

async function postNote(url, note) {
  const res = await fetch(`${url}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  return { status: res.status, raw: await res.text(), type: res.headers.get("content-type") };
}

let admin;

beforeAll(async () => {
  admin = await connect();
  await admin.query(`create schema ${SCHEMA}`);
  // 출하되는 마이그레이션 SQL을 **그대로** 적용한다. 테스트가 DDL을 따로 적어 두면 SQL 파일과
  // repo의 INSERT가 어긋나도 게이트가 초록이다(지난 회차 verifier finding #4).
  await admin.query(`set search_path to ${SCHEMA}`);
  await admin.query(await readFile(MIGRATION, "utf8"));
  await admin.query("reset search_path");
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
  // 정리는 이 한 줄뿐이다 — `public.notes`도, 다른 실행의 스키마도 건드리지 않는다.
  if (!admin) return;
  try {
    // 이 diff에서 유일하게 되돌릴 수 없는 행위이고, 드롭할 이름이 **런타임에 계산된다**.
    // 그래서 이름이 이 파일이 만든 형태가 아니면 드롭하지 않고 실패한다 — 변수 하나가 빈 문자열이
    // 되거나 누군가 SCHEMA의 출처를 바꾸는 날, 조용히 남의 스키마를 지우는 대신 소리를 낸다.
    // (실측: `unique("test_2")`를 `unique("public_oops")`로 바꾸면 이 줄이 드롭 전에 RED가 되고
    //  그 스키마는 실제로 남는다 — 가드가 공허하지 않다.)
    expect(SCHEMA, "테스트 소유 스키마가 아닌 이름은 드롭하지 않는다").toMatch(/^test_2_/);
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
  } finally {
    await admin.end();
  }
});

describe("issue #2 — POST /notes on real PostgreSQL", () => {
  // dw1: 출하되는 진입점이 실제 드라이버로 노트를 남긴다. 이 이슈의 Story 1이 사는 자리이고,
  // must_fix spec1·qa1이 "구조적으로 항상 깨진다"고 지목한 바로 그 경로다.
  test("test_2_shipped_entrypoint_persists_note_in_isolated_schema", async () => {
    const app = await startShippedEntrypoint();
    try {
      const marker = unique("dw1_marker");
      const note = makeNote({ title: `  ${marker}  `, body: `  본문 ${marker}\t유지  `, nickname: "mina" });
      const expectedTitle = note.title.trim();
      const expectedBody = note.body.trim();

      const { status, raw, type } = await postNote(app.url, note);

      // (a) 201 + 응답 키 집합이 정확히 네 개. `req.body`를 201에 spread하는 라우트는 여기서 떨어진다.
      expect(status, `${raw}\n${app.stderr}`).toBe(201);
      expect(type).toMatch(/application\/json/);
      const created = JSON.parse(raw);
      expect(Object.keys(created).sort()).toEqual(["body", "created_at", "id", "title"]);
      expect(created.title).toBe(expectedTitle);
      expect(created.body).toBe(expectedBody);
      expect(raw).not.toContain("nickname");
      expect(raw).not.toContain("mina");

      // (b) 앱이 아닌 **테스트가 연 커넥션**이 그 행을 본다. 존재만 확인하지 않는다 —
      //     title/body가 트림된 요청 값과 전체 문자열로 같아야 한다(스펙 :53, :58).
      const stored = await admin.query(
        `select id, title, body, created_at from ${SCHEMA}.notes where title = $1`,
        [expectedTitle],
      );
      expect(stored.rowCount).toBe(1);
      expect(stored.rows[0].title).toBe(expectedTitle);
      expect(stored.rows[0].body).toBe(expectedBody);
      expect(String(stored.rows[0].id)).toBe(String(created.id));

      // (c) 격리가 실제로 성립했다: 공유 public.notes에는 이 마커의 행이 없다.
      //     깨끗한 컴포즈에는 public.notes 자체가 없으므로 존재 여부를 먼저 묻는다.
      const publicTable = await admin.query("select to_regclass('public.notes') as reg");
      if (publicTable.rows[0].reg !== null) {
        const leaked = await admin.query("select 1 from public.notes where title = $1", [expectedTitle]);
        expect(leaked.rowCount, "전용 스키마 밖 public.notes로 행이 샜다").toBe(0);
      }

      // (d) 와이어 타입을 명시적으로 고정한다. node-postgres는 int8(bigserial)을 기본으로
      //     **문자열**로 준다 — 002의 `created_at DESC, id DESC` 계약이 이 값 위에 얹히므로
      //     추측이 아니라 관측으로 못박고 같은 값을 docs/TECHNICAL.md §Interfaces에 적는다.
      expect(typeof created.id).toBe("string");
      expect(created.id).toMatch(/^[0-9]+$/);
      expect(typeof created.created_at).toBe("string");
      expect(created.created_at).toBe(new Date(created.created_at).toISOString());
      expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(Number.isNaN(Date.parse(created.created_at))).toBe(false);

      // (e) 정리는 `afterAll`의 `drop schema <schema> cascade` 하나뿐이고 `/^test_2_/` 가드가 붙는다.
      //     `/healthz`는 여기서 다시 단언하지 않는다 — test/smoke.test.js가 출하 진입점 프로세스를
      //     상대로 required 게이트 안에서 이미 더 강하게 지킨다(001 plan handoff non_goals).
    } finally {
      await app.stop();
    }
  }, BOOT_TIMEOUT_MS + 20000);

  // dw3: `created_at`의 출처가 앱(주입된 시계)이고, 거절된 요청은 행을 만들지 않는다.
  // 둘 다 **호출자의 트랜잭션 안에서** 관측한다 — 앱이 자기 pool로 다른 커넥션을 쓰면 행이
  // 보이지 않거나 ROLLBACK 뒤에도 남아 떨어진다(docs/QA.md "DB isolation").
  test("test_2_created_at_from_injected_clock_and_no_row_on_reject", async () => {
    const moment = new Date("2026-01-01T00:00:00Z");
    const client = await connect();
    let server;
    try {
      await client.query("begin");
      // 이 커넥션에는 PGOPTIONS가 걸려 있지 않다 — 트랜잭션 안에서만 전용 스키마를 본다.
      await client.query(`set local search_path to ${SCHEMA}`);

      server = createApp({ db: client, now: () => moment }).listen(0, LOOPBACK);
      await once(server, "listening");
      const url = `http://${LOOPBACK}:${server.address().port}`;

      // (a) 유효한 요청: 201 + 저장된 행의 created_at이 **주입된 순간**이다.
      //     repo의 INSERT가 컬럼을 빠뜨려 DDL의 `default now()`가 값을 만들면 실제 벽시계가 되어 떨어진다.
      const marker = unique("dw3_ok");
      const note = makeNote({ title: `  ${marker}  `, body: `  ${marker} 본문  ` });
      const { status, raw } = await postNote(url, note);
      expect(status, raw).toBe(201);
      const created = JSON.parse(raw);
      expect(Object.keys(created).sort()).toEqual(["body", "created_at", "id", "title"]);
      expect(created.created_at).toBe(moment.toISOString());

      const row = await client.query("select title, body, created_at from notes where id = $1", [created.id]);
      expect(row.rowCount).toBe(1);
      expect(row.rows[0].title).toBe(marker);
      expect(row.rows[0].body).toBe(`${marker} 본문`);
      expect(new Date(row.rows[0].created_at).toISOString()).toBe(moment.toISOString());

      // (b) 거절된 요청은 행을 만들지 않는다 — 같은 트랜잭션에서 직접 센다.
      //     "repo가 호출되지 않았다"를 mock으로 단언하는 형태는 호출 구조를 베낄 뿐이다.
      const rejected = unique("dw3_rejected");
      const bad = await postNote(url, { body: rejected });
      expect(bad.status, bad.raw).toBe(400);
      const error = JSON.parse(bad.raw).error;
      expect(error.code).toBe("invalid_request");
      expect(error.message).toContain("title");
      const none = await client.query("select 1 from notes where body = $1", [rejected]);
      expect(none.rowCount).toBe(0);

      await client.query("rollback");

      // 롤백이 실제로 지웠다: 새 커넥션은 그 행을 보지 못한다.
      const after = await admin.query(`select 1 from ${SCHEMA}.notes where title = $1`, [marker]);
      expect(after.rowCount).toBe(0);
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      }
      await client.end();
    }
  }, BOOT_TIMEOUT_MS);

  // (이 파일에 없는 것) 유휴 커넥션이 서버에서 강제 종료된 뒤에도 출하 프로세스가 사는지를
  // 관측하는 케이스는 **이번 이슈가 만들지 않는다**(001 plan handoff non_goals, dissent_log에
  // operator의 반대가 원문으로 남아 있다). `src/app.js`는 계속 `pool.on("error")`를 등록하지만,
  // 그 사실을 지키는 게이트는 없다 — 잃는 사용자 사실은 §Constraints 한 줄과 open_risks에 있다:
  // 유휴 커넥션 오류 한 번이 `npm start` 단일 프로세스를 죽여 `/notes`와 `/healthz`를 함께 지울 수 있다.
});
