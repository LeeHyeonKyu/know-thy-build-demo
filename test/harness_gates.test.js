// issue #15 — 하네스 성숙도 승격(M2)의 게이트 성질을 저장소의 **실제** 하네스로 지킨다.
//
// 두 단언 모두 설정 텍스트를 베껴 쓰지 않는다: `.factory/harness.toml`을 판정 엔진
// (`.factory/lib/gates.js`의 runGates, `.factory/lib/test-env.js`의 envUp)에 실제로 통과시키고,
// 밖에서 관측 가능한 것 — "무슨 명령이 실행됐는가", "무슨 판정이 나왔는가",
// "누가 프로세스를 띄웠는가" — 만 본다. 그래서 이 파일은 harness.toml의 한 줄이 바뀌면
// 그 줄의 **결과**가 달라질 때만 색이 바뀐다.
import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadHarness } from "../.factory/lib/config.js";
import { runGates } from "../.factory/lib/gates.js";
import { envUp } from "../.factory/lib/test-env.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

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
