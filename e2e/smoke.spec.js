import { test, expect } from "@playwright/test";
test("healthz", async ({ request }) => {
  const r = await request.get("/healthz");
  expect(r.status()).toBe(200);
});

// issue #15 — CHARTER Preserve가 이름 붙인 계약은 "200"이 아니라 200 **그리고** {"ok":true}다.
// 위 케이스는 상태 코드만 보므로 body가 {"ok":"yes"}로 바뀌어도 초록이다. 이 레인이 게이트가
// 되었을 때 무엇을 막는지가 여기서 정해진다 — 정확한 body를 본다(부분 문자열 포함이 아니라).
// 브라우저 픽스처는 쓰지 않는다: `request`는 크로미움 바이너리 없이 동작하고, 웹 UI 렌더링은
// docs/PROJECT.md(HTTP JSON API)와 docs/TECHNICAL.md "What NOT to Test" 기준으로 범위 밖이다.
test("test_15_healthz_body_is_exactly_ok_true", async ({ request }) => {
  const r = await request.get("/healthz");
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ ok: true });
});
