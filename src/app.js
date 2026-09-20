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
app.get("/version", (_req, res) => res.status(200).json({ version }));
const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`listening on ${port}`));
