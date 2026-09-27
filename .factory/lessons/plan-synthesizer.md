<!-- factory-lessons:v1 role=plan-synthesizer max=12 -->
# Lessons — plan-synthesizer

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-20-01] dissent_log의 반박이 '이 done_when은 지금 이 저장소에서 만들 수 없다'를 설정 파일 인용과 함께 주장하면(ci-settings의 deny, 미설치 의존성, `harness.maturity` 상한, CI에서 한 번도 실행된 적 없는 명령) 그 항목을 done_when에 남긴 채 resolution만 'unresolved — proceeding'으로 적지 않는다 — 해당 항목을 `open_risks`/`non_goals`로 내리거나 사람이 머지하는 선행 조건으로 올린다
  근거: runs/2.md, runs/15.md. 인용: 0회.
- [L-2026-09-27-01] dissent_log가 기존 테스트의 위치(`test/**:줄`)를 들어 '이 계획의 동작이 그 테스트를 RED로 만든다'고 주장하면(`tests_are_load_bearing = true`), 그 반박을 'unresolved — proceeding'으로 넘기지 않는다. 인용된 테스트 id를 하나씩 plan에 옮겨 적고, 각각을 둘 중 한 곳에 둔다. 하나는 '수정 없이 통과한다'고 명시한 done_when이고, 이때 설계가 그 테스트를 초록으로 유지해야 한다. 다른 하나는 테스트 변경을 사람이 머지하는 선행 조건으로 올린 ope…
  근거: runs/45.md, runs/7.md. 인용: 0회.
- [L-2026-09-27-02] done_when이 스펙(`docs/features/NNN-*.md`)의 Acceptance Criteria 항목을 덮으면, 그 AC에 적힌 `level`과 done_when의 `level`을 나란히 적어 비교한다. done_when이 더 낮으면 dissent_log나 open_risks에 낮춘 이유를 반드시 남긴다. 이유는 maturity 상한, 가짜 타이머가 자식 프로세스에 닿지 않음 같은 구체적인 사실이어야 한다. 이유가 없으면 원래 level로 되돌린다. 조용한 강등은 spec-conformance가 reject하므로 re…
  근거: runs/2.md, runs/7.md. 인용: 0회.
