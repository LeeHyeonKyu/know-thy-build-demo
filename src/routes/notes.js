import express from "express";
import { NotesError } from "../service/notes.js";

// Routes: request parsing, status codes, and the `{"error":{"code","message"}}` format
// (CHARTER Preserve: clients branch on `code`).

const STATUS_BY_CODE = { invalid_request: 400, db_unavailable: 503 };

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

export function createNotesRouter(service) {
  const router = express.Router();

  // The body is parsed as JSON whatever the Content-Type says: spec 001's curl one-liner
  // (`curl -d '{...}'`) labels its JSON application/x-www-form-urlencoded. Anything that is not
  // JSON is then a parse error → 400 below, never an undefined body → 500 (dissent d12).
  // No size cap: spec 001 Assumptions say notes have no length limit, and a limit with 413 is a
  // separate issue (plan non_goals). body-parser would otherwise impose an implicit 100kb default
  // and reject a pasted incident log with 413 (review cf4). `Infinity` disables that check.
  router.post("/", express.json({ type: () => true, limit: Infinity }), async (req, res) => {
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
    if (err && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      const message = err.type === "entity.parse.failed" ? "request body must be valid JSON" : "invalid request body";
      return sendError(res, err.status, "invalid_request", message);
    }
    return next(err);
  });

  return router;
}
