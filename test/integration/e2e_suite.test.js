// issue #15 — e2e 레인이 "무엇을 막아 주는가"를 양성/음성 대조로 증명한다.
//
// 이 파일의 관측 대상은 `e2e/*.spec.js`의 **단언**이다. 스펙을 실제 playwright 러너로 돌리되,
// 앱 대신 우리가 세운 127.0.0.1 스텁을 향하게 하고 그 스텁의 응답만 바꿔 판정을 뒤집는다.
//   - 스텁이 200 `{"ok":true}`  → 레인은 초록(exit 0)
//   - 스텁이 200 `{"ok":"yes"}` → 레인은 빨강(exit != 0)이고, 출력이 어느 스펙이 왜 깨졌는지 말한다
// 종료 코드만 보면 "환경이 깨져서 non-zero"와 구별되지 않으므로, 음성 쪽은 `N failed`와
// expected/received 값까지 함께 단언한다. 양성 쪽도 `0 passed`(= 아무 테스트도 안 돎)를 거부한다.
//
// 왜 `npm run e2e`(게이트 명령 그 자체)를 쓰지 않는가 — `playwright.config.js`는 보호 경로이고
// (`.factory/ci-settings.json`의 `Edit/Write(playwright.config.*)` deny), 그 파일이 baseURL을
// `http://localhost:3000`으로 못박고 `webServer`로 `node src/app.js`를 항상 띄운다. 외부 타깃을
// 가리킬 방법이 설정 파일 밖에 없으므로, 이 테스트는 같은 스펙을 **webServer 없는** 설정으로 돌린다.
// 그래서 이 단언이 지키는 것은 러너 형상이 아니라 스펙의 단언 자체다. 러너 형상(dw7)과 게이트 승격
// (dw1/dw4)은 사람이 머지해야 하는 diff로 PR 본문에 남겼다.
//
// `browser loads`(e2e/smoke.spec.js)는 `--grep-invert`로 이 실행에서만 제외한다. 저장소의 스펙 파일은
// 건드리지 않으므로 `npm run e2e`는 여전히 두 케이스를 모두 돌린다 — 다만 크로미움 바이너리를 설치하는
// CI 스텝이 이 저장소에 없어서(`.factory/actions/setup/action.yml`), 그 케이스를 이 테스트에 끌어들이면
// 판정이 계약이 아니라 머신 상태에 달리게 된다.
import { afterEach, describe, expect, test } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const E2E_DIR = join(ROOT, "e2e");
const PLAYWRIGHT_CLI = join(ROOT, "node_modules", "@playwright", "test", "cli.js");
const LOOPBACK = "127.0.0.1";
const BROWSER_CASE = "browser loads";   // 이 실행에서만 제외한다 — 위 주석 참고
const LANE_TIMEOUT_MS = 120_000;

// 응답 body만 다른 스텁. 포트는 커널이 고른다(listen 0) — 확보-후-재바인드 창이 없어서
// 전체 스위트와 동시에 돌아도 포트를 다투지 않는다(docs/QA.md: 고정 포트 금지, 조건 대기만).
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

// 저장소의 e2e 스펙을 그대로, 그러나 webServer 없이, 주어진 base URL을 상대로 돌린다.
async function runE2eLaneAgainst(baseURL) {
  const dir = await mkdtemp(join(tmpdir(), "ktb-15-e2e-"));
  const configPath = join(dir, "pw.config.cjs");
  await writeFile(
    configPath,
    // webServer 키가 아예 없다 — 있으면 playwright가 스텁이 잡고 있는 url을 보고
    // "url is already used"로 테스트를 하나도 돌리지 않은 채 throw한다(= 음성 판정 위조).
    `module.exports = ${JSON.stringify({
      testDir: E2E_DIR,
      outputDir: join(dir, "results"),
      timeout: 15_000,
      use: { baseURL },
    }, null, 2)};\n`,
    "utf8",
  );

  const child = spawn(
    process.execPath,
    [PLAYWRIGHT_CLI, "test", "--config", configPath, "--reporter", "list", "--workers", "1", "--grep-invert", BROWSER_CASE],
    { cwd: ROOT, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c) => { output += c; });
  child.stderr.on("data", (c) => { output += c; });
  const [code] = await once(child, "close");
  return { code, output };
}

describe("issue #15 — e2e 레인의 /healthz 계약 단언", () => {
  const running = [];
  afterEach(async () => { while (running.length) await running.pop().stop(); });

  const stub = async (body) => {
    const s = await startHealthzStub(body);
    running.push(s);
    return s;
  };

  // dw6: status가 아니라 **body**를 본다는 것을 같은 스텁 경로의 양성/음성 두 실행으로 증명한다.
  // 이 단언은 `e2e/smoke.spec.js`가 status만 보던 시점(origin/main)에서 음성 실행이 초록이 되어 실패한다.
  test("test_15_e2e_asserts_healthz_body_positive_and_negative", async () => {
    const good = await stub({ ok: true });
    const positive = await runE2eLaneAgainst(good.baseURL);

    // (a) 계약을 지키는 응답에는 레인이 초록이다 — 그리고 실제로 테스트가 돌았다.
    //     "0개 실행 후 exit 0"이 초록으로 읽히면 이 대조 전체가 무의미해진다.
    expect(positive.output).toMatch(/\d+ passed/);
    expect(positive.output).not.toMatch(/\b0 passed/);
    expect(positive.code, `positive run should be green:\n${positive.output}`).toBe(0);
    // (b) 레인이 말을 건 상대는 우리 스텁이다 — webServer가 끼어들어 다른 프로세스를 띄우지 않았다.
    expect(good.paths).toContain("/healthz");

    const bad = await stub({ ok: "yes" });   // 같은 200, 같은 경로. 다른 것은 body 하나뿐이다.
    const negative = await runE2eLaneAgainst(bad.baseURL);

    // (c) body만 깨져도 레인이 빨갛다.
    expect(negative.code, `body regression must fail the e2e lane:\n${negative.output}`).not.toBe(0);
    // (d) 그 빨강은 "환경이 깨졌다"가 아니라 **단언 실패**다 — 실행은 됐고, 무엇이 틀렸는지 말한다.
    expect(negative.output).toMatch(/\d+ failed/);
    expect(negative.output).not.toMatch(/no tests found/i);
    expect(negative.output).toContain("test_15_healthz_body_is_exactly_ok_true");
    expect(negative.output).toMatch(/expected/i);
    expect(negative.output).toMatch(/received/i);
    expect(negative.output).toContain("yes");   // 받은 값
    expect(negative.output).toContain("true");  // 기대한 값
    expect(bad.paths).toContain("/healthz");
  }, LANE_TIMEOUT_MS);
});
