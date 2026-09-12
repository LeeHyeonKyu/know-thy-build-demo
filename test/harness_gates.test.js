// issue #15 — 하네스 성숙도 승격(M2)의 게이트 성질을 저장소의 **실제** 하네스로 지킨다.
//
// 두 단언 모두 설정 텍스트를 베껴 쓰지 않는다: `.factory/harness.toml`을 판정 엔진
// (`.factory/lib/gates.js`의 runGates, `.factory/lib/test-env.js`의 envUp)에 실제로 통과시키고,
// 밖에서 관측 가능한 것 — "무슨 명령이 실행됐는가", "무슨 판정이 나왔는가",
// "누가 프로세스를 띄웠는가" — 만 본다. 그래서 이 파일은 harness.toml의 한 줄이 바뀌면
// 그 줄의 **결과**가 달라질 때만 색이 바뀐다.
//
// 정직한 한계(verifier 지적에 대한 답): 이 두 단언은 **이 PR의 diff로는 빨개지지 않는다**. 둘을 뒤집는
// 유일한 파일이 `.factory/harness.toml`이고 그 경로는 `.factory/ci-settings.json`의 `Edit/Write(.factory/**)`
// deny로 이 역할에게 닫혀 있기 때문이다(실측: Edit 시도 → "File is in a directory that is denied by your
// permission settings"). 그러므로 이 파일은 "구현을 되돌리면 빨개지는 증명"이 아니라 **사람이 머지할 승격
// diff에 거는 선행 가드**다 — `[gates].fast`에 e2e가 들어가거나 `[test.env].app_start`가 켜지는 순간 빨개진다.
// 그 두 가지가 PR 본문 "Harness change needed"의 승격안에서 가장 틀리기 쉬운 자리다.
import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadHarness } from "../.factory/lib/config.js";
import { runGates } from "../.factory/lib/gates.js";
import { envUp } from "../.factory/lib/test-env.js";
// issue #15(2라운드)에서 더해진 단언들이 쓴다 — 위 블록의 두 케이스는 이 심볼들을 쓰지 않는다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectMaturityGaps } from "../.factory/lib/retro/maturity.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NOW = "2026-01-01T00:00:00Z";   // 판정 결과에 시계가 끼어들지 않게 고정한다(docs/QA.md)

// 주입 러너: 실행된 (cmd, args) 쌍을 기록만 하고 항상 성공을 돌려준다. 게이트 명령을 실제로
// 돌리지 않는 이유는 속도가 아니라 결정성이다 — 이 파일은 "무엇이 실행되는가"만 묻는다.
function recordingRunner(codeFor = () => 0) {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const code = codeFor(cmd, args);
    return { code, stdout: "", stderr: "" };
  };
  return { run, calls, shellCommands: () => calls.filter((c) => c.cmd === "bash").map((c) => c.args[c.args.length - 1]) };
}

