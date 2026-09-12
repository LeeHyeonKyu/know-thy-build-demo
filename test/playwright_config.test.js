// issue #15 — 앱을 띄우는 주인이 실행 경로마다 정확히 하나다(dw5).
//
// 관측 대상은 `playwright.config.js`가 **내보내는 설정 객체**다 — 파일의 텍스트가 아니라
// 환경변수에 따라 실제로 달라지는 값. 그래서 이 파일은 설정을 베껴 쓰지 않고, 두 실행 모드를
// 각각 로드해 "무엇이 있고 무엇이 없는가"를 본다:
//   (a) 외부 base URL(`PLAYWRIGHT_TEST_BASE_URL`)이 있으면 `webServer` 키 자체가 없어야 한다.
//       있으면 러너가 "url is already used"로 **테스트를 하나도 돌리지 않고** throw하고,
//       그러면 test/integration/e2e_suite.test.js의 음성 판정(회귀 → 빨강)이 위조된다.
//   (b) 없으면 `webServer`가 앱을 띄우되, 그 포트와 `use.baseURL`의 포트가 **같은 출처**(`PORT`)에서
//       파생돼야 한다. 리터럴이 두 곳에 박혀 있으면 PORT를 바꿨을 때 러너가 자기가 띄운 앱이
//       아닌 곳을 두드린다 — 그래서 PORT를 실제로 바꿔 보고 두 값이 함께 움직이는지 본다.
//   (c) `reuseExistingServer: true`를 무조건 켜지 않는다 — 켜면 CI에서 낯설거나 오래된 서버를
//       상대로 e2e가 조용히 초록이 된다.
import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { loadHarness } from "../.factory/lib/config.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG_URL = new URL("../playwright.config.js", import.meta.url).href;
const ENV_KEYS = ["PLAYWRIGHT_TEST_BASE_URL", "PORT", "CI"];

let loads = 0;

/**
 * 설정 모듈을 주어진 환경으로 **새로** 평가한다. ESM 모듈 캐시를 우회하려고 쿼리스트링을 붙인다 —
 * 같은 프로세스에서 두 모드를 비교하려면 두 번 평가해야 한다.
 */
async function loadConfigWith(env) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) {
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return (await import(`${CONFIG_URL}?case=${loads++}`)).default;
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("issue #15 — playwright 설정의 앱 수명주기 소유자", () => {
  test("test_15_playwright_config_omits_webserver_for_external_target", async () => {
    // (a) 외부 타깃 모드 — webServer 키가 "있는데 비활성"이 아니라 아예 없어야 한다.
    const external = "http://127.0.0.1:49517";
    const withExternal = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: external, PORT: undefined, CI: undefined });
    expect(Object.keys(withExternal)).not.toContain("webServer");
    expect("webServer" in withExternal).toBe(false);
    expect(withExternal.use.baseURL).toBe(external);

    // (b) 기본 모드 — 앱은 러너가 띄우고, 포트는 단일 출처에서 나온다.
    const local = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: undefined, PORT: "45917", CI: undefined });
    expect(local.webServer).toBeTruthy();
    expect(new URL(local.webServer.url).port).toBe("45917");
    expect(new URL(local.use.baseURL).port).toBe("45917");
    expect(new URL(local.webServer.url).host).toBe(new URL(local.use.baseURL).host);

    // 같은 파일을 다른 PORT로 다시 평가하면 두 값이 **함께** 움직인다 — 한쪽만 리터럴이면 여기서 갈라진다.
    const other = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: undefined, PORT: "45918", CI: undefined });
    expect(new URL(other.webServer.url).port).toBe("45918");
    expect(new URL(other.use.baseURL).port).toBe("45918");

    // PORT가 없으면 기본값으로 떨어지되, 그 기본값도 두 곳이 같아야 한다(src/app.js의 기본과 같은 3000).
    const fallback = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: undefined, PORT: undefined, CI: undefined });
    expect(new URL(fallback.webServer.url).host).toBe(new URL(fallback.use.baseURL).host);
    expect(new URL(fallback.use.baseURL).port).toBe("3000");

    // (c) 어느 경우에도 "이미 떠 있는 아무 서버나 재사용"을 무조건 켜지 않는다.
    for (const cfg of [local, other, fallback]) {
      expect(cfg.webServer.reuseExistingServer).not.toBe(true);
    }
    const inCi = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: undefined, PORT: "45919", CI: "1" });
    expect(inCi.webServer.reuseExistingServer).not.toBe(true);

    // 부수 절(base에서도 참): test-env는 앱을 띄우지 않는다 — 켜면 webServer와 포트를 다툰다.
    // (`.factory/lib/test-env.js`에서 app_ready 폴링은 `if (env.app_start)` 안에 있어 단독 활성화는 죽은 설정이다.)
    const harness = loadHarness(ROOT);
    expect(harness.test.env.app_start).toBeUndefined();
    expect(harness.test.env.app_ready).toBeUndefined();
    expect(harness.test.env.compose).toBe("docker-compose.test.yml");
  });
});
