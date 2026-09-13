// SQL 실행과 행↔객체 매핑. 검증도 상태코드도 모른다(docs/TECHNICAL.md §Architecture).
//
// 실행자(`db`)는 `{ query(text, params) }` 하나만 요구한다 — pg의 `Pool`과 `PoolClient`가
// 둘 다 만족하므로 테스트가 자기 트랜잭션 커넥션을 그대로 주입할 수 있다(docs/QA.md:19).
//
// 이 층이 pg를 아는 유일한 층이므로, "DB에 닿지 못했다"를 도메인 code로 번역하는 것도 여기다.
// app.js는 code → 상태코드만 매핑한다(코드 집합을 넓혀도 app.js를 건드리지 않는다).

export const DB_UNAVAILABLE = "db_unavailable";

// 연결류 오류는 코드 하나가 아니라 집합이다: libuv 소켓 오류 + PostgreSQL class 08(연결 예외)과
// 서버가 연결을 받을 수 없다고 말하는 코드들.
//
// **연결 수립이 실패하는 흔한 경우는 소켓 오류가 아니라 SQLSTATE로 온다**: 자격증명이 틀리면 28P01,
// pg_hba가 막으면 28000, DSN이 가리키는 데이터베이스가 없으면 3D000 — 셋 다 TCP는 붙은 뒤 서버가
// 핸드셰이크에서 거절한 것이라 `ECONNREFUSED`가 아니다. 이것을 500으로 내보내면
// "503이면 DB에 못 닿는 것, 500이면 이 배포가 마이그레이션을 빠뜨린 것"(docs/TECHNICAL.md §Data
// 당직 런북)이 거짓이 되고, DSN 오타 한 글자가 당직자에게 우리 코드의 버그로 도착한다.
// 42P01(테이블 없음)은 여전히 여기 없다 — 그것은 연결이 아니라 스키마의 문제다.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EPIPE", "EAI_AGAIN",
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "28000", "28P01",
  "3D000",
  "57P01", "57P02", "57P03",
  "53300",
]);

const INSERT_NOTE =
  "insert into notes (title, body, created_at) values ($1, $2, $3) returning id, title, body, created_at";

function asDomainError(err) {
  if (err && typeof err.code === "string" && CONNECTION_ERROR_CODES.has(err.code)) {
    const unavailable = new Error("database is unavailable");
    unavailable.code = DB_UNAVAILABLE;
    unavailable.cause = err;
    return unavailable;
  }
  // 연결류가 아니면 번역하지 않는다 — 프로그래밍 오류를 "DB 불가"로 위장하면
  // 새벽 당직자가 DB를 30분 들여다보게 된다.
  return err;
}

export async function insertNote(db, { title, body, createdAt }) {
  try {
    const result = await db.query(INSERT_NOTE, [title, body, createdAt]);
    const row = result?.rows?.[0];
    if (!row) {
      throw new Error("insert into notes returned no row");
    }
    return row;
  } catch (err) {
    throw asDomainError(err);
  }
}
