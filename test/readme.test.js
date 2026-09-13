// --- issue #18 회귀 가드: 루트 README가 저장소에 대해 참인 말만 하게 만든다 ------------------
//
// 지키는 것은 "헤딩 네 개가 있다"가 아니라 "README의 진술이 저장소와 대조해 참이다"이다.
// 헤딩 네 줄만 있는 빈 README, 존재하지 않는 `POST /notes`를 구현된 것처럼 적은 README,
// 이미 구현된 엔드포인트를 `planned`로 남겨 둔 README, 죽은 경로·없는 npm 스크립트를 안내하는
// README는 전부 여기서 RED가 된다.
//
// 단언의 기준값은 어느 것도 이 파일에 하드코딩되지 않는다 — 진입점은 package.json `scripts.start`에서,
// 라우트는 src/**/*.js의 등록 리터럴에서, compose 파일·경로는 디스크에서 파생한다. 오늘 참인 사실을
// 테스트에 박아 두면(예: 문자열 "src/app.js") 진입점이 리네임되는 날 "정직하게 고치면 RED"가 되어
// 유일한 GREEN 경로가 거짓말이 된다(이 가드의 직전 판본이 실제로 그랬다).
//
// 파일은 cwd가 아니라 import.meta.url 기준으로 읽는다(선례: test/smoke.test.js:14,
// 근거: docs/QA.md "Order randomization" — `--sequence.shuffle`로도 같은 결과여야 한다).
// 프로세스를 띄우지 않고 파일만 읽으므로 unit 레벨이고, 시계·랜덤·네트워크를 쓰지 않는다.

import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const README_PATH = fileURLToPath(new URL("../README.md", import.meta.url));
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

const REQUIRED_SECTIONS = ["## What", "## Endpoints", "## Run tests", "## Layout"];
const STATUS_MARKERS = ["implemented", "planned"];

// README.md가 없으면 skip이 아니라 이 단언에서 시끄럽게 실패한다. 이 이슈의 증상 자체가
// "파일이 없다"이므로, 조용한 skip은 게이트가 그 증상을 초록으로 승인하는 것과 같다.
function readReadme() {
  expect(
    existsSync(README_PATH),
    "README.md가 저장소 루트에 없다 (issue #18의 증상 그 자체) — " + README_PATH,
  ).toBe(true);
  return readFileSync(README_PATH, "utf8");
}

function packageScripts() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts ?? {};
}

// 코드펜스 안인지 표시한 줄 목록. 펜스 안의 `## ...`는 헤딩이 아니고, 펜스 안의 `GET /x`는
// 엔드포인트 "항목"이 아니라 예시다. 반대로 명령·경로 해석은 펜스 안까지 본다(dw2(a)).
function annotatedLines(text) {
  let inFence = false;
  return text.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return { line, inFence: true }; // 펜스 구분선 자체도 본문이 아니다
    }
    return { line, inFence };
  });
}

