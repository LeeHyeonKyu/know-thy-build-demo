// dw8 — migrate()가 실제 Postgres에 만든 `notes`의 모양을, 마이그레이션 파일이 아니라
// **information_schema.columns**에서 읽어 판정한다. 파일 텍스트를 정규식으로 되읽는 단언은
// 산출물을 같은 산출물로 재확인할 뿐이라 DDL이 틀려도 통과한다 — 여기서는 서버에 물어본다.
//
// 동시 적용은 기제가 아니라 결과로 본다(plan dw8, skeptic 서명 반박의 accept 조건 (2)):
// 전용 세션 두 개에서 동시에 불러도 둘 다 reject 없이 끝나고, 경쟁의 패자 오류(42P07 /
// pg_type·pg_class 고유 위반)는 삼키되 그 밖의 오류는 그대로 전파한다.
import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migrate } from "../../src/repo/schema.js";
import { connect } from "./helpers/db.js";

const CASE_TIMEOUT_MS = 60000;
const MIGRATION_PATH = fileURLToPath(new URL("../../db/migrations/001_create_notes.sql", import.meta.url));

const COLUMNS_SQL = `select column_name, data_type, is_nullable, column_default
  from information_schema.columns
  where table_schema = $1 and table_name = $2
  order by ordinal_position`;

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

