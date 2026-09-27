import express from "express";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { NotesError } from "../service/notes.js";

// Routes: request parsing, status codes, and the `{"error":{"code","message"}}` format
// (CHARTER Preserve: clients branch on `code`).

const STATUS_BY_CODE = { invalid_request: 400, db_unavailable: 503 };

// Upper bound on a POST /notes body after decompression. Far above any note a person pastes
// (the cf4 case is ~1.6 MB) and far below V8's ~512 MiB string maximum.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

// Process-wide bound on POST /notes body bytes in flight, counted AFTER decompression (#87). The
// per-request cap stops one gzip bomb, but ~300 concurrent ~16 KB gzip bodies each inflating to
// just under MAX_BODY_BYTES still exhausted the V8 heap. A request is charged for every inflated
// byte it buffers and keeps that charge until its RESPONSE is over (finish or close) AND, if the
// body was parsed, until the route handler is done with it — not merely until parsing ends or the
// client hangs up, because a parsed 16 MiB note still sits in memory while it waits on Postgres.
// A request whose next chunk would push the total past this bound is refused with 503 `overloaded`.
// It must stay >= MAX_BODY_BYTES so an idle process still admits one full-size note.
// What is NOT bounded here: the copies JSON.parse and the driver make on top of the raw bytes, so
// the real peak is a small multiple of this number (plan open_risks).
export const MAX_INFLIGHT_BODY_BYTES = 4 * MAX_BODY_BYTES;
export const OVERLOADED_RETRY_AFTER_SECONDS = 1;

let inflightBodyBytes = 0;

const bodyError = (status, type, message) => Object.assign(new Error(message), { status, type });

const DECOMPRESSORS = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress };

// The same "is there a body?" test body-parser (type-is) used.
const hasBody = (req) => req.headers["transfer-encoding"] !== undefined || !isNaN(req.headers["content-length"]);

function charsetOf(req) {
  const match = /;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(req.headers["content-type"] ?? "");
  return match ? (match[1] ?? match[2]).toLowerCase() : "utf-8";
}

// body-parser's strict JSON rule: an empty body is {}, otherwise the first non-whitespace
// character must open an object or an array.
function parseStrictJson(text) {
  if (text.length === 0) return {};
  const first = /^[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d])/.exec(text)?.[1];
  if (first !== "{" && first !== "[") throw new SyntaxError("request body must be a JSON object or array");
  return JSON.parse(text);
}

// Reads a POST /notes body into req.body — what express.json({type: () => true, limit:
// MAX_BODY_BYTES}) did, plus the in-flight budget above. It reads the (possibly decompressed)
// stream itself because body-parser buffers the whole body before any hook runs, which is exactly
// the memory this budget has to see. Failures reach the error handler below with the same
// `type`/`status` body-parser gave them (entity.too.large → 413, entity.parse.failed → 400, …).
function readJsonBody(req, res, next) {
  if (!hasBody(req)) return next();
  const charset = charsetOf(req);
  let decoder;
  try {
    if (!charset.startsWith("utf-")) throw new RangeError(charset);
    decoder = new TextDecoder(charset);
  } catch {
    return next(bodyError(415, "charset.unsupported", "unsupported charset"));
  }
  const encoding = String(req.headers["content-encoding"] || "identity").toLowerCase();
  let source = req;
  if (encoding !== "identity") {
    const decompress = DECOMPRESSORS[encoding];
    if (!decompress) return next(bodyError(415, "encoding.unsupported", "unsupported content encoding"));
    source = decompress();
    req.pipe(source);
  }

  // The charge is returned exactly once, when the response is over — whatever path got it there
  // (201, 400, 413, 503, a handler exception, or a client that hung up mid-upload). If the body
  // was parsed and handed to the route handler, the response being over is not enough: a client
  // that hangs up after a complete upload closes `res` while its parsed note still waits on
  // Postgres (review cf1). Then the charge also waits for the handler to call
  // res.locals.releaseBody (in its finally), i.e. until nothing references the body any more.
  let charged = 0;
  let open = true;
  let bodyInUse = false;
  const release = () => {
    if (open || bodyInUse) return;
    inflightBodyBytes -= charged;
    charged = 0;
  };
  const responseOver = () => {
    open = false;
    release();
  };
  res.once("finish", responseOver);
  res.once("close", responseOver);

  const chunks = [];
  let settled = false;
  const settle = (err) => {
    if (settled) return;
    settled = true;
    if (!err) {
      let body;
      try {
        const text = decoder.decode(Buffer.concat(chunks, charged));
        chunks.length = 0;
        body = parseStrictJson(text);
      } catch {
        return next(bodyError(400, "entity.parse.failed", "request body must be valid JSON"));
      }
      req.body = body;
      bodyInUse = true;
      res.locals.releaseBody = () => {
        bodyInUse = false;
        release();
      };
      return next();
    }
    // Stop inflating, drop what was buffered, and read off the rest of the upload before
    // answering so the client actually receives the error (as body-parser did).
    chunks.length = 0;
    if (source !== req) {
      req.unpipe(source);
      source.destroy();
    }
    if (req.readableEnded || req.destroyed) return next(err);
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      next(err);
    };
    req.once("end", answer);
    req.once("close", answer);
    req.resume();
  };

  source.on("data", (chunk) => {
    if (settled) return;
    if (!open) return settle(bodyError(400, "request.aborted", "request aborted"));
    if (charged + chunk.length > MAX_BODY_BYTES) {
      return settle(bodyError(413, "entity.too.large", "request entity too large"));
    }
    if (inflightBodyBytes + chunk.length > MAX_INFLIGHT_BODY_BYTES) {
      return settle(bodyError(503, "entity.overloaded", "too many request body bytes in flight"));
    }
    inflightBodyBytes += chunk.length;
    charged += chunk.length;
    chunks.push(chunk);
  });
  source.once("end", () => settle());
  source.on("error", () => settle(bodyError(400, "entity.decode.failed", "invalid request body")));
  if (source !== req) req.on("error", () => settle(bodyError(400, "request.aborted", "request aborted")));
  req.once("close", () => {
    if (!req.complete) settle(bodyError(400, "request.aborted", "request aborted"));
  });
}

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

