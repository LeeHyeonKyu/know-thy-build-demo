import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 매니페스트는 **모듈 위치 기준**으로 읽는다. cwd 기준(`./package.json`)으로 읽으면 레포 루트
// 밖에서 기동한 프로세스가 엉뚱한 파일을 읽거나 아무것도 못 읽는다 (#39 dw5).
const MANIFEST_PATH = fileURLToPath(new URL("../package.json", import.meta.url));
// 매니페스트에 version이 없거나(현재 상태) 읽을 수 없을 때 보고하는 값.
// 릴리스로 실존할 수 있는 형태(1.2.3)여서는 안 된다 — 온콜이 존재하지 않는 릴리스 번호를
// 읽는 것보다 "모른다"를 읽는 편이 낫다 (#39 dw6).
const UNKNOWN_VERSION = "unknown";

// 부팅 시 1회 읽는다. 읽기 실패는 이 함수 밖으로 새지 않는다 — 매니페스트가 없는 배포
// (프루닝된 컨테이너 등)에서도 app.listen과 /healthz는 살아 있어야 한다 (#39 dw5).
function readVersion() {
  try {
    const declared = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).version;
    return typeof declared === "string" && declared.trim() !== "" ? declared : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
const version = readVersion();

const app = express();
app.get("/healthz", (_req, res) => res.set("Cache-Control", "no-store").status(200).json({ ok: true }));
// 캐시 헤더는 붙이지 않는다 — #8의 no-store는 /healthz 한 곳의 계약이고, /version의 캐시 정책은
// 이 이슈에서 결정하지 않는다(#39 non-goals).
// `node`는 **요청을 처리하는 프로세스의 런타임**이다(빌드가 선언한 값이 아니다) — 환경을
// 비교하는 운영자가 빌드 버전 옆에서 읽는 값이므로 부팅 시 스냅샷이 아니라 현재 프로세스에서
// 그대로 읽는다 (#45 dw1).
// 이 응답의 **키 집합은 닫혀 있다**: `version`과 `node` 둘뿐이다. 인증이 없는 엔드포인트라
// (docs/TECHNICAL.md Constraints) 여기에 붙는 필드는 곧 무인증 노출이다. 세 번째 키를 더하면
// test_45_version_body_carries_no_third_field가 RED가 된다 — 늘리려면 그 가드부터 마주한다.
app.get("/version", (_req, res) => res.status(200).json({ version, node: process.version }));
// PORT는 바인딩 전에 검증한다 (#59). 설정돼 있으면 [0,65535] 안의 10진 정수 문자열이어야 한다.
// 검증이 없으면 `abc`·`-1` 같은 값은 listen()이 유닉스 소켓/파이프 경로로 받아 조용히 엉뚱한 곳에
// 바인딩하고, `99999`는 Node의 ERR_SOCKET_BAD_PORT 스택 트레이스로 죽는다. 그래서 소켓 경로를
// PORT로 넘기는 사용법은 더 이상 지원하지 않는다(#59 plan d3). 빈 문자열(`PORT=`)도 "설정된 값"으로
// 보고 거절한다 — 기본값 3000으로의 조용한 폴백은 PORT가 아예 없을 때만이다.
const DEFAULT_PORT = 3000;
const MAX_PORT = 65535;
function resolvePort(raw) {
  if (raw === undefined) return DEFAULT_PORT;
  if (/^\d+$/.test(raw) && Number(raw) <= MAX_PORT) return Number(raw);
  console.error(`invalid PORT "${raw}": must be an integer between 0 and ${MAX_PORT}`);
  process.exit(1);
}
const port = resolvePort(process.env.PORT);
app.listen(port, () => console.log(`listening on ${port}`));
