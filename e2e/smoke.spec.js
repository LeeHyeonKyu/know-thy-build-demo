import { test, expect } from "@playwright/test";
test("healthz", async ({ request }) => {
  const r = await request.get("/healthz");
  expect(r.status()).toBe(200);
});
test("browser loads", async ({ page }) => {
  await page.goto("/healthz");
  await expect(page.locator("body")).toContainText("ok");
});

// issue #15 — 기존 두 케이스는 그대로 두고 한 건을 **더한다**(tests_are_load_bearing).
// CHARTER Preserve가 이름 붙인 계약은 "200"이 아니라 200 **그리고** 정확히 {"ok":true}다.
// 위의 `healthz`는 상태 코드만, `browser loads`는 "본문에 ok가 들어 있다"만 보므로
// 둘 다 `{"ok":"yes"}` 회귀를 통과시킨다. 이 레인이 게이트가 되었을 때 무엇을 막는지는 여기서 정해진다.
// 이 단언이 실제로 회귀를 막는다는 증명(양성/음성 대조)은 test/integration/e2e_suite.test.js에 있다 —
// `e2e/**`는 `[test].test_glob` 밖이라 prove-test가 이 파일의 RED를 증명해 주지 않기 때문이다.
test("test_15_healthz_body_is_exactly_ok_true", async ({ request }) => {
  const r = await request.get("/healthz");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});
