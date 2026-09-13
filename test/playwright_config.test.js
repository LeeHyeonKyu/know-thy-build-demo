// issue #15 — e2e 러너 설정이 답해야 하는 두 질문을 **내보내는 설정 객체**로만 확인한다.
//
//   dw4  앱을 띄우는 주인이 실행 경로마다 정확히 하나이고, 포트가 단일 출처(`PORT`)에서 나오는가.
//   dw5  브라우저 케이스가 레인에서 조용히 영구 제외되지 않는가 — 하나의 명명된 입력에 조건부인가.
//
// 관측 대상은 파일의 텍스트가 아니라 **환경에 따라 실제로 달라지는 값**이다. 그래서 설정을 두 번
// 이상 평가해 "무엇이 있고 무엇이 없는가", "무엇이 선택되는가"를 본다. 러너는 한 번도 기동하지
// 않는다(기동은 test/integration/e2e_suite.test.js가 2회로 상한 지어 담당한다).
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { loadHarness } from "../.factory/lib/config.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CONFIG_URL = new URL("../playwright.config.js", import.meta.url).href;
const SPEC_PATH = fileURLToPath(new URL("../e2e/smoke.spec.js", import.meta.url));
const SPEC_RELATIVE = "e2e/smoke.spec.js";
// 설정이 읽을 수 있는 입력 전부. 테스트마다 이 키들만 갈아 끼우고 나머지 환경은 건드리지 않는다.
const ENV_KEYS = ["PLAYWRIGHT_TEST_BASE_URL", "PORT", "CI", "E2E_BROWSER_AVAILABLE", "PLAYWRIGHT_BROWSERS_PATH"];

let loads = 0;

/**
 * 설정 모듈을 주어진 환경으로 **새로** 평가한다. ESM 모듈 캐시를 우회하려고 쿼리스트링을 붙인다 —
 * 같은 프로세스에서 여러 모드를 비교하려면 여러 번 평가해야 한다.
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

/**
 * 스펙 파일에서 **케이스와 그 픽스처**를 읽는다. "어느 케이스가 브라우저를 요구하는가"를 제목
 * 상수로 베껴 쓰지 않기 위해서다 — 근거는 `({ page })`라는 픽스처 자체이고, 그것은 스펙에 있다.
 */
function parseSpecCases(source) {
  const cases = [];
  const re = /test\(\s*"([^"]+)"\s*,\s*async\s*\(\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    cases.push({ title: m[1], fixtures: m[2].split(",").map((s) => s.trim()).filter(Boolean) });
  }
  return cases;
}

const asRegExps = (v) => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v]).map((x) => (x instanceof RegExp ? x : new RegExp(String(x)))));

/**
 * 설정 객체가 이 스펙 파일에서 **실제로 고르는 제목 집합**. playwright의 선택 규칙 중 이 저장소가
 * 쓸 수 있는 것(testIgnore = 파일 단위, grep/grepInvert = 제목 단위)만 해석한다.
 * `projects`가 생기면 이 모델이 더 이상 전부를 설명하지 못하므로 아래에서 그 부재를 함께 단언한다.
 */
function selectedTitles(config, titles, relativeFile = SPEC_RELATIVE) {
  if (asRegExps(config.testIgnore).some((r) => r.test(relativeFile))) return [];
  const grep = asRegExps(config.grep);
  const grepInvert = asRegExps(config.grepInvert);
  return titles.filter((t) => (!grep.length || grep.some((r) => r.test(t))) && !grepInvert.some((r) => r.test(t)));
}

/** 이 프로세스에서 크로미움 바이너리가 실제로 존재하는가 — 설정의 기본값이 파생돼야 하는 사실. */
function chromiumBinaryPresent() {
  try {
    const p = chromium.executablePath();
    return Boolean(p) && existsSync(p);
  } catch {
    return false;
  }
}

const specCases = parseSpecCases(readFileSync(SPEC_PATH, "utf8"));
const titles = specCases.map((c) => c.title);
const browserCases = specCases.filter((c) => c.fixtures.includes("page")).map((c) => c.title);
const requestCases = specCases.filter((c) => c.fixtures.includes("request")).map((c) => c.title);

