import { test, expect } from "vitest";
test("smoke", () => { expect(true).toBe(true); });

// --- issue #8 회귀 가드: GET /healthz 응답은 캐시되면 안 된다 -------------------------
// 관측점은 프로세스 밖이다. 프로덕션 진입점("node src/app.js" — npm start와 playwright
// webServer가 쓰는 바로 그 경로) 그대로 자식 프로세스로 띄우고 HTTP 응답만 본다.
// 그래서 이 단언은 헤더뿐 아니라 "진입점이 여전히 리스닝한다"는 사실까지 M1 게이트 안에서 지킨다.
import { afterAll, beforeAll, describe, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const APP_ENTRYPOINT = fileURLToPath(new URL("../src/app.js", import.meta.url));
const BOOT_TIMEOUT_MS = 20000;
const LOOPBACK = "127.0.0.1";
const READY_LINE = "listening on ";
const baseUrl = (port) => "http://" + LOOPBACK + ":" + port;

// 127.0.0.1의 빈 포트를 동적으로 확보한다. 고정 포트는 금지다 — new-test-repeat가 전체 스위트와
// 이 파일을 동시에 돌리므로 진입점 자식 프로세스가 한 번에 둘 이상 살아 있다.
// 확보에 실패하면 재시도로 덮지 않고 그대로 실패한다(대기는 조건 대기만, docs/QA.md No sleep).
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK);
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

// 진입점을 띄우고, 스스로 리스닝했다고 말할 때까지 조건 대기한다(docs/QA.md: No sleep).
async function startEntrypoint() {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [APP_ENTRYPOINT], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const dead = () => child.exitCode !== null || child.signalCode !== null;
  // 실패 경로에서도 자식을 반드시 정리한다 — 프로세스가 새면 게이트가 RED가 아니라 hang한다.
  const stop = async () => {
    if (dead()) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };

  try {
    await vi.waitFor(
      () => {
        if (dead()) {
          throw new Error("entrypoint stopped before listening: " + stderr + stdout);
        }
        if (!stdout.includes(READY_LINE + port)) {
          throw new Error("entrypoint has not bound port " + port + " yet: " + JSON.stringify(stdout));
        }
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
}

describe("issue #8 — /healthz cache headers", () => {
  let app;
  beforeAll(async () => { app = await startEntrypoint(); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  // dw1: 같은 응답 하나가 status 200 + body 정확히 ok:true + cache-control 값 no-store 를 동시에 만족한다.
  // 셋을 한 응답에 묶어야 CHARTER Preserve(200 ok:true)를 깨는 구현이 헤더만 맞춰 통과하지 못한다.
  test("test_8_healthz_no_store_on_real_entrypoint", async () => {
    const res = await fetch(baseUrl(app.port) + "/healthz");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
    // 키 존재가 아니라 값까지 고정한다 — 이 저장소엔 APM도 알림도 없어 이 단언이 유일한 방어선이다.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  // dw2: no-store는 전역 미들웨어가 아니라 /healthz 한 곳에만 걸린다. 아직 존재하지 않는
  // /notes의 캐시 정책을 이 버그픽스가 몰래 결정하지 않게 하는 경계 단언이다.
  test("test_8_no_store_scoped_to_healthz", async () => {
    const other = await fetch(baseUrl(app.port) + "/__no_such_route__");
    expect(other.status).toBe(404);
    expect(other.headers.get("cache-control")).toBeNull();

    // 같은 프로세스에서 /healthz는 여전히 no-store여야 한다 — 이 두 줄이 없으면
    // "아무 데도 헤더를 붙이지 않는" 구현도 위 단언만으로 통과한다.
    const health = await fetch(baseUrl(app.port) + "/healthz");
    expect(health.headers.get("cache-control")).toBe("no-store");
  });
});
