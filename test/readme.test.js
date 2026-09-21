import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";

// #18 — README.md 회귀 가드.
//
// 재는 것은 **파일 내용 + 디스크 조회**이고, 거기에 하나가 더 있다: README가 "오늘 응답한다"고
// 적은 엔드포인트를 **프로덕션 진입점에 직접 물어본다**(dw5). 라우트를 열거하지도 `src/**`를
// 파싱하지도 않으므로 라우트 목록이 README에 얼어붙지 않는다 — 판정 대상은 언제나
// "README가 주장한 것"뿐이다. 이 채널은 test/smoke.test.js가 이미 M1 게이트 안에서 쓰는 것과
// 같고, docs/TECHNICAL.md §Testing Strategy가 "관측 가능한 응답 계약"을 글루 금지에서 뺀다.
//
// `## Run tests`의 **단계 순서·준비 대기**는 이 가드가 기계로 재지 않는다(plan non_goals):
// 직전 라운드의 순서 판정이 참인 README 네 변형에 거짓 RED를 냈고(review cf1), 그 성질은
// dw2에서 리뷰어가 절차를 글자 그대로 실행해 판정한다.
//
// 각 테스트는 실제 README.md에 더해 **합성 입력**으로 자기 판별력을 같은 실행 안에서 잰다.

// 저장소 루트는 **게이트를 띄운 디렉터리**(process.cwd())이지 이 파일의 위치가 아니다 (dw6).
// 모듈 상대(`../`)로 잡으면, 중단된 prove-test가 남긴 `.factory/out/prove-wt` 워크트리의 이 파일
// 사본이 자기 워크트리를 루트로 보고 "README.md가 없다"로 저장소의 **모든 후속 PR**을 RED로
// 만든다(vitest의 테스트 글로빙은 dot:true이고 vitest.config.js의 exclude는 node_modules·e2e뿐).
// cwd 기준이면 그 사본도 루트의 README를 읽어 초록이고, 동시에 prove-test가 base 워크트리를
// cwd로 삼아 이 파일을 돌릴 때는 그 트리에 README.md가 없으므로 여전히 RED다.
const gateRoot = pathToFileURL(`${process.cwd()}/`);
const readmeUrl = new URL("README.md", gateRoot);

/** `## Layout`에서만 쓰는 단 하나의 "아직 없다" 마커. 새 상태 어휘를 만들지 않는다. */
const PLANNED_MARKER = "(아직 없음)";
/** `## Endpoints`에서 "오늘 응답한다"를 뜻하는 단 하나의 표기. dw4와 dw5가 **같은 문구**를 읽는다. */
const TODAY_CLAIM = "오늘 응답한다";
const REQUIRED_HEADINGS = ["## What", "## Endpoints", "## Run tests", "## Layout"];
const PATH_EXT = /\.(js|mjs|cjs|json|md|yml|yaml|toml|sh|sql|ts)$/i;

const readReadme = () => readFileSync(readmeUrl, "utf8");
const readPkg = () => JSON.parse(readFileSync(new URL("package.json", gateRoot), "utf8"));

/** 저장소 루트 기준 실재 여부. 가드는 경로 문자열을 하드코딩하지 않고 이 함수만 쓴다. */
const existsInRepo = (p) => existsSync(new URL(p, gateRoot));

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

// ---------------------------------------------------------------- dw3

/** 토큰이 "저장소 상대경로 주장"인가. 낱말(PORT, express)과 URL과 글로브는 주장이 아니다. */
function isPathClaim(token) {
  if (!token || /\s/.test(token)) return false;
  if (token.includes("*")) return false; // 글로브는 경로 주장이 아니다
  if (token.includes("://") || token.startsWith("/") || token.startsWith("~") || token.startsWith("-") || token.startsWith("$")) return false;
  if (token.startsWith("#") || token.startsWith("mailto:")) return false;
  return token.includes("/") || PATH_EXT.test(token);
}

