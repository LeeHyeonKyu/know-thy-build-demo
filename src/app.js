import express from "express";
import { readVersion } from "./version.js";

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
const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`listening on ${port}`));
