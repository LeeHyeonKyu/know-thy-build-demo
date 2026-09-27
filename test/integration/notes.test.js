// Issue #76 — POST /notes against the real entrypoint and the compose Postgres
// (docker-compose.test.yml). The app is started exactly as production starts it
// (`node src/app.js`, real pg driver) and observed over HTTP; the database is read back with a
// separate pg connection.
//
// Isolation (docs/QA.md DB isolation, plan dissent d2): an HTTP request goes through the app's own
// pool, so a per-case BEGIN/ROLLBACK cannot wrap it. Instead every row a case writes carries a
// marker unique to that request, "was a row written?" is asked about that marker only (never a
// table-wide count), and afterAll deletes exactly the markers this file created.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createGzip } from "node:zlib";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { makeNote, uniqueMarker } from "../fixtures/notes.js";
import { MAX_BODY_BYTES, MAX_INFLIGHT_BODY_BYTES } from "../../src/routes/notes.js";

const APP_ENTRYPOINT = fileURLToPath(new URL("../../src/app.js", import.meta.url));
const COMPOSE_FILE = fileURLToPath(new URL("../../docker-compose.test.yml", import.meta.url));
const LOOPBACK = "127.0.0.1";
const READY_LINE = "listening on ";
const BOOT_TIMEOUT_MS = 20000;
const CASE_TIMEOUT_MS = 60000;

// Connection settings come from the compose file (the single source for the test database), and
// can be overridden with pg's standard PG* variables. Nothing here is a production credential.
function composeValue(key) {
  const match = readFileSync(COMPOSE_FILE, "utf8").match(new RegExp(key + ":\\s*([^,\\s}]+)"));
  return match ? match[1] : undefined;
}
const DB = {
  host: process.env.PGHOST ?? LOOPBACK,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: process.env.PGPASSWORD ?? composeValue("POSTGRES_PASSWORD"),
  database: process.env.PGDATABASE ?? composeValue("POSTGRES_DB"),
};
const pgEnv = (host, port) => ({
  PGHOST: host,
  PGPORT: String(port),
  PGUSER: DB.user,
  PGPASSWORD: DB.password,
  PGDATABASE: DB.database,
});

async function reserveLoopbackPort() {
  const probe = createServer();
  probe.listen(0, LOOPBACK);
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((err) => (err ? reject(err) : resolve())));
  return port;
}

// Starts the production entrypoint with the given extra env and waits (condition wait, no sleep)
// until it says it is listening.
async function startApp(extraEnv) {
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [APP_ENTRYPOINT], {
    env: { ...process.env, ...extraEnv, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { out.stdout += chunk; });
  child.stderr.on("data", (chunk) => { out.stderr += chunk; });
  const dead = () => child.exitCode !== null || child.signalCode !== null;
  const stop = async () => {
    if (dead()) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  };
  try {
    await vi.waitFor(
      () => {
        if (dead()) throw new Error("entrypoint stopped before listening: " + out.stderr + out.stdout);
        if (!out.stdout.includes(READY_LINE + port)) throw new Error("not listening yet: " + JSON.stringify(out.stdout));
      },
      { timeout: BOOT_TIMEOUT_MS, interval: 20 },
    );
  } catch (err) {
    await stop();
    throw err;
  }
  return { base: "http://" + LOOPBACK + ":" + port, out, dead, stop };
}

async function send(base, path, init) {
  const res = await fetch(base + path, init);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, text, body };
}

