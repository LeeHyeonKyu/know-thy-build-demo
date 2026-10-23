<!-- factory-lessons:v1 role=reviewer-correctness max=12 -->
# Lessons — reviewer-correctness

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-27-01] diff가 DB·드라이버 오류를 HTTP 상태(503 db_unavailable / 500 internal_error)로 나누는 분류기를 추가하거나 고치면, 분류기가 실제로 보는 판별자(`typeof err.code === "string"`, 정규식, SQLSTATE 목록)와 pool 설정(connectionTimeoutMillis·query_timeout·statement_timeout 유무)을 읽고 여섯 경우가 각각 어느 분기로 가는지 표로 적는다: 연결 거부, 인증 실패(28P01/28000), 없는 DB(3D000), `c…
  근거: runs/2.md, runs/76.md. 인용: 0회.
