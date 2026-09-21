<!-- factory-lessons:v1 role=factory-builder max=12 -->
# Lessons — factory-builder

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-21-01] HTTP 응답 본문을 단언하는 새 테스트를 쓸 때 `expect(body).toEqual({...})`로 **키 집합 전체**를 닫지 않는다 — 확인법: 새 테스트에서 응답 객체 전체를 받는 `toEqual`이 몇 군데인지 세고, '이 응답에 다른 필드가 없다'가 done_when·스펙 문장에 실제로 있는지 대조한다. 없으면 `toMatchObject`나 개별 키 단언으로 쓰고, 폐쇄가 진짜 요구면 그 단언을 전용 테스트 **한 개**에만 둔다. `.factory/harness.toml:88`(tests_are_load_beari…
  근거: runs/39.md, runs/45.md. 인용: 0회.
