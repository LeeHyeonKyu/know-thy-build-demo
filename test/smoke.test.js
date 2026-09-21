import { test, expect } from "vitest";
test("smoke", () => { expect(true).toBe(true); });

// --- issue #8 회귀 가드: GET /healthz 응답은 캐시되면 안 된다 -------------------------
// 관측점은 프로세스 밖이다. 프로덕션 진입점("node src/app.js" — npm start와 playwright
// webServer가 쓰는 바로 그 경로) 그대로 자식 프로세스로 띄우고 HTTP 응답만 본다.
// 그래서 이 단언은 헤더뿐 아니라 "진입점이 여전히 리스닝한다"는 사실까지 M1 게이트 안에서 지킨다.
import { afterAll, beforeAll, describe, vi } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const APP_ENTRYPOINT = fileURLToPath(new URL("../src/app.js", import.meta.url));
const BOOT_TIMEOUT_MS = 20000;
const LOOPBACK = "127.0.0.1";
const READY_LINE = "listening on ";
const baseUrl = (port) => "http://" + LOOPBACK + ":" + port;

// 127.0.0.1의 빈 포트를 동적으로 확보한다. 고정 포트는 금지다 — new-test-repeat가 전체 스위트와
// 이 파일을 동시에 돌리므로 진입점 자식 프로세스가 한 번에 둘 이상 살아 있다.
// 확보에 실패하면 재시도로 덮지 않고 그대로 실패한다(대기는 조건 대기만, docs/QA.md No sleep).
async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK);
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