describe("issue #2 — notes migration on postgres", () => {
  test("test_2_notes_migration_schema_and_concurrent_apply", async () => {
    const sessions = [];
    const open = async () => {
      const session = await connect();
      sessions.push(session);
      return session;
    };

    try {
      // (1) 서로 다른 전용 세션 두 개에서 동시에 적용해도 둘 다 reject 없이 끝난다.
      //     (경쟁의 패자가 게이트를 빨갛게 만들지 않는다 — 결과로 판정한다.)
      const [first, second] = [await open(), await open()];
      await expect(Promise.all([migrate(first), migrate(second)])).resolves.toEqual([undefined, undefined]);

      // (2) 그렇게 만들어진 테이블의 컬럼 집합을 서버에게 물어본다(docs/TECHNICAL.md §Data).
      //     테이블이 이미 있었더라도 컬럼이 틀리면 여기서 떨어진다.
      const reader = await open();
      const { rows } = await reader.query(COLUMNS_SQL, ["public", "notes"]);
      const byName = Object.fromEntries(rows.map((row) => [row.column_name, row]));

      expect(rows.map((row) => row.column_name)).toEqual(["id", "title", "body", "created_at"]);
      expect(byName.id).toMatchObject({ data_type: "bigint", is_nullable: "NO" });
      expect(byName.id.column_default).toMatch(/^nextval\(/); // bigserial
      expect(byName.title).toMatchObject({ data_type: "text", is_nullable: "NO", column_default: null });
      expect(byName.body).toMatchObject({ data_type: "text", is_nullable: "NO", column_default: null });
      expect(byName.created_at).toMatchObject({
        data_type: "timestamp with time zone",
        is_nullable: "NO",
        column_default: "now()",
      });

      // (2-b) 위 단언은 "이미 있는 테이블이 틀리면 떨어진다"를 본다. 그 반대편 —
      //       "이 마이그레이션이 **새로** 만드는 테이블이 그 모양인가" — 는 DB 이력과 무관해야 하므로
      //       빈 스키마에 적용해 같은 질문을 다시 한다. 전부 한 트랜잭션 안이고 ROLLBACK으로 사라진다
      //       (DROP을 실행하지 않는다).
      const probe = `ktb_probe_p${process.pid}`;
      await reader.query("begin");
      await reader.query(`create schema ${probe}`);
      await reader.query(`set local search_path = ${probe}`);
      await migrate(reader);
      const fresh = await reader.query(COLUMNS_SQL, [probe, "notes"]);
      expect(fresh.rows.map((row) => row.column_name)).toEqual(["id", "title", "body", "created_at"]);
      expect(fresh.rows.map((row) => `${row.column_name}:${row.data_type}:${row.is_nullable}`)).toEqual([
        "id:bigint:NO",
        "title:text:NO",
        "body:text:NO",
        "created_at:timestamp with time zone:NO",
      ]);
      expect(fresh.rows[3].column_default).toBe("now()");
      await reader.query("rollback");
      await reader.query("set search_path = public");

      // id가 진짜 primary key다 — bigserial만 있고 제약이 없는 테이블을 떨어뜨린다.
      const pk = await reader.query(
        `select a.attname as column_name
           from pg_index i
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
          where i.indrelid = $1::regclass and i.indisprimary`,
        ["public.notes"],
      );
      expect(pk.rows).toEqual([{ column_name: "id" }]);

      // not null이 선언만이 아니라 실제로 강제된다.
      await reader.query("begin");
      const violation = await rejectionOf(reader.query("insert into notes (title, body) values (null, $1)", ["b"]));
      expect(violation?.code).toBe("23502");
      await reader.query("rollback");

      // 이미 있는 테이블에 다시 적용해도 파괴적이지 않다 — DROP+CREATE 구현이라면 이 행이 사라진다
      // (docs/factory/CHARTER.md NEVER_AUTOMATE: 파괴적 스키마 변경은 출하하지 않는다).
      await reader.query("begin");
      const kept = `schema-guard-p${process.pid}`;
      await reader.query("insert into notes (title, body, created_at) values ($1, $1, now())", [kept]);
      await migrate(reader);
      const survived = await reader.query("select title from notes where title = $1", [kept]);
      expect(survived.rows).toEqual([{ title: kept }]);
      await reader.query("rollback");
    } finally {
      while (sessions.length) await sessions.pop().close();
    }

    // (3) 경쟁의 패자 오류만 삼킨다. 실제 경쟁은 좁은 창이라 위 (1)이 매번 재현하지 못하므로,
    //     결정적으로 관측 가능한 가짜 실행자로 같은 계약을 못박는다.
    const calls = [];
    const executor = (respond) => ({
      async query(text, params) {
        calls.push({ text, params });
        return respond(text, params);
      },
    });

    for (const err of [
      pgError({ code: "42P07" }),
      pgError({ code: "23505", constraint: "pg_type_typname_nsp_index" }),
      pgError({ code: "23505", constraint: "pg_class_relname_nsp_index" }),
    ]) {
      await expect(
        migrate(executor(async () => { throw err; })),
        `${err.code}/${err.constraint ?? "-"} must be tolerated`,
      ).resolves.toBeUndefined();
    }

    // 그 밖의 오류는 전파한다 — 전면 catch 구현은 여기서 떨어진다.
    for (const err of [pgError({ code: "42601" }), pgError({ code: "28P01" })]) {
      const seen = await rejectionOf(migrate(executor(async () => { throw err; })));
      expect(seen, `${err.code} must not be swallowed`).toBe(err);
    }

    // migrate()는 인라인 SQL이 아니라 db/migrations/001_create_notes.sql을 적용한다.
    const sql = await readFile(MIGRATION_PATH, "utf8");
    expect(calls).toHaveLength(5); // 삼킨 3건 + 전파한 2건. 0건이면 위 루프가 공허하게 통과한다.
    expect(calls.every((call) => call.text === sql)).toBe(true);

    // (4) 실행되는 DDL에 DROP은 없다(docs/factory/CHARTER.md NEVER_AUTOMATE).
    //     주석은 걷어낸다 — 마이그레이션 파일의 주석이 "DROP TABLE은 사람이 판단한다"고 적어 둔 곳이다.
    //     실행 결과 쪽 판정은 위 (2)의 "다시 적용해도 행이 살아 있다"가 한다.
    expect(sql.replace(/--[^\n]*/g, " ")).not.toMatch(/\bdrop\b/i);
  }, CASE_TIMEOUT_MS);
});