describe("issue #15 — e2e 승격이 게이트에서 실제로 하는 일", () => {
  // dw2: docs tier(fast)는 이 승격으로 막히지 않는다. e2e가 fast 레벨로 새어 들어오면
  // README 한 줄 PR까지 앱 기동을 기다리게 된다(CHARTER Tiers: docs → fast).
  // 이 단언은 harness.toml의 `[gates].fast`에 `e2e`가 추가되는 순간 RED가 된다.
  test("test_15_fast_level_does_not_run_e2e", async () => {
    const harness = loadHarness(ROOT);
    const runner = recordingRunner();
    const result = await runGates({
      run: runner.run,
      cwd: ROOT,
      harness,
      level: "fast",
      quarantine: { quarantined: [] },
      readFile: () => null, // 리포트는 읽지 않는다 — 판정 근거를 종료 코드로 고정한다
      now: "2026-01-01T00:00:00Z",
    });

    // (0) 먼저 fast가 **비어 있지 않다**는 것을 고정한다. 이게 없으면 아래 `not.toContain`들이
    //     "아무 게이트도 안 돌았다"라는 이유로 전부 공허하게 통과한다(게으른 통과 경로 봉쇄).
    expect(Object.keys(result.gates)).toEqual(expect.arrayContaining(["lint", "unit"]));
    expect(runner.shellCommands()).toContain(harness.commands.unit);
    // (a) e2e 게이트가 fast 레벨에서 만들어지지 않았다.
    expect(Object.keys(result.gates)).not.toContain("e2e");
    // (b) e2e 명령이 실행되지 않았다 — 게이트 이름이 아니라 실제로 돈 셸 명령을 본다.
    //     `commands.e2e`가 아직 없는 하네스에서도(현재), 생긴 뒤에도(승격 후) 같은 뜻이다.
    const e2eCommand = harness.commands.e2e;
    if (e2eCommand) expect(runner.shellCommands()).not.toContain(e2eCommand);
    expect(runner.shellCommands()).not.toEqual(expect.arrayContaining([expect.stringContaining("playwright")]));
    // (c) 그러면서도 fast는 여전히 판정을 내린다 — "아무것도 안 물렸다"가 GREEN으로 읽히면 안 되므로
    //     required_missing이 비어 있다는 것까지 같이 본다(gates.js의 MISCONFIGURED 경로).
    expect(result.required_missing).toEqual([]);
    expect(result.status).toBe("GREEN");
  });

  // dw3: 앱을 띄우는 주인이 정확히 하나다. `[test.env].app_start`/`app_ready`를 켜면
  // playwright.config.js의 webServer와 포트를 다투게 되므로, test-env는 compose만 띄워야 한다.
  // 관측점은 설정 키가 아니라 **부수효과**다: 배경 프로세스 spawn과 ready URL 폴링이 0회인가.
  test("test_15_single_app_lifecycle_owner", async () => {
    const harness = loadHarness(ROOT);
    const runner = recordingRunner();
    const spawned = [];
    const fetched = [];
    const result = await envUp({
      run: runner.run,
      cwd: ROOT,
      harness,
      spawnBg: (cmd) => { spawned.push(cmd); return { pid: 1 }; },
      fetch: async (url) => { fetched.push(url); return { status: 200 }; },
      // sleep이 불리면 그 자체가 폴링이 일어났다는 뜻이다 — 대기하지 않고 즉시 실패시킨다.
      sleep: async () => { throw new Error("test-env waited: app_ready polling must not happen"); },
    });

    expect(result.ok).toBe(true);
    expect(spawned).toEqual([]);   // 배경 프로세스(앱·fake)를 하나도 띄우지 않았다
    expect(fetched).toEqual([]);   // ready URL을 한 번도 두드리지 않았다
    // 그런데 compose는 띄웠다 — "아무것도 안 한다"와 "앱만 안 띄운다"를 구분한다.
    expect(result.steps.map((s) => s.name)).toEqual(["compose"]);
    expect(runner.calls.map((c) => c.cmd)).toEqual(["docker"]);
  });
});

