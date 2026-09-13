# know-thy-build-demo — Notes API

작은 팀이 HTTP로 메모를 남기고 되찾는 최소 노트 API. Node 22 + Express 5 + PostgreSQL 16.

## 먼저 읽을 것
- `docs/PROJECT.md` — 무엇을, 누구를 위해 (Feature Registry 포함)
- `docs/TECHNICAL.md` — 스택·아키텍처·Testing Strategy·TDR
- `docs/QA.md` — 결정성 규칙, fixture 정책, 테스트 네이밍(`test_{issue}_{slug}`), 증거 규칙
- `docs/features/NNN-*.md` — 기능별 스펙과 done_when
- `.factory/harness.toml` — 게이트 명령·성숙도(M2)·보호 경로. **손으로 고치지 않는다**(`factory:harness` 이슈 + 사람 머지)

## 명령
| | |
|---|---|
| 설치 | `npm ci` |
| 실행 | `npm start` (기본 3000 포트) |
| 단위+통합 테스트 | `npx vitest run` (통합은 `docker compose -f docker-compose.test.yml up -d` 필요) |
| e2e | `npm run e2e` — **required 게이트다**(M2, #15). 러너가 `node src/app.js`를 띄운다. 포트는 `PORT`(기본 3000) |
| e2e를 이미 떠 있는 서버에 | `PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3000 npm run e2e` — 이 모드에서는 러너가 앱을 띄우지 않는다 |
| 하네스 점검 | `npx know-thy-build factory doctor` (`--no-run`을 붙이면 `[commands]`를 실제로 돌리지 않는다 — e2e 기동 비용을 건너뛴다) |

## 규칙
- 린터는 없다. `[commands].lint`는 자리를 지키는 no-op이다.
- 기존 테스트는 load-bearing이다 — 고치지 말고 추가한다.
- 테스트에 `sleep`·고정 대기 금지. 조건 대기만 (`docs/QA.md`).
- e2e 레인은 크로미움 없이도 초록이어야 한다 — CI 셋업이 브라우저를 내려받지 않는다. `page` 픽스처가
  필요한 케이스는 브라우저 신호가 없을 때만 `playwright.config.js`가 레인에서 뺀다(스펙 파일은 안 고친다).
  그 신호의 이름은 `E2E_BROWSER_AVAILABLE` 하나다 — 주지 않으면 크로미움 바이너리 존재에서 파생하고,
  `E2E_BROWSER_AVAILABLE=1 npm run e2e`로 브라우저 케이스까지 강제로 돌릴 수 있다(docs/QA.md).
- 저장소는 PostgreSQL이다 (SQLite 아님 — `docs/TECHNICAL.md` TDR-1).
