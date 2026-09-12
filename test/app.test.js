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