describe("issue #15 — e2e 러너 설정", () => {
  // dw4: 앱을 띄우는 주인이 실행 경로마다 하나이고, 포트는 `PORT` 한 곳에서 나온다.
  //   (a) 외부 base URL 모드에서는 `webServer` 키가 아예 없다 — 있으면 러너가 "url is already used"로
  //       **테스트를 하나도 돌리지 않고** throw하고, e2e_suite의 음성 판정이 위조된다.
  //   (b) 기본 모드에서는 `webServer.url`과 `use.baseURL`이 같은 포트를 가리키고, 그 포트가 PORT를
  //       따라 **함께** 움직인다(한쪽만 리터럴이면 여기서 갈라진다).
  //   (c) 어느 경우에도 `reuseExistingServer`가 무조건 true가 아니다.
  test("test_15_playwright_config_has_one_app_owner", async () => {
    // (a)
    const external = "http://127.0.0.1:49517";
    const withExternal = await loadConfigWith({ PLAYWRIGHT_TEST_BASE_URL: external });
    expect(Object.keys(withExternal)).not.toContain("webServer");
    expect("webServer" in withExternal).toBe(false);
    expect(withExternal.use.baseURL).toBe(external);

    // (b)
    const local = await loadConfigWith({ PORT: "45917" });
    expect(local.webServer).toBeTruthy();
    expect(new URL(local.webServer.url).port).toBe("45917");
    expect(new URL(local.use.baseURL).port).toBe("45917");
    expect(new URL(local.webServer.url).host).toBe(new URL(local.use.baseURL).host);

    const other = await loadConfigWith({ PORT: "45918" });
    expect(new URL(other.webServer.url).port).toBe("45918");
    expect(new URL(other.use.baseURL).port).toBe("45918");

    // PORT가 없으면 기본값으로 떨어지되, 그 기본값도 두 곳이 같아야 한다(src/app.js의 기본과 같은 3000).
    const fallback = await loadConfigWith({});
    expect(new URL(fallback.webServer.url).host).toBe(new URL(fallback.use.baseURL).host);
    expect(new URL(fallback.use.baseURL).port).toBe("3000");

    // (c)
    for (const cfg of [local, other, fallback]) expect(cfg.webServer.reuseExistingServer).not.toBe(true);
    const inCi = await loadConfigWith({ PORT: "45919", CI: "1" });
    expect(inCi.webServer.reuseExistingServer).not.toBe(true);

    // 부수 절: test-env는 앱을 띄우지 않는다 — 켜면 webServer와 포트를 다툰다(app_ready 폴링은
    // `.factory/lib/test-env.js`에서 `if (env.app_start)` 안이라 단독 활성화는 죽은 설정이다).
    const harness = loadHarness(ROOT);
    expect(harness.test.env.app_start).toBeUndefined();
    expect(harness.test.env.app_ready).toBeUndefined();
    expect(harness.test.env.compose).toBe("docker-compose.test.yml");
  });

  // dw5: 브라우저 케이스가 영구히 죽지 않는다. 선택 집합이 **하나의 명명된 입력**에 따라 양방향으로
  // 움직이는 것을 본다 — 무조건 제외(testIgnore/grepInvert 고정)는 여기서 거짓이 된다.
  test("test_15_browser_case_is_conditionally_selected", async () => {
    // 스펙에서 읽어 온 사실부터 고정한다. 파싱이 헛돌면 아래 단언이 전부 공허하게 통과한다.
    expect(titles.length).toBeGreaterThanOrEqual(3);
    expect(browserCases).toHaveLength(1);          // `page` 픽스처를 쓰는 케이스는 지금 하나다
    expect(requestCases.length).toBeGreaterThanOrEqual(1);
    const browserCase = browserCases[0];

    // 입력 없음(신호 = 브라우저 사용 불가): 브라우저 케이스만 빠지고 나머지는 **전부** 남는다.
    const off = await loadConfigWith({ E2E_BROWSER_AVAILABLE: "0" });
    const selectedOff = selectedTitles(off, titles);
    expect(selectedOff).not.toContain(browserCase);
    for (const t of requestCases) expect(selectedOff).toContain(t);
    expect(selectedOff).toEqual(titles.filter((t) => t !== browserCase));

    // 입력 있음(신호 = 브라우저 사용 가능): 두 케이스가 모두 선택된다 — 제외가 조건부라는 증거.
    const on = await loadConfigWith({ E2E_BROWSER_AVAILABLE: "1" });
    const selectedOn = selectedTitles(on, titles);
    expect(selectedOn).toEqual(titles);
    expect(selectedOn).toContain(browserCase);

    // 신호를 주지 않으면 **머신의 사실**(크로미움 바이너리 존재)에서 파생된다 — 어느 쪽으로도
    // 고정돼 있지 않다는 것을 이 프로세스에서 관측 가능한 값으로 확인한다.
    const auto = await loadConfigWith({});
    expect(selectedTitles(auto, titles).includes(browserCase)).toBe(chromiumBinaryPresent());

    // 이 테스트의 선택 모델이 설정 전부를 설명한다는 전제: 레인이 projects로 갈라지면 위 단언들이
    // 더 이상 "실제로 도는 집합"을 말하지 않는다.
    for (const cfg of [off, on, auto]) expect(cfg.projects).toBeUndefined();
  });
});
