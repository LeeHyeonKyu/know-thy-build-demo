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

const REJECTED_BODY = "request body was rejected";

// body-parser가 붙인 type별 문장. 헤더 값도 본문도 넣지 않는다 — 무엇을 고쳐야 하는지만 말한다.
const CLIENT_BODY_MESSAGES = {
  "charset.unsupported": "request charset is not supported — send UTF-8 JSON",
  "encoding.unsupported": "request content-encoding is not supported",
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
  // 파싱 실패만이 "읽을 수 없는 body"는 아니다. body-parser는 지원하지 않는 charset·content-encoding에
  // 415를, 압축을 풀지 못한 body에 400을 주면서 `expose: true`로 "클라이언트에게 말해도 되는 잘못"임을
  // 표시한다. 그것을 500으로 내리면 사용자가 고칠 수 있는 실수가 서버 장애로 보고된다
  // (docs/features/001-create-note.md:63 "500이 아니다"). 상태코드는 파서가 정한 것을 따르고,
  // 메시지는 요청 본문·헤더 값을 에코하지 않는 고정 문장만 쓴다.
  if (err?.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return { status: err.status, code: INVALID_REQUEST, message: CLIENT_BODY_MESSAGES[err.type] ?? REJECTED_BODY };
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

// --- 진입점 배선 -----------------------------------------------------------------------
// `npm start`(= `node src/app.js`)가 타는 유일한 경로다. DB 핸들을 만드는 곳은 여기 하나뿐이고,
// 만들어진 실행자는 createApp이 라우트에 내려준다(docs/TECHNICAL.md §Architecture "DB 핸들").
//
// 드라이버는 **동적으로** 부른다. 최상단 `import "pg"`는 드라이버가 없는 환경에서 모듈 import 자체를
// 깨뜨려 createApp을 쓰는 모든 테스트와 `/healthz`까지 함께 끌고 내려간다 — 이 저장소에는 아직 pg가
// 없다(package.json은 protected다. PR 본문 "Harness change needed" 참조).

const DB_DRIVER = "pg";

// 드라이버가 없거나 pool을 만들지 못했을 때 쓰는 실행자. 기동을 막지 않고(= fail-fast 하지 않고)
// 요청 시점에 "DB에 닿지 못했다"를 말한다 — app.js가 그 code만 503으로 매핑한다.
// pg 오류 코드를 흉내 내지 않는다: 실패한 것은 연결이 아니라 핸들 자체이고, 사용자가 보는 사실은 같다.
function unavailableDb(cause) {
  return {
    async query() {
      const err = new Error("database is unavailable");
      err.code = DB_UNAVAILABLE;
      err.cause = cause;
      throw err;
    },
  };
}

export async function createDbFromEnv({ env = process.env, loadDriver = () => import(DB_DRIVER) } = {}) {
  try {
    const driver = await loadDriver();
    const Pool = driver?.Pool ?? driver?.default?.Pool;
    if (typeof Pool !== "function") {
      throw new TypeError(`${DB_DRIVER} driver exposes no Pool`);
    }
    // 진입점은 DATABASE_URL만 읽는다 — 하드코딩 DSN fallback을 두지 않는다(docs/TECHNICAL.md §Data).
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    // idle client가 죽으면(DB 재시작, 서버측 연결 종료) pool은 자기 자신에게 'error'를 emit한다.
    // 리스너가 없는 EventEmitter의 'error'는 Node가 throw해 프로세스를 죽인다 — 요청 시점 503으로
    // 끝나야 할 DB 블립이 /healthz(CHARTER Preserve)까지 함께 끌고 내려가지 않게 여기서 받는다.
    pool.on?.("error", (cause) => {
      console.warn(`[app] idle ${DB_DRIVER} client error — /notes will answer 503 while it lasts: ${cause?.message ?? cause}`);
    });
    return pool;
  } catch (cause) {
    // 조용히 넘어가지 않는다(PROJECT 원칙 3): 기동은 계속하되 그 사실을 한 줄 남긴다.
    console.warn(`[app] ${DB_DRIVER} pool unavailable — /notes will answer 503: ${cause?.message ?? cause}`);
    return unavailableDb(cause);
  }
}

export async function createAppFromEnv({ env = process.env, loadDriver, now } = {}) {
  return createApp({ db: await createDbFromEnv({ env, loadDriver }), now });
}

// 진입점 가드: `node src/app.js`로 실행될 때만 리스닝한다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ?? 3000;
  const app = await createAppFromEnv();
  app.listen(port, () => console.log(`listening on ${port}`));
}
