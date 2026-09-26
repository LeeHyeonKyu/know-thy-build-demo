# know-thy-build-demo — Notes API

작은 팀이 HTTP로 메모를 남기고 되찾는 최소 노트 API. Node 22 + Express 5 + PostgreSQL 16.

## 먼저 읽을 것
- `docs/PROJECT.md` — 무엇을, 누구를 위해 (Feature Registry 포함)
- `docs/TECHNICAL.md` — 스택·아키텍처·Testing Strategy·TDR
- `docs/QA.md` — 결정성 규칙, fixture 정책, 테스트 네이밍(`test_{issue}_{slug}`), 증거 규칙
- `docs/features/NNN-*.md` — 기능별 스펙과 done_when
- `.factory/harness.toml` — 게이트 명령·성숙도(M1)·보호 경로. **손으로 고치지 않는다**(`factory:harness` 이슈 + 사람 머지)

## 명령
| | |
|---|---|
| 설치 | `npm ci` |
| 실행 | `npm start` (기본 3000 포트) |
| 단위+통합 테스트 | `npx vitest run` (통합은 `docker compose -f docker-compose.test.yml up -d` 필요) |
| e2e | `npm run e2e` (M2 승격 전까지 게이트 밖) |
| 하네스 점검 | `npx know-thy-build factory doctor` |

## 규칙
- 린터는 없다. `[commands].lint`는 자리를 지키는 no-op이다.
- 기존 테스트는 load-bearing이다 — 고치지 말고 추가한다.
- 테스트에 `sleep`·고정 대기 금지. 조건 대기만 (`docs/QA.md`).
- 저장소는 PostgreSQL이다 (SQLite 아님 — `docs/TECHNICAL.md` TDR-1).