// 진입점을 띄우고, 스스로 리스닝했다고 말할 때까지 조건 대기한다(docs/QA.md: No sleep).
async function startEntrypoint() {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [APP_ENTRYPOINT], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const dead = () => child.exitCode !== null || child.signalCode !== null;
  // 실패 경로에서도 자식을 반드시 정리한다 — 프로세스가 새면 게이트가 RED가 아니라 hang한다.
  const stop = async () => {
    if (dead()) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };

  try {
    await vi.waitFor(
      () => {
        if (dead()) {
          throw new Error("entrypoint stopped before listening: " + stderr + stdout);
        }
        if (!stdout.includes(READY_LINE + port)) {
          throw new Error("entrypoint has not bound port " + port + " yet: " + JSON.stringify(stdout));
        }
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
}

describe("issue #8 — /healthz cache headers", () => {
  let app;
  beforeAll(async () => { app = await startEntrypoint(); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  // dw1: 같은 응답 하나가 status 200 + body 정확히 ok:true + cache-control 값 no-store 를 동시에 만족한다.
  // 셋을 한 응답에 묶어야 CHARTER Preserve(200 ok:true)를 깨는 구현이 헤더만 맞춰 통과하지 못한다.
  test("test_8_healthz_no_store_on_real_entrypoint", async () => {
    const res = await fetch(baseUrl(app.port) + "/healthz");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(body)).toEqual({ ok: true });
    // 키 존재가 아니라 값까지 고정한다 — 이 저장소엔 APM도 알림도 없어 이 단언이 유일한 방어선이다.
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  // dw2: no-store는 전역 미들웨어가 아니라 /healthz 한 곳에만 걸린다. 아직 존재하지 않는
  // /notes의 캐시 정책을 이 버그픽스가 몰래 결정하지 않게 하는 경계 단언이다.
  test("test_8_no_store_scoped_to_healthz", async () => {
    const other = await fetch(baseUrl(app.port) + "/__no_such_route__");
    expect(other.status).toBe(404);
    expect(other.headers.get("cache-control")).toBeNull();

    // 같은 프로세스에서 /healthz는 여전히 no-store여야 한다 — 이 두 줄이 없으면
    // "아무 데도 헤더를 붙이지 않는" 구현도 위 단언만으로 통과한다.
    const health = await fetch(baseUrl(app.port) + "/healthz");
    expect(health.headers.get("cache-control")).toBe("no-store");
  });
});

// --- issue #39 가드: GET /version 은 매니페스트의 version을 보고한다 --------------------
// #8과 같은 관측점(프로덕션 진입점을 자식 프로세스로 띄우고 HTTP 응답만 본다)을 쓴다.
// 기존 헬퍼(startEntrypoint/reserveLoopbackPort)와 #8 블록은 load-bearing이라 읽기만 하고
// 한 줄도 고치지 않는다 — 진입점 경로·cwd를 바꿔야 하는 케이스는 아래에 별도 헬퍼를 둔다.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));
// 레포 안의 스크래치 루트. .gitignore에 걸려 있어(`.spike/`) 남더라도 커밋되지 않고,
// 레포 안이라 자식 프로세스가 레포의 node_modules(express)를 그대로 해석한다.
const SCRATCH_ROOT = join(REPO_ROOT, ".spike");
// "릴리스로 실존할 수 있는 버전 문자열" 모양. 버전을 모를 때 이 모양을 답하면 온콜이
// 존재하지 않는 릴리스 번호를 읽게 된다(dw6).
const RELEASE_SHAPED = /^\d+\.\d+\.\d+/;
// 매니페스트에 실제로 쓸 값이자 기대값. 한 상수가 픽스처와 단언 양쪽을 만들기 때문에
// 이 값을 바꿔도 테스트를 고칠 필요가 없다 — 기대값은 매니페스트에서 파생된다(dw2).
const FIXTURE_MANIFEST_VERSION = "39.4.2-fixture";
// 진입점과 무관한 cwd에 놓는 미끼 매니페스트의 값. 응답에 이 값이 나오면 구현이 진입점이 아니라
// 프로세스의 현재 디렉터리를 버전의 출처로 삼은 것이다(dw5).
const DECOY_MANIFEST_VERSION = "39.0.0-decoy-from-cwd";

// 매니페스트가 선언한 version. 없거나 문자열이 아니거나 공백뿐이면 null.
function declaredManifestVersion() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const declared = manifest.version;
  return typeof declared === "string" && declared.trim() !== "" ? declared : null;
}

// startEntrypoint()와 같은 조건 대기 규약(docs/QA.md: No sleep)을 쓰되 진입점 경로와 cwd를
// 바꿀 수 있는 변형. 기존 헬퍼를 고치는 대신 복제한다(#8 가드가 그 헬퍼에 걸려 있다).
async function startEntrypointFrom({ entrypoint = APP_ENTRYPOINT, cwd = REPO_ROOT } = {}) {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [entrypoint], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

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
        if (dead()) {
          throw new Error("entrypoint stopped before listening (cwd=" + cwd + "): " + stderr + stdout);
        }
        if (!stdout.includes(READY_LINE + port)) {
          throw new Error("entrypoint has not bound port " + port + " yet: " + JSON.stringify(stdout));
        }
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { port, stop };
}

// 진입점 전체를 스크래치 디렉터리로 복사하고 그 옆에 매니페스트를 써서 띄운다.
// 매니페스트가 바뀔 때 응답이 따라 바뀌는지를 보기 위한 유일한 수단이다 —
// 레포의 package.json은 보호 경로라 테스트가 건드릴 수 없다.
// cwd는 일부러 진입점과 무관한 디렉터리로 둔다: cwd 기준으로 매니페스트를 읽는 구현이
// 여기서 통과해 버리면 이 테스트는 "파생"이 아니라 "cwd 옆의 파일"을 증명하게 된다.
async function startEntrypointWithManifest(manifest) {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = mkdtempSync(join(SCRATCH_ROOT, "issue-39-manifest-"));
  const unrelatedCwd = mkdtempSync(join(tmpdir(), "issue-39-elsewhere-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  cpSync(SRC_DIR, join(dir, "src"), { recursive: true });
  const app = await startEntrypointFrom({ entrypoint: join(dir, "src", "app.js"), cwd: unrelatedCwd });
  return {
    port: app.port,
    stop: async () => {
      await app.stop();
      rmSync(dir, { recursive: true, force: true });
      rmSync(unrelatedCwd, { recursive: true, force: true });
    },
  };
}

// 본문이 JSON이 아니어도 여기서 던지지 않는다 — 던지면 실패 메시지가 "JSON 파싱 실패"가 되어
// 무엇이 계약과 달랐는지를 가린다. 파싱 실패는 body=null로 흘려보내고 단언이 말하게 한다.
async function getJson(port, path) {
  const res = await fetch(baseUrl(port) + path);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, text, body };
}

describe("issue #39 — GET /version", () => {
  let app;
  beforeAll(async () => { app = await startEntrypointFrom(); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  // dw1: 응답 하나가 status 200 + content-type JSON + "version이 비어 있지 않은 문자열"을
  // 동시에 만족한다. 키 집합까지 고정해야 `{}`(= res.json({version: undefined}))가 통과하지 못한다.
  test("test_39_version_returns_non_empty_version_string", async () => {
    const { res, body } = await getJson(app.port, "/version");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(body).toEqual({ version: expect.any(String), node: expect.any(String) });
    expect(body.version.trim()).not.toBe("");
  });

  // dw2: 보고되는 값은 package.json의 version에서 온다.
  // (a) 현재 매니페스트에 대한 단언 — 기대값은 리터럴이 아니라 매니페스트에서 계산한다.
  // (b) 파생 자체의 증명 — 같은 진입점을 version이 선언된 매니페스트 옆에서 띄우면
  //     응답이 그 값을 글자 그대로 따라간다. (a)만으로는 상수를 답하는 구현도 통과한다.
  test("test_39_version_matches_package_json", async () => {
    const declared = declaredManifestVersion();
    const { res, body } = await getJson(app.port, "/version");
    expect(res.status).toBe(200);
    expect(body).toEqual({ version: expect.any(String), node: expect.any(String) });

    if (declared !== null) {
      expect(body.version).toBe(declared);
    } else {
      // version이 없는 동안에도 매니페스트의 부재를 그대로 흘려보내면 안 된다
      // (`String(undefined)` === "undefined" 같은 값은 버전이 아니다).
      expect(body.version).not.toBe(String(JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).version));
      expect(body.version.trim()).not.toBe("");
    }

    const fixture = await startEntrypointWithManifest({
      name: "issue-39-manifest-fixture",
      private: true,
      type: "module",
      version: FIXTURE_MANIFEST_VERSION,
    });
    try {
      const fromFixture = await getJson(fixture.port, "/version");
      expect(fromFixture.res.status).toBe(200);
      expect(fromFixture.body).toEqual({ version: FIXTURE_MANIFEST_VERSION, node: expect.any(String) });
    } finally {
      await fixture.stop();
    }
  }, BOOT_TIMEOUT_MS + 5000);

  // dw5: 레포 루트가 아닌 cwd에서 같은 진입점을 띄워도 (1) 리스닝에 성공하고
  // (2) /healthz 계약이 그대로이며 (3) /version 값이 루트에서 띄운 프로세스와 같다.
  // cwd 기준으로 매니페스트를 읽는 구현은 여기서 죽거나 다른 값을 답한다.
  test("test_39_version_and_healthz_survive_foreign_cwd", async () => {
    const fromRoot = await getJson(app.port, "/version");
    expect(fromRoot.res.status).toBe(200);
    expect(fromRoot.body).toEqual({ version: expect.any(String), node: expect.any(String) });
    const rootVersion = fromRoot.body.version;

    // cwd에 "그럴듯한 다른 매니페스트"를 놓는다. 이게 없으면 cwd 기준으로 읽는 구현도
    // (읽기에 실패해 같은 fallback을 답하며) 통과해 버린다 — 이 미끼가 있어야 RED가 된다.
    const foreignCwd = mkdtempSync(join(tmpdir(), "issue-39-cwd-"));
    writeFileSync(
      join(foreignCwd, "package.json"),
      JSON.stringify({ name: "issue-39-decoy", private: true, version: DECOY_MANIFEST_VERSION }),
    );
    let foreign;
    try {
      foreign = await startEntrypointFrom({ cwd: foreignCwd });

      const health = await getJson(foreign.port, "/healthz");
      expect(health.res.status).toBe(200);
      expect(health.body).toEqual({ ok: true });
      expect(health.res.headers.get("cache-control")).toBe("no-store");

      const version = await getJson(foreign.port, "/version");
      expect(version.res.status).toBe(200);
      expect(version.body.version).not.toBe(DECOY_MANIFEST_VERSION);
      expect(version.body.version).toBe(rootVersion);
    } finally {
      await foreign?.stop();
      rmSync(foreignCwd, { recursive: true, force: true });
    }
  }, BOOT_TIMEOUT_MS + 5000);

  // dw6: 매니페스트에 version이 없는 동안 응답값은 "버전을 알 수 없다"를 스스로 말해야 한다.
  // `{version:"0.0.0"}`은 dw1·dw2를 통과하지만 온콜에게 존재하지 않는 릴리스를 말하므로 여기서 RED다.
  // 사람이 나중에 version을 머지하면 분기가 사라져 이 테스트가 RED로 돌변하지 않는다.
  test("test_39_unknown_version_is_not_release_shaped", async () => {
    const declared = declaredManifestVersion();
    const { res, body } = await getJson(app.port, "/version");
    expect(res.status).toBe(200);
    expect(body).toEqual({ version: expect.any(String), node: expect.any(String) });

    if (declared !== null) {
      expect(body.version).toBe(declared);
      return;
    }
    expect(body.version).not.toMatch(RELEASE_SHAPED);
    expect(body.version.toLowerCase()).toMatch(/unknown|unset|unspecified|unavailable|missing/);
  });
});

// --- issue #45 가드: GET /version 은 런타임(node)도 함께 보고한다 ------------------------
// #8·#39와 같은 관측점(프로덕션 진입점을 자식 프로세스로 띄우고 HTTP 응답만 본다)을 쓴다.
// 기존 헬퍼(startEntrypointFrom / startEntrypointWithManifest / getJson)는 호출만 하고
// 한 줄도 고치지 않는다 — 세 번째 사본을 만드는 대신 그대로 재사용한다.
// "릴리스로 실존할 수 있는 런타임 버전" 모양. 기대값은 여기서 나오지 않는다 —
// 값 자체는 언제나 이 테스트를 돌리는 런타임에서 파생하고(process.version), 이 정규식은
// 모양만 본다(예: 상수 "unknown"이나 "22"를 node로 답하는 구현을 배제).
const NODE_VERSION_SHAPE = /^v\d+\.\d+\.\d+/;
// #39의 픽스처와 값이 겹치지 않게 별도 상수를 쓴다 — 이 가드가 #39의 픽스처 상수에
// 의존하면 그쪽 값이 바뀔 때 여기가 조용히 같이 움직인다.
const FIXTURE_MANIFEST_VERSION_45 = "45.8.3-fixture";

describe("issue #45 — GET /version reports the Node runtime", () => {
  let app;
  beforeAll(async () => { app = await startEntrypointFrom(); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  // dw1: 응답 하나가 status 200 + content-type JSON + 종전과 같은 version + 요청을 처리한
  // 프로세스의 런타임과 글자 그대로 같은 node 를 동시에 만족한다.
  // 기대값은 리터럴("v22.11.0")이 아니라 이 자식 프로세스를 띄운 바로 그 바이너리
  // (process.execPath == 이 테스트 프로세스의 런타임)에서 파생한다 — 그래서 런타임을
  // 올려도 이 테스트는 고칠 필요가 없고, 상수를 답하는 구현은 다음 업그레이드에서 죽는다.
  test("test_45_version_reports_node_runtime", async () => {
    const declared = declaredManifestVersion();
    const { res, body } = await getJson(app.port, "/version");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);

    // 기존 필드는 그대로다 — node가 붙으면서 version이 흔들리면 여기서 죽는다.
    expect(typeof body?.version).toBe("string");
    expect(body.version.trim()).not.toBe("");
    if (declared !== null) {
      expect(body.version).toBe(declared);
    }

    expect(body.node).toBe(process.version);
    expect(body.node).toMatch(NODE_VERSION_SHAPE);
    expect(body.node.startsWith("v")).toBe(true);
    // 빌드 버전을 런타임 버전 자리에 되풀이하는 구현(`{ version, node: version }`)을 배제한다.
    expect(body.node).not.toBe(body.version);
  });

  // dw2: `node`가 붙은 뒤에도 #39가 지키던 실질이 그대로 성립한다. 셋을 한 테스트에 묶는 이유는
  // "node가 존재하는 상태에서" 다시 보여야 하기 때문이다 — 그래야 이 가드가 구현 전에 RED다.
  //  (a) 파생: 다른 version을 선언한 매니페스트 옆에서 띄우면 응답이 그 값을 따라간다.
  //  (b) 모름: 매니페스트에 version이 없으면 릴리스 모양이 아닌 "모른다" 값을 답한다.
  //  (c) 이웃: 같은 프로세스의 /healthz는 200 `{ok:true}` + no-store 그대로다.
  test("test_45_version_keeps_manifest_contract", async () => {
    const fixture = await startEntrypointWithManifest({
      name: "issue-45-manifest-fixture",
      private: true,
      type: "module",
      version: FIXTURE_MANIFEST_VERSION_45,
    });
    try {
      // (a) 키 집합까지 고정한다 — 파생을 보면서 응답의 모양도 같이 못박는다.
      const declaredRes = await getJson(fixture.port, "/version");
      expect(declaredRes.res.status).toBe(200);
      expect(declaredRes.body).toEqual({
        version: FIXTURE_MANIFEST_VERSION_45,
        node: process.version,
      });

      // (c) node를 얻은 프로세스에서 /healthz 계약이 살아 있는지 같은 기동에서 확인한다.
      const health = await getJson(fixture.port, "/healthz");
      expect(health.res.status).toBe(200);
      expect(health.body).toEqual({ ok: true });
      expect(health.res.headers.get("cache-control")).toBe("no-store");
    } finally {
      await fixture.stop();
    }

    // (b) version 없는 매니페스트. `String(undefined)`나 "0.0.0" 같은 릴리스 모양이 아니라
    // 스스로 "모른다"라고 말해야 하고, 그 와중에도 node는 여전히 런타임이다.
    const versionless = await startEntrypointWithManifest({
      name: "issue-45-manifest-versionless",
      private: true,
      type: "module",
    });
    try {
      const { res, body } = await getJson(versionless.port, "/version");
      expect(res.status).toBe(200);
      expect(body.node).toBe(process.version);
      expect(typeof body.version).toBe("string");
      expect(body.version).not.toMatch(RELEASE_SHAPED);
      expect(body.version.toLowerCase()).toMatch(/unknown|unset|unspecified|unavailable|missing/);
    } finally {
      await versionless.stop();
    }
  }, BOOT_TIMEOUT_MS * 2 + 10000);

  // dw4: #39이 `toEqual({ version })`로 지키던 "응답 키 집합 폐쇄"를 node 추가 이후에도 다시 세운다.
  // 부분 매칭이 아니라 키 목록 자체를 단언하므로, 인증 없는 이 엔드포인트에 누가 env·경로·설정
  // 한 필드를 더 노출하면(docs/TECHNICAL.md Constraints, CHARTER Preserve) 여기서 RED가 된다.
  // dw1과 다른 질문이다 — 여기서는 값이 아니라 "그 둘 말고는 없는가"만 본다.
  test("test_45_version_body_carries_no_third_field", async () => {
    const { res, body } = await getJson(app.port, "/version");
    expect(res.status).toBe(200);
    expect(body).not.toBeNull();
    expect(Object.keys(body).sort()).toEqual(["node", "version"]);

    // 같은 확인에서 이웃 엔드포인트도 닫혀 있는지 본다 — /healthz가 조용히 넓어지는 것을
    // 막는 단언이 이 저장소에 따로 없다.
    const health = await getJson(app.port, "/healthz");
    expect(health.res.status).toBe(200);
    expect(health.body).not.toBeNull();
    expect(Object.keys(health.body).sort()).toEqual(["ok"]);
    expect(health.body).toEqual({ ok: true });
  });
});
