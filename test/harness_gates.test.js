// #15 — 하네스 M2 승격의 회귀 가드 (issue #15 "Spec revision 2").
//
// 앞의 두 테스트는 `.factory/harness.toml`을 **텍스트로** 읽는다(factory 런타임 없이 `npm ci`만으로 돈다).
// 뒤의 테스트들은 factory의 실제 판정 함수(doctor·감지기·게이트 러너·test-env)를 동적으로 불러 쓴다 —
// 그 런타임의 `smol-toml`은 이 파일이 vi.mock으로 공급하므로 이것들도 `npm ci`만으로 돈다(아래 설명).
// Playwright는 이 파일 어디에서도 실행하지 않는다(e2e는 `[commands].e2e` 게이트가 돌린다 — Spec revision 2).
import { test, expect, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// 최소 TOML 읽기: `[section]` 아래의 `key = "string"` / `key = [array]` 한 줄 값만 본다.
// 주석 처리된 키(`# app_start = …`)는 없는 것으로 읽힌다 — 그게 이 가드가 보려는 것이다.
function readSection(text, name) {
  const out = {};
  let inSection = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) { inSection = header[1].trim() === name; continue; }
    if (!inSection || !line || line.startsWith("#")) continue;
    const kv = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const rest = kv[2];
    let value;
    if (rest.startsWith("\"")) {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(rest);
      value = JSON.parse(`"${m[1]}"`);
    } else if (rest.startsWith("[")) {
      value = JSON.parse(rest.slice(0, rest.indexOf("]") + 1));
    } else {
      value = rest.split("#")[0].trim();
    }
    out[kv[1]] = value;
  }
  return out;
}
const harnessText = () => readFileSync(join(ROOT, ".factory/harness.toml"), "utf8");

test("test_15_harness_promoted_to_m2_with_e2e_gate", async () => {
  const text = harnessText();
  const harness = readSection(text, "harness");
  const commands = readSection(text, "commands");
  const gates = readSection(text, "gates");
  const env = readSection(text, "test.env");
  const runtime = readSection(text, "runtime");

  // M2, e2e 명령은 owner가 정한 문자열 그대로.
  expect(harness.maturity).toBe("M2");
  expect(commands.e2e).toBe("npx playwright test");

  // e2e는 full·deep에만 — required·fast(docs tier)에는 없다. deep ⊇ full.
  expect(gates.full).toContain("e2e");
  expect(gates.deep).toContain("e2e");
  expect(gates.required).not.toContain("e2e");
  expect(gates.fast).not.toContain("e2e");
  expect(gates.full.filter((g) => !gates.deep.includes(g))).toEqual([]);

  // e2e가 **PR의 코드**를 검사한다(#15 review cf1/qa1): factory는 base 체크아웃에서 앱을 미리 띄우지
  // 않고(app_start/app_ready 없음), Playwright의 webServer가 현재 트리의 src/app.js를 띄우며
  // 이미 떠 있는 프로세스를 재사용하지 않는다(재사용하면 base에서 뜬 옛 프로세스를 검사할 수 있다).
  expect(env.app_start).toBeUndefined();
  expect(env.app_ready).toBeUndefined();
  const cfg = (await import(pathToFileURL(join(ROOT, "playwright.config.js")).href)).default;
  expect(cfg.webServer.command).toBe("node src/app.js");
  expect(cfg.webServer.reuseExistingServer ?? false).toBe(false);
  // 브라우저 케이스는 선택에서 빠지지 않는다 — 크로미움은 setup이 설치한다.
  expect(cfg.grepInvert).toBeUndefined();
  expect(runtime.setup).toMatch(/npx playwright install --with-deps chromium/);
});

