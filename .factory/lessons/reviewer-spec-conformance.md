<!-- factory-lessons:v1 role=reviewer-spec-conformance max=12 -->
# Lessons — reviewer-spec-conformance

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-20-01] diff가 문서(`docs/**`·`README.md`)에 저장소의 사실을 단언하는 문장을 새로 넣었으면(파일 경로, 읽는 환경변수, 배선 지점, 증거 로그 경로) 그 식별자를 리뷰 대상 커밋에서 `rg`/`ls`로 직접 센다 — 코드·fs 히트가 0이면 같은 커밋 안에서 문서가 거짓이 된 것이므로 reject다
  근거: runs/2.md, runs/18.md. 인용: 3회.
