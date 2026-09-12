// --- issue #18 회귀 가드: 루트 README가 저장소에 대해 참인 말만 하게 만든다 ------------------
//
// 지키는 것은 "헤딩 네 개가 있다"가 아니라 "README의 진술이 저장소와 대조해 참이다"이다.
// 헤딩 네 줄만 있는 빈 README, 존재하지 않는 `POST /notes`를 구현된 것처럼 적은 README,
// 아직 없는 `src/routes/` 트리를 현재 구조로 그린 README는 전부 여기서 RED가 된다.
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
// npm의 내장 서브커맨드 중 README가 쓸 수 있는 것 — 이것만 package.json scripts 대조에서 면제된다.
const NPM_BUILTINS = ["ci", "install"];

// README.md가 없으면 skip이 아니라 이 단언에서 시끄럽게 실패한다. 이 이슈의 증상 자체가
// "파일이 없다"이므로, 조용한 skip은 게이트가 그 증상을 초록으로 승인하는 것과 같다.
function readReadme() {
  expect(
    existsSync(README_PATH),
    "README.md가 저장소 루트에 없다 (issue #18의 증상 그 자체) — " + README_PATH,
  ).toBe(true);
  return readFileSync(README_PATH, "utf8");
}

// `## X` 헤딩 아래 본문을 돌려준다. 코드펜스 안의 `## ...` 줄은 헤딩으로 세지 않는다.
function sectionBody(readme, heading) {
  const lines = readme.split("\n");
  const body = [];
  let inSection = false;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
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

function readSourceText() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = dir + entry.name;
      if (entry.isDirectory()) walk(full + "/");
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(SRC_DIR); // .factory/harness.toml [test].source_glob = ["src/**/*.js"]
  expect(files.length, "src/**/*.js 가 비어 있다 — 소스 대조의 전제가 무너졌다").toBeGreaterThan(0);
  return files.map((f) => readFileSync(f, "utf8")).join("\n");
}

// `GET /healthz` 처럼 method + path 로 시작하는 줄을 엔드포인트 항목으로 본다.
// 항목 검출은 상태 마커와 독립이어야 한다 — 마커가 있는 줄만 항목으로 세면
// "모든 항목이 마커를 갖는다"가 동어반복이 되어 아무것도 증명하지 못한다.
const ENDPOINT_ITEM = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-./{}:]*)/;

