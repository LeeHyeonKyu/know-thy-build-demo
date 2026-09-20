<!-- factory-lessons:v1 role=reviewer-qa max=12 -->
# Lessons — reviewer-qa

Read this file as a checklist before you start. Entries are appended by the retro job only
(`- [L-YYYY-MM-DD-NN] <check sentence> — 근거: <run links>`); integrity rejects other edits.
- [L-2026-09-20-01] 진입·설치 경로를 건드리는 diff(진입점 부팅, 새 의존성, 테스트가 import하는 런타임)에서는 스테이지에 이미 깔린 환경이 아니라 저장소가 문서로 선언한 명령만으로(`npm ci` → `npm start` / `[commands].unit` 문자열 그대로) 깨끗한 체크아웃에서 done_when을 재현한다 — 게이트가 GREEN인데 이 경로가 실패하면 그 자체가 must_fix다
  근거: runs/2.md, runs/15.md. 인용: 0회.
- [L-2026-09-20-02] 새 테스트·가드의 이름이 done_when의 약속을 담고 있으면(`..._exhaustive`, `..._serves_notes_...`) 이름이 아니라 단언 집합을 읽고 '약속이 깨진 상태'와 '지켜진 상태'를 구분할 수 있는지 본다 — 구분하지 못하면 `/tmp` 워크트리에 최소 반례 하나를 주입해 RED가 되는지 확인하고, 초록이면 must_fix다
  근거: runs/2.md, runs/18.md. 인용: 0회.
