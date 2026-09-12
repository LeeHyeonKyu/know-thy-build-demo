---
status: active
generatedBy: know-thy-build-qa
date: 2026-09-12
---

# QA

<!-- 이 프로젝트가 어떻게 테스트하는지의 단일 출처: 환경, 결정성 규칙, fixture, 네이밍, 증거.
     feature별 테스트 케이스는 factory의 reviewer-qa / factory-verifier가 리뷰 때 만든다. -->

## Determinism Rules (§5.2.5-①)

| Rule | This project |
|---|---|
| Fake timers | `vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") })` — `created_at`을 단언하는 테스트는 반드시 고정. `afterEach(() => vi.useRealTimers())` |
| Random seed | 랜덤을 쓰는 테스트는 `faker.seed(20260912)` 또는 고정 배열. `Math.random` 직접 호출 금지 |
| Network blocking | 테스트 프로세스는 외부 네트워크 금지. 허용되는 소켓은 `127.0.0.1`(컴포즈 Postgres, 앱 기동)뿐. 외부 HTTP가 필요하면 fake 서버를 `[test.fakes]`에 등록하고 쓴다 |
| DB isolation | integration은 케이스마다 `BEGIN` → 단언 → `ROLLBACK`. 공유 테이블에 남기지 않는다. 병렬 실행 시에도 서로의 행을 보지 않아야 한다 |
| Order randomization | `npx vitest run --sequence.shuffle` 로도 GREEN이어야 한다 — 순서 의존은 태어날 때 드러낸다 |
| No `sleep` | `setTimeout`/`sleep`으로 기다리지 않는다. 조건 대기(`vi.waitFor`, `expect.poll`, compose healthcheck)만 사용. 리뷰에서 `sleep(`·`setTimeout(.*done` 패턴은 reject 사유 |

**`.factory/harness.toml` test sections:** `[test]`/`[test.env]`가 채워져 있다 — 실제 값은 그 파일이 출처이고, 이 표는 *왜* 그렇게 설정했는지를 설명한다.

**Smoke suite (maturity M1):** `test/smoke.test.js`(unit), `test/integration/db.test.js`(integration) — `npx know-thy-build factory doctor`가 GREEN으로 확인한다.

## Fixture Policy

- fixture는 **factory 함수**로 만든다: `test/fixtures/notes.js`의 `makeNote(overrides)` — 리터럴 객체를 테스트마다 복사하지 않는다.
- 기본값은 유효한 최소 노트(`title`, `body`)이고, 케이스가 관심 있는 필드만 `overrides`로 덮는다. 단언은 **덮은 필드에만** 건다.
- 공유 가변 상태 금지: fixture는 매 호출 새 객체를 반환한다. 모듈 최상단 `const note = {...}` 재사용 금지.
- DB fixture는 시드 SQL이 아니라 repository를 통해 넣는다 — 스키마 변경이 fixture를 자동으로 따라오게.
- 파일은 `test/fixtures/**`에 두고 `test_glob`(`test/**/*.test.js`)에 걸리지 않게 `.test.js` 접미사를 쓰지 않는다.

## Naming

- 테스트 이름은 `test_{issue}_{slug}` — 예: `test_12_create_note_rejects_empty_title`.
- `{issue}`는 GitHub 이슈 번호, `{slug}`는 done_when 항목을 소문자 snake로 줄인 것.
- 회귀 가드도 같은 규칙을 따른다 — 나중에 이슈 번호로 "이 테스트가 왜 있는지"를 되짚을 수 있어야 한다.
- 파일 위치: unit은 `test/*.test.js`, integration은 `test/integration/*.test.js`. e2e는 `e2e/*.spec.js`(M2 승격 전까지 게이트 밖).
- e2e 스펙은 `request` 픽스처만 쓴다 — `page`/`browser`/`context`는 금지다(#15, 브라우저 바이너리를 설치하는 CI 스텝이 없다).
  `e2e/**`는 `test_glob` 밖이라 prove-test가 그 스펙의 RED를 증명해 주지 않는다. 새 e2e 단언을 넣을 때는 고의로 깨뜨린
  응답을 상대로 한 번 돌려 실패를 확인하고 그 출력을 `.factory/out/qa/`에 남긴다(아래 Evidence).

## Evidence

- **증거 없는 재현은 일어나지 않은 재현이다.** reviewer-qa는 판정 근거를 `.factory/out/qa/**`에 남긴다(`[evidence].qa_artifacts`).
- 최소 증거: 실행한 명령, 원시 응답(HTTP 상태 + body), 실패 시 스택. API 프로젝트이므로 스크린샷 대신 `curl`/`fetch` 요청·응답 쌍을 파일로 남긴다.
- 파일명은 `qa-{issue}-{slug}.{log,json}`. 요약만 적고 원시 출력을 버리지 않는다.
- unit/integration 게이트의 기계 판정 근거는 `.factory/out/unit.json`(vitest json 리포터)이다 — 사람이 다시 돌려볼 수 있어야 한다.
- 통과 주장에는 항상 명령과 종료 코드를 붙인다. "테스트 통과함"만 적힌 리뷰는 spec-conformance가 reject한다.

## What is NOT automatable (manual checklist)

- [ ] 에러 메시지가 사람이 읽을 만한지(문구 품질) — 사람이 읽고 판단
- [ ] curl 스니펫이 팀 채널에 붙였을 때 그대로 동작하는지 — 릴리스 때 1회 수동 확인
