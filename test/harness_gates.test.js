// #15 — 하네스 M2 승격의 회귀 가드 (issue #15 "Spec revision 2").
//
// 이 파일은 factory 런타임(`.factory/lib/**`)을 import하지 않는다 — `.factory/harness.toml`을 **텍스트로**
// 읽는다. 그래서 `npm ci` 뒤 `npx vitest run`만으로 돈다. Playwright도 여기서 실행하지 않는다(e2e는
// `[commands].e2e` 게이트가 돌린다).
import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