test("test_15_lint_checks_integration_tests", () => {
  const lint = readSection(harnessText(), "commands").lint;
  const runLint = (cwd) => spawnSync("bash", ["-c", lint], { cwd, encoding: "utf8" });

  // 실제 저장소 트리: 초록.
  const real = runLint(ROOT);
  expect({ code: real.status, stderr: real.stderr }).toEqual({ code: 0, stderr: "" });

  // 같은 src/·test/에 구문 오류가 있는 test/integration/*.js 하나를 더한 임시 트리: 빨강.
  // package.json도 복사한다 — `"type": "module"`이 없으면 node --check가 ESM 구문을 검사하지 않고 넘어간다.
  const tmp = mkdtempSync(join(tmpdir(), "fq15-lint-"));
  try {
    cpSync(join(ROOT, "package.json"), join(tmp, "package.json"));
    cpSync(join(ROOT, "src"), join(tmp, "src"), { recursive: true });
    cpSync(join(ROOT, "test"), join(tmp, "test"), { recursive: true });
    writeFileSync(join(tmp, "test/integration/broken_syntax.test.js"), "export const x = ;\n");
    const broken = runLint(tmp);
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain("broken_syntax.test.js");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── factory의 실제 판정 함수로 본 M2 승격 (dw1·dw2) ──────────────────────────────────────────────
// factory 런타임(`.factory/lib/**`)은 **테스트 안에서** 동적으로 import한다. 런타임의 유일한 외부 의존은
// `smol-toml`인데, 그것은 factory setup이 `.factory/node_modules`에 깔 뿐 이 저장소의 package.json에는 없고
// 핀하지도 않는다(issue #15 Spec revision 2: factory 내부용 devDependency 금지). 그래서 이 파일은 `smol-toml`을
// **스스로 공급한다**: 아래의 엄격한 TOML 부분집합 파서로 vi.mock한다. 그러면 `npm ci` 뒤 `npx vitest run`만으로
// (`.factory/node_modules` 없이) 돌고, factory CI에서도 같은 파서를 쓰므로 결과가 환경에 따라 갈리지 않는다(dw2).
// 파서는 모르는 문법을 만나면 추측하지 않고 던진다 — 조용히 잘못 읽어 공허한 초록을 만들지 않게.
function parseTomlSubset(src) {
  let i = 0;
  const fail = (msg) => { throw new Error(`toml-subset: ${msg} at line ${src.slice(0, i).split("\n").length}`); };
  const peek = () => src[i];
  const skipWs = () => { while (i < src.length && (src[i] === " " || src[i] === "\t")) i++; };
  const skipComment = () => { if (src[i] === "#") while (i < src.length && src[i] !== "\n") i++; };
  const skipBlank = () => { for (;;) { skipWs(); skipComment(); if (src[i] === "\n" || src[i] === "\r") { i++; continue; } return; } };
  const endOfLine = () => { skipWs(); skipComment(); if (i < src.length && src[i] !== "\n" && src[i] !== "\r") fail(`unexpected '${src[i]}'`); };
  const str = () => {
    if (src.startsWith("\"\"\"", i) || src.startsWith("'''", i)) fail("multi-line strings unsupported");
    const q = src[i++]; let out = "";
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\n") fail("newline in string");
      if (q === "\"" && src[i] === "\\") {
        const m = /^\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/.exec(src.slice(i));
        if (!m) fail("bad escape");
        out += JSON.parse(`"${m[0]}"`); i += m[0].length;
      } else out += src[i++];
    }
    if (src[i] !== q) fail("unterminated string");
    i++; return out;
  };
  const key = () => {
    const parts = [];
    for (;;) {
      skipWs();
      if (peek() === "\"" || peek() === "'") parts.push(str());
      else { const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i)); if (!m) fail("bad key"); parts.push(m[0]); i += m[0].length; }
      skipWs();
      if (peek() !== ".") return parts;
      i++;
    }
  };
  const assign = (table, parts, value) => {
    let t = table;
    for (const p of parts.slice(0, -1)) { t[p] ??= {}; if (typeof t[p] !== "object" || Array.isArray(t[p])) fail(`key ${p} is not a table`); t = t[p]; }
    const last = parts[parts.length - 1];
    if (Object.hasOwn(t, last)) fail(`duplicate key ${parts.join(".")}`);
    t[last] = value;
  };
  const value = () => {
    const c = peek();
    if (c === "\"" || c === "'") return str();
    if (c === "[") {
      i++; const arr = [];
      for (;;) { skipBlank(); if (peek() === "]") { i++; return arr; } arr.push(value()); skipBlank(); if (peek() === ",") { i++; continue; } if (peek() === "]") { i++; return arr; } fail("bad array"); }
    }
    if (c === "{") {
      i++; const t = {};
      skipWs(); if (peek() === "}") { i++; return t; }
      for (;;) { const k = key(); if (peek() !== "=") fail("expected ="); i++; skipWs(); assign(t, k, value()); skipWs(); if (peek() === ",") { i++; continue; } if (peek() === "}") { i++; return t; } fail("bad inline table"); }
    }
    const m = /^(?:true|false|[+-]?\d+(?:\.\d+)?)(?![A-Za-z0-9_.:-])/.exec(src.slice(i));
    if (!m) fail("unsupported value");
    i += m[0].length;
    return m[0] === "true" ? true : m[0] === "false" ? false : Number(m[0]);
  };
  const root = {}; let cur = root;
  for (;;) {
    skipBlank();
    if (i >= src.length) return root;
    if (peek() === "[") {
      if (src[i + 1] === "[") fail("arrays of tables unsupported");
      i++; const parts = key(); if (peek() !== "]") fail("bad table header"); i++; endOfLine();
      cur = root;
      for (const p of parts) { cur[p] ??= {}; if (typeof cur[p] !== "object" || Array.isArray(cur[p])) fail(`${p} is not a table`); cur = cur[p]; }
      continue;
    }
    const k = key(); if (peek() !== "=") fail("expected ="); i++; skipWs();
    assign(cur, k, value()); endOfLine();
  }
}
vi.mock("smol-toml", () => ({
  parse: parseTomlSubset,
  stringify: () => { throw new Error("smol-toml.stringify is not provided in test/harness_gates.test.js"); },
}));

