import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

// #15 (M2) — e2e는 full·deep 게이트다(.factory/harness.toml [commands].e2e = "npx playwright test").
//
// 포트: 앱(src/app.js)과 같은 `PORT`를 읽는다. 없으면 둘 다 3000([test.env].app_ready).
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;

// 브라우저: CI 러너에는 Playwright 브라우저가 설치되지 않는다(외부 네트워크 금지, docs/QA.md). 그 환경에서
// 페이지를 여는 케이스는 "Executable doesn't exist"로 영구 RED가 되므로, 크로미움 실행 파일이 없을 때만
// 그 케이스(`e2e/smoke.spec.js`의 "browser loads")를 선택에서 뺀다. 브라우저가 있으면 전부 돈다.
// 빼는 것은 조용하지 않다 — 아래 경고가 매 실행 stderr에 남는다.
const BROWSER_CASES = /browser loads/;
const hasBrowser = (() => {
  try { return existsSync(chromium.executablePath()); } catch { return false; }
})();
if (!hasBrowser) console.warn(`[playwright.config] chromium not installed — deselecting browser cases ${BROWSER_CASES}`);

export default {
  testDir: "e2e",
  use: { baseURL: BASE_URL, headless: true },
  // reuseExistingServer: factory가 [test.env].app_start로 앱을 먼저 띄운다. 이미 떠 있으면 그것을 쓰고,
  // 없을 때만 webServer가 띄운다 — 두 프로세스가 같은 포트를 바인딩하지 않는다(#15).
  webServer: { command: "node src/app.js", url: `${BASE_URL}/healthz`, timeout: 30_000, reuseExistingServer: true },
  ...(hasBrowser ? {} : { grepInvert: BROWSER_CASES }),
  // json 리포트 경로는 그대로다(#15 non_goals). list는 사람이 읽는 콘솔 요약("N passed")을 더할 뿐이다.
  reporter: [["list"], ["json", { outputFile: ".spike/e2e.json" }]],
};
