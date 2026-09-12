// Express 앱 구성·라우트 등록·에러 포맷. 비즈니스 규칙도 SQL도 모른다(docs/TECHNICAL.md §Architecture).
//
// import만으로는 포트를 잡지 않는다 — 여러 테스트 파일이 동시에 import해도 EADDRINUSE가 없어야 하고,
// 실제 기동은 아래 진입점 가드(= `node src/app.js`, package.json의 start와 playwright webServer)만 한다.
import express from "express";
import { pathToFileURL } from "node:url";
import { createNotesRouter } from "./routes/notes.js";
import { INVALID_REQUEST } from "./service/notes.js";
import { DB_UNAVAILABLE } from "./repo/notes.js";

const INTERNAL_ERROR = "internal_error";

const STATUS_BY_CODE = {
  [INVALID_REQUEST]: 400,
  [DB_UNAVAILABLE]: 503,
};

// 응답에 실을 것을 여기서 한 번에 정한다. 요청 본문도 내부 메시지도 에코하지 않는다
// (docs/features/001-create-note.md:78) — 사용자가 고칠 수 있는 검증 오류의 문장만 그대로 나간다.
function toEnvelope(err) {
  // body-parser 오류: 봉투를 유지한 채 express 자신이 정한 상태코드를 따른다.
  // 본문 길이 상한·413 의미론은 이번 이슈가 정하지 않는다(non-goal) — 여기서 발명하지 않고 위임한다.
  if (typeof err?.type === "string" && err.type.startsWith("entity.")) {
    const message =
      err.type === "entity.parse.failed" ? "request body must be valid JSON" : "request body was rejected";
    return { status: Number.isInteger(err.status) ? err.status : 400, code: INVALID_REQUEST, message };
  }
  if (err?.code === INVALID_REQUEST) {
    return { status: STATUS_BY_CODE[INVALID_REQUEST], code: INVALID_REQUEST, message: err.message };
  }
  if (err?.code === DB_UNAVAILABLE) {
    return { status: STATUS_BY_CODE[DB_UNAVAILABLE], code: DB_UNAVAILABLE, message: "database is unavailable" };
  }
  return { status: 500, code: INTERNAL_ERROR, message: "internal error" };
}

export function createApp({ db, now = () => new Date() } = {}) {
  const app = express();

  // /healthz는 DB를 모른다 — 컴포즈 healthcheck와 playwright webServer의 ready 신호가 여기 걸려 있다.
  app.get("/healthz", (_req, res) => res.set("Cache-Control", "no-store").status(200).json({ ok: true }));

  app.use(express.json());
  app.use(createNotesRouter({ db, now }));

  // 에러 핸들러는 라우트 뒤에 온다. 앞에 오면 아무 요청도 라우트에 닿지 못한다.
  app.use((err, _req, res, _next) => {
    const { status, code, message } = toEnvelope(err);
    res.status(status).json({ error: { code, message } });
  });

  return app;
}

// 진입점 가드: `node src/app.js`로 실행될 때만 리스닝한다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ?? 3000;
  createApp().listen(port, () => console.log(`listening on ${port}`));
}
