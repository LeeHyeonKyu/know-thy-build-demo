// #15 — e2e 게이트가 CI 러너와 같은 조건에서 초록인가.
//
// CI의 조건을 그대로 재현한다: factory가 `[test.env].app_start`로 앱을 **먼저** 띄우고(`app_ready`까지
// 조건 대기), 그 다음 게이트가 `[commands].e2e` 문자열을 그대로 실행한다. 러너에는 Playwright 브라우저가
// 없다 — `PLAYWRIGHT_BROWSERS_PATH`를 빈 임시 디렉터리로 고정해 그 조건을 만든다.
//
// 격리: 저장소의 실행 표면(`src/`, `e2e/`, `playwright.config.js`, `package.json`)을 임시 디렉터리에 복사하고
// node_modules만 심볼릭 링크한다. 리포트(`.spike/e2e.json`)가 이 실행의 임시 디렉터리에만 쓰이므로
// 병렬 실행(new-test-repeat)끼리, 또는 개발자 트리에 남은 옛 리포트와 섞이지 않는다. 포트는 루프백의
// 빈 포트를 `PORT`로 주입한다 — 앱(`src/app.js`)과 `playwright.config.js`가 둘 다 `PORT`를 읽는다.
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarness } from "../../.factory/lib/config.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOOPBACK = "127.0.0.1";
const STEP_TIMEOUT_MS = 90_000;
const REPORT = ".spike/e2e.json"; // playwright.config.js의 json 리포터 outputFile (config 디렉터리 기준)

async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK);
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

const healthzStatus = (port) =>
  fetch(`http://${LOOPBACK}:${port}/healthz`).then((r) => r.status, () => 0);

function runShell(cmd, { cwd, env }) {
  const child = spawn("bash", ["-c", cmd], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return once(child, "close").then(([code]) => ({ code, out: out.replace(/\x1b\[[0-9;]*m/g, "") }));
}

let work, port, app, run, harness;

beforeAll(async () => {
  harness = loadHarness(ROOT);
  const { e2e } = harness.commands;
  const { app_start: appStart, app_ready: appReady } = harness.test.env;
  if (typeof e2e !== "string") throw new Error(`.factory/harness.toml [commands].e2e is not a command string (got ${e2e})`);
  if (typeof appStart !== "string") throw new Error(`.factory/harness.toml [test.env].app_start is not set (got ${appStart})`);
  if (!/\/healthz$/.test(String(appReady))) throw new Error(`[test.env].app_ready must point at /healthz (got ${appReady})`);

  work = mkdtempSync(join(tmpdir(), "fq15-e2e-"));
  for (const p of ["src", "e2e", "playwright.config.js", "package.json"]) cpSync(join(ROOT, p), join(work, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(work, "node_modules"), "dir");
  const noBrowsers = join(work, "no-browsers");
  mkdirSync(noBrowsers);
  rmSync(join(work, REPORT), { force: true }); // 이전 리포트가 이 실행의 증거를 대신하지 못하게

  port = await reserveLoopbackPort();
  const env = { ...process.env, PORT: String(port), PLAYWRIGHT_BROWSERS_PATH: noBrowsers };
  // 이 실행의 결과를 바꾸는 외부 오버라이드는 지운다(리포트 경로·baseURL을 밖에서 돌려놓지 못하게).
  for (const k of ["PLAYWRIGHT_JSON_OUTPUT_NAME", "PLAYWRIGHT_JSON_OUTPUT_DIR", "PLAYWRIGHT_TEST_BASE_URL"]) delete env[k];

  // factory의 사전 기동: app_start를 백그라운드로, /healthz 200까지 조건 대기(sleep 금지, docs/QA.md).
  app = spawn("bash", ["-c", `exec ${appStart}`], { cwd: work, env, stdio: ["ignore", "pipe", "pipe"] });
  let appLog = "";
  app.stdout.on("data", (d) => { appLog += d; });
  app.stderr.on("data", (d) => { appLog += d; });
  await vi.waitFor(async () => {
    if (app.exitCode !== null) throw new Error(`app_start exited ${app.exitCode}: ${appLog}`);
    const s = await healthzStatus(port);
    if (s !== 200) throw new Error(`app_ready not yet 200 (got ${s})`);
  }, { timeout: 30_000, interval: 50 });

  run = await runShell(e2e, { cwd: work, env });
}, STEP_TIMEOUT_MS);

afterAll(async () => {
  if (app && app.exitCode === null) {
    const closed = once(app, "close");
    app.kill("SIGTERM");
    await closed;
  }
  if (work) rmSync(work, { recursive: true, force: true });
});

test("test_15_e2e_runs_against_preboot_without_browser", async () => {
  expect({ code: run.code, out: run.out }).toMatchObject({ code: 0 });
  expect(run.out).toMatch(/\d+ passed/);
  expect(run.out).not.toMatch(/\b0 passed/);
  expect(run.out).not.toMatch(/failed/);
  expect(run.out).not.toMatch(/EADDRINUSE|is already used/);
  // 사전 기동한 그 프로세스가 여전히 살아서 응답한다(Playwright가 그것을 대체·종료하지 않았다).
  expect(app.exitCode).toBe(null);
  expect(await healthzStatus(port)).toBe(200);
}, STEP_TIMEOUT_MS);

test("test_15_e2e_report_fresh_and_healthz_passed", () => {
  expect(harness.commands.e2e).toBe("npx playwright test");
  const reportPath = join(work, REPORT);
  expect(existsSync(reportPath)).toBe(true);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const specs = [];
  const walk = (s) => { for (const sp of s.specs || []) specs.push(sp); for (const c of s.suites || []) walk(c); };
  for (const s of report.suites || []) walk(s);
  const healthz = specs.filter((sp) => sp.title === "healthz" && sp.file.endsWith("smoke.spec.js"));
  expect(healthz).toHaveLength(1);
  expect(healthz[0].tests.flatMap((t) => t.results.map((r) => r.status))).toEqual(["passed"]);
  expect(report.stats.unexpected).toBe(0);
  expect(report.stats.expected).toBeGreaterThanOrEqual(1);
}, STEP_TIMEOUT_MS);
