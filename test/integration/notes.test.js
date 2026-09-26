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
