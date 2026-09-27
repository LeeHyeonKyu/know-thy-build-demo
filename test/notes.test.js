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
import { NotesError, normalizeQuery } from "../src/service/notes.js";
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

// ---------------------------------------------------------------------------------------------
// Issue #5 — GET /notes (spec docs/features/002-list-notes.md), DB-free unit level.
// The route and service are the production modules; the repository is a fake that records the
// page it was asked for, so the effective limit/offset is observed as a side effect, not recomputed.

function fakeListRepo(result = { items: [], total: 0 }) {
  const calls = [];
  return {
    calls,
    async insertNote() {
      throw new Error("insertNote must not be called by GET /notes");
    },
    async listNotes(page) {
      calls.push(page);
      if (result instanceof Error) throw result;
      return typeof result === "function" ? result(page) : result;
    },
  };
}

async function getNotes(base, search = "") {
  const res = await fetch(base + "/notes" + search);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { res, text, body };
}

describe("issue #5 — GET /notes paging rules without a database", () => {
  // dw3: missing limit → 20, in-range kept, over the cap → 100; offset defaults to 0 and is passed
  // through. Each request is checked by what the repository was actually asked for.
  test("test_5_limit_default_and_cap", async () => {
    const cases = [
      { search: "", page: { limit: 20, offset: 0 } },
      { search: "?limit=5", page: { limit: 5, offset: 0 } },
      { search: "?limit=5&offset=7", page: { limit: 5, offset: 7 } },
      { search: "?offset=40", page: { limit: 20, offset: 40 } },
      { search: "?limit=1", page: { limit: 1, offset: 0 } },
      { search: "?limit=100", page: { limit: 100, offset: 0 } },
      { search: "?limit=101", page: { limit: 100, offset: 0 } },
      { search: "?limit=1000", page: { limit: 100, offset: 0 } },
      { search: "?limit=99999999999999999999999", page: { limit: 100, offset: 0 } },
    ];
    for (const { search, page } of cases) {
      const repo = fakeListRepo();
      const base = await startWith(repo);
      const { res } = await getNotes(base, search);
      expect(res.status, "GET /notes" + search).toBe(200);
      expect(repo.calls, "GET /notes" + search).toEqual([page]);
    }
  });

  // dw4: a negative or non-integer limit is 400 in the API's error format, and storage is never
  // asked. '1.5' and '10abc' are the inputs a parseInt-based check lets through (plan d9); '0' is
  // not a positive integer (spec Key States message, plan d3).
  test("test_5_invalid_limit_returns_400", async () => {
    for (const raw of ["-1", "abc", "1.5", "10abc", "0", ""]) {
      const repo = fakeListRepo();
      const base = await startWith(repo);
      const { res, body } = await getNotes(base, "?limit=" + encodeURIComponent(raw));
      expect(res.status, "limit=" + JSON.stringify(raw)).toBe(400);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(body?.error?.code, "limit=" + JSON.stringify(raw)).toBe("invalid_request");
      expect(body?.error?.message).toContain("limit");
      expect(repo.calls, "limit=" + JSON.stringify(raw)).toHaveLength(0);
    }
  });

  // Plan d4: a negative, non-integer or out-of-range offset is refused before it reaches SQL
  // (where it would be a Postgres error and a 500).
  test("test_5_invalid_offset_returns_400", async () => {
    for (const raw of ["-5", "x", "2.5", "99999999999999999999999"]) {
      const repo = fakeListRepo();
      const base = await startWith(repo);
      const { res, body } = await getNotes(base, "?offset=" + encodeURIComponent(raw));
      expect(res.status, "offset=" + JSON.stringify(raw)).toBe(400);
      expect(body?.error?.code).toBe("invalid_request");
      expect(body?.error?.message).toContain("offset");
      expect(repo.calls).toHaveLength(0);
    }
  });

  // The repository's page is passed through as {items,total}; created_at is serialized the same
  // way POST /notes serializes it, and total stays a number.
  test("test_5_route_passes_repo_page_through", async () => {
    const createdAt = new Date("2026-02-03T04:05:06.789Z");
    const repo = fakeListRepo({ items: [{ id: 9, title: "t9", body: "b9", created_at: createdAt }], total: 42 });
    const base = await startWith(repo);
    const { res, body } = await getNotes(base, "?limit=1&offset=3");
    expect(res.status).toBe(200);
    expect(body.total).toBe(42);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 9, title: "t9", body: "b9", created_at: "2026-02-03T04:05:06.789Z" });
  });

  // Plan d5: the database being down on GET is the same 503 db_unavailable as on POST, not a 500.
  test("test_5_list_db_unavailable_maps_to_503", async () => {
    const base = await startWith(fakeListRepo(new Error("Connection terminated unexpectedly")));
    const down = await getNotes(base);
    expect(down.res.status).toBe(503);
    expect(down.body?.error?.code).toBe("db_unavailable");

    const base2 = await startWith(fakeListRepo(new Error("boom")));
    const other = await getNotes(base2);
    expect(other.res.status).toBe(500);
    expect(other.body?.error?.code).toBe("internal_error");
  });
});

