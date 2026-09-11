import { test, expect } from "@playwright/test";
test("healthz", async ({ request }) => {
  const r = await request.get("/healthz");
  expect(r.status()).toBe(200);
});
test("browser loads", async ({ page }) => {
  await page.goto("/healthz");
  await expect(page.locator("body")).toContainText("ok");
});
