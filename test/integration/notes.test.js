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
