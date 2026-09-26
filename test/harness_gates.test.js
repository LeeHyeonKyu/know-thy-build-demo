// #15 — 하네스 M2 승격의 회귀 가드.
//
// 관측점은 설정 텍스트가 아니라 **factory가 실제로 내리는 판정**이다: doctor의 정적 검사
// (`checkHarness`), retro의 성숙도 감지기(`detectMaturityGaps`), 게이트 러너(`runGates`), 그리고
// lint 게이트 명령의 실제 종료 코드. 모두 저장소의 실제 `.factory/harness.toml`을 읽는다.
//
// 설치 경로: 이 파일은 벤더링된 factory 런타임(`.factory/lib/**`)을 import하고, 그 런타임의 유일한
// 외부 의존 `smol-toml`은 이 저장소의 `package.json` devDependencies에도 같은 핀으로 선언돼 있다.
// 그래서 `npm ci` 뒤 `npx vitest run`만으로 수집된다(`.factory/node_modules`가 없어도) —
// `test_15_factory_runtime_deps_install_with_npm_ci`가 그 사실을 지킨다.
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarness, loadHarnessRaw } from "../.factory/lib/config.js";
import { checkHarness } from "../.factory/lib/doctor/harness.js";
import { detectMaturityGaps } from "../.factory/lib/retro/maturity.js";
import { runGates } from "../.factory/lib/gates.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

// doctor가 받는 `files`와 같은 모양(저장소 상대 경로, `/` 구분). `git ls-files`를 쓰지 않는 이유:
// `git archive`로 만든 깨끗한 트리에는 .git이 없다 — 그래도 이 테스트는 돌아야 한다.
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
const manifestDeps = () => {
  const pkg = readJson("package.json");
  return [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
};

test("test_15_doctor_passes_at_m2_and_gap_silent", () => {
  const harness = loadHarness(ROOT);
  const files = repoFiles();
  const checks = checkHarness({ harness, files, raw: loadHarnessRaw(ROOT) });
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));

  expect(checks.filter((c) => c.level === "FAIL")).toEqual([]);
  expect(byId["harness.maturity"]).toMatchObject({ level: "PASS", detail: "M2" });
  expect(byId["gates.levels-identical"].level).toBe("PASS");
  // deep ⊇ full — doctor의 판정과 별개로 집합으로도 확인한다.
  const deep = new Set(harness.gates.deep);
  expect(harness.gates.full.filter((g) => !deep.has(g))).toEqual([]);

  const rules = (h) => detectMaturityGaps({ files, harness: h, manifestDeps: manifestDeps() }).map((g) => g.rule);
  expect(rules(harness)).not.toContain("http-at-m1");
  // 대조군: 같은 입력에 maturity만 M1이면 감지기가 다시 울린다(감지기가 입력을 못 봐서 조용한 게 아니다).
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
const gatesAt = (harness, level, run) => runGates({ run, cwd: ROOT, harness, level, quarantine: null, readFile: () => null, now: "2026-01-01T00:00:00Z" });

test("test_15_e2e_gate_blocks_full_not_fast", async () => {
  const harness = loadHarness(ROOT);
  const e2e = harness.commands.e2e;
  expect(typeof e2e).toBe("string");

  // standard tier(full): e2e 명령이 실제로 불리고, 그것이 exit 1이면 판정이 RED로 뒤집힌다.
  const red = fakeRun(e2e);
  const fullRed = await gatesAt(harness, "full", red.run);
  expect(red.calls).toContain(e2e);
  expect(fullRed.status).toBe("RED");
  expect(fullRed.failing).toEqual(["e2e"]);
  // 대조군: 같은 레벨에서 e2e가 초록이면 GREEN이다 — 위 RED는 e2e 한 게이트 때문이다.
  const green = fakeRun(null);
  expect((await gatesAt(harness, "full", green.run)).status).toBe("GREEN");

  // docs tier(fast): e2e 명령이 아예 불리지 않는다(앱 기동 비용을 물리지 않는다).
  const fast = fakeRun(e2e);
  const fastResult = await gatesAt(harness, "fast", fast.run);
  expect(fast.calls).not.toContain(e2e);
  expect(fastResult.status).toBe("GREEN");

  // owner spec: e2e는 full·deep에만 — required·fast에는 없다.
  expect(harness.gates.required).not.toContain("e2e");
  expect(harness.gates.fast).not.toContain("e2e");
});

test("test_15_factory_runtime_deps_install_with_npm_ci", () => {
  // 이 파일이 import하는 factory 런타임의 외부 의존은 `.factory/package.json`에 선언돼 있고, 그것은
  // `npm ci`(= [runtime].setup)가 설치하지 않는다. 저장소 매니페스트가 같은 핀으로 선언하고, 그 패키지가
  // **프로젝트 루트의** node_modules에서 해석돼야 깨끗한 클론에서 `npm ci && npx vitest run`이 성립한다.
  const runtimeDeps = readJson(".factory/package.json").dependencies || {};
  const pkg = readJson("package.json");
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const lock = readJson("package-lock.json");
  const requireFromRoot = createRequire(join(ROOT, "package.json"));
  expect(Object.keys(runtimeDeps).length).toBeGreaterThan(0);
  for (const [name, pin] of Object.entries(runtimeDeps)) {
    expect({ name, declared: declared[name] }).toEqual({ name, declared: pin });
    expect({ name, locked: lock.packages?.[`node_modules/${name}`]?.version }).toEqual({ name, locked: pin });
    const resolved = requireFromRoot.resolve(name);
    expect(resolved.startsWith(join(ROOT, "node_modules") + sep)).toBe(true);
  }
});

test("test_15_lint_checks_integration_tests", () => {
  const lint = loadHarness(ROOT).commands.lint;
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
