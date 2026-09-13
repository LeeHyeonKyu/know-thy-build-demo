// integration 헬퍼 — 컴포즈 Postgres에 붙는 **세션 하나**를 `{ query(text, params) }` 실행자로 만든다.
//
// 왜 psql 세션인가: `pg` 드라이버는 이 저장소에 설치돼 있지 않고 package.json·package-lock.json은
// protected다(PR 본문 "Harness change needed"). 대신 이 저장소가 이미 쓰는 경로 —
// test/integration/db.test.js:4의 `docker compose exec -T db psql` — 를 **끊지 않고 유지되는 세션**으로
// 확장한다. 세션이 하나이므로 `BEGIN` → 단언 → `ROLLBACK`이 한 커넥션 안에서 성립하고
// (docs/QA.md "DB isolation"), 그 실행자를 그대로 `createApp({ db })`에 주입하면 앱이 쓴 행이
// 테스트의 트랜잭션 안에서 보인다 — 앱이 자기 pool로 다른 커넥션을 쓰면 보이지 않는다.
//
// 프로토콜: 문장 하나를 보낸 뒤 `\echo`로 마커를 찍고, 마커 줄에 psql 변수 :ERROR/:SQLSTATE를
// 함께 실어 stdout **한 스트림**에서 결과와 오류를 순서대로 읽는다. stderr는 진단용으로만 모은다
// (stdout/stderr 두 파이프의 도착 순서는 보장되지 않으므로 판정에 쓰지 않는다).
// 행이 있는 문장은 서버에서 JSON 한 줄로 접어 받는다 — 클라이언트 쪽 표 파싱이 없다.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION_PATH = fileURLToPath(new URL("../../../db/migrations/001_create_notes.sql", import.meta.url));
const COMPOSE_FILE = fileURLToPath(new URL("../../../docker-compose.test.yml", import.meta.url));
const MARKER_HEAD = "<<<KTB-END|";
const MARKER = `\\echo ${MARKER_HEAD}:ERROR|:SQLSTATE|:LAST_ERROR_MESSAGE>>>`;
const ROW_RETURNING = /^\s*(?:select|with|values|table)\b/i;
const RETURNING_CLAUSE = /\breturning\b/i;

// psql은 tty가 아니어도 명령 하나마다 stdout을 flush한다(확인함) — 마커가 도착할 때까지만 기다린다.
const PSQL_ARGV = [
  "compose", "-f", COMPOSE_FILE, "exec", "-T", "db",
  "psql", "-U", "postgres", "-d", "demo", "-X", "-q", "-A", "-t", "--no-psqlrc",
];

// 값을 SQL 리터럴로 만든다. 달러 인용을 쓰므로 (a) 이스케이프 규칙에 기대지 않고
// (b) 리터럴의 타입이 `unknown`이라 실제 바인드 파라미터와 같은 암묵 캐스팅을 받는다
// (text를 timestamptz 컬럼에 넣을 때 형 변환이 달라지는 문제가 없다).
function dollarQuote(value) {
  let tag = "ktb";
  for (let n = 1; value.includes(`$${tag}$`); n += 1) tag = `ktb${n}`;
  return `$${tag}$${value}$${tag}$`;
}

function toLiteral(value) {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return dollarQuote(value.toISOString());
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot bind non-finite number: ${value}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return dollarQuote(String(value));
}

// `$1`을 리터럴로 바꾼다. String#replace는 치환 결과를 다시 스캔하지 않으므로
// 리터럴 안의 `$ktb$`가 또 다른 자리표시자로 읽히지 않는다.
function interpolate(text, params) {
  return text.replace(/\$(\d+)/g, (whole, index) => {
    const position = Number(index);
    if (position < 1 || position > params.length) {
      throw new RangeError(`no binding for ${whole} (got ${params.length} params)`);
    }
    return toLiteral(params[position - 1]);
  });
}

function wrapForJson(sql) {
  const body = sql.trim().replace(/;\s*$/, "");
  // json_agg는 요소 사이에 개행을 넣는다. JSON 문자열 안의 개행은 이미 \n으로 이스케이프돼 있으므로
  // 남은 raw 개행은 포맷팅뿐이다 — 지우면 한 줄이 된다.
  return `with __ktb as (${body}) select replace(coalesce(json_agg(__ktb)::text, '[]'), chr(10), ' ') from __ktb;`;
}

class PsqlSession {
  #child;
  #stdout = "";
  #stderr = "";
  #lines = [];
  #waiter = null;
  #exit = null;
  #queue = Promise.resolve();

