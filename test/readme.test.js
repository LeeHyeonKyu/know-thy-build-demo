import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

// #18 — README.md 회귀 가드.
//
// 이 가드가 재는 것은 **파일 내용 + 디스크 조회**뿐이다: 자식 프로세스 0, 소켓 0,
// `src/**` 파싱 0, 모듈 import 0. 엔드포인트 "등록 사실"은 정적으로도 라이브로도
// 판정하지 않는다 — docs/TECHNICAL.md §Testing Strategy의 "What NOT to Test"가
// "라우팅 등록 같은 글루"를 범주로 금지하고, docs/QA.md의 수동 체크리스트가
// "문서의 curl 스니펫이 그대로 동작하는가"를 이미 사람 판단으로 분류했다.
//
// 각 테스트는 실제 README.md에 더해 **합성 입력**으로 자기 판별력을 같은 실행 안에서
// 잰다(구현을 그대로 옮겨 적은 단언으로는 통과할 수 없게).

const repoRoot = new URL("../", import.meta.url);
const readmeUrl = new URL("README.md", repoRoot);

/** `## Layout`에서만 쓰는 단 하나의 "아직 없다" 마커. 새 상태 어휘를 만들지 않는다. */
const PLANNED_MARKER = "(아직 없음)";
const REQUIRED_HEADINGS = ["## What", "## Endpoints", "## Run tests", "## Layout"];
/** 반환 시점에 DB 준비 완료를 보장하는 형태임을 문서에서 판정할 수 있는 토큰. */
const READINESS_TOKENS = ["--wait", "pg_isready", "healthy"];
const PATH_EXT = /\.(js|mjs|cjs|json|md|yml|yaml|toml|sh|sql|ts)$/i;

const readReadme = () => readFileSync(readmeUrl, "utf8");
const readPkg = () => JSON.parse(readFileSync(new URL("package.json", repoRoot), "utf8"));

/** 저장소 루트 기준 실재 여부. 가드는 경로 문자열을 하드코딩하지 않고 이 함수만 쓴다. */
const existsInRepo = (p) => existsSync(new URL(p, repoRoot));

const realEnv = () => {
  const pkg = readPkg();
  return { scripts: pkg.scripts ?? {}, exists: existsInRepo };
};

/** README를 줄 단위로 훑어 `## ` 섹션으로 자른다. 코드펜스 안의 `#`은 헤딩이 아니다. */
function sections(text) {
  const out = new Map();
  let current = null;
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^##\s+\S/.test(line);
    if (heading) {
      current = line.trim().replace(/\s+/g, " ");
      out.set(current, []);
      return;
    }
    if (current) out.get(current).push({ text: line, lineNo: i + 1 });
  });
  return out;
}

const bodyOf = (text, heading) => sections(text).get(heading) ?? null;
const joinBody = (rows) => (rows ?? []).map((r) => r.text).join("\n");

// ---------------------------------------------------------------- dw1

function sectionProblems(text) {
  const secs = sections(text);
  const problems = [];
  for (const heading of REQUIRED_HEADINGS) {
    const rows = secs.get(heading);
    if (!rows) problems.push(`README.md: '${heading}' 섹션이 없다`);
    else if (!rows.some((r) => r.text.trim() !== "")) problems.push(`README.md: '${heading}' 섹션에 본문이 한 줄도 없다 (헤딩만 있다)`);
  }
  return problems;
}

// ---------------------------------------------------------------- dw2

/** 토큰이 "저장소 상대경로 주장"인가. 낱말(PORT, express)과 URL과 글로브는 주장이 아니다. */
function isPathClaim(token) {
  if (!token || /\s/.test(token)) return false;
  if (token.includes("*")) return false; // 글로브는 경로 주장이 아니다
  if (token.includes("://") || token.startsWith("/") || token.startsWith("~") || token.startsWith("-") || token.startsWith("$")) return false;
  if (token.startsWith("#") || token.startsWith("mailto:")) return false;
  return token.includes("/") || PATH_EXT.test(token);
}

