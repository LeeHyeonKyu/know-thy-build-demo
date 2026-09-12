// dw4 · dw6 · dw7 — createApp()의 HTTP 표면을 DB 없이 고정한다.
// 모든 케이스는 listen(0) 위의 실제 요청이다(라우터·미들웨어 등록 순서까지 관측한다).
import { afterEach, describe, expect, test, vi } from "vitest";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { makeMarker, makeNote } from "./fixtures/notes.js";

const APP_MODULE = fileURLToPath(new URL("../src/app.js", import.meta.url));
const started = [];

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

describe("issue #2 — app factory HTTP surface", () => {
  // dw4: 파서가 실패해도 에러 봉투가 유지된다(docs/features/001-create-note.md:63, CHARTER:57).
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
    // HTML도 스택도 아니다 — 파싱되고, 봉투의 두 필드가 모두 있다.
    const body = JSON.parse(raw);
    expect(typeof body.error?.code).toBe("string");
    expect(typeof body.error?.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
    // express의 기본 SyntaxError 응답은 스택/`at JSON.parse`를 흘린다.
    expect(raw).not.toMatch(/at JSON\.parse|SyntaxError|<!DOCTYPE/i);
  });

  // dw6: DB 장애(503)와 프로그래밍 오류(503이 아니다)를 가른다.
  test("test_2_db_failure_503_but_bug_is_not_503", async () => {
    const secret = makeMarker("never-echoed");
    const note = makeNote({ title: secret, body: `${secret}-body` });

    const post = async (app) => {
      const res = await fetch(`${app.url}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(note),
      });
      return { status: res.status, raw: await res.text(), type: res.headers.get("content-type") };
    };

    // (1) 연결류 오류는 코드 하나가 아니라 집합이다.
    for (const code of ["ECONNREFUSED", "ETIMEDOUT"]) {
      const app = await startApp({ db: failingDb(() => pgError(code)) });
      const { status, raw, type } = await post(app);

      expect(status, code).toBe(503);
      expect(type, code).toMatch(/application\/json/);
      const body = JSON.parse(raw);
      expect(typeof body.error?.code, code).toBe("string");
      expect(typeof body.error?.message, code).toBe("string");
      // 요청 본문은 에코하지 않는다(docs/features/001-create-note.md:78).
      expect(raw, code).not.toContain(secret);
    }

    // (2) 평범한 TypeError는 DB 장애가 아니다 — 전면 catch→503 구현은 여기서 떨어진다.
    const buggy = await startApp({
      db: failingDb(() => new TypeError("rows is not iterable")),
    });
    const { status, raw, type } = await post(buggy);

    expect(status).not.toBe(503);
    expect(status).toBe(500);
    expect(type).toMatch(/application\/json/);
    const body = JSON.parse(raw);
    expect(typeof body.error?.code).toBe("string");
    expect(typeof body.error?.message).toBe("string");
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain("rows is not iterable"); // 내부 메시지도 새지 않는다
  });

  // dw7: import는 포트를 잡지 않고, DB 없이도 /healthz Preserve 계약이 산다(CHARTER:56, #8).
  test("test_2_app_factory_binds_no_port_and_preserves_healthz", async () => {
    // (1) 모듈을 import하기만 한 프로세스는 스스로 끝난다.
    //     최상단 listen이 남아 있으면 이벤트 루프가 살아 있어 영영 끝나지 않는다.
    //     자식에게 PORT=0을 준다 — 최상단 listen이 있으면 임의 포트에 **반드시 성공**해서
    //     프로세스가 살아남는다. 고정 포트였다면 그 포트가 이미 쓰이는 날 EADDRINUSE로 바로
    //     죽어 버려서, 회귀가 "조용히 통과"한다(실제로 그렇게 통과하는 것을 확인했다).
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", 'const m = await import(process.env.APP_MODULE_PATH);\nif (typeof m.createApp !== "function") process.exit(3);\n'],
      { env: { ...process.env, APP_MODULE_PATH: APP_MODULE, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
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
    expect(child.exitCode).toBe(0); // 3이면 createApp export가 없다
    // 진입점의 ready 신호는 `node src/app.js`일 때만 나온다(test/smoke.test.js의 #8 가드가 그쪽을 본다).
    expect(stdout).not.toContain("listening on");

    // (2) db를 하나도 주지 않은 앱에서 /healthz가 산다 — 헬스 경로에 DB를 끼워 넣으면 떨어진다.
    const app = await startApp();
    const res = await fetch(`${app.url}/healthz`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // #8 회귀 가드를 팩토리 경로에서도 지킨다(docs/TECHNICAL.md §Interfaces).
    expect(res.headers.get("cache-control")).toBe("no-store");

    // (3) 존재하지 않는 경로는 404다 — catch-all 에러 핸들러가 라우트보다 앞서면 여기서 드러난다.
    const missing = await fetch(`${app.url}/__no_such_route__`);
    expect(missing.status).toBe(404);
  }, 30000);
});

// ---------------------------------------------------------------------------------------
// rework(cf1 · arch1 · qa1 · spec2) — "출하되는 유일한 운영 경로"를 관측한다.
// 위 describe는 전부 테스트가 db를 주입한 앱을 본다. 그래서 `npm start`(= `node src/app.js`)가
// 실제로 타는 배선 — DATABASE_URL → pool → repo — 은 한 번도 밟히지 않았고, 그 경로의 POST /notes는
// db가 undefined라 500 internal_error로 끝났다. 아래 두 케이스가 그 경로를 게이트 안으로 끌어온다.
// ---------------------------------------------------------------------------------------

import { createServer } from "node:net";
import { createAppFromEnv } from "../src/app.js";

// createApp()이 아니라 진입점이 쓰는 팩토리로 앱을 띄운다(위 startApp과 달리 이미 만들어진 app을 받는다).
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

async function postNote(url, note) {
  const res = await fetch(`${url}/notes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  const raw = await res.text();
  return { status: res.status, raw, type: res.headers.get("content-type") };
}

// 127.0.0.1의 빈 포트를 확보한다. 고정 포트는 금지다 — new-test-repeat이 이 파일을 전체 스위트와
// 동시에 돌리므로 진입점 자식 프로세스가 한 번에 둘 이상 살아 있을 수 있다.
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

describe("issue #2 — the shipped entrypoint (`node src/app.js`)", () => {
  // cf1 · arch1 · spec2: 진입점 팩토리가 DATABASE_URL로 만든 실행자를 라우트까지 내려보낸다.
  // 드라이버는 주입한다 — 여기서 관측하는 것은 드라이버 구현이 아니라 **배선**이다
  // (docs/TECHNICAL.md §Data "연결 설정": 하드코딩 DSN fallback도 기동 시점 fail-fast도 없다).
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

  // qa1: 드라이버가 없거나 pool을 만들지 못해도 기동은 막히지 않고(/healthz Preserve),
  // 그 실패는 500 internal_error가 아니라 503으로 도착한다(docs/features/001-create-note.md:78).
  test("test_2_entrypoint_without_driver_answers_503_not_500", async () => {
    const marker = makeMarker("no-driver");
    const missingDriver = () => {
      const err = new Error("Cannot find package 'pg'");
      err.code = "ERR_MODULE_NOT_FOUND";
      return Promise.reject(err);
    };

    const app = await listenOn(await createAppFromEnv({ env: {}, loadDriver: missingDriver }));

    // 기동 시점 fail-fast를 하지 않는다 — 헬스 신호가 살아 있어야 컴포즈·playwright가 기다릴 수 있다.
    const health = await fetch(`${app.url}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const { status, raw, type } = await postNote(app.url, makeNote({ title: marker, body: `${marker}-body` }));
    expect(status, raw).toBe(503);
    expect(type).toMatch(/application\/json/);
    const envelope = JSON.parse(raw);
    expect(typeof envelope.error?.code).toBe("string");
    expect(typeof envelope.error?.message).toBe("string");
    expect(envelope.error.code).not.toBe("internal_error");
    expect(raw).not.toContain(marker); // 요청 본문도 드라이버 내부 메시지도 에코하지 않는다
    expect(raw).not.toContain("Cannot find package");

    // 검증은 DB와 무관하게 여전히 산다 — DB가 없다고 400이 503으로 바뀌지 않는다.
    const invalid = await postNote(app.url, { body: `${marker}-body` });
    expect(invalid.status).toBe(400);
    expect(JSON.parse(invalid.raw).error.code).toBe("invalid_request");
    expect(JSON.parse(invalid.raw).error.message).toContain("title");
  });

  // cf1 · qa1: 관측점을 프로세스 밖으로 옮긴다. `npm start`가 부르는 바로 그 명령을 그대로 띄우고
  // HTTP 응답만 본다 — db를 인자 없이 부르는 진입점은 여기서 500 internal_error로 떨어진다.
  test("test_2_started_process_serves_notes_with_db_wired", async () => {
    const marker = makeMarker("started-process");
    const port = await reserveLoopbackPort();
    const child = spawn(process.execPath, [APP_MODULE], {
      // 도달할 수 없는 DSN을 명시한다(크리덴셜 없음). 드라이버가 있든 없든 결과는 하나다:
      // 요청 시점에 "DB에 닿지 못했다"가 503으로 도착한다. 실제 DB에 붙지 않으므로 결정적이다.
      env: { ...process.env, PORT: String(port), DATABASE_URL: "postgres://127.0.0.1:1/ktb_unreachable" },
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
      // 조건 대기만 한다(docs/QA.md: No sleep).
      await vi.waitFor(
        () => {
          if (dead()) throw new Error(`entrypoint stopped before listening: ${stderr}${stdout}`);
          if (!stdout.includes(`listening on ${port}`)) {
            throw new Error(`entrypoint has not bound ${port} yet: ${JSON.stringify(stdout)}`);
          }
        },
        { timeout: 20000, interval: 20 },
      );

      const url = `http://127.0.0.1:${port}`;

      // (1) DB가 없어도 헬스는 산다(CHARTER Preserve).
      const health = await fetch(`${url}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      // (2) 출하되는 경로의 POST /notes는 "DB에 닿지 못했다"를 말한다 — 프로그래밍 오류(500)가 아니다.
      const { status, raw, type } = await postNote(url, makeNote({ title: marker, body: `${marker}-body` }));
      expect(status, raw).toBe(503);
      expect(type).toMatch(/application\/json/);
      const envelope = JSON.parse(raw);
      expect(envelope.error?.code).not.toBe("internal_error");
      expect(typeof envelope.error?.message).toBe("string");
      expect(raw).not.toContain(marker);

      // (3) 같은 프로세스에서 검증 경로도 계약대로다.
      const invalid = await postNote(url, { title: "   ", body: `${marker}-body` });
      expect(invalid.status).toBe(400);
      expect(JSON.parse(invalid.raw).error.code).toBe("invalid_request");
      expect(JSON.parse(invalid.raw).error.message).toContain("title");
    } finally {
      await stop();
    }
  }, 40000);
});