const postJson = (base, payload) =>
  send(base, "/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

// Direct DB access for read-back and cleanup — independent of the app's pool.
const db = new pg.Pool({ ...DB, max: 2 });
const createdMarkers = [];
function marker(label) {
  const m = uniqueMarker(label);
  createdMarkers.push(m);
  return m;
}
async function rowsWithMarker(m) {
  const { rows } = await db.query("select id, title, body, created_at from notes where title = $1 or body = $1", [m]);
  return rows;
}

afterAll(async () => {
  try {
    if (createdMarkers.length) {
      await db.query("delete from notes where title = any($1) or body = any($1)", [createdMarkers]);
    }
  } catch (err) {
    // 42P01: the table was never created (the app under test never wrote) — nothing to clean up.
    if (err?.code !== "42P01") throw err;
  } finally {
    await db.end();
  }
});

describe("issue #76 — POST /notes against the compose Postgres", () => {
  let app;
  beforeAll(async () => { app = await startApp(pgEnv(DB.host, DB.port)); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  // dw1: one request proves both the 201 response (closed key set, trimmed values, unknown field
  // not echoed) and the persisted row found by the returned id.
  test("test_76_create_note_returns_201_and_persists_row", async () => {
    const m = marker("dw1");
    const { res, body } = await postJson(app.base, makeNote({ title: "  " + m + "  ", body: "\tline one\n", owner: "mallory" }));

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    // The spec closes this response: exactly the four fields of the created resource.
    expect(Object.keys(body).sort()).toEqual(["body", "created_at", "id", "title"]);
    expect(body.title).toBe(m);
    expect(body.body).toBe("line one");
    expect(body.id).not.toBeNull();
    expect(Number.isNaN(Date.parse(body.created_at))).toBe(false);

    const { rows } = await db.query("select id, title, body, created_at from notes where id = $1", [body.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe(m);
    expect(rows[0].body).toBe("line one");
    expect(String(rows[0].id)).toBe(String(body.id));
    expect(rows[0].created_at.getTime()).toBe(Date.parse(body.created_at));
    expect(await rowsWithMarker(m)).toHaveLength(1);
  }, CASE_TIMEOUT_MS);

  // dw2: missing and whitespace-only, for both fields → 400 invalid_request naming the field, and
  // no row carrying this request's marker exists afterwards. A valid request with its own marker
  // runs first as the positive control: it proves the marker query can see a row when one is written.
  test("test_76_blank_or_missing_fields_rejected_without_row", async () => {
    const control = marker("dw2-control");
    const ok = await postJson(app.base, makeNote({ body: control }));
    expect(ok.res.status).toBe(201);
    // The fixture's default title travels verbatim: the response and the stored row both carry it.
    expect(ok.body?.title).toBe("pg pool leak");
    const controlRows = await rowsWithMarker(control);
    expect(controlRows).toHaveLength(1);
    expect(controlRows[0].title).toBe("pg pool leak");

    const cases = [
      { field: "title", build: (m) => ({ body: m }) },
      { field: "title", build: (m) => ({ title: "  \n\t ", body: m }) },
      { field: "body", build: (m) => ({ title: m }) },
      { field: "body", build: (m) => ({ title: m, body: "   " }) },
    ];
    for (const { field, build } of cases) {
      const m = marker("dw2-" + field);
      const payload = build(m);
      const { res, body } = await postJson(app.base, payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(body?.error?.code).toBe("invalid_request");
      expect(body?.error?.message).toContain(field);
      expect(await rowsWithMarker(m), "row written for " + JSON.stringify(payload)).toHaveLength(0);
    }
  }, CASE_TIMEOUT_MS);

  // dw4: a body that is not valid JSON is a 400 in the API's error format — not a 500 and not
  // Express's HTML error page. Covers malformed JSON under a JSON content type as well as bodies
  // sent with no JSON content type at all (dissent d12).
  test("test_76_non_json_body_returns_400", async () => {
    const m = marker("dw4");
    const variants = [
      { type: "application/json", payload: '{"title": "' + m + '", "body": ' },
      { type: "text/plain", payload: "just words " + m },
      { type: "application/x-www-form-urlencoded", payload: "title=" + m + "&body=x" },
    ];
    for (const { type, payload } of variants) {
      const { res, text, body } = await send(app.base, "/notes", { method: "POST", headers: { "content-type": type }, body: payload });
      expect(res.status, type).toBe(400);
      expect(res.headers.get("content-type"), type).toMatch(/application\/json/);
      expect(text).not.toMatch(/<html|<pre/i);
      expect(typeof body?.error?.code, type).toBe("string");
      expect(typeof body?.error?.message, type).toBe("string");
    }
    expect(await rowsWithMarker(m)).toHaveLength(0);
  }, CASE_TIMEOUT_MS);

  // Spec 001 Story 1 is a curl one-liner, and `curl -d '{...}'` labels the JSON it sends as
  // application/x-www-form-urlencoded. A JSON body is read as JSON whatever the label says.
  test("test_76_curl_default_content_type_json_is_accepted", async () => {
    const m = marker("curl");
    const { res, body } = await send(app.base, "/notes", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: JSON.stringify(makeNote({ title: m })),
    });
    expect(res.status).toBe(201);
    expect(body.title).toBe(m);
    // The body text (with its `=` and digits, which a form decoder would mangle) is stored verbatim.
    expect(body.body).toBe("max=10 then the pool starves");
    const rows = await rowsWithMarker(m);
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toBe("max=10 then the pool starves");
  }, CASE_TIMEOUT_MS);
});

// A TCP forwarder in front of the compose Postgres that this test alone controls. Only the
// connections that pass through it are ever cut — other suites' connections to the shared DB are
// never touched (no pg_terminate_backend).
async function startLink(target) {
  const state = { up: false, pairs: new Set(), accepted: 0 };
  const server = createServer((client) => {
    state.accepted += 1;
    if (!state.up) {
      client.destroy();
      return;
    }
    const upstream = connect(target.port, target.host);
    const pair = { client, upstream };
    state.pairs.add(pair);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      state.pairs.delete(pair);
    };
    client.on("error", drop);
    upstream.on("error", drop);
    client.on("close", drop);
    upstream.on("close", drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.listen(0, LOOPBACK);
  await once(server, "listening");
  return {
    port: server.address().port,
    state,
    setUp: (up) => { state.up = up; },
    cutAll: () => {
      const n = state.pairs.size;
      for (const pair of [...state.pairs]) {
        pair.client.destroy();
        pair.upstream.destroy();
        state.pairs.delete(pair);
      }
      return n;
    },
    close: async () => {
      state.up = false;
      for (const pair of [...state.pairs]) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("issue #76 — real driver outage on first use", () => {
  // dw6: the real app with the real pg driver, its DB link controlled by this test.
  // (a) link down on the very first POST → 503 db_unavailable, submitted text not echoed;
  // (b) link up → the next POST from the SAME process is 201 and its row exists (no cached failed init);
  // (c) the process's open DB connection is cut → the process stays alive, /healthz is 200, and the
  //     next POST is 503 or 201, never 500 and never a dropped connection.
  test("test_76_db_outage_on_first_use_recovers_and_does_not_crash", async () => {
    const link = await startLink({ host: DB.host, port: DB.port });
    let app;
    try {
      app = await startApp(pgEnv(LOOPBACK, link.port));

      // (a)
      const downTitle = marker("dw6-down");
      const down = await postJson(app.base, makeNote({ title: downTitle, body: "secret body " + downTitle }));
      expect(link.state.accepted).toBeGreaterThan(0); // the driver really tried, through the link
      expect(down.res.status).toBe(503);
      expect(down.body?.error?.code).toBe("db_unavailable");
      expect(down.text).not.toContain(downTitle);
      expect(await rowsWithMarker(downTitle)).toHaveLength(0);

      // (b)
      link.setUp(true);
      const upTitle = marker("dw6-up");
      const up = await postJson(app.base, makeNote({ title: upTitle }));
      expect(up.res.status).toBe(201);
      expect(up.body?.title).toBe(upTitle);
      expect(await rowsWithMarker(upTitle)).toHaveLength(1);

      // (c) The pooled connection is idle now; cut it underneath the app. Wait (condition wait,
      // no sleep) until the app has reacted — it either died or reported the lost connection on
      // stderr — before asking whether it survived.
      const stderrBefore = app.out.stderr.length;
      expect(link.cutAll()).toBeGreaterThan(0);
      await vi.waitFor(
        () => {
          if (!app.dead() && app.out.stderr.length === stderrBefore) throw new Error("app has not reacted to the cut yet");
        },
        { timeout: 10000, interval: 20 },
      );
      expect(app.dead(), "process exited after its DB connection was cut: " + app.out.stderr).toBe(false);

      const health = await send(app.base, "/healthz");
      expect(health.res.status).toBe(200);
      expect(health.body?.ok).toBe(true);

      const afterTitle = marker("dw6-after");
      const after = await postJson(app.base, makeNote({ title: afterTitle }));
      expect([201, 503]).toContain(after.res.status);
      if (after.res.status === 201) {
        expect(await rowsWithMarker(afterTitle)).toHaveLength(1);
      } else {
        expect(after.body?.error?.code).toBe("db_unavailable");
      }
      expect(app.dead()).toBe(false);
    } finally {
      await app?.stop();
      await link.close();
    }
  }, CASE_TIMEOUT_MS);
});

// cf-s1 (rework): a link that ACCEPTS the TCP connection and then never forwards a byte — a hung
// Postgres, a half-open NAT/LB, a proxy that never connects upstream. Unlike startLink's "down"
// (immediate destroy → RST), nothing here ever errors: without a timer in the app, a request
// through this link waits forever. `stall()` also freezes connections already open through it,
// so an idle pooled client that is reused sends its query into silence.
async function startStallableLink(target) {
  const state = { mode: "blackhole", pairs: new Set(), held: new Set(), accepted: 0 };
  const server = createServer((client) => {
    state.accepted += 1;
    client.on("error", () => {});
    if (state.mode !== "up") {
      // Accept and hold: read nothing back, answer nothing, never close.
      state.held.add(client);
      client.on("close", () => state.held.delete(client));
      return;
    }
    const upstream = connect(target.port, target.host);
    upstream.on("error", () => {});
    const pair = { client, upstream };
    state.pairs.add(pair);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      state.pairs.delete(pair);
    };
    client.on("close", drop);
    upstream.on("close", drop);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.listen(0, LOOPBACK);
  await once(server, "listening");
  return {
    port: server.address().port,
    state,
    setUp: () => { state.mode = "up"; },
    // New connections are held silently; open ones stop forwarding in both directions.
    stall: () => {
      state.mode = "blackhole";
      for (const { client, upstream } of state.pairs) {
        client.unpipe(upstream);
        upstream.unpipe(client);
        client.pause();
        upstream.pause();
      }
      return state.pairs.size;
    },
    close: async () => {
      for (const { client, upstream } of [...state.pairs]) {
        client.destroy();
        upstream.destroy();
      }
      for (const client of [...state.held]) client.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

// The bound a stalled database may hold a POST before the client gets its 503. Generous compared
// to the app's own timers so a loaded CI box does not flake, but finite: "never answers" fails.
const STALL_BOUND_MS = 20000;

// POST that never waits past `bound`: a hang is recorded as status "no response" instead of
// hanging the case until its own timeout, so the assertion names the actual failure.
async function postWithin(base, payload, bound) {
  const started = Date.now();
  try {
    const r = await send(base, "/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(bound),
    });
    return { ...r, status: r.res.status, elapsed: Date.now() - started };
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return { status: "no response within " + bound + "ms", body: null, text: "", elapsed: Date.now() - started };
    }
    throw err;
  }
}

describe("issue #76 rework — a stalled database answers 503 within a bound (cf-s1)", () => {
  test("test_76_stalled_db_answers_503_within_bound", async () => {
    const link = await startStallableLink({ host: DB.host, port: DB.port });
    let app;
    try {
      app = await startApp(pgEnv(LOOPBACK, link.port));

      // (a) First use, the DB accepts TCP and then says nothing: a connect-phase stall.
      const firstTitle = marker("stall-connect");
      const first = await postWithin(app.base, makeNote({ title: firstTitle, body: "secret " + firstTitle }), STALL_BOUND_MS);
      expect(link.state.accepted).toBeGreaterThan(0); // the driver really dialled through the link
      expect(first.status).toBe(503);
      expect(first.body?.error?.code).toBe("db_unavailable");
      expect(first.text).not.toContain(firstTitle);

      // (b) The link recovers: the same process writes (a pooled connection now exists).
      link.setUp();
      const okTitle = marker("stall-ok");
      const ok = await postWithin(app.base, makeNote({ title: okTitle }), STALL_BOUND_MS);
      expect(ok.status).toBe(201);
      expect(await rowsWithMarker(okTitle)).toHaveLength(1);

      // (c) The DB goes silent under an open pooled connection, and more requests arrive than
      // the pool has slots (pg default max 10): the reused idle client stalls mid-query, new
      // clients stall mid-connect, and the rest queue for a slot. Every one must get its 503 —
      // none may hang, none may be a 500.
      expect(link.stall()).toBeGreaterThan(0);
      const titles = Array.from({ length: 12 }, (_, i) => marker("stall-query-" + i));
      const results = await Promise.all(titles.map((t) => postWithin(app.base, makeNote({ title: t, body: "secret " + t }), STALL_BOUND_MS)));
      for (const [i, r] of results.entries()) {
        expect(r.status, "request " + i + " after " + r.elapsed + "ms").toBe(503);
        expect(r.body?.error?.code).toBe("db_unavailable");
        expect(r.text).not.toContain(titles[i]);
      }

      // The process is still serving.
      expect(app.dead()).toBe(false);
      const health = await send(app.base, "/healthz");
      expect(health.res.status).toBe(200);
    } finally {
      await app?.stop();
      await link.close();
    }
  }, 120000);
});

// cf4 (rework): spec 001 Assumptions — "본문 길이 제한이 필요 없다"; a size cap with 413 is a separate
// issue (plan non_goals). A pasted incident log past body-parser's implicit 100kb default is
// stored whole through the real entrypoint and the real database.
describe("issue #76 rework — no hidden request-size cap (cf4)", () => {
  let app;
  beforeAll(async () => { app = await startApp(pgEnv(DB.host, DB.port)); }, BOOT_TIMEOUT_MS + 5000);
  afterAll(async () => { await app?.stop(); });

  test("test_76_large_note_body_persists_without_413", async () => {
    for (const lines of [7500, 75000]) { // ~165 KB and ~1.6 MB
      const m = marker("big-" + lines);
      const big = "incident log line 0042\n".repeat(lines).trim();
      const { res, body } = await postJson(app.base, makeNote({ title: m, body: big }));
      expect(res.status, "body of " + big.length + " chars").toBe(201);
      expect(body?.body?.length).toBe(big.length);
      const { rows } = await db.query("select length(body) as n, md5(body) as h from notes where title = $1", [m]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].n)).toBe(big.length);
      const { rows: expected } = await db.query("select md5($1::text) as h", [big]);
      expect(rows[0].h).toBe(expected[0].h);
    }
  }, CASE_TIMEOUT_MS);
});

// cf1/qa1 (rework 2): gzip of N bytes of one repeated byte, built as a stream so the test never
// holds the inflated payload itself — only the (small) compressed result.
async function gzipOfRepeatedByte(byte, totalBytes) {
  const gz = createGzip({ level: 9 });
  const chunks = [];
  gz.on("data", (chunk) => chunks.push(chunk));
  const ended = once(gz, "end");
  const block = Buffer.alloc(1024 * 1024, byte);
  for (let written = 0; written < totalBytes; written += block.length) {
    if (!gz.write(block)) await once(gz, "drain");
  }
  gz.end();
  await ended;
  return Buffer.concat(chunks);
}

describe("issue #76 rework 2 — a compressed request cannot take the process down (cf1/qa1)", () => {
  // One unauthenticated POST whose gzip body inflates to 600 MiB (past V8's maximum string length)
  // but is well under 1 MB on the wire. Unbounded buffering throws a RangeError inside raw-body's
  // stream handler and the whole process exits — /healthz and /version with it. The real
  // entrypoint must instead answer 413 in the API's error format and keep serving.
  test("test_76_gzip_bomb_gets_413_and_process_keeps_serving", async () => {
    const app = await startApp(pgEnv(DB.host, DB.port));
    try {
      const bomb = await gzipOfRepeatedByte(0x61, 600 * 1024 * 1024);
      expect(bomb.length).toBeLessThan(1024 * 1024);

      let answer;
      try {
        answer = await send(app.base, "/notes", {
          method: "POST",
          headers: { "content-type": "application/json", "content-encoding": "gzip" },
          body: bomb,
          signal: AbortSignal.timeout(30000),
        });
      } catch (err) {
        answer = { failure: String(err?.cause?.code || err?.cause?.message || err?.message || err) };
      }
      if (answer.failure) {
        // The connection dropped: wait (condition, bounded) to see whether the process died with it.
        await vi.waitFor(() => { if (!app.dead()) throw new Error("still running"); }, { timeout: 5000, interval: 20 }).catch(() => {});
      }
      expect(answer.failure, "request dropped instead of answered; app stderr: " + app.out.stderr.slice(-1500)).toBeUndefined();
      expect(app.dead(), "process exited on a compressed request: " + app.out.stderr.slice(-1500)).toBe(false);
      expect(answer.res.status).toBe(413);
      expect(answer.res.headers.get("content-type")).toMatch(/application\/json/);
      expect(typeof answer.body?.error?.code).toBe("string");
      expect(typeof answer.body?.error?.message).toBe("string");

      const health = await send(app.base, "/healthz");
      expect(health.res.status).toBe(200);
      expect(health.body?.ok).toBe(true);
      const version = await send(app.base, "/version");
      expect(version.res.status).toBe(200);
      expect(app.dead()).toBe(false);
    } finally {
      await app.stop();
    }
  }, 120000);
});

// cf2/qa2 (rework 2): a 503 must mean "nothing was written". The INSERT is made to wait on a table
// lock longer than the app's timers; afterwards the row must not exist, because the SERVER aborted
// the statement — not merely the client giving up while the INSERT commits later.
//
// Isolation: the lock is taken in a throwaway database created for this case only, so no other
// suite's INSERTs on the shared compose database are ever blocked by it. The app's backends carry a
// per-case application_name (pg's standard PGAPPNAME) so the test can wait for exactly them.
describe("issue #76 rework 2 — a timed-out write answers 503 and leaves no row (cf2/qa2)", () => {
  test("test_76_timed_out_insert_answers_503_and_writes_no_row", async () => {
    const dbName = "fq76_timeout_" + randomUUID().replace(/-/g, "");
    const appName = "fq76-timeout-" + randomUUID();
    await db.query("create database " + dbName);
    const scoped = { ...DB, database: dbName };
    const reader = new pg.Client(scoped);
    const locker = new pg.Client(scoped);
    let app;
    try {
      await reader.connect();
      await locker.connect();
      app = await startApp({ ...pgEnv(DB.host, DB.port), PGDATABASE: dbName, PGAPPNAME: appName });

      // Warm-up: the app creates its table and holds a pooled connection.
      const warm = await postWithin(app.base, makeNote({ title: "warm-up" }), STALL_BOUND_MS);
      expect(warm.status).toBe(201);

      await locker.query("begin");
      await locker.query("lock table notes in access exclusive mode");
      const m = uniqueMarker("timeout");
      let blocked;
      try {
        blocked = await postWithin(app.base, makeNote({ title: m, body: "secret " + m }), STALL_BOUND_MS);
      } finally {
        await locker.query("rollback");
      }
      expect(blocked.status).toBe(503);
      expect(blocked.body?.error?.code).toBe("db_unavailable");
      expect(blocked.text).not.toContain(m);

      // Condition wait: none of the app's backends is still running an INSERT after the lock is
      // gone. An INSERT the server never aborted would run and commit right here.
      await vi.waitFor(
        async () => {
          const { rows } = await reader.query(
            "select count(*)::int as n from pg_stat_activity where application_name = $1 and state = 'active' and query ilike 'insert%'",
            [appName],
          );
          if (rows[0].n !== 0) throw new Error("an app backend is still running an INSERT");
        },
        { timeout: 20000, interval: 50 },
      );
      const { rows } = await reader.query("select id from notes where title = $1", [m]);
      expect(rows, "503 was answered but the row was written").toHaveLength(0);

      // The same process writes again once the lock is gone.
      const again = await postWithin(app.base, makeNote({ title: m + "-again" }), STALL_BOUND_MS);
      expect(again.status).toBe(201);
    } finally {
      await app?.stop();
      await reader.end().catch(() => {});
      await locker.end().catch(() => {});
      await db.query("drop database if exists " + dbName + " with (force)");
    }
  }, 120000);
});

// ---------------------------------------------------------------------------------------------
// Issue #5 — GET /notes (spec docs/features/002-list-notes.md) against the real entrypoint and
// the compose Postgres.
//
// Isolation (docs/QA.md DB isolation, plan dissent d2): `total` and the empty list are statements
// about the WHOLE table, so a marker filter cannot isolate them, and a BEGIN/ROLLBACK cannot wrap
// the app's own pool. Every case therefore gets a throwaway database of its own and an app process
// pointed at it (the same technique as test_76_timed_out_insert_answers_503_and_writes_no_row).
// Rows written by the #76 tests — or by a concurrent new-test-repeat run — live in other databases
// and cannot move `total`. The database starts with no `notes` table at all, so the first GET also
// proves the cold-start path (plan d6: GET before any POST is 200, not a 42P01 500).
//
// Rows are inserted with an explicit created_at by SQL, not through POST: the repository stamps
// now() and cannot be told a time, and dw2's rubric requires a REAL tie in the database (plan d1).
async function withScratchApp(label, fn) {
  const dbName = "fq5_" + label + "_" + randomUUID().replace(/-/g, "");
  await db.query("create database " + dbName);
  const client = new pg.Client({ ...DB, database: dbName });
  let app;
  try {
    await client.connect();
    app = await startApp({ ...pgEnv(DB.host, DB.port), PGDATABASE: dbName });
    return await fn({ app, client });
  } finally {
    await app?.stop();
    await client.end().catch(() => {});
    await db.query("drop database if exists " + dbName + " with (force)");
  }
}

// Inserts rows in the given order and returns them with their assigned ids.
async function insertAt(client, rows) {
  const out = [];
  for (const { title, createdAt } of rows) {
    const note = makeNote({ title });
    const { rows: r } = await client.query(
      "insert into notes (title, body, created_at) values ($1, $2, $3) returning id",
      [note.title, note.body, createdAt],
    );
    out.push({ id: Number(r[0].id), title, createdAt });
  }
  return out;
}

const getList = (base, search = "") => send(base, "/notes" + search);

describe("issue #5 — GET /notes against the compose Postgres", () => {
  // dw5: no notes → 200 and exactly {"items":[],"total":0} (total a number, not "0"), not 404 and
  // not a 500 on a database where the table has never been created.
  test("test_5_empty_list_returns_zero_total", async () => {
    await withScratchApp("empty", async ({ app }) => {
      for (let i = 0; i < 2; i += 1) {
        const { res, body } = await getList(app.base);
        expect(res.status, "call " + i).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/application\/json/);
        expect(body).toStrictEqual({ items: [], total: 0 });
      }
    });
  }, CASE_TIMEOUT_MS);

  // dw1: three notes at different times, inserted in an order that is NOT their time order, so
  // neither "id DESC" nor "insertion order" nor "created_at ASC" produces the expected list.
  test("test_5_list_notes_newest_first_with_total", async () => {
    await withScratchApp("order", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const [middle, newest, oldest] = await insertAt(client, [
        { title: "middle", createdAt: "2026-03-01T10:00:00Z" },
        { title: "newest", createdAt: "2026-03-01T12:00:00Z" },
        { title: "oldest", createdAt: "2026-03-01T08:00:00Z" },
      ]);

      const { res, body } = await getList(app.base);
      expect(res.status).toBe(200);
      // dw1 rubric: the body is exactly {items,total}.
      expect(Object.keys(body).sort()).toEqual(["items", "total"]);
      expect(body.total).toBe(3); // a number, not pg's bigint string "3" (plan d7)
      expect(body.items.map((n) => n.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(body.items[0]).toMatchObject({ title: "newest", created_at: "2026-03-01T12:00:00.000Z" });
      expect(body.items.map((n) => n.created_at)).toEqual([
        "2026-03-01T12:00:00.000Z",
        "2026-03-01T10:00:00.000Z",
        "2026-03-01T08:00:00.000Z",
      ]);
    });
  }, CASE_TIMEOUT_MS);

  // dw2: several rows share one created_at in the database (checked there, not in JSON, which
  // only has millisecond precision). They come back id DESC, between a newer and an older row,
  // and three calls return the same order.
  test("test_5_same_created_at_orders_by_id_desc", async () => {
    await withScratchApp("tie", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const tie = "2026-04-01T09:30:00.123456Z";
      const inserted = await insertAt(client, [
        { title: "older", createdAt: "2026-04-01T09:00:00Z" },
        { title: "tie-a", createdAt: tie },
        { title: "newer", createdAt: "2026-04-01T10:00:00Z" },
        { title: "tie-b", createdAt: tie },
        { title: "tie-c", createdAt: tie },
        { title: "tie-d", createdAt: tie },
      ]);
      const byTitle = Object.fromEntries(inserted.map((r) => [r.title, r.id]));
      const { rows } = await client.query("select count(distinct created_at)::int as n from notes where title like 'tie-%'");
      expect(rows[0].n, "the tie rows must share one created_at in the database").toBe(1);

      const expected = [byTitle.newer, byTitle["tie-d"], byTitle["tie-c"], byTitle["tie-b"], byTitle["tie-a"], byTitle.older];
      for (let i = 0; i < 3; i += 1) {
        const { res, body } = await getList(app.base);
        expect(res.status).toBe(200);
        expect(body.items.map((n) => n.id), "call " + i).toEqual(expected);
      }
    });
  }, CASE_TIMEOUT_MS);

  // dw6: 25 notes, inserted in a shuffled time order (a fixed permutation, not random). Page 1
  // (default limit 20) and page 2 (offset=20) together are the full newest-first list with no gap
  // and no overlap; page 2 starts at the 21st newest. An offset past the end is 200, empty items,
  // and the real total.
  test("test_5_offset_pages_and_past_total_is_empty", async () => {
    await withScratchApp("pages", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const N = 25;
      const base = Date.parse("2026-05-01T00:00:00Z");
      const plan = Array.from({ length: N }, (_, k) => {
        const minute = (k * 7) % N; // gcd(7,25)=1: a bijection, so every minute is used once
        return { title: "n" + String(minute).padStart(2, "0"), createdAt: new Date(base + minute * 60000).toISOString() };
      });
      const inserted = await insertAt(client, plan);
      const newestFirst = [...inserted].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((r) => r.id);

      const page1 = await getList(app.base);
      expect(page1.res.status).toBe(200);
      expect(page1.body.total).toBe(N);
      expect(page1.body.items.map((n) => n.id)).toEqual(newestFirst.slice(0, 20));

      const page2 = await getList(app.base, "?offset=20");
      expect(page2.res.status).toBe(200);
      expect(page2.body.total).toBe(N);
      expect(page2.body.items.map((n) => n.id)).toEqual(newestFirst.slice(20));
      expect(page2.body.items[0].id).toBe(newestFirst[20]);
      expect([...page1.body.items, ...page2.body.items].map((n) => n.id)).toEqual(newestFirst);

      const past = await getList(app.base, "?offset=100");
      expect(past.res.status).toBe(200);
      expect(past.body.items).toEqual([]);
      expect(past.body.total).toBe(N);
    });
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Issue #6 — GET /notes?q= (spec docs/features/003-search.md) against the real entrypoint and the
// compose Postgres. `total` is a statement about every matching row in the table, so each case
// runs in its own throwaway database (withScratchApp, the #5 technique): rows from other tests or
// a concurrent new-test-repeat run cannot move it (plan open_risks: shared compose database).
// Rows are inserted by SQL with explicit title, body and created_at so each case controls exactly
// which text sits in which column.
async function insertNotes(client, rows) {
  const out = [];
  for (const { title, body, createdAt } of rows) {
    const { rows: r } = await client.query(
      "insert into notes (title, body, created_at) values ($1, $2, $3) returning id",
      [title, body, createdAt],
    );
    out.push({ id: Number(r[0].id), title, body, createdAt });
  }
  return out;
}

const searchFor = (base, q, extra = "") => getList(base, "?q=" + encodeURIComponent(q) + extra);

describe("issue #6 — GET /notes?q= against the compose Postgres", () => {
  // dw1: a title-only match and a body-only match are both found, case is ignored in both
  // directions, and a note without the word is in neither `items` nor `total`.
  test("test_6_q_matches_title_or_body_case_insensitive", async () => {
    await withScratchApp("s6match", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const [inTitle, inBody, without, spaced] = await insertNotes(client, [
        { title: "pool tuning", body: "raise max connections", createdAt: "2026-06-01T08:00:00Z" },
        { title: "incident 42", body: "the connection Pool starved at noon", createdAt: "2026-06-01T09:00:00Z" },
        { title: "lunch", body: "sandwiches", createdAt: "2026-06-01T10:00:00Z" },
        { title: "po ol", body: "p-o-o-l", createdAt: "2026-06-01T11:00:00Z" },
      ]);

      for (const q of ["pool", "POOL", "PoOl"]) {
        const { res, body } = await searchFor(app.base, q);
        expect(res.status, "q=" + q).toBe(200);
        expect(body.total, "q=" + q).toBe(2);
        // Newest first, the 002 order: the body match (09:00) before the title match (08:00).
        expect(body.items.map((n) => n.id), "q=" + q).toEqual([inBody.id, inTitle.id]);
        const ids = body.items.map((n) => n.id);
        expect(ids).not.toContain(without.id);
        expect(ids).not.toContain(spaced.id);
      }
      // Items keep the 002 note shape.
      const { body } = await searchFor(app.base, "LUNCH");
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ id: without.id, title: "lunch", body: "sandwiches", created_at: "2026-06-01T10:00:00.000Z" });
    });
  }, CASE_TIMEOUT_MS);

  // dw2: '%', '_' and '\' are literal. Each has a note that literally contains it and decoys that
  // an unescaped pattern would also match (everything for '%'/'_'; 'eXc' for 'e_c'; plain 'p' for
  // '\p'). A trailing backslash would be a Postgres error (500) if left unescaped.
  test("test_6_wildcard_characters_match_literally", async () => {
    await withScratchApp("s6wild", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const [percent, underscore, backslash] = await insertNotes(client, [
        { title: "rollout", body: "100% done", createdAt: "2026-06-02T08:00:00Z" },
        { title: "naming", body: "use snake_case", createdAt: "2026-06-02T09:00:00Z" },
        { title: "windows", body: String.raw`C:\path\to`, createdAt: "2026-06-02T10:00:00Z" },
        { title: "decoy 1000", body: "snakeXcase path done", createdAt: "2026-06-02T11:00:00Z" },
        { title: "decoy plain", body: "nothing special", createdAt: "2026-06-02T12:00:00Z" },
      ]);

      const cases = [
        { q: "%", id: percent.id },
        { q: "0%", id: percent.id },
        { q: "_", id: underscore.id },
        { q: "e_c", id: underscore.id },
        { q: "\\", id: backslash.id },
        { q: String.raw`\p`, id: backslash.id },
        { q: String.raw`C:\ `, id: backslash.id }, // trimmed to a trailing backslash
      ];
      for (const { q, id } of cases) {
        const { res, body } = await searchFor(app.base, q);
        expect(res.status, "q=" + JSON.stringify(q)).toBe(200);
        expect(body.total, "q=" + JSON.stringify(q)).toBe(1);
        expect(body.items.map((n) => n.id), "q=" + JSON.stringify(q)).toEqual([id]);
      }
    });
  }, CASE_TIMEOUT_MS);

  // dw4: a search that matches nothing — on a table that has notes — is 200 and exactly
  // {"items":[],"total":0}; the closed shape is the done_when text itself (lesson L-2026-09-21-01:
  // the one test where closing the key set is the requirement).
  test("test_6_no_match_returns_200_empty", async () => {
    await withScratchApp("s6none", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      await insertNotes(client, [
        { title: "pool tuning", body: "raise max connections", createdAt: "2026-06-03T08:00:00Z" },
        { title: "lunch", body: "sandwiches", createdAt: "2026-06-03T09:00:00Z" },
      ]);
      for (const q of ["zebra", "%%", "pool tuning!"]) {
        const { res, body } = await searchFor(app.base, q);
        expect(res.status, "q=" + q).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/application\/json/);
        expect(body, "q=" + q).toStrictEqual({ items: [], total: 0 });
      }
    });
  }, CASE_TIMEOUT_MS);

  // dw5: filter, then sort newest first, then page. Seven matching notes and six non-matching
  // ones interleaved in time (including the newest rows overall), inserted in a fixed shuffled
  // order. Paging by 3 yields the matching notes newest first with no gap and no overlap, and
  // `total` is 7 on every page, not 13. A blank q is exactly the unfiltered list.
  test("test_6_search_filters_before_paging_and_blank_q_lists_all", async () => {
    await withScratchApp("s6page", async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const base = Date.parse("2026-06-04T00:00:00Z");
      const N = 13;
      const plan = Array.from({ length: N }, (_, k) => {
        const minute = (k * 5) % N; // gcd(5,13)=1: every minute used once, insertion order != time order
        const match = minute % 2 === 0; // minutes 0,2,...,12 match (7 rows); the newest row (12) matches
        return {
          title: (match ? "Apple note " : "pear note ") + minute,
          body: match ? "fruit" : "no fruit here",
          createdAt: new Date(base + minute * 60000).toISOString(),
        };
      });
      // Make the two newest rows overall non-matching too, so page-then-filter would visibly differ.
      plan.push({ title: "pear late 1", body: "x", createdAt: new Date(base + 100 * 60000).toISOString() });
      plan.push({ title: "pear late 2", body: "y", createdAt: new Date(base + 101 * 60000).toISOString() });
      const inserted = await insertNotes(client, plan);
      const matching = inserted
        .filter((r) => r.title.startsWith("Apple"))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map((r) => r.id);
      expect(matching).toHaveLength(7);

      const seen = [];
      for (const offset of [0, 3, 6]) {
        const { res, body } = await searchFor(app.base, "apple", "&limit=3&offset=" + offset);
        expect(res.status, "offset=" + offset).toBe(200);
        expect(body.total, "offset=" + offset).toBe(7);
        expect(body.items.map((n) => n.id), "offset=" + offset).toEqual(matching.slice(offset, offset + 3));
        seen.push(...body.items.map((n) => n.id));
      }
      expect(seen).toEqual(matching);
      const past = await searchFor(app.base, "apple", "&limit=3&offset=9");
      expect(past.res.status).toBe(200);
      expect(past.body.items).toEqual([]);
      expect(past.body.total).toBe(7);

      // Blank q: the same response as GET /notes without q, with and without paging.
      for (const extra of ["", "&limit=4&offset=2"]) {
        const plain = await getList(app.base, extra ? "?" + extra.slice(1) : "");
        expect(plain.res.status).toBe(200);
        expect(plain.body.total).toBe(inserted.length);
        for (const blank of ["?q=", "?q=%20%20", "?q=%09%20"]) {
          const got = await getList(app.base, blank + extra);
          expect(got.res.status, blank + extra).toBe(200);
          expect(got.text, blank + extra).toBe(plain.text);
        }
      }
    });
  }, CASE_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------------------------
// Issue #87 — a process-wide budget on inflated POST /notes body bytes in flight. The per-request
// cap (MAX_BODY_BYTES, 413) stops one gzip bomb; ~300 concurrent ~16 KB gzip bodies that each
// inflate to just under that cap still exhausted the V8 heap and took /healthz and /version down.
//
// Every body here is a gzip built as a stream, so the test process only ever holds the small
// compressed buffer. A burst reuses ONE compressed buffer for all its requests.
const NEAR_CAP = MAX_BODY_BYTES - 64 * 1024; // inflates to just under the per-request cap
const OVER_CAP = MAX_BODY_BYTES + 1024 * 1024; // inflates past it
const BURST = 300; // the issue's reproduction
// The burst cases pin the child's heap so the base commit (no budget) dies deterministically
// instead of depending on how much memory the runner happens to have (plan dissent d2).
const PINNED_HEAP = { NODE_OPTIONS: "--max-old-space-size=384" };
const BURST_TIMEOUT_MS = 180000;
const DW6_WAVES = 12;

// gzip of `head` + `fill` bytes + `tail`, inflating to exactly `totalBytes`.
async function gzipSized(totalBytes, { head = "", tail = "", fill = 0x61 } = {}) {
  const gz = createGzip({ level: 9 });
  const chunks = [];
  gz.on("data", (chunk) => chunks.push(chunk));
  const ended = once(gz, "end");
  const h = Buffer.from(head);
  const t = Buffer.from(tail);
  const block = Buffer.alloc(1024 * 1024, fill);
  if (!gz.write(h)) await once(gz, "drain");
  for (let remaining = totalBytes - h.length - t.length; remaining > 0; remaining -= block.length) {
    if (!gz.write(remaining >= block.length ? block : block.subarray(0, remaining))) await once(gz, "drain");
  }
  gz.write(t);
  gz.end();
  await ended;
  return Buffer.concat(chunks);
}
// A valid note whose JSON is exactly `totalBytes` long once inflated.
const gzipNote = (title, totalBytes) =>
  gzipSized(totalBytes, { head: '{"title":' + JSON.stringify(title) + ',"body":"', tail: '"}', fill: 0x6e });
// JSON that never closes: JSON.parse rejects it only after the whole body has been buffered.
const gzipUnterminated = (totalBytes, head = '{"title":"t","body":"') => gzipSized(totalBytes, { head });

// POST a gzip body; a dropped connection is recorded as `failure` instead of thrown, so the
// assertion names what happened.
async function postGzip(base, gz, bound = 90000) {
  try {
    const r = await send(base, "/notes", {
      method: "POST",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      body: gz,
      signal: AbortSignal.timeout(bound),
    });
    return { ...r, status: r.res.status };
  } catch (err) {
    return { failure: String(err?.cause?.code || err?.cause?.message || err?.message || err) };
  }
}

async function getWithin(base, path, bound = 30000) {
  try {
    const r = await send(base, path, { signal: AbortSignal.timeout(bound) });
    return { ...r, status: r.res.status };
  } catch (err) {
    return { failure: String(err?.cause?.code || err?.cause?.message || err?.message || err) };
  }
}

// Like withScratchApp (a throwaway database per case, dropped afterwards) but with extra env for
// the app process — here the pinned heap.
async function withScratchAppEnv(label, extraEnv, fn) {
  const dbName = "fq87_" + label + "_" + randomUUID().replace(/-/g, "");
  await db.query("create database " + dbName);
  const client = new pg.Client({ ...DB, database: dbName });
  let app;
  try {
    await client.connect();
    app = await startApp({ ...pgEnv(DB.host, DB.port), PGDATABASE: dbName, ...extraEnv });
    return await fn({ app, client });
  } finally {
    await app?.stop();
    await client.end().catch(() => {});
    await db.query("drop database if exists " + dbName + " with (force)");
  }
}

// Fires `count` copies of `gz` at once and, while they are in flight, asks /healthz and /version.
async function burstWithHealth(app, gz, count) {
  const pending = Promise.all(Array.from({ length: count }, () => postGzip(app.base, gz)));
  const during = { health: await getWithin(app.base, "/healthz"), version: await getWithin(app.base, "/version") };
  const results = await pending;
  return { results, during };
}

function expectServing(app, snapshot, when) {
  const tail = " (" + when + "); app stderr: " + app.out.stderr.slice(-1500);
  expect(snapshot.health.failure, "/healthz dropped" + tail).toBeUndefined();
  expect(snapshot.health.status, "/healthz" + tail).toBe(200);
  expect(snapshot.health.body).toMatchObject({ ok: true });
  expect(snapshot.version.failure, "/version dropped" + tail).toBeUndefined();
  expect(snapshot.version.status, "/version" + tail).toBe(200);
}

const tally = (results) => {
  const out = {};
  for (const r of results) {
    const key = r.failure ? "dropped:" + r.failure : r.status + ":" + (r.body?.error?.code ?? "-");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

describe("issue #87 — concurrent inflating bodies cannot take the process down", () => {
  // dw1: 300 concurrent ~16 KB gzip bodies, each inflating to just under 16 MiB of invalid JSON.
  // Every request is answered (400 after a full parse, or 503 overloaded), at least one is
  // overloaded, and /healthz and /version answer during and after the burst.
  test("test_87_concurrent_inflating_bodies_keep_healthz_serving", async () => {
    const gz = await gzipUnterminated(NEAR_CAP);
    expect(gz.length).toBeLessThan(64 * 1024);
    const app = await startApp({ ...pgEnv(DB.host, DB.port), ...PINNED_HEAP });
    try {
      const { results, during } = await burstWithHealth(app, gz, BURST);
      const counts = tally(results);
      const summary = JSON.stringify(counts) + "; app stderr: " + app.out.stderr.slice(-1500);
      expect(results.filter((r) => r.failure), "dropped requests: " + summary).toHaveLength(0);
      expect(app.dead(), "process exited during the burst: " + summary).toBe(false);
      for (const r of results) {
        expect([400, 503], summary).toContain(r.status);
        if (r.status === 503) expect(r.body?.error?.code, summary).toBe("overloaded");
      }
      expect(results.filter((r) => r.status === 503).length, summary).toBeGreaterThan(0);
      expectServing(app, during, "during the burst");
      expectServing(app, { health: await getWithin(app.base, "/healthz"), version: await getWithin(app.base, "/version") }, "after the burst");
      expect(app.dead()).toBe(false);
    } finally {
      await app.stop();
    }
  }, BURST_TIMEOUT_MS);

  // dw2: the refusal itself — 503, JSON, {error:{code:"overloaded",message}}, Retry-After as a
  // positive integer of seconds, and no echo of the submitted text. The bodies never parse, so
  // nothing is written to the shared database.
  test("test_87_overloaded_answers_503_json_with_retry_after", async () => {
    const secret = uniqueMarker("dw87-2-secret");
    const gz = await gzipUnterminated(NEAR_CAP, '{"title":"' + secret + '","body":"');
    const app = await startApp(pgEnv(DB.host, DB.port));
    try {
      const results = await Promise.all(Array.from({ length: 64 }, () => postGzip(app.base, gz)));
      const summary = JSON.stringify(tally(results));
      expect(results.filter((r) => r.failure), summary).toHaveLength(0);
      const refused = results.filter((r) => r.status === 503);
      expect(refused.length, summary).toBeGreaterThan(0);
      for (const r of refused) {
        expect(r.res.headers.get("content-type")).toMatch(/application\/json/);
        expect(r.body?.error?.code).toBe("overloaded");
        expect(r.body?.error?.code).not.toBe("db_unavailable");
        expect(typeof r.body?.error?.message).toBe("string");
        expect(r.body.error.message.length).toBeGreaterThan(0);
        const retryAfter = r.res.headers.get("retry-after");
        expect(retryAfter, "Retry-After header").toMatch(/^\d+$/);
        expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
        expect(r.text).not.toContain(secret);
      }
      expect(app.dead()).toBe(false);
    } finally {
      await app.stop();
    }
  }, BURST_TIMEOUT_MS);

  // dw3: after every exit path — 201, 400, 413, 503 overloaded and a client that hangs up
  // mid-upload — the budget is back to zero: a near-cap note is admitted (201 and a row), which
  // needs the WHOLE budget minus one request free. Each sequential path runs enough times that a
  // leak on that path alone would exhaust the budget.
  test("test_87_budget_released_after_burst_and_client_aborts", async () => {
    expect(MAX_INFLIGHT_BODY_BYTES, "the process-wide budget").toBeGreaterThanOrEqual(MAX_BODY_BYTES);
    const fits = Math.floor(MAX_INFLIGHT_BODY_BYTES / NEAR_CAP); // near-cap requests the budget holds at once
    const repeats = fits + 1;
    await withScratchAppEnv("release", {}, async ({ app, client }) => {
      const rowsTitled = async (title) => (await client.query("select count(*)::int as n from notes where title = $1", [title])).rows[0].n;

      // 201 path
      const okTitle = uniqueMarker("dw87-3-ok");
      const okGz = await gzipNote(okTitle, NEAR_CAP);
      for (let i = 0; i < repeats; i += 1) {
        const r = await postGzip(app.base, okGz);
        expect(r.status, "201 path #" + i + " " + JSON.stringify(r.body)).toBe(201);
      }
      expect(await rowsTitled(okTitle)).toBe(repeats);

      // 400 path (fully buffered, then JSON.parse fails)
      const badGz = await gzipUnterminated(NEAR_CAP);
      for (let i = 0; i < repeats; i += 1) {
        const r = await postGzip(app.base, badGz);
        expect(r.status, "400 path #" + i + " " + JSON.stringify(r.body)).toBe(400);
        expect(r.body?.error?.code).toBe("invalid_request");
      }

      // 413 path (charged up to the cap, then refused)
      const bombGz = await gzipUnterminated(OVER_CAP);
      for (let i = 0; i < repeats; i += 1) {
        const r = await postGzip(app.base, bombGz);
        expect(r.status, "413 path #" + i + " " + JSON.stringify(r.body)).toBe(413);
        expect(r.body?.error?.code).toBe("payload_too_large");
      }

      // 503 overloaded path: a concurrent burst larger than the budget.
      const burst = await Promise.all(Array.from({ length: 4 * repeats }, () => postGzip(app.base, badGz)));
      const summary = JSON.stringify(tally(burst));
      expect(burst.filter((r) => r.failure), summary).toHaveLength(0);
      for (const r of burst) expect([400, 503], summary).toContain(r.status);
      expect(burst.filter((r) => r.status === 503 && r.body?.error?.code === "overloaded").length, summary).toBeGreaterThan(0);

      // Client aborts: `fits` uploads send all but the last bytes of a near-cap gzip and then hold
      // the connection. Together they occupy the budget, which is observed from outside: a
      // near-cap probe is refused as overloaded. Then every one hangs up mid-upload.
      const url = new URL(app.base);
      const heldGz = await gzipUnterminated(NEAR_CAP);
      const held = [];
      try {
        for (let i = 0; i < fits; i += 1) {
          const socket = connect(Number(url.port), url.hostname);
          socket.on("error", () => {});
          await once(socket, "connect");
          socket.write(
            "POST /notes HTTP/1.1\r\nHost: " + url.host + "\r\nContent-Type: application/json\r\n" +
              "Content-Encoding: gzip\r\nContent-Length: " + heldGz.length + "\r\n\r\n",
          );
          socket.write(heldGz.subarray(0, heldGz.length - 16));
          held.push(socket);
        }
        await vi.waitFor(
          async () => {
            const probe = await postGzip(app.base, badGz);
            if (probe.status !== 503) throw new Error("budget not occupied yet: " + JSON.stringify(probe.status));
            expect(probe.body?.error?.code).toBe("overloaded");
          },
          { timeout: 30000, interval: 50 },
        );
      } finally {
        for (const socket of held) socket.destroy();
      }

      // Once the server has seen the hang-ups the budget is free again (condition wait, bounded:
      // a leaked charge never comes back, so this times out instead of passing).
      await vi.waitFor(
        async () => {
          const probe = await postGzip(app.base, badGz);
          if (probe.status !== 400) throw new Error("budget still occupied after client aborts: " + probe.status + " " + probe.body?.error?.code);
        },
        { timeout: 20000, interval: 50 },
      );

      // A near-cap note and an ordinary note are both created.
      const afterTitle = uniqueMarker("dw87-3-after");
      const after = await postGzip(app.base, await gzipNote(afterTitle, NEAR_CAP));
      expect(after.status, JSON.stringify(after.body)).toBe(201);
      expect(await rowsTitled(afterTitle)).toBe(1);
      const small = await postJson(app.base, makeNote({ title: "dw87-3-small" }));
      expect(small.res.status).toBe(201);
      expect(await rowsTitled("dw87-3-small")).toBe(1);
      expect(app.dead()).toBe(false);
    });
  }, BURST_TIMEOUT_MS);

  // dw4: the per-request cap is unchanged. An idle process admits a body of exactly
  // MAX_BODY_BYTES (the budget holds at least one full request), and a body past the cap is
  // still 413 payload_too_large, never 503.
  test("test_87_idle_process_admits_near_cap_body_and_keeps_413", async () => {
    expect(MAX_INFLIGHT_BODY_BYTES).toBeGreaterThanOrEqual(MAX_BODY_BYTES);
    await withScratchAppEnv("idle", {}, async ({ app, client }) => {
      const title = uniqueMarker("dw87-4-cap");
      const atCap = await postGzip(app.base, await gzipNote(title, MAX_BODY_BYTES));
      expect(atCap.status, JSON.stringify(atCap.body)).toBe(201);
      const { rows } = await client.query("select length(body)::int as n from notes where title = $1", [title]);
      expect(rows).toHaveLength(1);
      expect(rows[0].n).toBe(MAX_BODY_BYTES - Buffer.byteLength('{"title":' + JSON.stringify(title) + ',"body":""}'));

      const over = await postGzip(app.base, await gzipNote(uniqueMarker("dw87-4-over"), OVER_CAP));
      expect(over.status).toBe(413);
      expect(over.body?.error?.code).toBe("payload_too_large");
      expect(over.res.headers.get("retry-after")).toBeNull();
      expect(app.dead()).toBe(false);
    });
  }, BURST_TIMEOUT_MS);

  // dw6: the burst is VALID near-cap notes, so admitted requests are parsed and then wait on
  // Postgres holding a 16 MiB string each. To make that wait real, the case holds a SHARE lock on
  // the scratch database's notes table (INSERTs queue behind it; nothing else is touched) while
  // the burst arrives in waves — released well inside the app's 3 s statement_timeout. Only an
  // implementation that keeps a request charged until its response is sent survives this; one
  // that releases when parsing ends admits every wave, piling 16 MiB notes up behind the database
  // (the pool times them out as db_unavailable, or the heap runs out first). Every answer is 201
  // or 503 overloaded, /healthz and /version answer while the notes are held, and no more rows
  // exist than 201s were answered.
  test("test_87_concurrent_valid_json_near_cap_notes_keep_healthz_serving", async () => {
    const title = uniqueMarker("dw87-6");
    const gz = await gzipNote(title, NEAR_CAP);
    expect(gz.length).toBeLessThan(64 * 1024);
    const appName = "fq87-valid-" + randomUUID();
    await withScratchAppEnv("valid", { ...PINNED_HEAP, PGAPPNAME: appName }, async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const locker = new pg.Client({ ...DB, database: client.database });
      await locker.connect();
      let results;
      let during;
      try {
        await locker.query("begin");
        await locker.query("lock table notes in share mode");
        // Waves of `fits` concurrent notes (the most the budget can hold at once). Each wave starts
        // once the previous one is settled: every request answered or an INSERT queued on the lock
        // (or the process gone, which the assertions below report). A single all-at-once burst
        // would not do: every request inflates in parallel, the budget fills with partial charges,
        // and almost nothing reaches the parser — so "released when parsing ends" is never tested.
        const fits = Math.floor(MAX_INFLIGHT_BODY_BYTES / NEAR_CAP);
        let answered = 0;
        const sent = [];
        for (let wave = 0; wave < DW6_WAVES && !app.dead(); wave += 1) {
          for (let i = 0; i < fits; i += 1) {
            sent.push(postGzip(app.base, gz).then((r) => { answered += 1; return r; }));
          }
          await vi.waitFor(
            async () => {
              if (app.dead()) return;
              const { rows } = await client.query(
                "select count(*)::int as n from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'",
                [appName],
              );
              if (answered + rows[0].n < sent.length) {
                throw new Error("wave " + wave + " in flight: " + answered + " answered, " + rows[0].n + " queued of " + sent.length);
              }
            },
            { timeout: 60000, interval: 10 },
          );
        }
        during = { health: await getWithin(app.base, "/healthz"), version: await getWithin(app.base, "/version") };
        await locker.query("rollback");
        results = await Promise.all(sent);
      } finally {
        await locker.query("rollback").catch(() => {});
        await locker.end().catch(() => {});
      }
      const counts = tally(results);
      const summary = JSON.stringify(counts) + "; app stderr: " + app.out.stderr.slice(-1500);
      expect(results.filter((r) => r.failure), "dropped requests: " + summary).toHaveLength(0);
      expect(app.dead(), "process exited during the burst: " + summary).toBe(false);
      for (const r of results) {
        expect([201, 503], summary).toContain(r.status);
        if (r.status === 503) expect(r.body?.error?.code, summary).toBe("overloaded");
      }
      expect(results.filter((r) => r.status === 503).length, summary).toBeGreaterThan(0);
      expectServing(app, during, "during the burst");
      expectServing(app, { health: await getWithin(app.base, "/healthz"), version: await getWithin(app.base, "/version") }, "after the burst");
      const created = results.filter((r) => r.status === 201).length;
      const { rows } = await client.query("select count(*)::int as n from notes where title = $1", [title]);
      expect(rows[0].n).toBeLessThanOrEqual(created);
      expect(app.dead()).toBe(false);
    });
  }, BURST_TIMEOUT_MS);
});

describe("issue #87 rework — a client that hangs up after its upload does not free the budget (cf1)", () => {
  // cf1: `fits` raw-socket clients each send a COMPLETE valid near-cap note. The server parses each
  // one and its INSERT queues behind a SHARE lock, so each request now holds a parsed ~16 MiB note
  // while it waits on Postgres. Then every client destroys its socket. The notes are still in the
  // server's memory, so their charges must stay: a near-cap probe sent after the hang-ups is still
  // refused 503 overloaded. An implementation that releases on the socket 'close' admits the probe
  // (it parses, fails JSON.parse, and answers 400). Once the lock is gone and the handlers settle,
  // the budget is free again: the probe gets 400 and a near-cap note gets 201 (no leak).
  test("test_87_budget_held_after_client_hangs_up_while_note_waits_on_db", async () => {
    const fits = Math.floor(MAX_INFLIGHT_BODY_BYTES / NEAR_CAP);
    expect(fits, "near-cap requests the budget holds at once").toBeGreaterThanOrEqual(1);
    const title = uniqueMarker("dw87-cf1");
    const noteGz = await gzipNote(title, NEAR_CAP);
    const probeGz = await gzipUnterminated(NEAR_CAP);
    const appName = "fq87-hangup-" + randomUUID();
    await withScratchAppEnv("hangup", { PGAPPNAME: appName }, async ({ app, client }) => {
      expect((await getList(app.base)).res.status).toBe(200); // creates the table
      const queuedOnLock = async () =>
        (await client.query(
          "select count(*)::int as n from pg_stat_activity where application_name = $1 and wait_event_type = 'Lock'",
          [appName],
        )).rows[0].n;
      const url = new URL(app.base);
      const locker = new pg.Client({ ...DB, database: client.database });
      await locker.connect();
      const sockets = [];
      const probes = [];
      try {
        await locker.query("begin");
        await locker.query("lock table notes in share mode");
        for (let i = 0; i < fits; i += 1) {
          const socket = connect(Number(url.port), url.hostname);
          socket.on("error", () => {});
          sockets.push(socket);
          await once(socket, "connect");
          socket.write(
            "POST /notes HTTP/1.1\r\nHost: " + url.host + "\r\nContent-Type: application/json\r\n" +
              "Content-Encoding: gzip\r\nContent-Length: " + noteGz.length + "\r\n\r\n",
          );
          socket.write(noteGz);
        }
        // Every upload is complete and parsed: its INSERT is waiting on the lock.
        await vi.waitFor(
          async () => {
            const n = await queuedOnLock();
            if (n < fits) throw new Error(n + " of " + fits + " inserts queued on the lock");
          },
          { timeout: 20000, interval: 10 },
        );
        for (const socket of sockets) socket.destroy();
        // A round trip on a fresh connection after the hang-ups: the server has seen the FINs.
        expect((await getWithin(app.base, "/healthz")).status).toBe(200);
        for (let i = 0; i < 3; i += 1) probes.push(await postGzip(app.base, probeGz));
        expect(await queuedOnLock(), "the parsed notes were still waiting on Postgres while probing").toBe(fits);
      } finally {
        for (const socket of sockets) socket.destroy();
        await locker.query("rollback").catch(() => {});
        await locker.end().catch(() => {});
      }
      const summary = JSON.stringify(tally(probes)) + "; app stderr: " + app.out.stderr.slice(-1500);
      for (const probe of probes) {
        expect(probe.status, "probe while hung-up clients' notes wait on Postgres: " + summary).toBe(503);
        expect(probe.body?.error?.code, summary).toBe("overloaded");
      }

      // The handlers settle once the lock is gone; then the whole budget is free again.
      await vi.waitFor(
        async () => {
          const probe = await postGzip(app.base, probeGz);
          if (probe.status !== 400) throw new Error("budget still occupied after the handlers settled: " + probe.status + " " + probe.body?.error?.code);
        },
        { timeout: 20000, interval: 50 },
      );
      const afterTitle = uniqueMarker("dw87-cf1-after");
      const after = await postGzip(app.base, await gzipNote(afterTitle, NEAR_CAP));
      expect(after.status, JSON.stringify(after.body)).toBe(201);
      const { rows } = await client.query("select count(*)::int as n from notes where title = $1", [afterTitle]);
      expect(rows[0].n).toBe(1);
      expect(app.dead()).toBe(false);
    });
  }, BURST_TIMEOUT_MS);
});
