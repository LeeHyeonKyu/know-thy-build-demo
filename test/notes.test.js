// Issue #76 — POST /notes (spec docs/features/001-create-note.md), DB-free unit level.
// The route and service under test are the production modules; only the repository is faked,
// so these tests pin the HTTP contract and the service rules without a database.
// Observation point: an in-process express app bound to an ephemeral 127.0.0.1 port (never a
// fixed port — new-test-repeat runs this file alongside the full suite).
import { afterEach, describe, expect, test } from "vitest";
import express from "express";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
import { createNotesRouter } from "../src/routes/notes.js";
import { createNotesService } from "../src/service/notes.js";
import { makeNote } from "./fixtures/notes.js";

// A repository fake whose behaviour is decided per case. It records every insert so a case can
// assert that nothing reached storage.
function fakeRepo(insert) {
  const calls = [];
  return {
    calls,
    async insertNote(note) {
      calls.push(note);
      return insert(note);
    },
  };
}

const servers = [];
afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function startWith(repo) {
  const app = express();
  app.use("/notes", createNotesRouter(createNotesService(repo)));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return "http://127.0.0.1:" + server.address().port;
}

async function postNote(base, payload) {
  const res = await fetch(base + "/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, text, body };
}

describe("issue #76 — storage failures are classified, not swallowed", () => {
  // dw3: the regression that closed PR #17. A pg connection-loss error carries no `.code`;
  // it must still be 503 db_unavailable. In the same test a coded connection failure is 503 and an
  // unrelated error stays 500 — so a catch-all "every error is 503" fails here too.
  test("test_76_codeless_pg_connection_error_maps_to_503", async () => {
    const secretTitle = "title-must-not-echo-7c1f";
    const secretBody = "body-must-not-echo-9a2e";

    const codeless = new Error("Connection terminated unexpectedly");
    expect(codeless.code).toBeUndefined();
    const base = await startWith(fakeRepo(async () => { throw codeless; }));
    const lost = await postNote(base, makeNote({ title: secretTitle, body: secretBody }));
    expect(lost.res.status).toBe(503);
    expect(lost.res.headers.get("content-type")).toMatch(/application\/json/);
    expect(lost.body?.error?.code).toBe("db_unavailable");
    expect(typeof lost.body?.error?.message).toBe("string");
    // The 503 must not echo what the client submitted (spec 001 Key States).
    expect(lost.text).not.toContain(secretTitle);
    expect(lost.text).not.toContain(secretBody);

    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    const base2 = await startWith(fakeRepo(async () => { throw refused; }));
    const coded = await postNote(base2, makeNote());
    expect(coded.res.status).toBe(503);
    expect(coded.body?.error?.code).toBe("db_unavailable");

    const base3 = await startWith(fakeRepo(async () => { throw new Error("boom"); }));
    const other = await postNote(base3, makeNote({ title: secretTitle, body: secretBody }));
    expect(other.res.status).toBe(500);
    expect(other.body?.error?.code).toBe("internal_error");
    expect(other.text).not.toContain(secretTitle);
  });

  // The real driver's shapes that are not a plain Error with a message: Node 22 reports a refused
  // connect to "localhost" as an AggregateError with code ECONNREFUSED and an EMPTY message
  // (dissent d9), and pg surfaces server-side shutdown as SQLSTATE 57P01. Both are outages.
  test("test_76_driver_shaped_connection_errors_map_to_503", async () => {
    const aggregate = new AggregateError(
      [
        Object.assign(new Error("connect ECONNREFUSED ::1:5432"), { code: "ECONNREFUSED" }),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }),
      ],
      "",
    );
    aggregate.code = "ECONNREFUSED";
    const shutdown = Object.assign(new Error("terminating connection due to administrator command"), { code: "57P01" });
    const timeout = new Error("timeout exceeded when trying to connect");

    for (const err of [aggregate, shutdown, timeout]) {
      const base = await startWith(fakeRepo(async () => { throw err; }));
      const { res, body } = await postNote(base, makeNote());
      expect(res.status, "error " + JSON.stringify(err.message) + " code " + err.code).toBe(503);
      expect(body?.error?.code).toBe("db_unavailable");
    }

    // A coded SQL error that is not about the connection (unique violation) is not an outage.
    const unique = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const base = await startWith(fakeRepo(async () => { throw unique; }));
    const { res } = await postNote(base, makeNote());
    expect(res.status).toBe(500);
  });
});

