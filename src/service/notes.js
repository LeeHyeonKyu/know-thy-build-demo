// Service: note rules (required fields, trimming) and classification of storage failures.
// It knows neither HTTP nor SQL (docs/TECHNICAL.md Architecture); the route maps `code` to a status.

export class NotesError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = "NotesError";
    this.code = code;
  }
}

const REQUIRED_FIELDS = ["title", "body"];

// Validates and normalizes a create request. Only title/body are read, so unknown fields never
// reach storage or the response (spec 001: ignored, not echoed).
export function validateNewNote(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new NotesError("invalid_request", "request body must be a JSON object with title and body");
  }
  const note = {};
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) {
      throw new NotesError("invalid_request", field + " is required");
    }
    if (typeof value !== "string") {
      throw new NotesError("invalid_request", field + " must be a string");
    }
    const trimmed = value.trim();
    if (trimmed === "") {
      throw new NotesError("invalid_request", field + " must not be blank");
    }
    // Postgres text cannot hold U+0000 (SQLSTATE 22021). Refuse it with a reason instead of
    // letting client input turn into a 500 (dissent d13).
    if (trimmed.includes("\u0000")) {
      throw new NotesError("invalid_request", field + " must not contain NUL characters");
    }
    note[field] = trimmed;
  }
  return note;
}

// Error codes that mean "the database cannot be reached right now".
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EHOSTDOWN",
  "ENETUNREACH",
  "ENETDOWN",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now (starting up / shutting down)
  "53300", // too_many_connections
  "57014", // query_canceled: the server aborted the statement (statement_timeout) and rolled it back
]);

// Messages the pg driver uses for connection loss WITHOUT setting `.code` — the PR #17 finding:
// "Connection terminated unexpectedly" arrives as a bare Error, so a code-only check sends it to 500.
const CONNECTION_ERROR_MESSAGES = [
  /connection terminated/i,
  /timeout exceeded when trying to connect/i,
  /connection timeout/i,
  /query read timeout/i, // pool query_timeout: the connection stopped answering mid-query (review cf-s1)
  /client has encountered a connection error/i,
  /cannot use a pool after calling end/i,
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH)\b/,
];

// True when `err` (or anything it wraps) is a connection failure. Checks the code AND the message:
// Node 22 reports a refused connect to "localhost" as an AggregateError with an empty message but a
// code, while pg reports a dropped socket with a message but no code.
export function isDbUnavailable(err, depth = 0) {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const code = typeof err.code === "string" ? err.code : "";
  if (CONNECTION_ERROR_CODES.has(code) || code.startsWith("08")) return true; // class 08: connection exception
  const message = typeof err.message === "string" ? err.message : "";
  if (CONNECTION_ERROR_MESSAGES.some((pattern) => pattern.test(message))) return true;
  if (Array.isArray(err.errors) && err.errors.some((inner) => isDbUnavailable(inner, depth + 1))) return true;
  return isDbUnavailable(err.cause, depth + 1);
}

// Paging rules for GET /notes (spec 002). `limit`: default 20, a value above 100 is cut to 100,
// anything that is not a positive integer is invalid_request. `offset`: default 0, must be a
// non-negative integer small enough to reach SQL intact (plan d4). "Integer" means the WHOLE string
// is decimal digits — parseInt would accept "10abc" and "1.5" (plan d9).
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
const DIGITS = /^\d+$/;

export function parsePage(query = {}) {
  const { limit: rawLimit, offset: rawOffset } = query;
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    if (typeof rawLimit !== "string" || !DIGITS.test(rawLimit) || Number(rawLimit) < 1) {
      throw new NotesError("invalid_request", "limit must be a positive integer");
    }
    limit = Math.min(Number(rawLimit), MAX_LIMIT);
  }
  let offset = 0;
  if (rawOffset !== undefined) {
    if (typeof rawOffset !== "string" || !DIGITS.test(rawOffset) || !Number.isSafeInteger(Number(rawOffset))) {
      throw new NotesError("invalid_request", "offset must be a non-negative integer");
    }
    offset = Number(rawOffset);
  }
  return { limit, offset };
}

