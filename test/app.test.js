// dw4 · dw5 · dw6 — DB 없이 관측할 수 있는 것만 여기서 관측한다(createApp에 가짜 실행자를 주입하고
// listen(0) 위로 실제 HTTP 요청을 보낸다 — 라우터·미들웨어 등록 순서까지 본다).
//
// 이 파일이 **하지 않는** 것 둘(001 plan handoff non_goals):
//  - `/healthz`의 200 `{ok:true}`·`no-store`를 다시 단언하지 않는다. test/smoke.test.js가 출하되는
//    진입점 프로세스를 상대로 required 게이트 안에서 이미 더 강하게 지킨다 —
//    `tests_are_load_bearing=true` 아래에서 같은 Preserve 계약의 두 번째 사본은 지울 수 없다.
//  - 유휴 pool 오류로 프로세스가 죽지 않는지, `src/routes/notes.js`가 `src/repo/**`를 import하는지를
//    관측하지 않는다. 전자는 이번 이슈의 범위가 아니고(대가는 open_risks·§Constraints에 남았다),
//    후자는 매 PR에 배치되는 architecture 리뷰어의 판정이지 영구 grep의 일이 아니다.
import { afterEach, describe, expect, test, vi } from "vitest";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp, createAppFromEnv } from "../src/app.js";
import { makeMarker, makeNote } from "./fixtures/notes.js";

const APP_MODULE = fileURLToPath(new URL("../src/app.js", import.meta.url));
const started = [];

// 오류 code의 **값**은 클라이언트가 분기하는 공개 계약이다(CHARTER, docs/TECHNICAL.md §Interfaces).
// 그래서 테스트가 제품 상수를 import하지 않고 리터럴을 여기 다시 적는다 — import하면 상수를 바꾸는
// 순간 테스트도 같이 따라가서 아무것도 지키지 못한다(지난 회차 verifier finding #2).
const INVALID_REQUEST = "invalid_request";
const DB_UNAVAILABLE = "db_unavailable";
const INTERNAL_ERROR = "internal_error";

// 고정 포트를 쓰지 않는다 — prove-test의 new-test-repeat이 이 파일을 전체 스위트와 동시에 돌린다.
async function startApp(options) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  const handle = {
    url: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
  started.push(handle);
  return handle;
}

