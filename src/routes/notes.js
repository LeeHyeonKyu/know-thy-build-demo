// 요청 파싱·상태코드. 노트 규칙은 service가, SQL은 repo가 안다(docs/TECHNICAL.md §Architecture).
import { Router } from "express";
import { createNote } from "../service/notes.js";

// pg의 timestamptz는 Date로 온다. 응답 계약은 ISO-8601 UTC 문자열 하나다.
function toIsoString(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function createNotesRouter({ db, now }) {
  const router = Router();

  router.post("/notes", async (req, res, next) => {
    try {
      // 규칙도 SQL도 아래층이 안다. 이 층이 하는 일은 body를 넘기고 행을 응답 모양으로 바꾸는 것뿐이다.
      const row = await createNote({ db, now }, req.body);
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
