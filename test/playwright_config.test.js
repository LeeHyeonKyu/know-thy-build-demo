// issue #15 — e2e 레인은 브라우저 바이너리를 요구하지 않는다.
//
// 왜 코드의 성질로 보는가: `.factory/actions/setup/action.yml`에도 `[runtime].setup`에도
// 브라우저를 내려받는 스텝이 없다. `page`/`browser`/`context` 픽스처를 쓰는 스펙이 하나라도
// 있으면 e2e 게이트는 켜지는 순간 환경 때문에 영구 RED가 된다 — 그 실패는 계약 위반이 아니라
// 머신 상태다. 그래서 "지금 이 머신에 크로미움이 있는가"가 아니라 "스펙이 브라우저를
// 요구하는가"를 단언한다(설치된 브라우저 유무와 무관하게 같은 답이 나온다).
//
// 브라우저 렌더링이 범위 밖이라는 근거는 문서에 있다: docs/PROJECT.md(웹 UI 아님 — HTTP JSON API),
// docs/TECHNICAL.md "What NOT to Test"(글루는 테스트하지 않는다). 지켜야 할 것은 `/healthz`의
// 관측 가능한 응답 계약이고, 그것은 `request` 픽스처로 충분히 잰다.
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const E2E_DIR = fileURLToPath(new URL("../e2e", import.meta.url));

// 브라우저 컨텍스트를 실제로 띄우는 playwright 픽스처들. `request`는 여기 없다 — APIRequestContext는
// 브라우저 바이너리 없이 동작한다.
const BROWSER_FIXTURES = ["page", "browser", "context", "browserName"];

/** 파일 본문에서 테스트 콜백이 구조분해로 요구한 픽스처 이름을 모은다. */
function fixturesUsedIn(source) {
  const names = [];
  for (const m of source.matchAll(/\(\s*\{([^}]*)\}\s*\)\s*=>/g)) {
    for (const raw of m[1].split(",")) {
      const name = raw.split(":")[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("issue #15 — e2e 레인의 브라우저 의존", () => {
  test("test_15_e2e_specs_declare_no_browser_fixture", () => {
    const files = readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.js"));
    // 가장 게으른 "통과": e2e 스펙을 전부 지우는 것. 그 상태를 여기서 막는다.
    expect(files.length).toBeGreaterThan(0);

    const perFile = files.map((f) => ({ file: f, fixtures: fixturesUsedIn(readFileSync(join(E2E_DIR, f), "utf8")) }));
    const offenders = perFile.flatMap(({ file, fixtures }) =>
      fixtures.filter((n) => BROWSER_FIXTURES.includes(n)).map((n) => `${file}: ${n}`));

    // 실패 메시지가 "어느 파일의 어느 픽스처인지"를 지목한다 — 6개월 뒤에도 이름만 보고 고칠 수 있게.
    expect(offenders).toEqual([]);

    // 두 번째 게으른 "통과": 픽스처를 아예 안 쓰는(=아무것도 재지 않는) 스펙만 남기는 것.
    // e2e 레인은 HTTP 표면을 재야 하므로 `request`를 쓰는 스펙이 최소 하나는 살아 있어야 한다.
    expect(perFile.flatMap((x) => x.fixtures)).toContain("request");
  });
});
