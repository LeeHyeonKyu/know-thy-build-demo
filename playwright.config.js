// e2e 레인의 러너 설정. M2 승격(#15)으로 `[commands].e2e`가 required 게이트가 되면서, 이 파일이
// 답해야 하는 질문이 셋으로 늘었다.
//
// 1) 앱을 띄우는 주인은 누구인가 — 실행 경로마다 정확히 하나여야 한다.
//    · 외부 타깃 모드(`PLAYWRIGHT_TEST_BASE_URL`): 이미 떠 있는 것을 상대로 돈다 → `webServer` 키를
//      **내보내지 않는다**. 내보내면 러너가 "url is already used"로 테스트를 하나도 돌리지 않고 throw한다.
//    · 기본 모드: 러너가 `node src/app.js`를 띄운다. `[test.env].app_start`는 켜지 않는다 — 켜면
//      test-env와 이 webServer가 같은 포트를 다툰다(.factory/harness.toml [test.env] 주석).
// 2) 포트는 어디서 오는가 — `PORT` 하나다(`src/app.js`가 읽는 바로 그 변수). baseURL과 webServer.url이
//    각자 리터럴을 들고 있으면 PORT를 바꾼 순간 러너가 자기가 띄운 앱이 아닌 곳을 두드린다.
// 3) 브라우저 바이너리가 없는 머신에서 무엇을 도는가 — 이 저장소의 CI 셋업(`[runtime].setup = "npm ci"`,
//    `.factory/actions/setup/action.yml`)에는 크로미움을 내려받는 스텝이 없고, 게이트 명령 안에서
//    내려받지도 않는다(docs/QA.md: 테스트 프로세스는 외부 네트워크 금지). 그래서 `page` 픽스처가 필요한
//    케이스는 **브라우저 사용 가능 신호가 없을 때만** 레인에서 뺀다. 무조건 빼면 그 케이스는 어디서도
//    돌지 않는다 — 파일에만 남고 아무도 지키지 않는 테스트가 된다(tests_are_load_bearing의 우회).
//    스펙 파일은 한 줄도 고치지 않는다: 분기는 전부 여기 있고, 분기의 입력은 아래 이름 하나다.
import { chromium, defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * 브라우저 레인의 **단일 명명 입력**. 값이 있으면 그 값이 이기고(`1/true/yes/on` = 사용 가능),
 * 없으면 크로미움 바이너리의 실제 존재에서 파생한다 — 설치한 사람은 아무것도 설정하지 않아도
 * 전부 돌고, 설치하지 않은 CI는 `page` 케이스만 빠진다. 두 방향 모두 관측 가능해야 하므로
 * (test/playwright_config.test.js) 값을 강제로 줄 수 있는 이 이름이 필요하다.
 */
export const BROWSER_SIGNAL_ENV = "E2E_BROWSER_AVAILABLE";
const TRUTHY = new Set(["1", "true", "yes", "on"]);

// 브라우저를 요구하는 케이스. 제목으로 고르는 것은 튼튼하지 않다(제목이 바뀌면 범위가 조용히 달라진다) —
// 새 e2e 케이스가 `page`를 쓰면 여기 이름을 더하거나, 크로미움을 설치하는 셋업을 먼저 만들어야 한다.
// 제목을 바꾸면 test/playwright_config.test.js가 빨개져서 알려 준다.
export const BROWSER_FIXTURE_CASES = /browser loads/;

function chromiumBinaryPresent() {
  try {
    const path = chromium.executablePath();
    return Boolean(path) && existsSync(path);
  } catch {
    return false;   // 레지스트리가 경로조차 모르면 설치돼 있지 않은 것이다
  }
}

export function browserAvailable(env = process.env) {
  const declared = env[BROWSER_SIGNAL_ENV];
  if (declared !== undefined && declared !== "") return TRUTHY.has(declared.toLowerCase());
  return chromiumBinaryPresent();
}

const externalBaseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;   // playwright 자신의 어휘를 쓴다
const port = process.env.PORT ?? "3000";                        // src/app.js와 같은 기본값, 출처는 하나
const localBaseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: externalBaseURL || localBaseURL, headless: true },
  // 신호가 "사용 가능"이면 전부 돈다 — "브라우저가 있는데도 안 도는" 상태를 만들지 않는다.
  ...(browserAvailable() ? {} : { grepInvert: BROWSER_FIXTURE_CASES }),
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: "node src/app.js",
          url: `${localBaseURL}/healthz`,
          env: { ...process.env, PORT: String(port) },
          timeout: 30_000,
          // reuseExistingServer는 켜지 않는다 — 무조건 true면 CI에서 낯설거나 오래된 서버를 상대로
          // e2e가 조용히 초록이 된다(playwright 기본값: CI에서는 재사용하지 않는다).
        },
      }),
  reporter: [["json", { outputFile: ".spike/e2e.json" }]],
});
