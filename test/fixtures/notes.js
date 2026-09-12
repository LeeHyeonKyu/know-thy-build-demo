// Note fixtures — docs/QA.md "Fixture Policy": factory function, new object every call,
// default is the minimal *valid* note and cases override only the field they care about.
// 파일명에 `.test.js`를 쓰지 않는다(harness.toml [test].test_glob에 걸리지 않게).

export function makeNote(overrides = {}) {
  return { title: "pg pool leak", body: "max=10이면 커넥션이 모자란다", ...overrides };
}

// 케이스마다 다른 문자열이 필요할 때 쓴다(행 조회 키, 에코 금지 단언 등).
// 결정성: 난수를 쓰지 않고 호출 순서 카운터 + 호출자가 준 라벨로 만든다(docs/QA.md Random seed).
let marker = 0;
export function makeMarker(label) {
  marker += 1;
  return `marker-${label}-${marker}`;
}
