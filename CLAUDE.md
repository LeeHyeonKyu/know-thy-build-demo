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
| 설치 | `npm ci` (하네스 테스트가 import하는 factory 런타임의 의존 `smol-toml`도 devDependency로 함께 설치된다 — `.factory/node_modules` 불필요) |
| 실행 | `npm start` (기본 3000 포트) |
| 단위+통합 테스트 | `npx vitest run` (통합은 `docker compose -f docker-compose.test.yml up -d` 필요) |
| e2e | `npx playwright test` — full·deep 게이트(#15, M2). 앱이 떠 있으면 재사용하고 없으면 띄운다. 브라우저가 없으면 브라우저 케이스는 선택에서 빠진다 |
| 하네스 점검 | `npx know-thy-build factory doctor` |

## 규칙
- 린터는 없다. `[commands].lint`는 `src/`·`test/`·`test/integration/`의 `node --check` 구문 검사다.
- 기존 테스트는 load-bearing이다 — 고치지 말고 추가한다.
- 테스트에 `sleep`·고정 대기 금지. 조건 대기만 (`docs/QA.md`).
- 저장소는 PostgreSQL이다 (SQLite 아님 — `docs/TECHNICAL.md` TDR-1).
