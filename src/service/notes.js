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

// Storage failures that mean "the database cannot be reached" become db_unavailable; anything else
// is rethrown unchanged (the route answers it with 500).
function classifyStorageError(err) {
  if (isDbUnavailable(err)) {
    return new NotesError("db_unavailable", "the database is unavailable, try again later", { cause: err });
  }
  return err;
}

export function createNotesService(repo) {
  return {
    async listNotes(query) {
      const page = parsePage(query);
      let result;
      try {
        result = await repo.listNotes(page);
      } catch (err) {
        throw classifyStorageError(err);
      }
      return {
        items: result.items.map((n) => ({ id: n.id, title: n.title, body: n.body, created_at: n.created_at })),
        total: result.total,
      };
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
      return { id: created.id, title: created.title, body: created.body, created_at: created.created_at };
    },
  };
}