const factoryLib = (p) => import(pathToFileURL(join(ROOT, ".factory/lib", p)).href);

test("test_15_factory_runtime_tests_need_only_npm_ci", async () => {
  // factory 런타임이 보는 `smol-toml`은 이 파일이 공급한 것이다 — `.factory/node_modules`의 것이 아니다.
  // (vi.mock을 지우면 factory CI에서는 다른 parse가 잡혀 실패하고, 깨끗한 체크아웃에서는 import부터 실패한다.)
  expect((await import("smol-toml")).parse).toBe(parseTomlSubset);
  const { loadHarness } = await factoryLib("config.js");
  expect(loadHarness(ROOT).harness.maturity).toBe("M2");

  // 파서의 충실도: 이 하네스가 쓰는 문법(점 헤더, 여러 줄 배열, 인라인 테이블, 따옴표 키, 이스케이프, 주석).
  expect(parseTomlSubset([
    "schema = 1  # c",
    "[a.b]",
    "s = \"x \\\"q\\\" # not a comment\"",
    "arr = [\"p\",",
    "       \"q\",   # c",
    "]",
    "it = { unit = \"u.js\", \"k/*.md\" = [\"## E\"] }",
    "[c]",
    "on = true",
    "n = 90",
  ].join("\n"))).toEqual({
    schema: 1,
    a: { b: { s: "x \"q\" # not a comment", arr: ["p", "q"], it: { unit: "u.js", "k/*.md": ["## E"] } } },
    c: { on: true, n: 90 },
  });
  // 모르는 문법·중복 키는 추측하지 않고 던진다.
  for (const bad of ["x = \"\"\"m\"\"\"", "[[t]]", "x = 1979-05-27", "x = 1\nx = 2", "x = 1 y"]) {
    expect(() => parseTomlSubset(bad), bad).toThrow(/toml-subset/);
  }
});
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// doctor가 받는 `files`와 같은 모양(저장소 상대 경로, `/` 구분).
const SKIP_DIRS = new Set(["node_modules", ".git", ".spike", "test-results", "coverage"]);
function repoFiles(dir = ROOT, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(ROOT, abs).split(sep).join("/");
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || rel === ".factory/out") continue;
      repoFiles(abs, out);
    } else out.push(rel);
  }
  return out;
}

