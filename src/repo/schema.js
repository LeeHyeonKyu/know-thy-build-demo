// 스키마 적용. SQL 실행은 repo의 책임이다(docs/TECHNICAL.md §Architecture).
// 유일한 호출자는 테스트 헬퍼이고, 부팅 경로에는 붙이지 않는다 —
// `GET /healthz`(CHARTER Preserve)를 DB 가용성에 묶지 않기 위해서다.
// 운영 적용은 docs/TECHNICAL.md §Data의 수동 런북 한 줄(사람이 psql로 실행)이다.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MIGRATION_PATH = fileURLToPath(new URL("../../db/migrations/001_create_notes.sql", import.meta.url));

// 동시 생성 경쟁에서 "지는 쪽"이 받는 오류들. `CREATE TABLE IF NOT EXISTS`는 원자적이지 않아
// 두 세션이 같은 순간에 들어오면 한쪽이 아래 형태로 실패한다 — 결과는 이미 원하던 상태(테이블 존재)다.
const DUPLICATE_TABLE = "42P07";
const UNIQUE_VIOLATION = "23505";
const CATALOG_INDEXES = new Set(["pg_type_typname_nsp_index", "pg_class_relname_nsp_index"]);

function isConcurrentDuplicate(err) {
  if (!err || typeof err.code !== "string") return false;
  if (err.code === DUPLICATE_TABLE) return true;
  return err.code === UNIQUE_VIOLATION && CATALOG_INDEXES.has(err.constraint);
}

/**
 * `db/migrations/001_create_notes.sql`을 적용한다. 전진 전용이고 DROP을 실행하지 않는다.
 * 동시 적용 경쟁의 패자 오류만 삼키고 resolve하며, 그 밖의 오류(구문 오류·권한 오류 등)는
 * 그대로 전파한다 — 전면 catch는 진짜 실패를 조용히 만든다.
 */
export async function migrate(db) {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  try {
    await db.query(sql);
  } catch (err) {
    if (isConcurrentDuplicate(err)) return;
    throw err;
  }
}