async function listenOn(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const handle = {
    url: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
  started.push(handle);
  return handle;
}

afterEach(async () => {
  while (started.length) await started.pop().stop();
});

// query가 항상 같은 오류로 reject/throw하는 가짜 실행자. 드라이버를 흉내 내지 않는다 —
// repo가 분류해야 하는 "오류 객체의 형태"만 준다.
function failingDb(makeError) {
  return { query: async () => { throw makeError(); } };
}

function pgError(code) {
  const err = new Error("connection failure");
  err.code = code;
  return err;
}

async function postNote(url, note, init = {}) {
  const res = await fetch(`${url}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
    ...init,
  });
  return { status: res.status, raw: await res.text(), type: res.headers.get("content-type") };
}

describe("issue #2 — app factory HTTP surface", () => {
  // 파서가 실패해도 에러 봉투가 유지된다(docs/features/001-create-note.md:63, CHARTER:57).
  test("test_2_error_envelope_for_unparseable_body", async () => {
    const app = await startApp();

    const res = await fetch(`${app.url}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"title": "unclosed', // JSON이 아니다
    });
    const raw = await res.text();

    // 4xx 아무거나가 아니라 정확히 400이다.
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    // HTML도 스택도 아니다 — 파싱되고, 봉투의 두 필드가 리터럴/비어 있지 않은 문장으로 있다.
    const body = JSON.parse(raw);
    expect(body.error.code).toBe(INVALID_REQUEST);
    expect(typeof body.error?.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    // express의 기본 SyntaxError 응답은 스택/`at JSON.parse`를 흘린다.
    expect(raw).not.toMatch(/at JSON\.parse|SyntaxError|<!DOCTYPE/i);
  });

  // dw4: 클라이언트가 보낸 깨진 body가 **서버 장애로 보이지 않는다**. 파싱 실패만이 "읽을 수 없는
  // body"가 아니다 — body-parser가 클라이언트 잘못이라고 표시한 나머지 오류(지원하지 않는 charset·
  // content-encoding, 선언과 다른 압축)도 4xx로 나가야 한다. 500 internal_error로 답하면 사용자가
  // 고칠 수 있는 실수가 서버 장애로 보고되고(docs/features/001-create-note.md:63 "500이 아니다"),
  // 새벽 당직자는 멀쩡한 자기 서버를 들여다본다. (3)은 지난 회차가 실제로 500을 흘렸던 자리다.
  test("test_2_client_body_errors_are_never_500", async () => {
    const app = await startApp();
    const marker = makeMarker("client-body-error");
    const payload = JSON.stringify(makeNote({ title: marker, body: `${marker}-body` }));

    const cases = [
      {
        // (1) JSON으로 파싱되지 않는 body는 **정확히** 400이다(4xx 아무거나가 아니다).
        name: "body that is not JSON at all",
        // 마커를 본문에 실어 보낸다: 에코 금지 단언이 이 케이스에서 실제 판별력을 갖는다.
        init: { headers: { "content-type": "application/json" }, body: `{"title": "${marker}` },
        status: 400,
      },
      {
        // (2) 지원하지 않는 charset. express 기본 핸들러였다면 415였다 — 그보다 나쁜 상태코드를 내지 않는다.
        name: "charset the parser does not support",
        init: { headers: { "content-type": "application/json; charset=iso-8859-1" }, body: payload },
        status: 415,
      },
      {
        // (3) 깨진 압축 인코딩 둘: 알 수 없는 인코딩(415)과 "br이라고 선언했지만 brotli가 아닌 body"(400).
        name: "content-encoding the parser does not support",
        init: { headers: { "content-type": "application/json", "content-encoding": "x-ktb-none" }, body: payload },
        status: 415,
      },
      {
        name: "body declared br but not brotli",
        init: { headers: { "content-type": "application/json", "content-encoding": "br" }, body: payload },
        status: 400,
      },
    ];

    for (const { name, init, status } of cases) {
      const res = await fetch(`${app.url}/notes`, { method: "POST", ...init });
      const raw = await res.text();

      expect(res.status, `${name}: ${raw}`).toBe(status);
      expect(res.status, name).toBeLessThan(500);
      expect(res.headers.get("content-type"), name).toMatch(/application\/json/);
      const body = JSON.parse(raw);
      // 봉투의 code는 리터럴로 고정한다 — "문자열이기만 하면 통과"는 아무것도 지키지 못한다.
      expect(body.error.code, name).toBe(INVALID_REQUEST);
      expect(typeof body.error?.message, name).toBe("string");
      expect(body.error.message.length, name).toBeGreaterThan(0);
      // 요청 본문도 파서 내부 스택도 새지 않는다.
      expect(raw, name).not.toContain(marker);
      expect(raw, name).not.toMatch(/at JSON\.parse|SyntaxError|<!DOCTYPE/i);
    }
  });

  // dw5: DB 장애와 프로그래밍 오류와 스키마 오류가 응답에서 구분되고, **그 code 값이 리터럴로 고정된다**.
  // 이 형태는 실측에서 나왔다: 지난 회차는 `typeof body.error?.code === "string"`과 부정 단언만 걸어
  // 제품 상수를 임의 문자열로 바꿔도 전 스위트가 초록이었고, 같은 diff가 §Interfaces에 적은
  // `db_unavailable → 503`이 조용히 거짓이 됐다(verifier finding #2).
  test("test_2_db_failure_503_but_bug_is_not_503", async () => {
    const secret = makeMarker("never-echoed");
    const note = makeNote({ title: secret, body: `${secret}-body` });

    // (1) 연결류 오류는 코드 하나가 아니라 집합이다 — 두 코드로 그것을 관측한다.
    for (const code of ["ECONNREFUSED", "ETIMEDOUT"]) {
      const app = await startApp({ db: failingDb(() => pgError(code)) });
      const { status, raw, type } = await postNote(app.url, note);

      expect(status, `${code}: ${raw}`).toBe(503);
      expect(type, code).toMatch(/application\/json/);
      const body = JSON.parse(raw);
      expect(body.error.code, code).toBe(DB_UNAVAILABLE);
      expect(typeof body.error?.message, code).toBe("string");
      expect(body.error.message.length, code).toBeGreaterThan(0);
      // (2) 요청 본문은 어디에도 에코되지 않는다(docs/features/001-create-note.md:78).
      expect(raw, code).not.toContain(secret);
    }

    // (3) 평범한 TypeError는 DB 장애가 아니다 — 모든 예외를 503으로 보내는 전면 catch가 여기서
    //     떨어지고, 새벽 당직자에게 자기 코드의 버그가 "DB 불가, 재시도하세요"로 도착하지 않는다.
    const buggy = await startApp({ db: failingDb(() => new TypeError("rows is not iterable")) });
    const { status, raw, type } = await postNote(buggy.url, note);

    expect(status, raw).not.toBe(503);
    expect(status).toBe(500);
    expect(type).toMatch(/application\/json/);
    const body = JSON.parse(raw);
    expect(body.error.code).toBe(INTERNAL_ERROR);
    expect(body.error.code).not.toBe(DB_UNAVAILABLE);
    expect(typeof body.error?.message).toBe("string");
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("rows is not iterable"); // 내부 메시지도 새지 않는다

    // (4) 서버 모양의 오류(테이블 없음)도 연결 실패가 아니다. node-postgres는 SQLSTATE를
    //     `ECONNREFUSED`와 **같은 `err.code` 필드**에 싣는다 — 그래서 `err.code ? 503 : 500`으로
    //     판별하는 구현은 "마이그레이션을 빠뜨린 배포"를 'DB 불가, 재시도하세요'로 보고한다.
    //     이 계획은 마이그레이션을 사람의 수동 `psql -f`로 남기므로 테이블 부재는 가설이 아니라
    //     1순위 운영 실패다(§Data 당직 런북).
    const schemaBroken = await startApp({
      db: failingDb(() =>
        Object.assign(new Error('relation "notes" does not exist'), { code: "42P01", severity: "ERROR" }),
      ),
    });
    const missing = await postNote(schemaBroken.url, note);

    expect(missing.status, missing.raw).not.toBe(503);
    expect(missing.status).toBe(500);
    expect(missing.type).toMatch(/application\/json/);
    const missingBody = JSON.parse(missing.raw);
    expect(missingBody.error.code).toBe(INTERNAL_ERROR);
    expect(missingBody.error.code).not.toBe(DB_UNAVAILABLE);
    expect(typeof missingBody.error?.message).toBe("string");
    // 스키마 오류에서도 요청 본문과 드라이버 내부 문장은 새지 않는다.
    expect(missing.raw).not.toContain(secret);
    expect(missing.raw).not.toContain("does not exist");
  });

  // 진입점 팩토리가 DATABASE_URL로 만든 실행자를 라우트까지 내려보낸다. 드라이버는 주입한다 —
  // 여기서 관측하는 것은 드라이버 구현이 아니라 **배선**이고, 실제 드라이버 위의 같은 배선은
  // integration의 dw1이 출하 프로세스를 띄워 본다(docs/TECHNICAL.md §Data "연결 설정":
  // 하드코딩 DSN fallback도 기동 시점 fail-fast도 없다).
  test("test_2_entrypoint_wires_db_from_database_url", async () => {
    const marker = makeMarker("entry-wiring");
    const dsn = `postgres://127.0.0.1:5432/${marker}`;
    const moment = new Date("2026-02-03T04:05:06Z");
    const pools = [];

    // 가짜 드라이버: 항상 같은 값을 돌려주지 않고, 받은 파라미터를 그대로 행으로 만든다.
    // 그래서 응답이 "앱이 DB에 보낸 값"과 같은지 판별할 수 있다.
    class FakePool {
      constructor(config) {
        this.config = config;
        this.calls = [];
        pools.push(this);
      }

      async query(text, params) {
        this.calls.push({ text, params });
        const [title, body, createdAt] = params ?? [];
        return { rows: [{ id: 4242, title, body, created_at: createdAt }] };
      }
    }

    const app = await listenOn(
      await createAppFromEnv({
        env: { DATABASE_URL: dsn },
        loadDriver: async () => ({ Pool: FakePool }),
        now: () => moment,
      }),
    );

    // (1) 진입점은 DATABASE_URL만 읽는다 — 값을 바꿔 넣으면 그 값이 그대로 pool에 간다.
    expect(pools).toHaveLength(1);
    expect(pools[0].config.connectionString).toBe(dsn);

    // (2) 그 pool이 실제 요청 경로에 꽂혀 있다: 201이 오고, 응답은 DB가 돌려준 행이다.
    const { status, raw, type } = await postNote(app.url, { title: `  ${marker}  `, body: `${marker}-body` });
    expect(status, raw).toBe(201);
    expect(type).toMatch(/application\/json/);
    const created = JSON.parse(raw);
    expect(Object.keys(created).sort()).toEqual(["body", "created_at", "id", "title"]);
    expect(created).toEqual({
      id: 4242,
      title: marker, // service가 트림한 값이 DB까지 갔다
      body: `${marker}-body`,
      created_at: "2026-02-03T04:05:06.000Z",
    });

    // (3) 그리고 DB가 실제로 그 INSERT를 받았다 — 응답만 지어내는 구현은 여기서 떨어진다.
    expect(pools[0].calls).toHaveLength(1);
    expect(pools[0].calls[0].text).toMatch(/insert\s+into\s+notes\b/i);
    const [title, body, createdAt] = pools[0].calls[0].params;
    expect(title).toBe(marker);
    expect(body).toBe(`${marker}-body`);
    expect(new Date(createdAt).toISOString()).toBe("2026-02-03T04:05:06.000Z");
  });

  // dw6: `src/app.js`를 **import하는 것만으로는 리스너가 생기지 않는다**. 최상단 `listen`을 남긴 채
  // `createApp` export만 더한 가장 게으른 구현은 dw4·dw5를 통과하면서 파일 병렬 × new_test_repeats=3
  // 아래에서 EADDRINUSE flake를 낳고, tests_are_load_bearing이라 그 flake는 지울 수도 없다.
  //
  // 진입점 계약 셋(PORT 존중 · stdout `listening on <port>` · DATABASE_URL 없이 기동)은
  // test/smoke.test.js가 required 게이트 안에서 이미 실제 spawn으로 강제한다 — 여기서 두 번째 사본을
  // 만들지 않는다. 이 테스트가 새로 요구하는 것은 "import는 바인딩하지 않는다" 하나뿐이다.
  test("test_2_entrypoint_imports_without_binding", async () => {
    // 자식에게 PORT=0을 주는 이유: 최상단 listen이 남아 있으면 임의 포트에 **반드시 성공**해서
    // 프로세스가 살아남는다. 고정 포트였다면 그 포트가 이미 쓰이는 날 EADDRINUSE로 죽어
    // 회귀가 조용히 통과한다(실제로 그렇게 통과하는 것을 확인했다).
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", 'await import(process.env.APP_MODULE_PATH);\n'],
      { env: { ...process.env, APP_MODULE_PATH: APP_MODULE, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      // 고정 대기가 아니라 조건 대기다(docs/QA.md "No sleep").
      await vi.waitFor(
        () => {
          if (child.exitCode === null && child.signalCode === null) {
            throw new Error("importing src/app.js kept the process alive — a listener was bound at import time");
          }
        },
        { timeout: 15000, interval: 20 },
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
    expect(stderr, stderr).toBe("");
    expect(child.exitCode).toBe(0);
    expect(child.signalCode).toBeNull();
    // ready 신호는 `node src/app.js`일 때만 나온다(test/smoke.test.js의 #8 가드가 그쪽을 본다).
    expect(stdout).not.toContain("listening on");
  }, 30000);
});
