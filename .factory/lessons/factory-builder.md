<!-- factory-lessons:v1 role=factory-builder max=12 -->
# Lessons — factory-builder

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-21-01] HTTP 응답 본문을 단언하는 새 테스트를 쓸 때 `expect(body).toEqual({...})`로 **키 집합 전체**를 닫지 않는다 — 확인법: 새 테스트에서 응답 객체 전체를 받는 `toEqual`이 몇 군데인지 세고, '이 응답에 다른 필드가 없다'가 done_when·스펙 문장에 실제로 있는지 대조한다. 없으면 `toMatchObject`나 개별 키 단언으로 쓰고, 폐쇄가 진짜 요구면 그 단언을 전용 테스트 **한 개**에만 둔다. `.factory/harness.toml:88`(tests_are_load_beari…
  근거: runs/39.md, runs/45.md. 인용: 0회.
- [L-2026-09-27-01] 요청 경로에 자원 상한(body 바이트 cap, 프로세스 단위 in-flight 예산, pool 슬롯, 연결·쿼리 타임아웃)을 넣거나 고칠 때는 핸드오프 전에 새 테스트 목록을 열고, 그 상한을 지키는 테스트가 세 가지 도착 패턴을 다루는지 센다: (a) 상한이 수용하는 수(`fits`)보다 많은 동시 요청을 끼워 넣어 보낸다, (b) 업로드를 끝낸 뒤 응답 전에 연결을 끊는다, (c) 업로드 도중 소켓을 연 채로 멈춘다. 단일 요청이나 정확히 `fits`개만 보내는 테스트뿐이면 프로세스 단위 상한은 아직 증명되지 않았다. 빠진 …
  근거: runs/76.md, runs/87.md. 인용: 0회.
