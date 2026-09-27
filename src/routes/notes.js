import express from "express";
import { NotesError } from "../service/notes.js";

// Routes: request parsing, status codes, and the `{"error":{"code","message"}}` format
// (CHARTER Preserve: clients branch on `code`).

const STATUS_BY_CODE = { invalid_request: 400, db_unavailable: 503 };

// Upper bound on a POST /notes body after decompression. Far above any note a person pastes
// (the cf4 case is ~1.6 MB) and far below V8's ~512 MiB string maximum.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function createNotesRouter(service) {
  const router = express.Router();

  // The body is parsed as JSON whatever the Content-Type says: spec 001's curl one-liner
  // (`curl -d '{...}'`) labels its JSON application/x-www-form-urlencoded. Anything that is not
  // JSON is then a parse error → 400 below, never an undefined body → 500 (dissent d12).
  // Size: spec 001 Assumptions say notes need no product-level length limit, so body-parser's
  // implicit 100kb default (which rejected a pasted incident log, review cf4) is lifted. But the
  // parser must still stop buffering somewhere: gzip/deflate bodies are inflated, and the limit is
  // counted on INFLATED bytes. With no finite limit a ~600 KB gzip request inflates past V8's
  // maximum string length, raw-body throws a RangeError inside a stream handler, and the whole
  // process exits — /healthz and /version with it (review cf1/qa1). A request past this bound is
  // answered 413 below; the process keeps serving.
  router.post("/", express.json({ type: () => true, limit: MAX_BODY_BYTES }), async (req, res) => {
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
    }
  });

  // Body-parser failures (malformed JSON, bad charset/encoding) reach here with a 4xx
  // status. Answer in the API's format instead of Express's HTML error page.
  router.use((err, _req, res, next) => {
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