// `## X` 헤딩 아래 본문을 돌려준다. 없으면 null.
function sectionBody(readme, heading) {
  const body = [];
  let inSection = false;
  for (const { line, inFence } of annotatedLines(readme)) {
    const isHeading = !inFence && /^#{1,2} /.test(line);
    if (isHeading) {
      if (line.trim() === heading) {
        inSection = true;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (inSection) body.push(line);
  }
  return inSection ? body.join("\n") : null;
}

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = dir + entry.name;
      if (entry.isDirectory()) walk(full + "/");
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(SRC_DIR); // .factory/harness.toml [test].source_glob = ["src/**/*.js"]
  return files;
}

// src/**/*.js에 등장하는 라우트 등록 리터럴 `app.<method>("<path>"` 를 모은다.
// 경로를 부분문자열로 찾지 않는 이유: `GET /health`를 implemented로 적어도
// src/app.js의 `/healthz` 때문에 통과해 버린다(리뷰에서 세 번 재발견된 구멍).
// 여기서는 따옴표로 닫힌 리터럴 **전체**가 경로와 같아야 한다.
const ROUTE_REGISTRATION = /\bapp\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(["'`])([^"'`\n]*)\2/g;

function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function registeredRoutes() {
  const files = sourceFiles();
  expect(files.length, "src/**/*.js 가 비어 있다 — 소스 대조의 전제가 무너졌다").toBeGreaterThan(0);
  const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const routes = new Set();
  for (const [, method, , path] of text.matchAll(ROUTE_REGISTRATION)) {
    routes.add(`${method.toUpperCase()} ${normalizePath(path)}`);
  }
  return routes;
}

function isRegistered(routes, method, path) {
  const p = normalizePath(path);
  return routes.has(`${method} ${p}`) || routes.has(`ALL ${p}`);
}

// 항목 검출은 상태 마커와 **독립**이다 — 마커가 있는 줄만 항목으로 세면
// "모든 항목이 마커를 갖는다"가 동어반복이 되어 아무것도 증명하지 못한다.
// `| GET | /healthz |` 같은 표 행도 항목으로 받는다(서식 재배치가 false-RED가 되지 않도록).
const ENDPOINT_ITEM = /\b(GET|POST|PUT|PATCH|DELETE)\s*\|?\s+(\/[A-Za-z0-9_\-./{}:]*)/;

function endpointItems(section) {
  const lines = annotatedLines(section);
  const items = [];
  lines.forEach(({ line, inFence }, index) => {
    if (inFence) return; // 펜스 안의 curl 예시는 "이 엔드포인트가 있다"는 주장이 아니다
    const match = line.match(ENDPOINT_ITEM);
    if (!match) return;
    items.push({ line: line.trim(), index, method: match[1], path: match[2] });
  });
  // 항목의 "블록" = 그 줄부터 다음 항목 직전까지. 계약 토큰을 한 물리적 줄에서 찾지 않으므로
  // 하위 불릿으로 쪼개거나 표로 재배치하는 순전한 서식 변경이 RED가 되지 않고,
  // 그러면서도 다른 항목이 공급한 토큰을 빌려 쓰는 false-GREEN은 막는다.
  return items.map((item, i) => ({
    ...item,
    block: lines
      .slice(item.index, i + 1 < items.length ? items[i + 1].index : lines.length)
      .map((l) => l.line)
      .join("\n"),
  }));
}

// README가 "이 경로가 저장소에 있다"고 주장하는 토큰을 모은다. 수집원은 셋이다:
//   (1) 인라인 백틱 스팬 **전체**, (2) 코드펜스 안 명령의 공백 구분 단어
//       (기여자가 실제로 복붙하는 첫 명령이 펜스 안에 있으므로 펜스를 빼면
//        `npm start`를 존재하지 않는 `node src/server.js`로 바꿔도 게이트가 침묵한다),
//   (3) 상대 마크다운 링크 대상.
// README 본문과 독립적으로 판별력을 측정할 수 있도록 순수 함수로 분리한다
// (test_18_readme_path_claims_exhaustive가 합성 마크다운으로 직접 먹인다).
function collectPathClaims(text) {
  const claims = new Set();
  const addIfPathClaim = (raw) => {
    const token = raw.trim().replace(/^['"(<]+|['".,;:)>]+$/g, "");
    if (!token || token.includes("*")) return;
    if (/^(src|test|docs|e2e)\/\S*$/.test(token) || /^[A-Za-z0-9_.-]+\.(ya?ml|json|md|js)$/.test(token)) {
      claims.add(token);
    }
  };
  for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) addIfPathClaim(span);
  for (const { line, inFence } of annotatedLines(text)) {
    if (!inFence || /^\s*```/.test(line)) continue;
    for (const word of line.split(/\s+/)) addIfPathClaim(word);
  }
  for (const [, target] of text.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    if (/^([a-z]+:|#|\/\/)/i.test(target)) continue; // 외부 URL·앵커는 fs 대조 대상이 아니다
    claims.add(target.split("#")[0]);
  }
  return claims;
}

// HTTP 상태코드로 읽히는 3자리 수. `docs/features/001-create-note.md`의 `001`처럼
// 경로·파일명 안의 숫자는 상태코드가 아니다.
const HTTP_STATUS = /(?<![\w./-])[1-5]\d{2}(?![\w./-])/;

function squash(text) {
  return text.toLowerCase().replace(/[\s`"'*|]/g, "");
}

describe("issue #18 — README는 저장소에 대해 참인 말만 한다", () => {
  // dw1: 네 섹션이 존재하고, 각 섹션에 비공백 본문이 최소 한 줄 있다.
  test("test_18_readme_sections", () => {
    const readme = readReadme();
    for (const heading of REQUIRED_SECTIONS) {
      const body = sectionBody(readme, heading);
      expect(body, `README.md에 '${heading}' 섹션이 없다`).not.toBeNull();
      const filled = body.split("\n").filter((line) => line.trim().length > 0);
      // 헤딩 네 줄만 있는 빈 README가 통과하지 못하게 하는 절이다.
      expect(filled.length, `'${heading}' 섹션의 본문이 비어 있다 — 헤딩만으로는 아무도 돕지 못한다`)
        .toBeGreaterThan(0);
    }
  });

  // dw2: README가 가리키는 것 중 죽은 것이 없다. 검사 범위는 한 섹션이 아니라 README 전체이며
  // 코드펜스 안을 포함한다 — 기여자가 복붙하는 첫 명령이 펜스 안에 있기 때문이다.
  test("test_18_readme_references_resolve", () => {
    const readme = readReadme();
    const scripts = packageScripts();
    const scriptNames = Object.keys(scripts);

    // (b) `npm run <x>` 와 고정 단축 `npm test`/`npm start` 만 본다 — 그래서 손으로 유지하는
    //     npm 빌트인 면제 목록이 필요 없다(`npm ci`/`npm i`는 애초에 수집되지 않는다).
    const invoked = new Set();
    for (const [, name] of readme.matchAll(/\bnpm\s+run\s+([A-Za-z][\w:-]*)/g)) invoked.add(name);
    for (const [, name] of readme.matchAll(/\bnpm\s+(test|start)\b/g)) invoked.add(name);
    expect(invoked.size, "README가 npm 스크립트를 하나도 안내하지 않는다 — 실행법이 없다는 뜻이다")
      .toBeGreaterThan(0);
    for (const name of invoked) {
      expect(scriptNames, `README가 존재하지 않는 npm 스크립트 '${name}'를 안내한다`).toContain(name);
    }

    // (c) 저장소 상대경로 토큰과 상대 마크다운 링크 대상이 전부 fs에 존재한다.
    //     수집 규칙은 collectPathClaims에 있다(펜스 안까지 본다).
    const referenced = collectPathClaims(readme);
    expect(referenced.size, "README가 저장소 경로를 하나도 가리키지 않는다 — 인덱스로서 쓸모가 없다")
      .toBeGreaterThan(0);
    for (const token of referenced) {
      const target = REPO_ROOT + token.replace(/\/$/, "");
      expect(existsSync(target), `README가 존재하지 않는 경로 '${token}'를 가리킨다`).toBe(true);
      if (token.endsWith("/")) {
        expect(statSync(target).isDirectory(), `README가 '${token}'를 디렉터리로 적었지만 파일이다`).toBe(true);
      }
    }

    // (d) `## Layout`은 package.json `scripts.start`가 **실제로 실행하는 파일**을 언급한다.
    //     리터럴을 박지 않으므로 진입점이 리네임돼도 정직한 수정이 GREEN이다.
    const startScript = scripts.start;
    expect(typeof startScript, "package.json에 scripts.start가 없다").toBe("string");
    const entry = (startScript.match(/(?:^|\s)([\w./-]+\.[cm]?js)(?=\s|$)/) ?? [])[1];
    expect(entry, `package.json scripts.start에서 진입점 파일을 찾지 못했다: ${startScript}`).toBeTruthy();
    expect(existsSync(REPO_ROOT + entry), `scripts.start가 실행하는 '${entry}'가 디스크에 없다`).toBe(true);
    const layout = sectionBody(readme, "## Layout");
    expect(layout, "README.md에 '## Layout' 섹션이 없다").not.toBeNull();
    expect(layout, `'## Layout'이 진입점 '${entry}'(package.json scripts.start)를 언급하지 않는다`)
      .toContain(entry);
  });

  // dw2(c)의 "모두 / 면제 키워드 없음"을 README 본문과 **독립적으로** 측정한다.
  // 오늘의 README가 우연히 인용하지 않는 경로(`scripts/build.sh`, `config/nginx.conf`,
  // `.github/workflows/ci.yml`, `Dockerfile.dev` …)도 경로 주장으로 수집돼야 한다 —
  // 수집기가 접두사·확장자 목록으로 대상을 좁히면 그 목록 밖의 죽은 경로에 가드가 침묵하고,
  // 위 references_resolve는 오늘의 README만 보므로 그 침묵을 드러내지 못한다.
  // 반대로 명령·라우트·글로브·외부 URL·호출식은 경로 주장이 아니다 — 그것까지 fs에서 찾으면
  // 참인 README가 RED가 된다.
  test("test_18_readme_path_claims_exhaustive", () => {
    const markdown = [
      "루트 파일 `Dockerfile.dev` 와 `scripts/build.sh` 를 인용한다.",
      "설정은 `config/nginx.conf`, CI 워크플로는 `.github/workflows/ci.yml`, 환경 템플릿은 `.env.example`.",
      "명령은 `npm start`, 라우트는 `/healthz`, 호출은 `app.listen()`, 헤더는 `Cache-Control: no-store`.",
      "패턴은 `test/integration/**`, 버전은 `22.11.0`, 플래그는 `--reporter=json`.",
      "스펙은 [001](docs/features/001-create-note.md), 외부는 [예시](https://example.com/docs/x.md).",
      "```bash",
      "node tools/seed.js --url http://localhost:3000/healthz < fixtures/seed.sql",
      "```",
    ].join("\n");

    const claims = [...collectPathClaims(markdown)];

    for (const token of [
      "Dockerfile.dev",
      "scripts/build.sh",
      "config/nginx.conf",
      ".github/workflows/ci.yml",
      ".env.example",
      "docs/features/001-create-note.md",
      "tools/seed.js",
      "fixtures/seed.sql",
    ]) {
      expect(
        claims,
        `'${token}'는 저장소 상대경로 주장인데 수집되지 않았다 — 이 경로가 죽어도 가드가 침묵한다`,
      ).toContain(token);
    }

    for (const token of [
      "npm start",
      "/healthz",
      "app.listen()",
      "Cache-Control: no-store",
      "test/integration/**",
      "22.11.0",
      "--reporter=json",
      "https://example.com/docs/x.md",
      "http://localhost:3000/healthz",
      "node",
      "--url",
    ]) {
      expect(
        claims,
        `'${token}'은 경로 주장이 아니다(명령·라우트·글로브·버전·플래그·외부 URL) — fs에서 찾으면 참인 README가 RED가 된다`,
      ).not.toContain(token);
    }
  });

  // dw3: `## Endpoints`의 모든 항목이 상태를 숨기지 않고, 그 상태가 양방향으로 참이다.
  test("test_18_readme_endpoints_status_honest", () => {
    const readme = readReadme();
    const section = sectionBody(readme, "## Endpoints");
    expect(section, "README.md에 '## Endpoints' 섹션이 없다").not.toBeNull();

    const items = endpointItems(section);
    // 항목이 하나도 없는 Endpoints 섹션이 공허하게 통과해서는 안 된다.
    expect(items.length, "'## Endpoints'에 `METHOD /path` 형태의 항목이 하나도 없다").toBeGreaterThan(0);

    const routes = registeredRoutes();
    for (const item of items) {
      const markers = STATUS_MARKERS.filter((m) => new RegExp(`\\b${m}\\b`).test(item.line));
      // 마커가 없으면 독자는 그 줄이 오늘 되는 일인지 계획인지 구분할 수 없다.
      expect(
        markers,
        `'${item.method} ${item.path}' 항목에 상태 마커(${STATUS_MARKERS.join(" / ")})가 정확히 하나 있어야 한다: ${item.line}`,
      ).toHaveLength(1);
      const registered = isRegistered(routes, item.method, item.path);
      if (markers[0] === "implemented") {
        expect(
          registered,
          `README가 '${item.method} ${item.path}'를 implemented로 적었지만 src/**/*.js에 그 라우트 등록(app.${item.method.toLowerCase()}("${item.path}"...)이 없다`,
        ).toBe(true);
      } else {
        // 양방향 — 001/002가 머지되어 실제로 응답하는 날 README의 `planned`가 RED가 되고,
        // 그 PR의 저자는 마커 한 단어를 뒤집어야 한다. 의도된 트립와이어다.
        expect(
          registered,
          `README가 '${item.method} ${item.path}'를 planned로 적었지만 src/**/*.js에 그 라우트가 이미 등록돼 있다 — README.md의 '## Endpoints' 마커를 implemented로 고쳐야 한다`,
        ).toBe(false);
      }
    }

    // (e) `planned`가 적힌 줄은 HTTP 상태코드를 약속하지 않는다 — "호출하면 404가 온다" 류의 문장은
    //     그 엔드포인트가 구현되는 날 거짓이 되는데, 어떤 소스와도 대조할 수 없다.
    for (const { line, inFence } of annotatedLines(section)) {
      if (inFence || !/\bplanned\b/.test(line)) continue;
      expect(
        HTTP_STATUS.test(line),
        `'planned'가 적힌 줄이 HTTP 상태코드를 약속한다 — 구현되는 날 거짓이 된다: ${line.trim()}`,
      ).toBe(false);
    }

    // (f) GET /healthz 항목의 응답 서술이 보존 계약과 일치해야 한다
    //     (docs/TECHNICAL.md:63/:77, test/smoke.test.js). 계약 문자열은 README가 아니라 그 계약에서 왔다.
    const healthz = items.find((item) => normalizePath(item.path) === "/healthz");
    expect(healthz, "'## Endpoints'에 `GET /healthz` 항목이 없다 — 오늘 유일하게 구현된 엔드포인트다").toBeDefined();
    expect(healthz.method).toBe("GET");
    const contract = squash(healthz.block);
    expect(contract, `/healthz 항목이 상태코드 200을 적지 않았다:\n${healthz.block}`).toContain("200");
    expect(contract, `/healthz 항목의 body 서술이 {ok:true} 계약과 다르다:\n${healthz.block}`).toContain("ok:true");
    expect(contract, `/healthz 항목이 Cache-Control: no-store를 적지 않았다:\n${healthz.block}`)
      .toContain("cache-control:no-store");
  });

  // dw4: `## Run tests`를 위에서 아래로 따라 한 기여자가 막히지 않는다.
  // 설치 → DB 기동 → 테스트 실행이 이 순서여야 한다. `docker compose -f ... up`이라는 리터럴
  // 명령 형태는 요구하지 않는다 — 지켜야 할 사실은 "기동 단계가 테스트보다 앞에 온다 +
  // 실재하는 compose 파일을 가리킨다"이고, 형태를 못 박으면 기동을 래퍼로 감싸는 날
  // 참인 문서가 RED가 된다(의도적 하향 조정 — PR 본문에 기록).
  test("test_18_readme_run_tests_resolves", () => {
    const readme = readReadme();
    const section = sectionBody(readme, "## Run tests");
    expect(section, "README.md에 '## Run tests' 섹션이 없다").not.toBeNull();

    const installAt = section.search(/\bnpm\s+(?:ci|install)\b/);
    expect(installAt, "'## Run tests'에 설치 단계(`npm ci` / `npm install`)가 없다").toBeGreaterThanOrEqual(0);

    // test/integration/db.test.js가 가용성 체크 없이 `docker compose ... psql`을 부르고
    // harness test_glob이 그 파일을 unit 게이트의 같은 실행에 넣으므로, DB 기동 단계가
    // 설치 뒤·테스트 앞에 없는 README는 기여자를 첫 명령부터 RED로 보낸다.
    const composeStep = [...section.matchAll(/[A-Za-z0-9_.\/-]+\.ya?ml/g)]
      .filter((m) => existsSync(REPO_ROOT + m[0]))
      .find((m) => m.index > installAt);
    expect(
      composeStep,
      "'## Run tests'에 설치 단계 뒤로 DB 기동 단계가 없다 — 디스크에 실재하는 compose 파일을 이름으로 가리켜야 한다",
    ).toBeDefined();

    const after = section.slice(composeStep.index + composeStep[0].length);
    const runMatch = after.match(/\bnpm\s+(?:run\s+)?test\b|\bnpx\s+vitest\s+run\b/);
    expect(
      runMatch,
      "DB 기동 단계 뒤에 테스트 실행 명령(`npm test` / `npx vitest run`)이 없다 — 순서가 뒤집혔거나 명령이 없다",
    ).not.toBeNull();
  });
});