  constructor() {
    this.#child = spawn("docker", PSQL_ARGV, { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"] });
    this.#child.stdout.setEncoding("utf8");
    this.#child.stderr.setEncoding("utf8");
    this.#child.stdout.on("data", (chunk) => this.#absorb(chunk));
    this.#child.stderr.on("data", (chunk) => { this.#stderr += chunk; });
    this.#child.on("exit", (code, signal) => {
      this.#exit = { code, signal };
      this.#waiter?.reject(
        new Error(`psql session ended before the statement finished (code=${code} signal=${signal})\n${this.#stderr}`),
      );
      this.#waiter = null;
    });
  }

  #absorb(chunk) {
    this.#stdout += chunk;
    const parts = this.#stdout.split("\n");
    this.#stdout = parts.pop();
    for (const line of parts) this.#lines.push(line);
    this.#drain();
  }

  #drain() {
    if (!this.#waiter) return;
    const at = this.#lines.findIndex((line) => line.startsWith(MARKER_HEAD));
    if (at === -1) return;
    const rows = this.#lines.slice(0, at);
    const marker = this.#lines[at];
    this.#lines = this.#lines.slice(at + 1);
    const waiter = this.#waiter;
    this.#waiter = null;
    // 마커는 `<<<KTB-END|<:ERROR>|<:SQLSTATE>|<:LAST_ERROR_MESSAGE>>>>` 한 줄이다.
    const [errorFlag, state, ...messageParts] = marker
      .slice(MARKER_HEAD.length)
      .replace(/>>>$/, "")
      .split("|");
    if (errorFlag === "true") {
      const err = new Error(messageParts.join("|") || `psql error ${state}`);
      err.code = state;
      waiter.reject(err);
      return;
    }
    waiter.resolve(rows);
  }

  #send(statement) {
    if (this.#exit) {
      return Promise.reject(new Error(`psql session is closed (code=${this.#exit.code})\n${this.#stderr}`));
    }
    const settled = new Promise((resolve, reject) => { this.#waiter = { resolve, reject }; });
    // 종결자가 없으면 psql은 문장을 계속 읽는다 — 그러면 `\echo` 마커만 먼저 찍히고 다음 문장이
    // 앞 문장에 이어 붙는다(세션이 조용히 어긋난다). 항상 `;`로 닫는다.
    const terminated = statement.trimEnd().endsWith(";") ? statement : `${statement};`;
    this.#child.stdin.write(`${terminated}\n${MARKER}\n`);
    this.#drain();
    return settled;
  }

  // `{ query(text, params) }` — src/repo/**가 요구하는 실행자 계약 그대로다.
  query(text, params = []) {
    const run = this.#queue.then(
      () => this.#execute(text, params),
      () => this.#execute(text, params),
    );
    // 세션은 하나이므로 문장은 반드시 직렬화된다(앱의 질의와 테스트의 질의가 섞이지 않는다).
    this.#queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async #execute(text, params) {
    // 판정 입력은 **치환 전** 원문이다(리뷰 cs1). 치환된 문자열로 판정하면 파라미터 **값**에
    // `returning`이라는 단어가 들어간 INSERT가 json 래핑 CTE로 감싸져 0A000으로 실패하고,
    // 그 뒤 같은 트랜잭션의 모든 질의가 `current transaction is aborted`로 죽는다.
    const wantsRows = ROW_RETURNING.test(text) || RETURNING_CLAUSE.test(text);
    const sql = interpolate(text, params);
    const lines = await this.#send(wantsRows ? wrapForJson(sql) : sql);
    if (!wantsRows) return { rows: [] };
    const payload = lines.filter((line) => line.length > 0).pop() ?? "[]";
    return { rows: JSON.parse(payload) };
  }

  async close() {
    if (this.#exit) return;
    const ended = new Promise((resolve) => this.#child.once("exit", resolve));
    this.#child.stdin.end();
    await ended;
  }
}

/** 컴포즈 Postgres에 붙은 세션 하나를 연다. 연결이 실제로 살아 있는지 확인하고 돌려준다. */
export async function connect() {
  const session = new PsqlSession();
  const probe = await session.query("select 1 as one");
  if (probe.rows[0]?.one !== 1) {
    await session.close();
    throw new Error("compose postgres did not answer `select 1`");
  }
  return session;
}

// 동시 적용 경쟁에서 "지는 쪽"이 받는 오류들. `CREATE TABLE IF NOT EXISTS`는 원자적이지 않아
// 두 워커가 같은 순간에 들어오면 한쪽이 아래 형태로 실패한다 — 결과는 이미 원하던 상태(테이블 존재)다.
// vitest는 파일을 병렬로 돌리므로 이 경쟁은 가정이 아니라 이 스위트의 기본 실행 조건이다.
const DUPLICATE_TABLE = "42P07";
const UNIQUE_VIOLATION = "23505";
const CATALOG_INDEXES = ["pg_type_typname_nsp_index", "pg_class_relname_nsp_index"];

function isConcurrentDuplicate(err) {
  if (err?.code === DUPLICATE_TABLE) return true;
  // psql 실행자는 constraint 이름을 따로 주지 않는다 — SQLSTATE + 카탈로그 인덱스 이름으로 판정한다.
  return err?.code === UNIQUE_VIOLATION && CATALOG_INDEXES.some((name) => String(err.message).includes(name));
}

/**
 * 스키마를 적용한 세션. 마이그레이션 SQL은 출하하되(`db/migrations/001_create_notes.sql`)
 * **적용은 이 헬퍼가 한다** — 제품 호출자가 0인 `migrate()` 모듈을 src/에 두지 않기 위해서다
 * (plan non_goals, docs/TECHNICAL.md §Data). 동시 적용 경쟁의 패자 오류만 삼키고,
 * 그 밖의 오류(구문·권한)는 그대로 전파한다 — 전면 catch는 진짜 실패를 조용하게 만든다.
 */
export async function connectMigrated() {
  const session = await connect();
  try {
    await session.query(await readFile(MIGRATION_PATH, "utf8"));
  } catch (err) {
    if (!isConcurrentDuplicate(err)) {
      await session.close();
      throw err;
    }
  }
  return session;
}

/**
 * 케이스 하나를 위한 트랜잭션 커넥션. `BEGIN`까지 마친 실행자를 돌려주고,
 * `finish()`는 `ROLLBACK` 후 세션을 닫는다 — 공유 테이블에 행이 남지 않는다(docs/QA.md).
 */
export async function openCase() {
  const db = await connectMigrated();
  await db.query("begin");
  return {
    db,
    async rollback() {
      await db.query("rollback");
    },
    async finish() {
      try {
        await db.query("rollback");
      } finally {
        await db.close();
      }
    },
  };
}