describe("issue #76 — service validation without a database", () => {
  // dw2 (unit half): the service rule is pinned without a DB. Both fields, both failure modes;
  // the message names the offending field and nothing reaches the repository.
  test("test_76_service_rejects_blank_or_missing_fields", async () => {
    const cases = [
      { input: { body: "b" }, field: "title" },
      { input: { title: "   \t\n", body: "b" }, field: "title" },
      { input: { title: "t" }, field: "body" },
      { input: { title: "t", body: "  " }, field: "body" },
      { input: { title: 42, body: "b" }, field: "title" },
    ];
    for (const { input, field } of cases) {
      const repo = fakeRepo(async () => { throw new Error("repository must not be called"); });
      const service = createNotesService(repo);
      const err = await service.createNote(input).then(
        () => null,
        (e) => e,
      );
      expect(err, JSON.stringify(input)).not.toBeNull();
      expect(err.code).toBe("invalid_request");
      expect(err.message).toContain(field);
      expect(repo.calls).toHaveLength(0);
    }
  });

  // Spec: stored title/body are trimmed and unknown fields never reach storage or the response.
  test("test_76_service_trims_and_drops_unknown_fields", async () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const repo = fakeRepo(async (note) => ({ id: 7, ...note, created_at: createdAt }));
    const service = createNotesService(repo);

    const note = await service.createNote(makeNote({ title: "  spaced title ", body: "\n body \t", owner: "mallory" }));

    expect(repo.calls).toEqual([{ title: "spaced title", body: "body" }]);
    expect(note.title).toBe("spaced title");
    expect(note.body).toBe("body");
    expect(note).not.toHaveProperty("owner");
  });

  // Over HTTP the same rule gives 400 invalid_request, including for a body that is not an object.
  test("test_76_route_returns_400_invalid_request_for_bad_fields", async () => {
    const repo = fakeRepo(async () => { throw new Error("repository must not be called"); });
    const base = await startWith(repo);

    const missing = await postNote(base, { body: "b" });
    expect(missing.res.status).toBe(400);
    expect(missing.body?.error?.code).toBe("invalid_request");
    expect(missing.body?.error?.message).toContain("title");

    const array = await postNote(base, [makeNote()]);
    expect(array.res.status).toBe(400);
    expect(array.body?.error?.code).toBe("invalid_request");

    // U+0000 is valid JSON but Postgres rejects it in text columns (22021): refuse it as a
    // client error with a reason instead of letting it become a 500 (dissent d13).
    const nul = await postNote(base, makeNote({ body: "a\u0000b" }));
    expect(nul.res.status).toBe(400);
    expect(nul.body?.error?.code).toBe("invalid_request");
    expect(nul.body?.error?.message).toContain("body");

    expect(repo.calls).toHaveLength(0);
  });
});

describe("issue #76 rework — stalls and large bodies (cf-s1, cf4)", () => {
  // cf-s1: when a pooled connection stalls mid-query, pg's client-side query_timeout rejects with a
  // bare `Error("Query read timeout")` (no `.code`). That is the database not answering: 503, not 500.
  test("test_76_query_read_timeout_maps_to_503", async () => {
    const secretBody = "stalled-body-must-not-echo-41d0";
    const stalled = new Error("Query read timeout");
    expect(stalled.code).toBeUndefined();
    const base = await startWith(fakeRepo(async () => { throw stalled; }));
    const { res, text, body } = await postNote(base, makeNote({ body: secretBody }));
    expect(res.status).toBe(503);
    expect(body?.error?.code).toBe("db_unavailable");
    expect(text).not.toContain(secretBody);
  });

  // cf4: spec 001 Assumptions — no length limit on the note body (a size cap with 413 is a separate
  // issue). A body well past body-parser's implicit 100kb default reaches storage intact.
  test("test_76_body_over_100kb_reaches_storage_without_413", async () => {
    const repo = fakeRepo(async (note) => ({ id: 1, ...note, created_at: new Date("2026-01-01T00:00:00Z") }));
    const base = await startWith(repo);
    const big = "incident log line\n".repeat(20000).trim(); // ~360 KB
    const { res, body } = await postNote(base, makeNote({ body: big }));
    expect(res.status).toBe(201);
    expect(body?.body).toBe(big);
    expect(repo.calls).toHaveLength(1);
    expect(repo.calls[0].body).toBe(big);
  });
});

describe("issue #76 rework 2 — bounded body buffering and server-side statement timeout (cf1/qa1, cf2/qa2)", () => {
  // cf1/qa1: body-parser inflates gzip/deflate by default, and its size limit is counted on the
  // INFLATED bytes. With no finite limit a tiny compressed request can make the process buffer an
  // unbounded amount. A request whose inflated JSON is far past any sane note (32 MiB of body text,
  // a few tens of KB on the wire) must be refused with 413 in the API's error format before it
  // reaches storage — while an ordinary gzip-encoded note is still accepted.
  test("test_76_inflated_body_over_limit_gets_413_without_storage", async () => {
    const repo = fakeRepo(async (note) => ({ id: 1, ...note, created_at: new Date("2026-01-01T00:00:00Z") }));
    const base = await startWith(repo);
    const post = (payload) =>
      fetch(base + "/notes", {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
        body: gzipSync(Buffer.from(JSON.stringify(payload))),
      });

    const small = await post(makeNote({ title: "gzipped note" }));
    expect(small.status).toBe(201);
    expect((await small.json()).title).toBe("gzipped note");
    expect(repo.calls).toHaveLength(1);

    const huge = await post(makeNote({ body: "a".repeat(32 * 1024 * 1024) }));
    const text = await huge.text();
    expect(huge.status).toBe(413);
    expect(huge.headers.get("content-type")).toMatch(/application\/json/);
    const body = JSON.parse(text);
    expect(typeof body?.error?.code).toBe("string");
    expect(typeof body?.error?.message).toBe("string");
    expect(repo.calls).toHaveLength(1);
  });

  // cf2/qa2: the server-side statement_timeout aborts a stuck INSERT and reports SQLSTATE 57014
  // (query_canceled). The statement was rolled back, so "unavailable, try again later" is true:
  // 503 db_unavailable, not 500, and the submitted text is not echoed.
  test("test_76_statement_timeout_maps_to_503", async () => {
    const secretTitle = "timed-out-title-must-not-echo-5e21";
    const canceled = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    const base = await startWith(fakeRepo(async () => { throw canceled; }));
    const { res, text, body } = await postNote(base, makeNote({ title: secretTitle }));
    expect(res.status).toBe(503);
    expect(body?.error?.code).toBe("db_unavailable");
    expect(text).not.toContain(secretTitle);
  });
});