const trimToken = (t) => t.replace(/^[('"`\[]+/, "").replace(/[)'"`\],;:.]+$/, "");

/**
 * `docs/TECHNICAL.md:76` 같은 **줄 인용**에서 경로 부분만 남긴다. 이 저장소의 문서·플랜·리뷰가
 * 전부 이 표기로 인용하는데(review cs1), 인용을 통째로 경로로 읽으면 참인 README가 RED가 된다.
 * 줄 번호 자체가 썩었는지는 아무도 보지 않는다 — 이 가드도 보지 않는다(plan open_risks).
 */
const CITATION = /^(.+?):(\d+)(?:[-–]\d+)?$/;
const stripCitation = (t) => CITATION.exec(t)?.[1] ?? t;

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
      const token = stripCitation(trimToken(raw));
      if (isPathClaim(token)) claims.push({ token, line, lineNo: i + 1 });
    };
    if (fenced) {
      for (const word of line.split(/\s+/)) push(word);
      return;
    }
    for (const m of line.matchAll(/`([^`\n]+)`/g)) push(m[1]);
    for (const m of line.matchAll(/\[[^\]\n]*\]\(([^)\s]+)/g)) push(m[1]);
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
    const exists = env.exists(token);
    if (line.includes(PLANNED_MARKER)) {
      // 면제는 **아직 없는 것**에만 붙는다. 이미 디스크에 있는 경로가 마커 뒤에 있으면 그것은
      // 낡은 마커이고, 마커 한 개가 그 줄의 모든 주장을 무제한 끄던 백지수표(review arch-s5)가
      // 여기서 닫힌다 — 실재하는 경로를 섞어 죽은 경로를 숨길 수 없다.
      if (exists) problems.push(`README.md:${lineNo}: 이미 디스크에 있는 '${token}'이 '${PLANNED_MARKER}' 뒤에 숨어 있다 — 마커는 아직 없는 경로에만 붙는다`);
      continue;
    }
    if (!exists) problems.push(`README.md:${lineNo}: 존재하지 않는 경로 '${token}'을 가리킨다`);
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

// ---------------------------------------------------------------- dw4 / dw5

const METHOD_PATH = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[A-Za-z0-9/_.:{}-]*)/g;
/** 오늘 이 저장소가 등록하는 라우트(`src/app.js`의 /healthz·/version — #8, #39/#45). */
const TODAYS_ROUTES = [
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/version" },
];
const FEATURE_SPEC = /docs\/features\/[A-Za-z0-9._-]+\.md/g;

/** `## Endpoints`의 METHOD+경로 항목. `today`는 그 줄이 "오늘 응답한다"고 주장했는가다. */
function endpointEntries(text) {
  const rows = bodyOf(text, "## Endpoints");
  if (!rows) return null;
  const entries = [];
  for (const row of rows) {
    for (const m of row.text.matchAll(METHOD_PATH)) {
      entries.push({ method: m[1], path: m[2], line: row.text, lineNo: row.lineNo, today: row.text.includes(TODAY_CLAIM) });
    }
  }
  return entries;
}

function endpointProblems(text, env) {
  const entries = endpointEntries(text);
  if (!entries) return ["README.md: '## Endpoints' 섹션이 없다"];
  if (entries.length === 0) return ["README.md '## Endpoints': 엔드포인트를 METHOD+경로로 하나도 적지 않았다"];

  const problems = [];
  for (const route of TODAYS_ROUTES) {
    const hit = entries.find((e) => e.method === route.method && e.path === route.path);
    if (!hit) problems.push(`README.md '## Endpoints': 오늘 실제로 응답하는 '${route.method} ${route.path}'가 이름으로 적혀 있지 않다`);
    else if (!hit.today) problems.push(`README.md:${hit.lineNo}: '${route.method} ${route.path}'는 오늘 응답하는데 '${TODAY_CLAIM}'라고 적혀 있지 않다`);
  }

  for (const e of entries) {
    if (e.today) continue; // 오늘 응답한다는 주장은 dw5가 진입점에 직접 물어본다
    const specs = [...e.line.matchAll(FEATURE_SPEC)].map((m) => m[0]);
    if (specs.length === 0) {
      problems.push(`README.md:${e.lineNo}: 아직 없는 엔드포인트 '${e.method} ${e.path}'가 어떤 docs/features/*.md에도 귀속되지 않았다`);
      continue;
    }
    // 한 줄이 여러 스펙을 가리키면 **전부** 실재해야 한다 — 첫 매치만 보면 두 번째 링크가
    // 죽어도 조용하다(review qa-should_fix-1).
    for (const spec of specs) {
      if (!env.exists(spec)) problems.push(`README.md:${e.lineNo}: '${e.method} ${e.path}'가 존재하지 않는 스펙 '${spec}'을 가리킨다`);
    }
  }
  return problems;
}

/**
 * dw5 — README가 "오늘 응답한다"고 적은 METHOD+경로를 진입점에 그대로 물어본다.
 * 라우트를 열거하지 않는다: README가 주장하지 않은 라우트는 보지 않으므로, README를 건드리지
 * 않은 다음 라우트 PR이 이 검사로 RED가 되지 않는다.
 */
async function answerProblems(text, port) {
  const entries = endpointEntries(text) ?? [];
  const problems = [];
  for (const e of entries.filter((x) => x.today)) {
    const res = await fetch(`http://127.0.0.1:${port}${e.path}`, { method: e.method });
    if (res.status === 404) {
      problems.push(`README.md:${e.lineNo}: '${e.method} ${e.path}'가 '${TODAY_CLAIM}'고 적혀 있지만 진입점은 404를 돌려준다`);
    }
    await res.arrayBuffer(); // 응답 본문을 흘려 소켓을 닫는다
  }
  return problems;
}

// ---------------------------------------------------------------- 진입점 기동 (dw5)

const BOOT_TIMEOUT_MS = 20000;
const READY_LINE = "listening on ";

// 127.0.0.1의 빈 포트를 동적으로 확보한다. 고정 포트는 금지다 — new-test-repeat가 전체 스위트와
// 이 파일을 동시에 돌린다(docs/QA.md 결정성 규칙, test/smoke.test.js와 같은 규약).
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

/** 진입점은 리터럴이 아니라 `package.json` scripts.start에서 파생한다. 조건 대기만(No sleep). */
async function startEntrypoint() {
  const entry = entrypointOf(readPkg().scripts ?? {});
  if (!entry) throw new Error("package.json scripts.start에서 진입점 파일을 찾을 수 없다");
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [fileURLToPath(new URL(entry, gateRoot))], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });

  const dead = () => child.exitCode !== null || child.signalCode !== null;
  const stop = async () => {
    if (dead()) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };

  try {
    await vi.waitFor(
      () => {
        if (dead()) throw new Error(`진입점 '${entry}'이 리스닝 전에 죽었다: ${stderr}${stdout}`);
        if (!stdout.includes(READY_LINE + port)) throw new Error(`진입점이 아직 포트 ${port}를 잡지 않았다: ${JSON.stringify(stdout)}`);
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
}

// ---------------------------------------------------------------- 합성 입력

const SECTION_STUB = REQUIRED_HEADINGS.flatMap((h) => [h, "x", ""]).join("\n");
const fakeEnv = (overrides = {}) => ({
  scripts: { test: "vitest run", start: "node src/app.js", e2e: "playwright test" },
  exists: (p) => ["src/app.js", "docs/features/001-create-note.md", "docs/features/002-list-notes.md", "docker-compose.test.yml"].includes(p),
  ...overrides,
});
const withSection = (heading, body) => {
  const next = SECTION_STUB.replace(`${heading}\nx`, `${heading}\n${body}`);
  // 합성 입력을 만들지 못하면 그 아래 판별력 단언은 전부 공허하게 참이 된다.
  if (next === SECTION_STUB) throw new Error(`합성 입력 생성 실패: '${heading}' 자리를 찾지 못했다`);
  return next;
};
const readmeExists = () => expect(existsSync(readmeUrl), `저장소 루트(${process.cwd()})에 README.md가 없다 (이슈 #18의 증상)`).toBe(true);

/**
 * dw5의 합성 "오늘 응답한다" 주장에 쓰는 경로. 이 저장소가 등록한 적도, `docs/features/*.md`가
 * 예고한 적도 없는 이름이어야 한다 — 계획된 라우트로 뽑으면 그것을 구현하는 PR이 README와
 * 무관하게 이 가드를 RED로 만든다(review cf1).
 */
const ABSENT_PATH = "/__readme_guard_absent__";

/** 실재하는 기능 스펙 전문. 위 이름이 '예고된 라우트'가 아님을 기계로 확인하는 데만 쓴다. */
function featureSpecText() {
  const dir = new URL("docs/features/", gateRoot);
  const names = readdirSync(dir).filter((n) => n.endsWith(".md"));
  // 스펙이 0개면 아래 핀은 공허하게 참이 된다.
  expect(names.length, "docs/features/*.md를 하나도 찾지 못했다").toBeGreaterThan(0);
  return names.map((n) => readFileSync(new URL(n, dir), "utf8")).join("\n");
}

describe("#18 README guard", () => {
  it("test_18_readme_sections", () => {
    // README.md 부재는 이 이슈의 증상 그 자체다 — 조용히 skip하지 않고 시끄럽게 실패한다.
    readmeExists();

    expect(sectionProblems(readReadme())).toEqual([]);

    // 판별력: 헤딩만 있는 README도, 섹션이 빠진 README도, 본문이 공백뿐인 README도 RED다.
    expect(sectionProblems(REQUIRED_HEADINGS.join("\n\n"))).toHaveLength(REQUIRED_HEADINGS.length);
    expect(sectionProblems(SECTION_STUB.replace("## Layout\nx", ""))).toEqual([expect.stringContaining("'## Layout' 섹션이 없다")]);
    expect(sectionProblems(SECTION_STUB.replace("## Layout\nx", "## Layout\n   "))).toEqual([expect.stringContaining("본문이 한 줄도 없다")]);
    expect(sectionProblems(SECTION_STUB)).toEqual([]);
  });

  it("test_18_readme_references_resolve", () => {
    readmeExists();

    const text = readReadme();
    expect(referenceProblems(text, realEnv())).toEqual([]);
    expect(markerProblems(text)).toEqual([]);

    const layout = (body) => withSection("## Layout", body);

    // 판별력 (a) 죽은 경로는 RED, 글로브는 주장이 아니다
    expect(referenceProblems(layout("`src/app.js`와 `docs/NOPE.md`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'docs/NOPE.md'")]);
    expect(referenceProblems(layout("`src/app.js` — `test/integration/**`는 글로브다"), fakeEnv())).toEqual([]);

    // 판별력 (b) `경로:줄` 인용은 이 저장소 문서의 관용 표기다 — 참인 인용에 RED를 내지 않고,
    //           죽은 경로의 인용은 여전히 RED다 (review cs1).
    expect(referenceProblems(layout("`src/app.js:26`이 헬스 라우트를 등록한다"), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout("`src/app.js`와 `src/nope.js:26`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'src/nope.js'")]);

    // 판별력 (c) 마커 면제는 **아직 없는 것**에만 붙는다: 실재하는 경로를 섞어 죽은 경로를
    //           숨길 수 없고(review arch-s5의 백지수표), 낡은 마커 자체가 RED다.
    expect(referenceProblems(layout(`\`src/app.js\`\n\`src/routes/notes.js\` ${PLANNED_MARKER}`), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout(`\`src/app.js\`\n\`src/app.js\` · \`docs/GONE.md\` · \`test/nope.test.js\` ${PLANNED_MARKER}`), fakeEnv())).toEqual([
      expect.stringContaining("이미 디스크에 있는 'src/app.js'"),
    ]);
    expect(referenceProblems(layout("`src/app.js` / `src/routes/notes.js`"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'src/routes/notes.js'")]);

    // 낱말과 URL은 경로 주장이 아니다 (백틱을 지우게 가르치지 않는다)
    expect(referenceProblems(layout("`src/app.js`는 `PORT`를 읽는다 — `express` / http://localhost:3000/healthz"), fakeEnv())).toEqual([]);

    // 판별력 (d) 죽은 스크립트
    expect(referenceProblems(layout("`src/app.js`\n\n    npm run e2eee"), fakeEnv())).toEqual([expect.stringContaining("npm run e2eee")]);
    expect(referenceProblems(layout("`src/app.js`\n\n    npm run e2e 와 npm test"), fakeEnv())).toEqual([]);

    // 판별력 (e) 진입점은 리터럴이 아니라 package.json scripts.start에서 파생된다
    const renamed = fakeEnv({ scripts: { start: "node src/server.js" }, exists: (p) => p === "src/server.js" });
    expect(referenceProblems(layout("`src/app.js`"), renamed)).toEqual([
      expect.stringContaining("존재하지 않는 경로 'src/app.js'"),
      expect.stringContaining("진입점 'src/server.js'"),
    ]);
    expect(referenceProblems(layout("`src/server.js`"), renamed)).toEqual([]);

    // 판별력 (f) 마크다운 링크도 경로 주장이다 — title 문법에서도 수집한다(review qa-should_fix-2)
    expect(referenceProblems(layout("[앱](src/app.js)과 [스펙](docs/NOPE.md \"제목\")"), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 경로 'docs/NOPE.md'")]);

    // 판별력 (h) 코드펜스 안의 **진짜 경로**는 여전히 본다 — 아래 (i)가 펜스 스캔을 끄지 않았음을
    //           같은 실행에서 증명한다.
    expect(referenceProblems(layout("`src/app.js`\n\n```bash\ndocker compose -f docker-compose.test.yml up -d --wait\n```"), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout("`src/app.js`\n\n```bash\ndocker compose -f docker-compose.nope.yml up -d\n```"), fakeEnv())).toEqual([
      expect.stringContaining("존재하지 않는 경로 'docker-compose.nope.yml'"),
    ]);

    // 판별력 (i) 정직한 HTTP 예시는 '존재하지 않는 경로'가 아니다 (review cf2 실측): MIME 타입과
    //           프로토콜 버전은 저장소 상대경로 주장이 아니다. 이 오진이 남으면 001을 문서화하는
    //           사람은 Content-Type 헤더를 뺀 — 즉 Express 5의 json 파싱에서 **거짓인** — curl만
    //           적을 수 있고, dw3 텍스트가 계약의 절반으로 명시한 "정직한 README는 RED가 되지
    //           않는다"가 깨진다.
    expect(referenceProblems(layout("`src/app.js`\n\n```bash\ncurl -i -H 'Content-Type: application/json' http://localhost:3000/notes\n```"), fakeEnv())).toEqual([]);
    expect(referenceProblems(layout("`src/app.js`\n\n```http\nPOST /notes HTTP/1.1\nContent-Type: application/vnd.api+json\nAccept: text/markdown\n```"), fakeEnv())).toEqual([]);

    // 판별력 (g) 마커는 `## Layout` 밖에서 쓸 수 없다 (엔드포인트 상태 어휘로 번지지 않게)
    expect(markerProblems(withSection("## Endpoints", `- POST /notes ${PLANNED_MARKER}`))).toEqual([expect.stringContaining("'## Layout' 밖에서 쓸 수 없다")]);
    expect(markerProblems(layout(`\`src/routes/notes.js\` ${PLANNED_MARKER}`))).toEqual([]);
  });

  it("test_18_readme_endpoints_reflect_today", () => {
    readmeExists();

    expect(endpointProblems(readReadme(), realEnv())).toEqual([]);

    const eps = (body) => withSection("## Endpoints", body);
    const today = (line) => `${line} — ${TODAY_CLAIM}`;
    const honest = [today("- GET /healthz"), today("- GET /version")].join("\n");

    // 오늘 응답하는 라우트가 빠지면 RED (`GET /version`은 #45/#46로 머지됐다)
    expect(endpointProblems(eps(`${today("- GET /healthz")}\n- POST /notes — 스펙: \`docs/features/001-create-note.md\``), fakeEnv())).toEqual([
      expect.stringContaining("GET /version"),
    ]);
    // 오늘 응답하는데 "오늘 응답한다"로 적지 않으면 RED — dw5가 물어볼 줄이 사라지기 때문이다
    // (그 줄은 "아직 없는 것"으로 읽히므로 스펙 귀속까지 요구받는다 — 두 진단이 같이 난다)
    expect(endpointProblems(eps(`- GET /healthz — 200\n${today("- GET /version")}`), fakeEnv())).toEqual([
      expect.stringContaining(`'${TODAY_CLAIM}'라고 적혀 있지 않다`),
      expect.stringContaining("귀속되지 않았다"),
    ]);
    // 항목이 0개인 섹션도 RED
    expect(endpointProblems(eps("엔드포인트는 여러 개 있다."), fakeEnv())).toEqual([expect.stringContaining("하나도 적지 않았다")]);
    // 아직 없는 엔드포인트는 실재하는 스펙 문서에 귀속되어야 한다
    expect(endpointProblems(eps(`${honest}\n- POST /notes — 201`), fakeEnv())).toEqual([expect.stringContaining("어떤 docs/features/*.md에도 귀속되지 않았다")]);
    expect(endpointProblems(eps(`${honest}\n- POST /notes — \`docs/features/999-nope.md\``), fakeEnv())).toEqual([expect.stringContaining("존재하지 않는 스펙")]);
    // 한 줄의 **두 번째** 스펙 링크가 죽어도 잡는다
    expect(endpointProblems(eps(`${honest}\n- GET /notes — \`docs/features/002-list-notes.md\`(목록), \`docs/features/003-nope.md\`(검색)`), fakeEnv())).toEqual([
      expect.stringContaining("docs/features/003-nope.md"),
    ]);
    expect(endpointProblems(eps(`${honest}\n- POST /notes — \`docs/features/001-create-note.md\``), fakeEnv())).toEqual([]);
  });

  describe("오늘 응답한다고 적힌 것은 실제로 응답한다", () => {
    let app;
    beforeAll(async () => { app = await startEntrypoint(); }, BOOT_TIMEOUT_MS + 5000);
    afterAll(async () => { await app?.stop(); });

    it("test_18_readme_endpoints_answer_today", async () => {
      readmeExists();

      const text = readReadme();
      const claimed = (endpointEntries(text) ?? []).filter((e) => e.today);
      // 주장이 0개면 이 검사는 공허하게 참이 된다 — 그 상태 자체를 RED로 둔다.
      expect(claimed.length).toBeGreaterThan(0);
      expect(await answerProblems(text, app.port)).toEqual([]);

      const eps = (body) => withSection("## Endpoints", body);

      // 판별력 (1) 없는 엔드포인트를 "오늘 응답한다"고 적으면 RED이고, 메시지는 관측된 404를 말한다
      //           (review cs4가 영구 GREEN으로 실측했던 바로 그 줄).
      //           합성 주장의 경로는 **이 저장소가 앞으로도 등록하지 않을** 이름이어야 한다:
      //           `POST /notes`로 뽑으면 001(P0)을 구현하는 PR이 README를 한 글자도 건드리지 않고
      //           이 가드를 RED로 만든다(review cf1 실측). 판별력은 같고 src/app.js 결합만 없다.
      expect(await answerProblems(eps(`- POST ${ABSENT_PATH} — ${TODAY_CLAIM}. 201`), app.port)).toEqual([
        expect.stringContaining("404"),
      ]);
      // 그 이름이 계획된 라우트로 바뀌면 위 결합이 되살아나므로, 스펙이 예고한 경로가 아님을
      // 기계로 붙들어 둔다 (rework 회귀 핀 cf1).
      expect(featureSpecText()).not.toContain(ABSENT_PATH);

      // 판별력 (2) 라우트 목록을 얼리지 않는다: README가 /healthz만 주장하면 그것만 본다.
      //           같은 프로세스가 다른 라우트에도 답하지만 이 검사는 그것을 요구하지 않으므로,
      //           README를 건드리지 않은 다음 라우트 PR이 여기서 RED가 되지 않는다. (`/version`의
      //           응답 계약을 여기서 다시 단언하지 않는다 — 그 계약은 test/smoke.test.js의 것이다.)
      expect(await answerProblems(eps(`- GET /healthz — ${TODAY_CLAIM}`), app.port)).toEqual([]);

      // 판별력 (3) 스펙에 귀속된 줄("오늘 응답한다"가 없는 줄)은 오늘 404여도 RED가 아니다
      expect(await answerProblems(eps("- POST /notes — 스펙: `docs/features/001-create-note.md`"), app.port)).toEqual([]);
    }, BOOT_TIMEOUT_MS + 5000);
  });
});