// Search term for GET /notes?q= (spec 003). Returns null for "no filter" (absent, empty or
// whitespace-only q — the 002 list), otherwise the trimmed term with the LIKE metacharacters made
// literal: each '\' (the escape character itself), '%' and '_' gets one '\' in front. It is one
// pass over the input, so a backslash added for '%' or '_' is never escaped again (the order trap
// of a chained replace). The repository wraps the
// result in '%…%' and matches it with ILIKE … ESCAPE '\'.
// Express parses ?q=a&q=b into an array; that is a client error, not a TypeError 500 (plan d3).
export function normalizeQuery(rawQ) {
  if (rawQ === undefined) return null;
  if (typeof rawQ !== "string") {
    throw new NotesError("invalid_request", "q must be a single value");
  }
  const trimmed = rawQ.trim();
  if (trimmed === "") return null;
  return trimmed.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

// Storage failures that mean "the database cannot be reached" become db_unavailable; anything else
// is rethrown unchanged (the route answers it with 500).
function classifyStorageError(err) {
  if (isDbUnavailable(err)) {
    return new NotesError("db_unavailable", "the database is unavailable, try again later", { cause: err });
  }
  return err;
}

// GET /notes response cache (spec 004): in process memory, fixed 5000 ms TTL, cleared as a whole by
// a successful create. Single process by design (spec Excludes: no Redis, no partial invalidation,
// no size limit). Writes that bypass createNote (direct SQL, another process) show up once the
// entry expires.
export const LIST_CACHE_TTL_MS = 5000;

// The cache key is the page the repository is asked for, not the raw URL: two query strings that
// normalise to the same {limit, offset, q} ask the database the same question, and any difference
// in limit, offset or q is a different key.
export function listCacheKey({ limit, offset, q = null }) {
  return JSON.stringify([limit, offset, q]);
}

// A per-service cache (never module-level: each service instance, and so each test, owns its own).
// `now` is the injected clock (default Date.now, read at call time so fake timers also reach it).
// An entry is fresh while now - storedAt < ttlMs. `generation` goes up on every clear; a read that
// started under an older generation is not stored, so a GET in flight during a successful POST
// cannot put the pre-POST list back after the clear (plan d5).
export function createListCache({ now = () => Date.now(), ttlMs = LIST_CACHE_TTL_MS } = {}) {
  const entries = new Map();
  let generation = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    generation: () => generation,
    set(key, value, startedGeneration) {
      if (startedGeneration !== generation) return;
      entries.set(key, { value, storedAt: now() });
    },
    clear() {
      generation += 1;
      entries.clear();
    },
  };
}

const copyList = (list) => ({ items: list.items.map((n) => ({ ...n })), total: list.total });

export function createNotesService(repo, { now } = {}) {
  const cache = createListCache({ now });
  return {
    async listNotes(query) {
      const page = parsePage(query);
      const q = normalizeQuery(query?.q);
      // `q` is only passed when there is a filter, so a blank search asks for exactly the 002 page.
      const request = q === null ? page : { ...page, q };
      const key = listCacheKey(request);
      const hit = cache.get(key);
      if (hit) return copyList(hit);
      const startedGeneration = cache.generation();
      let result;
      try {
        result = await repo.listNotes(request);
      } catch (err) {
        // Failures (503/500) are never cached: the next request asks the database again.
        throw classifyStorageError(err);
      }
      const list = {
        items: result.items.map((n) => ({ id: n.id, title: n.title, body: n.body, created_at: n.created_at })),
        total: result.total,
      };
      cache.set(key, list, startedGeneration);
      return copyList(list);
    },

    async createNote(input) {
      const note = validateNewNote(input);
      let created;
      try {
        created = await repo.insertNote(note);
      } catch (err) {
        if (isDbUnavailable(err)) {
          throw new NotesError("db_unavailable", "the database is unavailable, try again later", { cause: err });
        }
        throw err;
      }
      // Only a stored note clears the cache; a rejected or failed create leaves it as it was.
      cache.clear();
      return { id: created.id, title: created.title, body: created.body, created_at: created.created_at };
    },
  };
}