// ---------------------------------------------------------------------------------------------
// Issue #6 — GET /notes?q= search (spec docs/features/003-search.md), DB-free unit level.
// normalizeQuery is the pure service rule; the route cases observe what the repository was asked
// for (the fake records it) instead of recomputing it.

describe("issue #6 — search-term normalisation without a database", () => {
  // dw3: trim; escape '\', '%' and '_' so each is literal inside ILIKE; blank means no filter.
  // Expected values are written out as literal LIKE patterns, not derived from a replace chain.
  test("test_6_normalize_query_trims_and_escapes", async () => {
    // Blank / absent: no filter at all.
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("   ")).toBeNull();
    expect(normalizeQuery("\t \n")).toBeNull();

    // Trim only the ends; inner spaces are part of the term.
    expect(normalizeQuery("  pool  ")).toBe("pool");
    expect(normalizeQuery(" pg pool ")).toBe("pg pool");
    expect(normalizeQuery("POOL")).toBe("POOL");

    // Each LIKE metacharacter is preceded by one backslash.
    expect(normalizeQuery("%")).toBe(String.raw`\%`);
    expect(normalizeQuery("_")).toBe(String.raw`\_`);
    expect(normalizeQuery("\\")).toBe(String.raw`\\`);
    expect(normalizeQuery("100%")).toBe(String.raw`100\%`);
    expect(normalizeQuery("snake_case")).toBe(String.raw`snake\_case`);
    expect(normalizeQuery(String.raw`C:\tmp`)).toBe(String.raw`C:\\tmp`);
    // Order trap (plan open_risks): a backslash already in the input is escaped exactly once, and
    // the backslashes added for % and _ are not escaped again.
    expect(normalizeQuery(String.raw`\%`)).toBe(String.raw`\\\%`);
    expect(normalizeQuery(String.raw`a\_b%`)).toBe(String.raw`a\\\_b\%`);
    // Trim happens before escaping, so surrounding spaces never survive.
    expect(normalizeQuery("  %_  ")).toBe(String.raw`\%\_`);

    // Through the route: the repository receives the normalised term, and no filter when blank.
    for (const { search, expected } of [
      { search: "?q=" + encodeURIComponent("  50%_off  "), expected: { limit: 20, offset: 0, q: String.raw`50\%\_off` } },
      { search: "?q=%20%20&limit=5", expected: { limit: 5, offset: 0 } },
      { search: "?q=", expected: { limit: 20, offset: 0 } },
    ]) {
      const repo = fakeListRepo();
      const base = await startWith(repo);
      const { res } = await getNotes(base, search);
      expect(res.status, "GET /notes" + search).toBe(200);
      expect(repo.calls, "GET /notes" + search).toHaveLength(1);
      expect(repo.calls[0].q ?? null, "GET /notes" + search).toBe(expected.q ?? null);
      expect(repo.calls[0]).toMatchObject({ limit: expected.limit, offset: expected.offset });
    }
  });

  // dw6: Express turns ?q=a&q=b into an array; that is a 400 in the API's error format (spec
  // Key States), never a TypeError 500, and storage is never asked.
  test("test_6_repeated_q_returns_400_invalid_request", async () => {
    for (const search of ["?q=a&q=b", "?q=a&q=a", "?q=&q=x", "?limit=5&q=pool&q=POOL"]) {
      const repo = fakeListRepo();
      const base = await startWith(repo);
      const { res, body } = await getNotes(base, search);
      expect(res.status, "GET /notes" + search).toBe(400);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(body?.error?.code, "GET /notes" + search).toBe("invalid_request");
      expect(body?.error?.message).toBe("q must be a single value");
      expect(repo.calls, "GET /notes" + search).toHaveLength(0);
    }
    expect(() => normalizeQuery(["a", "b"])).toThrow(NotesError);
  });
});
