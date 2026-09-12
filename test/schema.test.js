// dw8 (부분) — src/repo/schema.js 의 migrate(db) 계약.
//
// 이 파일이 덮는 것: migrate()가 db/migrations/001_create_notes.sql 을 **그대로** 실행자에게
// 넘긴다는 것, 그 SQL이 docs/TECHNICAL.md §Data의 컬럼 선언과 일치한다는 것, 그리고 동시 생성
// 경쟁에서 지는 쪽의 오류(42P07 / pg_type·pg_class 고유 위반)를 삼키고 resolve하되 그 밖의
// 오류는 그대로 전파한다는 것(skeptic 서명 반박의 accept 조건 (2)).
//
// 이 파일이 덮지 못하는 것: 실제 Postgres에 적용한 뒤 information_schema.columns로 읽는 절과
// 전용 커넥션 두 개의 동시 적용 절. 둘 다 `pg` 드라이버가 필요한데 이 저장소에는 설치돼 있지
// 않고 package.json/package-lock.json은 protected다 — PR 본문 "Harness change needed" 참조.
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "../src/repo/schema.js";

const MIGRATION_PATH = fileURLToPath(new URL("../db/migrations/001_create_notes.sql", import.meta.url));

// 질의를 기록하는 가짜 실행자. 응답은 호출자가 정한다(항상 같은 값을 돌려주는 mock이 아니다).
function recordingDb(respond = async () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      return respond(text, params);
    },
  };
}

function pgError(fields) {
  return Object.assign(new Error("pg error"), fields);
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

describe("issue #2 — notes migration", () => {
  test("test_2_notes_migration_schema_and_concurrent_apply", async () => {
    const sql = await readFile(MIGRATION_PATH, "utf8");

    // (1) 마이그레이션이 선언하는 컬럼 집합이 docs/TECHNICAL.md §Data와 같다.
    const normalized = sql.toLowerCase().replace(/--[^\n]*/g, " ").replace(/\s+/g, " ");
    expect(normalized).toMatch(/create table if not exists notes\s*\(/);
    expect(normalized).toMatch(/\bid bigserial primary key\b/);
    expect(normalized).toMatch(/\btitle text not null\b/);
    expect(normalized).toMatch(/\bbody text not null\b/);
    expect(normalized).toMatch(/\bcreated_at timestamptz not null default now\(\)/);
    // 전진 전용 — DROP은 출하하지 않는다(docs/factory/CHARTER.md:42 NEVER_AUTOMATE).
    expect(normalized).not.toMatch(/\bdrop\b/);

    // (2) migrate()는 그 파일을 실행자에게 넘긴다. 인라인 SQL을 따로 들고 있는 구현은 떨어진다.
    const db = recordingDb();
    await migrate(db);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].text).toBe(sql);

    // (3) 동시 생성 경쟁의 패자 오류는 삼키고 resolve한다 — 게이트를 빨갛게 만들지 않는다.
    const tolerated = [
      pgError({ code: "42P07" }),
      pgError({ code: "23505", constraint: "pg_type_typname_nsp_index" }),
      pgError({ code: "23505", constraint: "pg_class_relname_nsp_index" }),
    ];
    for (const err of tolerated) {
      const loser = recordingDb(async () => { throw err; });
      await expect(migrate(loser), `${err.code}/${err.constraint ?? "-"}`).resolves.toBeUndefined();
      expect(loser.calls, `${err.code} still applies the migration`).toHaveLength(1);
    }

    // (4) 그 밖의 오류는 그대로 전파한다 — 전면 catch 구현은 여기서 떨어진다.
    const propagated = [
      pgError({ code: "42601" }), // 구문 오류
      pgError({ code: "23505", constraint: "notes_pkey" }), // 카탈로그 경쟁이 아닌 고유 위반
      pgError({ code: "28P01" }), // 인증 실패
    ];
    for (const err of propagated) {
      const seen = await rejectionOf(migrate(recordingDb(async () => { throw err; })));
      expect(seen, `${err.code}/${err.constraint ?? "-"} must not be swallowed`).toBe(err);
    }
  });
});
