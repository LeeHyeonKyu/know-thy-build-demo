import pg from "pg";

// Repository: SQL and row <-> object mapping only (docs/TECHNICAL.md Architecture).
//
// Connection settings are pg's standard PG* environment variables (PGHOST, PGPORT, PGUSER,
// PGPASSWORD, PGDATABASE); this module adds no configuration contract of its own.
//
// Nothing here touches the database at import or at app start: `new pg.Pool(...)` does not connect,
// and the table is created lazily on the first query, so `node src/app.js` boots and serves
// /healthz with no database reachable (plan dw5 / dissent d3).

// A new table, not a destructive change. Idempotent so every process may run it on first use.
const SCHEMA_DDL = `
  create table if not exists notes (
    id bigserial primary key,
    title text not null,
    body text not null,
    created_at timestamptz not null default now()
  )`;

// Two processes racing `create table if not exists` on a fresh database can see one of these;
// either way the table now exists (dissent d10).
const SCHEMA_ALREADY_EXISTS = new Set(["42P07", "23505"]);

export function createNotesRepo({ pool = createPool() } = {}) {
  // The in-flight schema promise is cached only while it is pending or after it succeeded. A
  // failed attempt (e.g. the DB was down on the very first request) is forgotten, so the next
  // request retries instead of failing forever until a restart (dissent d7).
  let schemaReady = null;
  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = pool.query(SCHEMA_DDL).then(
        () => undefined,
        (err) => {
          if (SCHEMA_ALREADY_EXISTS.has(err?.code)) return undefined;
          schemaReady = null;
          throw err;
        },
      );
    }
    return schemaReady;
  }

  return {
    async insertNote({ title, body }) {
      await ensureSchema();
      const { rows } = await pool.query(
        "insert into notes (title, body) values ($1, $2) returning id, title, body, created_at",
        [title, body],
      );
      const row = rows[0];
      return { id: Number(row.id), title: row.title, body: row.body, created_at: row.created_at };
    },
  };
}

// Timers on every wait in the request path (review cf-s1). Without them a database that accepts TCP
// and then goes silent (hung Postgres, half-open NAT/LB, a proxy that never forwards) holds a POST
// forever, and after `max` such requests every later POST sits in pg-pool's wait queue — the
// endpoint stops answering instead of returning 503 (spec 001 Key States).
//  - connectionTimeoutMillis bounds both opening a connection (handshake included) and waiting in
//    the pool's queue for a free client; pg then raises "Connection terminated due to connection
//    timeout" / "timeout exceeded when trying to connect".
//  - query_timeout is a client-side read timer: a query sent on a connection that stops answering
//    fails with "Query read timeout", and pool.query discards that client instead of reusing it.
// Both errors are classified as db_unavailable by the service layer.
export const CONNECT_TIMEOUT_MS = 3000;
export const QUERY_TIMEOUT_MS = 5000;

function createPool() {
  const pool = new pg.Pool({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS });
  // An idle pooled client whose connection drops (Postgres restart, network cut) is reported as
  // an 'error' event on the pool. Without a listener Node treats it as an unhandled error and the
  // whole process exits — /healthz and /version included (dissent d8). The pool has already
  // discarded that client; the next query opens a fresh connection. Log only the message: never
  // the query or its parameters.
  pool.on("error", (err) => {
    console.error("notes db: idle connection lost: " + (err?.message || err?.code || "unknown error"));
  });
  return pool;
}
