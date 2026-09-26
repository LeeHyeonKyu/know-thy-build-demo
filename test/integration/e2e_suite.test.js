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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// 브라우저 케이스의 선택 해제는 "크로미움 실행 파일이 없을 때"에만 일어나야 한다. 무조건 빼는 설정
// (영구 skip과 같은 효과)으로 퇴행하면, 브라우저가 있는 환경에서도 `browser loads`가 목록에서 사라져
// 이 테스트가 RED가 된다. `--list`는 테스트를 실행하지 않고(브라우저를 띄우지 않고) 선택 결과만 보여 준다.
test("test_15_browser_case_deselected_only_without_browser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fq15-list-"));
  try {
    for (const p of ["e2e", "playwright.config.js", "package.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    const browsersPath = join(dir, "browsers");
    mkdirSync(browsersPath);
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath };
    // --reporter=list: 목록만 콘솔에 — json 리포트를 쓰지 않는다.
    const list = () => runShell("npx playwright test --list --reporter=list", { cwd: dir, env });
    const listed = (out) => [...out.matchAll(/smoke\.spec\.js:\d+:\d+ › (.+)$/gm)].map((m) => m[1].trim()).sort();

    // 크로미움 없음: healthz만 선택되고, 빼는 사실이 출력에 드러난다.
    const without = await list();
    expect({ code: without.code, cases: listed(without.out) }).toEqual({ code: 0, cases: ["healthz"] });
    expect(without.out).toContain("chromium not installed");

    // 크로미움 있음(Playwright가 찾는 바로 그 경로에 실행 파일): 기존 케이스 전부가 선택된다.
    const probe = await runShell(
      `node --input-type=module -e 'import("@playwright/test").then((m) => console.log(m.chromium.executablePath()))'`,
      { cwd: dir, env },
    );
    const exe = probe.out.trim().split("\n").pop();
    expect(exe.startsWith(browsersPath)).toBe(true);
    mkdirSync(join(exe, ".."), { recursive: true });
    writeFileSync(exe, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const withBrowser = await list();
    expect({ code: withBrowser.code, cases: listed(withBrowser.out) }).toEqual({ code: 0, cases: ["browser loads", "healthz"] });
    expect(withBrowser.out).not.toContain("chromium not installed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, STEP_TIMEOUT_MS);

// ---------------------------------------------------------------------------------------------------------
// #15 rework cf1/qa1 — 파이프라인에서 사전 기동한 앱이 **PR 코드가 아닐 수 있다**.
//
// review/merge에서는 setup이 base 체크아웃에서 `app_start`를 띄운 뒤(`.factory/actions/setup`), 트리가 PR head로
// 바뀌고(`checkoutHead`), 게이트 직전 re-up의 두 번째 `app_start`는 :PORT를 못 잡고 EADDRINUSE로 죽는다 — 그래도
// `app_ready`는 살아 있는 base 프로세스에게서 200을 받는다. 아래 테스트는 그 순서를 그대로 재현한다: 트리에서
// 앱을 띄우고(= base), 그 **다음에** 트리의 `src/`를 바꾼다(= checkout). 그 뒤 `[commands].e2e`가 검사하는 것은
// 지금 트리의 코드여야 한다 — 옛 프로세스의 응답이 아니라.
// ---------------------------------------------------------------------------------------------------------

import { utimesSync } from "node:fs";

function stageTree(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  for (const p of ["src", "e2e", "playwright.config.js", "package.json"]) cpSync(join(ROOT, p), join(dir, p), { recursive: true });
  symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  mkdirSync(join(dir, "no-browsers"));
  return dir;
}

function e2eEnv(dir, appPort) {
  const env = { ...process.env, PORT: String(appPort), PLAYWRIGHT_BROWSERS_PATH: join(dir, "no-browsers") };
  for (const k of ["PLAYWRIGHT_JSON_OUTPUT_NAME", "PLAYWRIGHT_JSON_OUTPUT_DIR", "PLAYWRIGHT_TEST_BASE_URL", "E2E_RESOLVED_PORT"]) delete env[k];
  return env;
}

// factory의 사전 기동과 같은 모양: `[test.env].app_start`를 백그라운드로 띄우고 /healthz 200까지 조건 대기.
async function preboot(cwd, env, cmd = harness.test.env.app_start) {
  const child = spawn("bash", ["-c", `exec ${cmd}`], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  await vi.waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`preboot exited ${child.exitCode}: ${log}`);
    const s = await healthzStatus(env.PORT);
    if (s !== 200) throw new Error(`preboot not yet 200 (got ${s})`);
  }, { timeout: 30_000, interval: 50 });
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = once(child, "close");
  child.kill("SIGTERM");
  await closed;
}

function caseStatuses(dir) {
  const report = JSON.parse(readFileSync(join(dir, REPORT), "utf8"));
  const out = {};
  const walk = (s) => {
    for (const sp of s.specs || []) out[sp.title] = sp.tests.flatMap((t) => t.results.map((r) => r.status));
    for (const c of s.suites || []) walk(c);
  };
  for (const s of report.suites || []) walk(s);
  return out;
}

const statusOf = (p, path) => fetch(`http://${LOOPBACK}:${p}${path}`).then((r) => r.status, () => 0);

// 방향 1: PR이 새 라우트와 그 e2e 케이스를 더한다. 옛 프로세스를 상대로 돌면 404로 RED가 된다(올바른 PR이 막힌다).
test("test_15_e2e_checks_pr_tree_not_stale_preboot_new_route", async () => {
  const dir = stageTree("fq15-stale-new-");
  let base;
  try {
    const p = await reserveLoopbackPort();
    const env = e2eEnv(dir, p);
    base = await preboot(dir, env);
    // checkout: 트리의 코드가 기동 **뒤에** 바뀐다.
    const appJs = join(dir, "src/app.js");
    const src = readFileSync(appJs, "utf8");
    const anchor = 'app.get("/version"';
    expect(src).toContain(anchor);
    writeFileSync(appJs, src.replace(anchor, 'app.get("/fq15-probe", (_req, res) => res.status(200).json({ probe: true }));\n' + anchor));
    writeFileSync(join(dir, "e2e/probe.spec.js"),
      'import { test, expect } from "@playwright/test";\ntest("fq15 probe", async ({ request }) => {\n  expect((await request.get("/fq15-probe")).status()).toBe(200);\n});\n');
    // 전제: 사전 기동한 프로세스는 옛 코드다(새 라우트를 모른다).
    expect(await statusOf(p, "/fq15-probe")).toBe(404);

    const r = await runShell(harness.commands.e2e, { cwd: dir, env });
    expect({ code: r.code, cases: caseStatuses(dir) }).toMatchObject({ code: 0, cases: { "fq15 probe": ["passed"], healthz: ["passed"] } });
    expect(r.out).not.toMatch(/EADDRINUSE|is already used/);
  } finally {
    await stop(base);
    rmSync(dir, { recursive: true, force: true });
  }
}, STEP_TIMEOUT_MS);

// 방향 2: PR이 /healthz 계약(200)을 깬다. 옛 프로세스를 상대로 돌면 여전히 200이라 GREEN이 된다(깨진 PR이 통과한다).
test("test_15_e2e_checks_pr_tree_not_stale_preboot_broken_healthz", async () => {
  const dir = stageTree("fq15-stale-broken-");
  let base;
  try {
    const p = await reserveLoopbackPort();
    const env = e2eEnv(dir, p);
    base = await preboot(dir, env);
    const appJs = join(dir, "src/app.js");
    const src = readFileSync(appJs, "utf8");
    const healthy = '.status(200).json({ ok: true })';
    expect(src).toContain(healthy);
    writeFileSync(appJs, src.replace(healthy, '.status(201).json({ ok: true })'));
    // 전제: 사전 기동한 프로세스는 여전히 옛 200을 준다.
    expect(await statusOf(p, "/healthz")).toBe(200);

    const r = await runShell(harness.commands.e2e, { cwd: dir, env });
    expect(r.code).not.toBe(0);
    expect(caseStatuses(dir)).toMatchObject({ healthz: ["failed"] });
  } finally {
    await stop(base);
    rmSync(dir, { recursive: true, force: true });
  }
}, STEP_TIMEOUT_MS);

// 반대쪽 가드: 트리가 기동 뒤에 바뀌지 않았으면 사전 기동한 그 앱을 재사용한다(owner spec: reuseExistingServer,
// "e2e runs against the pre-booted app"). src/의 mtime을 기동보다 한 시간 앞으로 고정해 시각 경계를 없앤다.
test("test_15_e2e_reuses_preboot_when_tree_unchanged", async () => {
  const dir = stageTree("fq15-fresh-");
  let base;
  try {
    const past = new Date(Date.now() - 3_600_000);
    for (const f of ["src/app.js", "src/version.js", "src"]) utimesSync(join(dir, f), past, past);
    const p = await reserveLoopbackPort();
    const env = e2eEnv(dir, p);
    base = await preboot(dir, env);
    const r = await runShell(harness.commands.e2e, { cwd: dir, env });
    expect({ code: r.code, cases: caseStatuses(dir) }).toMatchObject({ code: 0, cases: { healthz: ["passed"] } });
    expect(r.out).toContain(`reusing pre-booted app pid ${base.pid} on :${p}`);
    expect(r.out).not.toMatch(/booting this tree's app/);
    expect(base.exitCode).toBe(null);
  } finally {
    await stop(base);
    rmSync(dir, { recursive: true, force: true });
  }
}, STEP_TIMEOUT_MS);

// 낯선 서버(이 트리가 아닌 곳에서 뜬 프로세스)가 PORT의 /healthz에 200을 주어도 그것을 대상으로 삼지 않는다(plan d2).
test("test_15_e2e_ignores_foreign_server_on_port", async () => {
  const dir = stageTree("fq15-foreign-");
  const elsewhere = mkdtempSync(join(tmpdir(), "fq15-elsewhere-"));
  let foreign;
  try {
    // src/를 과거로 고정한다 — 그래야 "옛 코드" 판정이 아니라 "이 트리가 아니다" 판정만이 낯선 서버를 거를 수 있다.
    const past = new Date(Date.now() - 3_600_000);
    for (const f of ["src/app.js", "src/version.js", "src"]) utimesSync(join(dir, f), past, past);
    writeFileSync(join(dir, "e2e/version.spec.js"),
      'import { test, expect } from "@playwright/test";\ntest("fq15 version", async ({ request }) => {\n  expect((await request.get("/version")).status()).toBe(200);\n});\n');
    writeFileSync(join(elsewhere, "server.cjs"),
      'require("node:http").createServer((q, s) => { s.statusCode = q.url === "/healthz" ? 200 : 404; s.end("{}"); }).listen(Number(process.env.PORT));\n');
    const p = await reserveLoopbackPort();
    const env = e2eEnv(dir, p);
    foreign = await preboot(elsewhere, env, "node server.cjs");
    expect(await statusOf(p, "/version")).toBe(404);
    const r = await runShell(harness.commands.e2e, { cwd: dir, env });
    expect({ code: r.code, cases: caseStatuses(dir) }).toMatchObject({ code: 0, cases: { "fq15 version": ["passed"], healthz: ["passed"] } });
  } finally {
    await stop(foreign);
    rmSync(dir, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
}, STEP_TIMEOUT_MS);