function endpointItems(section) {
  return section
    .split("\n")
    .map((line) => ({ line, match: line.match(ENDPOINT_ITEM) }))
    .filter((item) => item.match !== null)
    .map((item) => ({ line: item.line.trim(), method: item.match[1], path: item.match[2] }));
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

  // dw2: `## Run tests`를 위에서 아래로 따라 하면 막히지 않는다.
  // 설치 → compose 기동 → 테스트 실행이 이 순서로 있어야 하고, 거기 적힌 명령·파일이 전부 해석돼야 한다.
  test("test_18_readme_run_tests_resolves", () => {
    const readme = readReadme();
    const section = sectionBody(readme, "## Run tests");
    expect(section, "README.md에 '## Run tests' 섹션이 없다").not.toBeNull();

    const installAt = section.search(/\bnpm ci\b/);
    expect(installAt, "'## Run tests'에 설치 명령(`npm ci`)이 없다").toBeGreaterThanOrEqual(0);

    // test/integration/db.test.js:4 가 무조건 `docker compose ... psql`을 부르고
    // harness test_glob이 그 파일을 같은 실행에 넣으므로, compose 선행 단계가 없는 README는
    // 기여자를 첫 명령부터 RED로 보낸다.
    const composeMatch = section.match(/docker compose\s+(?:-f|--file)\s+(\S+)[^\n]*\bup\b/);
    expect(composeMatch, "'## Run tests'에 `docker compose -f <file> ... up` 기동 단계가 없다").not.toBeNull();
    const composeAt = section.indexOf(composeMatch[0]);
    expect(installAt, "설치 명령이 compose 기동 단계보다 뒤에 있다").toBeLessThan(composeAt);

    const after = section.slice(composeAt);
    const runMatch = after.match(/\b(npm (?:run )?test\b|npx vitest run\b)/);
    expect(runMatch, "compose 기동 뒤에 테스트 실행 명령(`npm test` / `npx vitest run`)이 없다").not.toBeNull();

    // 부수 조건: 적힌 npm 스크립트와 compose 파일이 실재한다.
    const scripts = Object.keys(JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")).scripts ?? {});
    for (const [, name] of section.matchAll(/\bnpm (?:run )?([a-zA-Z][\w:-]*)/g)) {
      if (NPM_BUILTINS.includes(name)) continue;
      expect(scripts, `README가 존재하지 않는 npm 스크립트 '${name}'를 안내한다`).toContain(name);
    }
    for (const [, file] of section.matchAll(/docker compose\s+(?:-f|--file)\s+(\S+)/g)) {
      expect(existsSync(REPO_ROOT + file), `README가 없는 compose 파일 '${file}'을 가리킨다`).toBe(true);
    }
  });

  // dw3: `## Endpoints`의 모든 항목이 상태를 숨기지 않는다.
  test("test_18_readme_endpoints_status_honest", () => {
    const readme = readReadme();
    const section = sectionBody(readme, "## Endpoints");
    expect(section, "README.md에 '## Endpoints' 섹션이 없다").not.toBeNull();

    const items = endpointItems(section);
    // 항목이 하나도 없는 Endpoints 섹션이 공허하게 통과해서는 안 된다.
    expect(items.length, "'## Endpoints'에 `METHOD /path` 형태의 항목이 하나도 없다").toBeGreaterThan(0);

    const sourceText = readSourceText();
    for (const item of items) {
      const markers = STATUS_MARKERS.filter((m) => new RegExp(`\\b${m}\\b`).test(item.line));
      // 마커가 없으면 독자는 그 줄이 오늘 되는 일인지 계획인지 구분할 수 없다.
      expect(markers, `'${item.method} ${item.path}' 항목에 상태 마커(${STATUS_MARKERS.join(" / ")})가 정확히 하나 있어야 한다: ${item.line}`)
        .toHaveLength(1);
      if (markers[0] === "implemented") {
        expect(
          sourceText.includes(item.path),
          `README가 '${item.method} ${item.path}'를 implemented로 적었지만 그 경로가 src/**/*.js 어디에도 없다`,
        ).toBe(true);
      }
    }

    // GET /healthz 의 응답 서술은 보존 계약과 일치해야 한다
    // (docs/factory/CHARTER.md Preserve, docs/TECHNICAL.md §Interfaces, test/smoke.test.js:81-90).
    const healthz = items.find((item) => item.path === "/healthz");
    expect(healthz, "'## Endpoints'에 `GET /healthz` 항목이 없다 — 오늘 유일하게 구현된 엔드포인트다").toBeDefined();
    expect(healthz.method).toBe("GET");
    const contract = healthz.line.toLowerCase().replace(/[\s`"'*]/g, "");
    expect(contract, `/healthz 항목이 상태코드 200을 적지 않았다: ${healthz.line}`).toContain("200");
    expect(contract, `/healthz 항목의 body 서술이 {ok:true} 계약과 다르다: ${healthz.line}`).toContain("ok:true");
    expect(contract, `/healthz 항목이 Cache-Control: no-store를 적지 않았다: ${healthz.line}`)
      .toContain("cache-control:no-store");
  });

  // dw4: README가 가리키는 곳이 전부 실재한다.
  test("test_18_readme_paths_resolve", () => {
    const readme = readReadme();

    const referenced = new Set();
    for (const [, token] of readme.matchAll(/`([^`\n]+)`/g)) {
      if (/^(src|test|docs|e2e)\/\S*$/.test(token) || /^[A-Za-z0-9_.-]+\.ya?ml$/.test(token)) {
        referenced.add(token);
      }
    }
    for (const [, target] of readme.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#|\/\/)/i.test(target)) continue; // 외부 URL·앵커는 fs 대조 대상이 아니다
      referenced.add(target.split("#")[0]);
    }
    expect(referenced.size, "README가 저장소 경로를 하나도 가리키지 않는다 — 인덱스로서 쓸모가 없다")
      .toBeGreaterThan(0);

    for (const token of referenced) {
      const target = REPO_ROOT + token.replace(/\/$/, "");
      expect(existsSync(target), `README가 존재하지 않는 경로 '${token}'를 가리킨다`).toBe(true);
      if (token.endsWith("/")) {
        expect(statSync(target).isDirectory(), `README가 '${token}'를 디렉터리로 적었지만 파일이다`).toBe(true);
      }
    }

    // 산문으로만 넘어가는 회피를 막는다 — Layout은 최소한 진입점 파일을 명시해야 한다.
    const layout = sectionBody(readme, "## Layout");
    expect(layout, "README.md에 '## Layout' 섹션이 없다").not.toBeNull();
    expect(layout, "'## Layout'이 진입점 `src/app.js`를 명시하지 않는다").toContain("src/app.js");
  });
});
