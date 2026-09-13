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

**Smoke suite (maturity M2):** `test/smoke.test.js`(unit), `test/integration/db.test.js`(integration) — `npx know-thy-build factory doctor`가 GREEN으로 확인한다. doctor는 `[commands]`를 **전부 실행**하므로 M2부터 점검 한 번에 e2e 기동이 얹힌다 — 기동 없이 설정만 보려면 `factory doctor --no-run`.

**e2e 레인(M2, #15)이 무엇을 돌리고 무엇을 돌리지 않는가:**

- 게이트 명령은 `[commands].e2e`(`npx playwright test`) 하나이고 판정 근거는 **종료 코드**다. 브라우저를 내려받지 않는다(위 Network blocking 규칙).
- 그래서 크로미움 바이너리가 없는 머신에서는 `page` 픽스처를 쓰는 케이스(`e2e/smoke.spec.js`의 `browser loads`)가 레인에서 **빠진다** — 스펙 파일에서 지우는 것이 아니라 `playwright.config.js`가 고른다. 바이너리가 있으면 전부 돈다. 새 e2e 케이스에 `page`가 필요하면 그 이름을 설정의 `BROWSER_FIXTURE_CASES`에 더하거나, 브라우저를 설치하는 셋업을 먼저 만든다(`factory:harness` 이슈).
- **그 분기의 입력은 이름이 하나다: `E2E_BROWSER_AVAILABLE`**(`playwright.config.js`의 `BROWSER_SIGNAL_ENV`). 값을 주면 그것이 이기고(`1/true/yes/on` = 사용 가능, 그 밖 = 불가), 주지 않으면 크로미움 바이너리의 실제 존재에서 파생한다. 환경 조건부로 테스트를 고르는 것은 위 결정성 표의 예외이므로 여기 적어 둔다 — **양방향이 관측되지 않는 분기는 금지다**: `test/playwright_config.test.js`가 신호 on/off 두 경우의 선택 집합을 모두 고정한다(무조건 `testIgnore`/`grepInvert`는 그 테스트를 빨갛게 만든다).
- **게이트 판정을 보는 테스트는 `.factory/lib/**`를 직접 부른다**(`test/harness_gates.test.js` 등) — 설정 텍스트를 베낀 단언은 설정이 틀려도 초록이기 때문이다. 그래서 그 런타임의 의존(`smol-toml`)이 이 저장소의 `devDependencies`에 `.factory/package.json`과 **같은 핀으로** 선언돼 있다: `npm ci` 하나로 이 테스트들이 돈다(`.factory/node_modules`를 따로 만들 필요 없음). 핀이 갈라지거나 선언이 사라지면 `test_15_factory_lib_deps_install_with_npm_ci`가 빨개진다.
- 앱을 띄우는 주인은 실행 경로마다 하나다: 기본 모드는 `playwright.config.js`의 `webServer`(`PORT`, 기본 3000), 외부 타깃 모드는 `PLAYWRIGHT_TEST_BASE_URL`(이때 `webServer` 설정은 아예 없다). `[test.env].app_start`/`app_ready`는 켜지 않는다.

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
- 파일 위치: unit은 `test/*.test.js`, integration은 `test/integration/*.test.js`. e2e는 `e2e/*.spec.js`(M2부터 required 게이트, #15).
- **e2e 단언은 증명을 따로 붙인다(#15).** `e2e/**`는 `test_glob`(`test/**/*.test.js`) 밖이라 prove-test가 그 스펙의 RED를
  증명해 주지 않는다 — 새 e2e 단언은 `test/integration/e2e_suite.test.js`처럼 **스펙을 실제로 돌려 양성/음성을 대조하는
  테스트**를 `test/` 아래에 함께 두고, 그 테스트가 base에서 빨간 것을 확인한 뒤 출력을 `.factory/out/qa/`에 남긴다(아래 Evidence).
  종료 코드만 보는 단언은 금지다: "0개 실행 후 exit 0"과 "계약을 지켜서 exit 0"이 구별되지 않는다.

## Evidence

- **증거 없는 재현은 일어나지 않은 재현이다.** reviewer-qa는 판정 근거를 `.factory/out/qa/**`에 남긴다(`[evidence].qa_artifacts`).
- 최소 증거: 실행한 명령, 원시 응답(HTTP 상태 + body), 실패 시 스택. API 프로젝트이므로 스크린샷 대신 `curl`/`fetch` 요청·응답 쌍을 파일로 남긴다.
- 파일명은 `qa-{issue}-{slug}.{log,json}`. 요약만 적고 원시 출력을 버리지 않는다.
- unit/integration 게이트의 기계 판정 근거는 `.factory/out/unit.json`(vitest json 리포터)이다 — 사람이 다시 돌려볼 수 있어야 한다.
- 통과 주장에는 항상 명령과 종료 코드를 붙인다. "테스트 통과함"만 적힌 리뷰는 spec-conformance가 reject한다.
- **`.factory/out/**`은 `.gitignore`에 있다 — 거기 쓴 증거는 다음 체크아웃에 존재하지 않는다.** 머지 판단에 필요한
  증거(게이트 명령의 원시 출력·종료 코드)는 같은 내용을 **PR 코멘트로도** 남긴다. #15의 webServer 모드
  (`node src/app.js` 실 기동) 양성/음성 대조 로그가 그 예다 — 그 경로는 M1 상한 때문에 어떤 done_when도
  CI에서 초록으로 관측할 수 없어, 사람 머지 전에 로그가 유일한 관측이다.

## What is NOT automatable (manual checklist)

- [ ] 에러 메시지가 사람이 읽을 만한지(문구 품질) — 사람이 읽고 판단
- [ ] curl 스니펫이 팀 채널에 붙였을 때 그대로 동작하는지 — 릴리스 때 1회 수동 확인
