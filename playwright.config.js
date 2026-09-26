// #15 (M2) — e2e는 full·deep 게이트다(.factory/harness.toml [commands].e2e = "npx playwright test").
//
// 앱은 webServer가 **현재 체크아웃**에서 띄운다 — review/merge에서는 그것이 PR의 코드다. 이미 떠 있는
// 프로세스는 재사용하지 않는다(reuseExistingServer: false): 그 포트의 주인이 base 체크아웃에서 뜬 옛 앱이면
// e2e가 PR이 아니라 base를 검사하게 된다(#15 review cf1/qa1). 포트가 차 있으면 조용히 초록이 되는 대신
// Playwright가 실패로 알린다.
//
// 포트: 앱(src/app.js)과 같은 `PORT`를 읽는다. 없으면 둘 다 3000.
const PORT = process.env.PORT || "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default {
  testDir: "e2e",
  use: { baseURL: BASE_URL, headless: true },
  webServer: { command: "node src/app.js", url: `${BASE_URL}/healthz`, env: { PORT }, timeout: 30_000, reuseExistingServer: false },
  // json 리포트 경로는 그대로다. list는 사람이 읽는 콘솔 요약("N passed")을 더할 뿐이다.
  reporter: [["list"], ["json", { outputFile: ".spike/e2e.json" }]],
};
