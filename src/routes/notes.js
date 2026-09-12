// 요청 파싱·상태코드. 노트 규칙은 service가, SQL은 repo가 안다(docs/TECHNICAL.md §Architecture).
import { Router } from "express";
import { validateNewNote } from "../service/notes.js";
import { insertNote } from "../repo/notes.js";

// pg의 timestamptz는 Date로 온다. 응답 계약은 ISO-8601 UTC 문자열 하나다.
function toIsoString(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function createNotesRouter({ db, now }) {
  const router = Router();

  router.post("/notes", async (req, res, next) => {
    try {
      const note = validateNewNote(req.body);
      // 시각의 출처는 앱이다 — DDL의 default now()가 아니라 주입된 시계가 만든다.
      const row = await insertNote(db, { ...note, createdAt: now() });
      res.status(201).json({
        id: row.id,
        title: row.title,
        body: row.body,
        created_at: toIsoString(row.created_at),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
