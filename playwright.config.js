import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// #15 (M2) — e2e는 full·deep 게이트다(.factory/harness.toml [commands].e2e = "npx playwright test").
//
// 포트: 앱(src/app.js)과 같은 `PORT`를 읽는다. 없으면 둘 다 3000([test.env].app_ready).
const ROOT = realpathSync(fileURLToPath(new URL(".", import.meta.url)));
const REQUESTED_PORT = process.env.PORT || "3000";

// 사전 기동 재사용(#15 rework cf1/qa1). factory는 `[test.env].app_start`로 앱을 먼저 띄운다 — 그런데
// review/merge에서는 그 앱이 **base 체크아웃**에서 뜨고, 트리는 그 뒤에 PR head로 바뀐다. 게이트 직전 re-up의
// 두 번째 app_start는 포트를 못 잡고 죽으며, /healthz는 살아 있는 옛 프로세스가 200으로 답한다. 그 프로세스를
// 그대로 재사용하면 e2e는 PR 코드가 아니라 base 코드를 검사한다.
// 그래서 PORT에 떠 있는 서버는 **이 트리의 현재 코드임을 증명할 수 있을 때만** 재사용한다:
//   (1) 그 포트를 LISTEN하는 프로세스의 cwd가 이 디렉터리이고, (2) 그 프로세스가 src/의 마지막 쓰기 **뒤에** 시작했다.
// 증명하지 못하면(옛 프로세스·낯선 서버·/proc 없는 OS) 그것을 건드리지 않고, 빈 포트에 이 트리의 앱을 띄운다.
// 결정은 메인 프로세스에서 한 번만 하고 `E2E_RESOLVED_PORT`로 워커에 넘긴다(워커도 이 설정을 다시 읽는다).
function listenerPid(port) {
  const hex = Number(port).toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length > 9 && c[1].endsWith(`:${hex}`) && c[3] === "0A") inodes.add(`socket:[${c[9]}]`);
    }
  }
  if (!inodes.size) return null;
  for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    let fds = [];
    try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
    for (const fd of fds) { try { if (inodes.has(readlinkSync(`/proc/${pid}/fd/${fd}`))) return Number(pid); } catch {} }
  }
  return null;
}

function processStartMs(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const startTicks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]); // field 22 (starttime)
  let hz = 100;
  try { hz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100; } catch {}
  const uptimeSec = Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]);
  // 두 값 모두 틱(10ms) 단위로 내림된다. 오차는 "옛것으로 본다" 쪽으로 기울인다 — 새 앱을 띄우는 것은 안전하다.
  return Date.now() - (uptimeSec - startTicks / hz) * 1000 - 50;
}

function newestMtimeMs(dir) {
  let newest = statSync(dir).mtimeMs;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtimeMs(p) : statSync(p).mtimeMs);
  }
  return newest;
}

function freePort() {
  const js = "const s=require('node:net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})";
  return execFileSync(process.execPath, ["-e", js], { encoding: "utf8" }).trim();
}

function resolvePort() {
  if (process.env.E2E_RESOLVED_PORT) return process.env.E2E_RESOLVED_PORT; // 워커: 메인의 결정을 따른다
  let port = REQUESTED_PORT, why = null;
  try {
    const pid = listenerPid(REQUESTED_PORT);
    if (pid === null) {
      if (!existsSync("/proc/net/tcp")) why = "cannot inspect listeners (no /proc)";
    } else if (realpathSync(`/proc/${pid}/cwd`) !== ROOT) {
      why = `pid ${pid} is not running from this tree`;
    } else if (processStartMs(pid) < newestMtimeMs(join(ROOT, "src"))) {
      why = `pid ${pid} started before src/ was last written (stale code)`;
    } else {
      console.warn(`[playwright.config] reusing pre-booted app pid ${pid} on :${REQUESTED_PORT}`);
    }
  } catch (e) {
    why = `cannot verify the server on :${REQUESTED_PORT} (${e.message})`;
  }
  if (why) {
    port = freePort();
    console.warn(`[playwright.config] not reusing :${REQUESTED_PORT} — ${why}; booting this tree's app on :${port}`);
  }
  process.env.E2E_RESOLVED_PORT = port;
  return port;
}

const PORT = resolvePort();
const BASE_URL = `http://localhost:${PORT}`;

// 브라우저: CI 러너에는 Playwright 브라우저가 설치되지 않는다(외부 네트워크 금지, docs/QA.md). 그 환경에서
// 페이지를 여는 케이스는 "Executable doesn't exist"로 영구 RED가 되므로, 크로미움 실행 파일이 없을 때만
// 그 케이스(`e2e/smoke.spec.js`의 "browser loads")를 선택에서 뺀다. 브라우저가 있으면 전부 돈다.
// 빼는 것은 조용하지 않다 — 아래 경고가 매 실행 stderr에 남는다.
const BROWSER_CASES = /browser loads/;
const hasBrowser = (() => {
  try { return existsSync(chromium.executablePath()); } catch { return false; }
})();
if (!hasBrowser) console.warn(`[playwright.config] chromium not installed — deselecting browser cases ${BROWSER_CASES}`);

export default {
  testDir: "e2e",
  use: { baseURL: BASE_URL, headless: true },
  // reuseExistingServer: 위 resolvePort()가 이 트리의 현재 코드라고 증명한 사전 기동 앱이면 그것을 쓰고,
  // 아니면 PORT는 빈 포트라 webServer가 이 트리의 앱을 띄운다 — 두 프로세스가 같은 포트를 바인딩하지 않는다(#15).
  webServer: { command: "node src/app.js", url: `${BASE_URL}/healthz`, env: { PORT }, timeout: 30_000, reuseExistingServer: true },
  ...(hasBrowser ? {} : { grepInvert: BROWSER_CASES }),
  // json 리포트 경로는 그대로다(#15 non_goals). list는 사람이 읽는 콘솔 요약("N passed")을 더할 뿐이다.
  reporter: [["list"], ["json", { outputFile: ".spike/e2e.json" }]],
};