test("test_15_doctor_passes_at_m2_and_gap_silent", async () => {
  const { loadHarness, loadHarnessRaw } = await factoryLib("config.js");
  const { checkHarness } = await factoryLib("doctor/harness.js");
  const { detectMaturityGaps } = await factoryLib("retro/maturity.js");

  const harness = loadHarness(ROOT);
  const files = repoFiles();
  const checks = checkHarness({ harness, files, raw: loadHarnessRaw(ROOT) });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));

  // doctor의 정적 판정: FAIL 없음, maturity PASS(M2), deep이 full을 포함한다(levels-identical PASS).
  expect(checks.filter((c) => c.level === "FAIL")).toEqual([]);
  expect(byId["harness.maturity"]).toMatchObject({ level: "PASS", detail: "M2" });
  expect(byId["gates.levels-identical"]?.level).toBe("PASS");

  // 이 이슈를 연 감지기(`http-at-m1`)가 실제 하네스로는 조용하다.
  const pkg = readJson("package.json");
  const manifestDeps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  const rules = (h) => detectMaturityGaps({ files, harness: h, manifestDeps }).map((g) => g.rule);
  expect(rules(harness)).not.toContain("http-at-m1");
  // 대조군: 같은 입력에 maturity만 M1이면 다시 울린다 — 위의 침묵은 입력을 못 봐서가 아니다.
  const asM1 = { ...harness, harness: { ...harness.harness, maturity: "M1" } };
  expect(rules(asM1)).toContain("http-at-m1");
});