const trimToken = (t) => t.replace(/^[('"`\[]+/, "").replace(/[)'"`\],;:.]+$/, "");

/** 코드펜스 안을 포함한 README 전역에서 경로 주장을 모은다. */
function collectPathClaims(text) {
  const claims = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    const push = (raw) => {
      const token = trimToken(raw);
      if (isPathClaim(token)) claims.push({ token, line, lineNo: i + 1 });
    };
    if (fenced) {
      for (const word of line.split(/\s+/)) push(word);
      return;
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) push(m[1]);
    for (const m of line.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) push(m[1]);
  });
  return claims;
}

/** README가 부르는 npm 스크립트. `npm run <x>`와 고정 단축 `npm test`/`npm start`만 본다. */
function collectScriptCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g)) calls.push(m[1]);
  for (const m of text.matchAll(/\bnpm\s+(test|start)\b/g)) calls.push(m[1]);
  return calls;
}

/** `scripts.start`가 실제로 실행하는 파일 — 리터럴 `src/app.js`를 가드에 박지 않는다. */
function entrypointOf(scripts) {
  const start = scripts?.start ?? "";
  const hit = start.split(/\s+/).map(trimToken).find((w) => isPathClaim(w) && PATH_EXT.test(w));
  return hit ?? null;
}

function referenceProblems(text, env) {
  const problems = [];

  for (const { token, line, lineNo } of collectPathClaims(text)) {
    if (line.includes(PLANNED_MARKER)) continue; // 같은 줄에서 "아직 없다"고 밝힌 경로는 주장이 아니다
    if (!env.exists(token)) problems.push(`README.md:${lineNo}: 존재하지 않는 경로 '${token}'을 가리킨다`);
  }

  for (const name of collectScriptCalls(text)) {
    if (!(name in env.scripts)) problems.push(`README.md: package.json에 없는 스크립트 'npm run ${name}'을 안내한다`);
  }

  const entry = entrypointOf(env.scripts);
  if (!entry) problems.push("package.json scripts.start에서 진입점 파일을 찾을 수 없다");
  else {
    const layout = joinBody(bodyOf(text, "## Layout"));
    if (layout === "" || !layout.includes(entry)) problems.push(`README.md: '## Layout'이 진입점 '${entry}'(scripts.start)를 언급하지 않는다`);
    if (!env.exists(entry)) problems.push(`진입점 '${entry}'이 디스크에 없다`);
  }

  return problems;
}

/** "아직 없음" 마커는 README 전체에서 한 벌이고 `## Layout`에만 나타난다. */
function markerProblems(text) {
  const layoutLines = new Set((bodyOf(text, "## Layout") ?? []).map((r) => r.lineNo));
  return text
    .split("\n")
    .map((line, i) => ({ line, lineNo: i + 1 }))
    .filter((r) => r.line.includes(PLANNED_MARKER) && !layoutLines.has(r.lineNo))
    .map((r) => `README.md:${r.lineNo}: '${PLANNED_MARKER}' 마커는 '## Layout' 밖에서 쓸 수 없다`);
}

// ---------------------------------------------------------------- dw3

const firstIndex = (rows, re) => rows.findIndex((r) => re.test(r.text));

function runTestsProblems(text) {
  const rows = bodyOf(text, "## Run tests");
  if (!rows) return ["README.md: '## Run tests' 섹션이 없다"];

  const install = firstIndex(rows, /\bnpm\s+(ci|install)\b/);
  const dbUp = firstIndex(rows, /docker-compose\.test\.yml/);
  const runTests = firstIndex(rows, /\bnpm\s+test\b|\bnpm\s+run\s+test\b|\bvitest\s+run\b/);

  const problems = [];
  if (install < 0) problems.push("README.md '## Run tests': 설치 단계(`npm ci`/`npm install`)가 없다");
  if (dbUp < 0) problems.push("README.md '## Run tests': `docker-compose.test.yml`을 이름으로 가리키는 DB 기동 단계가 없다");
  if (runTests < 0) problems.push("README.md '## Run tests': 테스트 실행 명령이 없다");
  if (problems.length) return problems;

  if (!(install < dbUp)) problems.push("README.md '## Run tests': 설치 단계가 DB 기동 단계보다 뒤에 있다");
  if (!(dbUp < runTests)) problems.push("README.md '## Run tests': 첫 테스트 실행 명령이 DB 기동 단계보다 앞에 있다 — 그 순서로 따라 하면 통합 테스트가 터진다");
  if (problems.length) return problems;

  const window = rows.slice(dbUp, runTests).map((r) => r.text).join("\n");
  if (!READINESS_TOKENS.some((t) => window.includes(t))) {
    problems.push(`README.md '## Run tests': DB 기동 단계가 준비 완료를 보장하지 않는다 — ${READINESS_TOKENS.map((t) => `'${t}'`).join("/")} 중 하나가 필요하다`);
  }
  if (/\bsleep\b/.test(window)) problems.push("README.md '## Run tests': 고정 대기(`sleep`)는 준비 완료를 보장하지 않는다 (docs/QA.md 결정성 규칙)");
  return problems;
}