// One note as GET /notes lists it: the same four fields and created_at format POST /notes returns.
const toNoteJson = (note) => ({
  id: note.id,
  title: note.title,
  body: note.body,
  created_at: note.created_at instanceof Date ? note.created_at.toISOString() : note.created_at,
});

export function createNotesRouter(service) {
  const router = express.Router();

  // GET /notes?limit=&offset= (spec 002): 200 {items,total}, newest first.
  router.get("/", async (req, res) => {
    try {
      const { items, total } = await service.listNotes(req.query);
      res.status(200).json({ items: items.map(toNoteJson), total });
    } catch (err) {
      if (err instanceof NotesError && STATUS_BY_CODE[err.code]) {
        return sendError(res, STATUS_BY_CODE[err.code], err.code, err.message);
      }
      console.error("GET /notes failed: " + (err?.stack || err));
      return sendError(res, 500, "internal_error", "internal error");
    }
  });

  // The body is parsed as JSON whatever the Content-Type says: spec 001's curl one-liner
  // (`curl -d '{...}'`) labels its JSON application/x-www-form-urlencoded. Anything that is not
  // JSON is then a parse error → 400 below, never an undefined body → 500 (dissent d12).
  // Size: spec 001 Assumptions say notes need no product-level length limit, so body-parser's
  // implicit 100kb default (which rejected a pasted incident log, review cf4) is lifted. But the
  // parser must still stop buffering somewhere: gzip/deflate bodies are inflated, and the limit is
  // counted on INFLATED bytes. With no finite limit a ~600 KB gzip request inflates past V8's
  // maximum string length, raw-body throws a RangeError inside a stream handler, and the whole
  // process exits — /healthz and /version with it (review cf1/qa1). A request past this bound is
  // answered 413 below; the process keeps serving. Across requests, inflated bytes in flight are
  // bounded by MAX_INFLIGHT_BODY_BYTES (#87): past it the request is answered 503 overloaded.
  router.post("/", readJsonBody, async (req, res) => {
    try {
      const note = await service.createNote(req.body ?? {});
      res.status(201).json({
        id: note.id,
        title: note.title,
        body: note.body,
        created_at: note.created_at instanceof Date ? note.created_at.toISOString() : note.created_at,
      });
    } catch (err) {
      if (err instanceof NotesError && STATUS_BY_CODE[err.code]) {
        // The message is ours, never the driver's or the request's: the 503 must not echo input.
        return sendError(res, STATUS_BY_CODE[err.code], err.code, err.message);
      }
      console.error("POST /notes failed: " + (err?.stack || err));
      return sendError(res, 500, "internal_error", "internal error");
    } finally {
      // The parsed body is no longer needed: its in-flight charge may go once the response is
      // over too (readJsonBody). Without this a client that hung up would keep the charge forever.
      res.locals.releaseBody?.();
    }
  });

  // Body-parser failures (malformed JSON, bad charset/encoding) reach here with a 4xx
  // status. Answer in the API's format instead of Express's HTML error page.
  router.use((err, _req, res, next) => {
    if (err?.type === "entity.overloaded") {
      // Like db_unavailable a "try again later" 503, but a distinct code: the database is fine,
      // this process is holding too many request bodies. The message never echoes the request.
      res.set("Retry-After", String(OVERLOADED_RETRY_AFTER_SECONDS));
      return sendError(res, 503, "overloaded", "the server is busy, try again later");
    }
    if (err?.type === "entity.too.large") {
      return sendError(res, 413, "payload_too_large", "request body exceeds " + MAX_BODY_BYTES + " bytes");
    }
    if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      const message = err.type === "entity.parse.failed" ? "request body must be valid JSON" : "invalid request body";
      return sendError(res, err.status, "invalid_request", message);
    }
    return next(err);
  });

  return router;
}