// runGates에 주입하는 가짜 실행기: 명령 문자열을 기록하고, `redCmd`만 exit 1을 돌려준다.
function fakeRun(redCmd) {
  const calls = [];
  const run = async (_bin, args) => {
    const cmd = args[args.length - 1];
    calls.push(cmd);
    return { code: cmd === redCmd ? 1 : 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

test("test_15_e2e_gate_blocks_full_not_fast", async () => {
  const { loadHarness } = await factoryLib("config.js");
  const { runGates } = await factoryLib("gates.js");
  const harness = loadHarness(ROOT);
  const e2e = harness.commands.e2e;
  expect(typeof e2e).toBe("string");
  const gatesAt = (level, run) =>
    runGates({ run, cwd: ROOT, harness, level, quarantine: null, readFile: () => null, now: "2026-01-01T00:00:00Z" });

  // standard tier(full): e2e 명령이 실제로 불리고, 그것이 exit 1이면 판정이 RED로 뒤집힌다.
  const red = fakeRun(e2e);
  const fullRed = await gatesAt("full", red.run);
  expect(red.calls).toContain(e2e);
  expect(fullRed.status).toBe("RED");
  expect(fullRed.failing).toEqual(["e2e"]);
  // 대조군: 같은 레벨에서 e2e가 초록이면 GREEN — 위 RED는 e2e 한 게이트 때문이다.
  expect((await gatesAt("full", fakeRun(null).run)).status).toBe("GREEN");
  // deep(load-bearing tier)도 e2e RED로 뒤집힌다.
  expect((await gatesAt("deep", fakeRun(e2e).run)).status).toBe("RED");

  // docs tier(fast)·required: e2e 명령이 아예 불리지 않는다(앱 기동 비용을 물리지 않는다).
  for (const level of ["fast", "required"]) {
    const r = fakeRun(e2e);
    const result = await gatesAt(level, r.run);
    expect({ level, calledE2e: r.calls.includes(e2e), status: result.status }).toEqual({ level, calledE2e: false, status: "GREEN" });
  }
});

// ── e2e는 PR의 코드를 검사한다 (review cf1/qa1, Spec revision 2) ──────────────────────────────────
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

test("test_15_e2e_boots_this_tree_app_not_a_preboot", async () => {
  const { loadHarness } = await factoryLib("config.js");
  const { envUp } = await factoryLib("test-env.js");
  const harness = loadHarness(ROOT);

  // (1) factory의 test-env up은 앱을 미리 띄우지 않는다: base 체크아웃에서 뜬 앱이 :3000을 쥐고 남아
  // PR head의 e2e가 그것을 검사하는 경로(cf1/qa1)가 없다. compose·fetch는 가짜로 관측만 한다.
  const up = async (h) => {
    const spawned = [];
    const savedProject = process.env.COMPOSE_PROJECT_NAME;
    try {
      const res = await envUp({
        run: async () => ({ code: 0, stdout: "", stderr: "" }), cwd: ROOT, harness: h,
        spawnBg: (cmd) => { spawned.push(cmd); return { pid: 0 }; },
        fetch: async () => ({ status: 200 }), sleep: async () => {},
      });
      return { ok: res.ok, spawned };
    } finally {
      if (savedProject === undefined) delete process.env.COMPOSE_PROJECT_NAME; else process.env.COMPOSE_PROJECT_NAME = savedProject;
    }
  };
  expect(await up(harness)).toEqual({ ok: true, spawned: [] });
  // 대조군: app_start가 있으면 envUp은 그것을 띄운다 — 위의 빈 목록은 관측이 비어서가 아니다.
  const withPreboot = { ...harness, test: { ...harness.test, env: { ...harness.test.env, app_start: "node src/app.js", app_ready: "http://localhost:3000/healthz" } } };
  expect((await up(withPreboot)).spawned).toEqual(["node src/app.js"]);

  // (2) Playwright의 webServer는 **자기 트리**의 src/app.js를 띄우고, 그 프로세스가 Playwright가 기다리는
  // URL에 답한다. 임시 트리의 src/app.js를 표식을 돌려주는 앱으로 바꿔, 설정이 가리키는 명령·URL·포트가
  // 그 트리의 코드로 이어지는지 본다. Playwright 자체는 실행하지 않는다(Spec revision 2).
  const tmp = mkdtempSync(join(tmpdir(), "fq15-webserver-"));
  let child;
  try {
    cpSync(join(ROOT, "package.json"), join(tmp, "package.json"));
    cpSync(join(ROOT, "playwright.config.js"), join(tmp, "playwright.config.js"));
    mkdirSync(join(tmp, "src"));
    const marker = `THIS-TREE-${process.pid}-${Date.now()}`;
    writeFileSync(join(tmp, "src/app.js"),
      `import { createServer } from "node:http";\n` +
      `createServer((q, s) => { s.statusCode = q.url === "/healthz" ? 200 : 404; s.end(${JSON.stringify(marker)}); })` +
      `.listen(Number(process.env.PORT));\n`);
    const port = await reserveLoopbackPort();
    const env = { ...process.env, PORT: String(port) };
    const cfgOut = spawnSync(process.execPath, ["--input-type=module", "-e",
      "const m = await import(process.cwd() + '/playwright.config.js'); console.log(JSON.stringify(m.default.webServer));"],
      { cwd: tmp, env, encoding: "utf8" });
    expect({ code: cfgOut.status, stderr: cfgOut.stderr }).toEqual({ code: 0, stderr: "" });
    const ws = JSON.parse(cfgOut.stdout);
    // 이미 떠 있는 프로세스를 재사용하지 않는다 — 재사용하면 그 포트의 주인(옛 base 앱일 수 있다)을 검사한다.
    expect(ws.reuseExistingServer ?? false).toBe(false);

    child = spawn("bash", ["-c", `exec ${ws.command}`], { cwd: tmp, env: { ...env, ...(ws.env || {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d; });
    child.stderr.on("data", (d) => { log += d; });
    const body = await vi.waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`webServer.command exited ${child.exitCode}: ${log}`);
      const r = await fetch(ws.url);
      if (r.status !== 200) throw new Error(`webServer.url not ready (status ${r.status})`);
      return r.text();
    }, { timeout: 20_000, interval: 50 });
    expect(body).toBe(marker);
  } finally {
    if (child && child.exitCode === null) {
      const closed = once(child, "close");
      child.kill("SIGTERM");
      await closed;
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}, 30_000);
