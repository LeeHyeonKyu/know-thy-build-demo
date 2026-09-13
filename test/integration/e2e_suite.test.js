// issue #15 — 새 required 게이트가 **실제로** 무엇을 하는지 두 번의 실행으로 확정한다.
//
//   dw6  브라우저가 없는 환경에서 `harness.commands.e2e`가 초록이고, 그 초록이 "아무것도 안 돌아서"가 아니다.
//   dw7  같은 명령이, 같은 경로가 계약을 깨는 body를 돌려줄 때 빨갛고, 무엇이 왜 깨졌는지 말한다.
//
// 두 실행 모두 **하네스에 적힌 명령 문자열 그대로**를 `bash -lc`로 돌린다 — 게이트(`.factory/lib/gates.js`)가
// 돌릴 것과 한 글자도 다르지 않다. 이전 라운드는 이 파일이 자기 임시 설정 + `--grep-invert`로 스펙만
// 돌려서 "게이트 레인"을 한 번도 관측하지 못했고, verifier가 그 이유로 기각했다.
//
// 앱은 우리가 띄우지 않는다: 127.0.0.1의 빈 포트(포트 0)에 스텁을 세우고 `PLAYWRIGHT_TEST_BASE_URL`로
// 가리킨다. 그 모드에서 `playwright.config.js`는 `webServer`를 아예 내보내지 않으므로(dw4 (a)) 러너가
// "url is already used"로 throw해 음성 판정을 위조하는 경로가 없다. 러너 기동은 이 이슈 전체에서
// 이 파일의 2회뿐이다 — 나머지 done_when은 설정 객체·판정 엔진을 직접 읽는 unit이다.
import { describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHarness } from "../../.factory/lib/config.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LOOPBACK = "127.0.0.1";
const LANE_TIMEOUT_MS = 120_000;
// 게이트와 기여자 명령(`npm run e2e`)이 갈라지는 유일한 방법: 명령줄에서 테스트를 고르는 것.
// 분기는 두 경로가 함께 읽는 `playwright.config.js`에 있어야 한다(`package.json`은 고칠 수 없다).
const SELECTION_ARGS = /--(grep|grep-invert|project|test-ignore|testIgnore|shard|last-failed|only-changed)\b/;

/** 크로미움 바이너리가 존재하지 않는 환경을 결정적으로 만든다 — 빈 디렉터리를 브라우저 루트로 준다. */
const emptyBrowsersPath = () => mkdtemp(join(tmpdir(), "ktb-15-browsers-"));

/**
 * 응답 body만 다른 `/healthz` 스텁. 포트는 커널이 고른다(listen 0) — 확보 후 재바인드하는 창이 없어
 * 전체 스위트와 동시에 돌아도 포트를 다투지 않는다(docs/QA.md: 고정 포트 금지, 조건 대기만).
 */
async function startHealthzStub(body) {
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(0, LOOPBACK);
  await once(server, "listening");
  const { port } = server.address();
  return {
    baseURL: `http://${LOOPBACK}:${port}`,
    paths,
    stop: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

/** `.factory/harness.toml`의 `[commands].e2e`를 게이트와 같은 모양(`bash -lc`)으로 한 번 실행한다. */
async function runHarnessE2eCommand(env0) {
  const harness = loadHarness(ROOT);
  const command = harness.commands.e2e;
  if (typeof command !== "string" || !command.trim()) {
    throw new Error(
      `.factory/harness.toml [commands].e2e is not a command string (got ${JSON.stringify(command)}) — ` +
      "the e2e gate would be MISCONFIGURED and there is nothing for this test to run",
    );
  }
  // 부모 환경에서 흘러드는 값들은 지운 뒤 이 실행이 원하는 것만 다시 넣는다 — 실행 모드를 테스트가 정한다.
  const env = { ...process.env, CI: "1", FORCE_COLOR: "0" };
  for (const k of ["PLAYWRIGHT_TEST_BASE_URL", "PORT", "E2E_BROWSER_AVAILABLE"]) delete env[k];
  Object.assign(env, env0);

  const child = spawn("bash", ["-lc", command], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  const [code] = await once(child, "close");
  return { code, output, command };
}

describe("issue #15 — 게이트가 실제로 돌릴 e2e 명령", () => {
  // dw6: 태어나자마자 영구 RED가 되지 않는다 — 그러나 아무것도 선택하지 않아 초록이 되지도 않는다.
  test("test_15_harness_e2e_command_green_without_browser", async () => {
    const browsersPath = await emptyBrowsersPath();
    const good = await startHealthzStub({ ok: true });
    try {
      const run = await runHarnessE2eCommand({
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
        PLAYWRIGHT_TEST_BASE_URL: good.baseURL,
      });

      // 명령 자체가 테스트를 고르지 않는다 — 고르면 `npm run e2e`(기여자 명령)와 게이트가 갈라진다.
      expect(run.command).not.toMatch(SELECTION_ARGS);
      // 브라우저를 요구하지도, 내려받지도 않는다.
      expect(run.output, `browser-free lane must not ask for a chromium binary:\n${run.output}`)
        .not.toMatch(/Executable doesn't exist|playwright install/i);
      // 실제로 돌았다. "0개 실행 후 exit 0"은 초록이 아니다.
      expect(run.output).toMatch(/\d+ passed/);
      expect(run.output).not.toMatch(/\b0 passed/);
      expect(run.output).not.toMatch(/no tests found/i);
      // webServer가 끼어들지 않았다: 러너가 말을 건 상대는 우리 스텁이다.
      expect(run.output).not.toMatch(/is already used/i);
      expect(good.paths).toContain("/healthz");
      expect(run.code, `${run.command} must exit 0 without a browser:\n${run.output}`).toBe(0);
    } finally {
      await good.stop();
    }
  }, LANE_TIMEOUT_MS);

  // dw7: 그 게이트가 **무엇을 막는가**. dw6과 같은 명령·같은 경로, 바뀌는 것은 body 하나다.
  //   200 {"ok":true}  → exit 0 (dw6)
  //   200 {"ok":"yes"} → exit != 0, 그리고 출력이 어느 스펙이 왜 깨졌는지 말한다
  // 종료 코드만으로는 "환경 파손"과 "계약 파손"을 구분하지 못하므로 귀속까지 함께 단언한다.
  test("test_15_e2e_lane_rejects_healthz_body_regression", async () => {
    const browsersPath = await emptyBrowsersPath();
    const bad = await startHealthzStub({ ok: "yes" });   // 같은 200, 같은 경로. 다른 것은 body뿐이다.
    try {
      const run = await runHarnessE2eCommand({
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
        PLAYWRIGHT_TEST_BASE_URL: bad.baseURL,
      });

      expect(run.code, `body regression must turn the e2e gate red:\n${run.output}`).not.toBe(0);
      expect(run.output).toMatch(/\d+ failed/);
      expect(run.output).not.toMatch(/no tests found/i);
      expect(run.output).not.toMatch(/is already used/i);
      // 사람이 로그만 보고 판단할 수 있어야 한다: 어느 스펙이, 무엇을 기대했고, 무엇을 받았는가.
      expect(run.output).toContain("test_15_healthz_body_is_exactly_ok_true");
      expect(run.output).toMatch(/expected/i);
      expect(run.output).toMatch(/received/i);
      expect(run.output).toContain("yes");    // 받은 값
      expect(run.output).toContain("true");   // 기대한 값
      expect(bad.paths).toContain("/healthz");
    } finally {
      await bad.stop();
    }
  }, LANE_TIMEOUT_MS);
});