// ---------------------------------------------------------------- dw4

const METHOD_PATH = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9/_.:{}-]*)/g;
const TODAYS_ROUTE = { method: "GET", path: "/healthz" };
const FEATURE_SPEC = /docs\/features\/[A-Za-z0-9._-]+\.md/;

function endpointProblems(text, env) {
  const rows = bodyOf(text, "## Endpoints");
  if (!rows) return ["README.md: '## Endpoints' 섹션이 없다"];

  const entries = [];
  for (const row of rows) {
    for (const m of row.text.matchAll(METHOD_PATH)) entries.push({ method: m[1], path: m[2], line: row.text, lineNo: row.lineNo });
  }

  const problems = [];
  if (entries.length === 0) return ["README.md '## Endpoints': 엔드포인트를 METHOD+경로로 하나도 적지 않았다"];
  if (!entries.some((e) => e.method === TODAYS_ROUTE.method && e.path === TODAYS_ROUTE.path)) {
    problems.push(`README.md '## Endpoints': 오늘 실제로 응답하는 '${TODAYS_ROUTE.method} ${TODAYS_ROUTE.path}'가 이름으로 적혀 있지 않다`);
  }

  for (const e of entries) {
    if (e.method === TODAYS_ROUTE.method && e.path === TODAYS_ROUTE.path) continue;
    const spec = e.line.match(FEATURE_SPEC);
    if (!spec) {
      problems.push(`README.md:${e.lineNo}: 아직 없는 엔드포인트 '${e.method} ${e.path}'가 어떤 docs/features/*.md에도 귀속되지 않았다`);
    } else if (!env.exists(spec[0])) {
      problems.push(`README.md:${e.lineNo}: '${e.method} ${e.path}'가 존재하지 않는 스펙 '${spec[0]}'을 가리킨다`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- 합성 입력

const SECTION_STUB = REQUIRED_HEADINGS.flatMap((h) => [h, "x", ""]).join("\n");
const fakeEnv = (overrides = {}) => ({
  scripts: { test: "vitest run", start: "node src/app.js", e2e: "playwright test" },
  exists: (p) => ["src/app.js", "docs/features/001-create-note.md", "docker-compose.test.yml"].includes(p),
  ...overrides,
});
const withSection = (heading, body) => {
  const next = SECTION_STUB.replace(`${heading}\nx`, `${heading}\n${body}`);
  // 합성 입력을 만들지 못하면 그 아래 판별력 단언은 전부 공허하게 참이 된다.
  if (next === SECTION_STUB) throw new Error(`합성 입력 생성 실패: '${heading}' 자리를 찾지 못했다`);
  return next;
};

describe("#18 README guard", () => {
  it("test_18_readme_sections", () => {
    // README.md 부재는 이 이슈의 증상 그 자체다 — 조용히 skip하지 않고 시끄럽게 실패한다.
    expect(existsSync(readmeUrl), "저장소 루트에 README.md가 없다 (이슈 #18의 증상)").toBe(true);

    const text = readReadme();
    expect(sectionProblems(text)).toEqual([]);

    // 판별력: 헤딩만 있는 README도, 섹션이 빠진 README도 RED다.
    expect(sectionProblems(REQUIRED_HEADINGS.join("\n\n"))).toHaveLength(REQUIRED_HEADINGS.length);
    expect(sectionProblems(SECTION_STUB.replace("## Layout\nx", ""))).toEqual([expect.stringContaining("'## Layout' 섹션이 없다")]);
    expect(sectionProblems(SECTION_STUB.replace("## Layout\nx", "## Layout\n   "))).toEqual([expect.stringContaining("본문이 한 줄도 없다")]);
    expect(sectionProblems(SECTION_STUB)).toEqual([]);
  });

  it("test_18_readme_references_resolve", () => {
    expect(existsSync(readmeUrl), "저장소 루트에 README.md가 없다 (이슈 #18의 증상)").toBe(true);

    const text = readReadme();
    const env = realEnv();
    expect(referenceProblems(text, env)).toEqual([]);
    expect(markerProblems(text)).toEqual([]);

    // 판별력 (a) 죽은 경로 / 글로브 면제 / "아직 없음" 면제
    const layout = (body) => withSection("## Layout", body);
    expect(referenceProblems(layout("`src/app.js`와 `docs/NOPE.md`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'docs/NOPE.md'")]);
    expect(referenceProblems(layout("`src/app.js` — `test/integration/**`는 글로브다"), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout(`\`src/app.js\` / \`src/routes/notes.js\` ${PLANNED_MARKER}`), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout("`src/app.js` / `src/routes/notes.js`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'src/routes/notes.js'")]);
    // 낱말과 URL은 경로 주장이 아니다 (백틱을 지우게 가르치지 않는다)
    expect(referenceProblems(layout("`src/app.js`는 `PORT`를 읽는다 — `express` / http://localhost:3000/healthz"), fakeEnv())).toEqual([]);

    // 판별력 (b) 죽은 스크립트
    expect(referenceProblems(layout("`src/app.js`\n\n    npm run e2eee"), fakeEnv())).toEqual([expect.stringContaining("npm run e2eee")]);
    expect(referenceProblems(layout("`src/app.js`\n\n    npm run e2e 와 npm test"), fakeEnv())).toEqual([]);

    // 판별력 (d) 진입점은 리터럴이 아니라 package.json scripts.start에서 파생된다
    const renamed = fakeEnv({ scripts: { start: "node src/server.js" }, exists: (p) => p === "src/server.js" });
    expect(referenceProblems(layout("`src/app.js`"), renamed)).toEqual([
      expect.stringContaining("존재하지 않는 경로 'src/app.js'"),
      expect.stringContaining("진입점 'src/server.js'"),
    ]);
    expect(referenceProblems(layout("`src/server.js`"), renamed)).toEqual([]);

    // 판별력: 마커는 `## Layout` 밖에서 쓸 수 없다 (엔드포인트 상태 어휘로 번지지 않게)
    expect(markerProblems(withSection("## Endpoints", `- POST /notes ${PLANNED_MARKER}`))).toEqual([expect.stringContaining("'## Layout' 밖에서 쓸 수 없다")]);
    expect(markerProblems(layout(`\`src/routes/notes.js\` ${PLANNED_MARKER}`))).toEqual([]);
  });

  it("test_18_readme_run_tests_order_enforced", () => {
    expect(existsSync(readmeUrl), "저장소 루트에 README.md가 없다 (이슈 #18의 증상)").toBe(true);

    expect(runTestsProblems(readReadme())).toEqual([]);

    const steps = (...lines) => withSection("## Run tests", lines.join("\n"));
    const good = ["npm ci", "docker compose -f docker-compose.test.yml up -d --wait", "npm test"];

    expect(runTestsProblems(steps(...good))).toEqual([]);
    // 순서를 뒤집으면 RED — "기동 언급 이후 어딘가"가 아니라 첫 테스트 명령의 위치로 판정한다
    expect(runTestsProblems(steps(good[0], good[2], good[1]))).toEqual([expect.stringContaining("첫 테스트 실행 명령이 DB 기동 단계보다 앞에 있다")]);
    expect(runTestsProblems(steps(good[1], good[0], good[2]))).toEqual([expect.stringContaining("설치 단계가 DB 기동 단계보다 뒤에")]);
    // 준비 대기를 빼거나 고정 대기로 바꾸면 RED
    expect(runTestsProblems(steps(good[0], "docker compose -f docker-compose.test.yml up -d", good[2]))).toEqual([expect.stringContaining("준비 완료를 보장하지 않는다")]);
    expect(runTestsProblems(steps(good[0], "docker compose -f docker-compose.test.yml up -d", "sleep 10", good[2]))).toEqual([
      expect.stringContaining("준비 완료를 보장하지 않는다"),
      expect.stringContaining("고정 대기"),
    ]);
    // 단계가 통째로 빠져도 RED
    expect(runTestsProblems(steps(good[0], good[2]))).toEqual([expect.stringContaining("DB 기동 단계가 없다")]);
    expect(runTestsProblems(steps(good[1], good[2]))).toEqual([expect.stringContaining("설치 단계")]);
    // 준비 대기 토큰은 셋 다 받는다 (기동 명령의 리터럴 형태는 요구하지 않는다)
    for (const token of READINESS_TOKENS) {
      expect(runTestsProblems(steps(good[0], `docker compose -f docker-compose.test.yml up -d`, `준비 대기: ${token}`, good[2]))).toEqual([]);
    }

    // --- review cf1: 참인 README에 RED를 내지 않고, 거짓인 README를 놓치지도 않는다 ---

    // (a) 설치와 기동이 **같은 줄**이면 순서는 줄 안의 위치로 판정한다 — 줄 번호만 보면 '설치가 뒤에 있다'는
    //     거짓 진단이 나온다(cf1 (a)).
    const oneLine = "`npm ci`로 설치하고 `docker compose -f docker-compose.test.yml up -d --wait`로 DB를 띄운 다음:";
    expect(runTestsProblems(steps(oneLine, "```bash", "npm test", "```"))).toEqual([]);
    // 같은 줄이라도 기동이 설치보다 앞서면 여전히 RED다
    const oneLineBad = "`docker compose -f docker-compose.test.yml up -d --wait`로 DB를 띄우고 `npm ci`로 설치한 다음:";
    expect(runTestsProblems(steps(oneLineBad, "```bash", "npm test", "```"))).toEqual([
      expect.stringContaining("DB 기동 단계가 설치 단계보다 먼저"),
    ]);

    // (b) 섹션 인트로의 **산문 언급**은 실행 단계가 아니다 — 뒤따르는 절차가 옳으면 GREEN(cf1 (b)).
    const intro = "`npm test` 하나로 unit과 integration이 함께 돈다. 그 전에 아래 순서를 그대로 따른다.";
    expect(runTestsProblems(steps(intro, "```bash", ...good, "```"))).toEqual([]);

    // (c) 거짓 음성: 올바른 블록 **뒤에** 순서가 뒤집힌 두 번째 quickstart를 덧붙여도 RED여야 한다(cf1 반례).
    expect(
      runTestsProblems(
        steps("```bash", ...good, "```", "", "```bash", "npm test", "docker compose -f docker-compose.test.yml up -d", "```"),
      ),
    ).toEqual([
      expect.stringContaining("준비 완료를 보장하지 않는다"),
      expect.stringContaining("같은 블록 안"),
    ]);

    // (d) 펜스 안 두 줄을 맞바꾸면, 그 아래 산문이 옳은 순서를 반복해도 RED다 (review s1의 구멍).
    expect(
      runTestsProblems(
        steps(
          "```bash",
          good[0],
          good[2],
          good[1],
          "```",
          "",
          "1. `npm ci` — 설치",
          "2. `docker compose -f docker-compose.test.yml up -d --wait` — DB 기동",
          "3. `npm test` — 실행",
        ),
      ),
    ).toEqual([expect.stringContaining("같은 블록 안")]);

    // (e) 통합 테스트를 명시적으로 제외한 실행은 DB를 요구하지 않는다 — docker 없는 안내가 false-RED를 내지 않는다.
    expect(
      runTestsProblems(steps("```bash", ...good, "```", "", "```bash", "npx vitest run --exclude 'test/integration/**'", "```")),
    ).toEqual([]);
  });

  it("test_18_readme_endpoints_reflect_today", () => {
    expect(existsSync(readmeUrl), "저장소 루트에 README.md가 없다 (이슈 #18의 증상)").toBe(true);

    expect(endpointProblems(readReadme(), realEnv())).toEqual([]);

    const eps = (body) => withSection("## Endpoints", body);
    // 오늘 실제로 응답하는 라우트를 빼고 아직 없는 것만 나열하면 RED
    expect(endpointProblems(eps("- POST /notes — `docs/features/001-create-note.md`"), fakeEnv())).toEqual([expect.stringContaining("GET /healthz")]);
    // 항목이 0개인 섹션도 RED
    expect(endpointProblems(eps("엔드포인트는 여러 개 있다."), fakeEnv())).toEqual([expect.stringContaining("하나도 적지 않았다")]);
    // 아직 없는 엔드포인트는 실재하는 스펙 문서에 귀속되어야 한다
    expect(endpointProblems(eps("- GET /healthz — 200\n- POST /notes — 201"), fakeEnv())).toEqual([expect.stringContaining("어떤 docs/features/*.md에도 귀속되지 않았다")]);
    expect(endpointProblems(eps("- GET /healthz — 200\n- POST /notes — `docs/features/999-nope.md`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 스펙")]);
    expect(endpointProblems(eps("- GET /healthz — 200\n- POST /notes — `docs/features/001-create-note.md`"), fakeEnv())).toEqual([]);
  });
});