// ── 이 라운드부터 `.factory/harness.toml`이 이 역할에게 열렸다 ────────────────────────────────
// 위 블록 머리말의 "harness.toml은 닫혀 있다"는 전제는 이 라운드에 더 이상 유효하지 않다:
// `factory:harness` 라벨 이슈의 implement 스테이지는 `.factory/ci-settings-harness.json`으로 돌고
// (`.factory/bin/run-stage.js`), 그 deny 목록에 `.factory/harness.toml`도 `playwright.config.*`도 없다.
// 그래서 아래 두 단언은 선행 가드가 아니라 **이 diff를 되돌리면 빨개지는** 증명이다.
describe("issue #15 — M2 승격이 판정을 실제로 뒤집는가", () => {
  // dw1: "설정에 e2e라고 적혀 있다"가 아니라 "판정 엔진이 e2e 때문에 GREEN을 내지 못한다"를 본다.
  // 세 갈래를 한 테스트에 묶는 이유: 셋 중 하나만 빠져도 승격은 "초록으로 보이는 꺼진 게이트"가 된다.
  //   (a) full 레벨이 harness.commands.e2e **문자열 그대로**를 실행한다
  //   (b) 그 명령이 exit 1이면 판정이 RED다 (게이트가 판정을 뒤집는다)
  //   (c) commands.e2e 키만 사라지면 판정이 MISCONFIGURED다 — gates.js의 required 교집합 필터 때문에
  //       `[gates].required`에 e2e가 없으면 이 경우가 조용히 GREEN이 된다.
  test("test_15_e2e_gate_red_and_misconfigured_are_not_green", async () => {
    const harness = loadHarness(ROOT);

    // 부수 절(base에서도 참): fast는 lint·unit을 **실제로** 실행하고 e2e는 건드리지 않는다.
    // 먼저 "돌긴 돌았다"를 고정해야 아래 not.* 단언들이 공허하게 통과하지 못한다.
    const fastRunner = recordingRunner();
    const fast = await runGates({
      run: fastRunner.run, cwd: ROOT, harness, level: "fast",
      quarantine: { quarantined: [] }, readFile: () => null, now: NOW,
    });
    expect(fastRunner.shellCommands()).toEqual(expect.arrayContaining([harness.commands.lint, harness.commands.unit]));
    expect(Object.keys(fast.gates)).not.toContain("e2e");
    expect(fast.required_missing).toEqual([]);
    expect(fast.status).toBe("GREEN");

    // (a) full 레벨은 e2e 게이트를 만들고, 하네스에 적힌 명령을 그대로 셸에 넘긴다.
    const greenRunner = recordingRunner();
    const green = await runGates({
      run: greenRunner.run, cwd: ROOT, harness, level: "full",
      quarantine: { quarantined: [] }, readFile: () => null, now: NOW,
    });
    expect(Object.keys(green.gates)).toContain("e2e");
    expect(typeof harness.commands.e2e).toBe("string");
    expect(greenRunner.shellCommands()).toContain(harness.commands.e2e);
    expect(green.status).toBe("GREEN");          // 모두 exit 0이면 초록이다 — 대조군

    // (b) 같은 하네스, 같은 레벨. 다른 것은 e2e 명령의 종료 코드 하나뿐이다.
    const redRunner = recordingRunner((cmd, args) => (args[args.length - 1] === harness.commands.e2e ? 1 : 0));
    const red = await runGates({
      run: redRunner.run, cwd: ROOT, harness, level: "full",
      quarantine: { quarantined: [] }, readFile: () => null, now: NOW,
    });
    expect(red.status).toBe("RED");
    expect(red.failing).toContain("e2e");
    expect(red.gates.e2e.code).toBe(1);

    // (c) commands.e2e만 지운 하네스 사본 — 설정이 반쯤 적용된 세계다. GREEN으로 읽히면 안 된다.
    const withoutCommand = { ...harness, commands: { ...harness.commands } };
    delete withoutCommand.commands.e2e;
    const misconfigured = await runGates({
      run: recordingRunner().run, cwd: ROOT, harness: withoutCommand, level: "full",
      quarantine: { quarantined: [] }, readFile: () => null, now: NOW,
    });
    expect(misconfigured.status).toBe("MISCONFIGURED");
    expect(misconfigured.required_missing).toContain("e2e");
  });

  // dw3: 이 이슈를 만든 결정적 감지(rule http-at-m1)가 더 이상 발화하지 않는다.
  // 입력은 저장소의 **실제** 하네스와 **실제** package.json 의존성 이름이다. 그리고 같은 입력에서
  // maturity만 M1로 되돌리면 감지가 다시 발화한다는 대조를 함께 건다 — 그게 없으면 "감지기가
  // 원래 아무것도 못 찾는다"로도 이 테스트가 통과한다(공허한 초록 봉쇄).
  test("test_15_http_at_m1_gap_no_longer_detected", async () => {
    const harness = loadHarness(ROOT);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    const manifestDeps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
    expect(manifestDeps).toContain("express");   // 감지 근거(HTTP 표면)는 여전히 저장소에 있다

    const gaps = detectMaturityGaps({ files: ["src/app.js"], harness, manifestDeps });
    expect(gaps.map((g) => g.rule)).not.toContain("http-at-m1");

    const stillM1 = { ...harness, harness: { ...harness.harness, maturity: "M1" } };
    const wouldFire = detectMaturityGaps({ files: ["src/app.js"], harness: stillM1, manifestDeps });
    expect(wouldFire.map((g) => g.rule)).toContain("http-at-m1");
  });
});
