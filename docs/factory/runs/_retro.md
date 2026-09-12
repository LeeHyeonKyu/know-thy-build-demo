# Retro State

- last retro: 2026-09-12T17:07:22.748Z
- merges since last retro: 0
- current N: 1

## History (last 5)

| at | yield | n_before | n_after | needs_human_since |
| --- | --- | --- | --- | --- |
| 2026-09-12T17:07:22.748Z | 1 | 1 | 1 | 3 |

## Stats

| metric | this window | cumulative |
| --- | --- | --- |
| merged | 0 | 1 |
| review rounds avg | 0 | 1 |
| needs-human | 3 | 3 |
| rejects by role | 없음 | 없음 |
| cost (usd) | 101.80 | 81.81 |
| tokens | input 1795037 / output 220659 | input 50 / output 128059 |
| retro cost (usd) | 0.00 | 0.72 |
| retro tokens | input 0 / output 0 | input 2 / output 2998 |
| full retros | — | 1 |

<!-- factory-retro-state:v1 -->
```json
{
  "cursor": {
    "last_retro_at": "2026-09-12T17:07:22.748Z",
    "last_record_offsets": {}
  },
  "merges_since": 0,
  "n": 1,
  "history": [
    {
      "at": "2026-09-12T17:07:22.748Z",
      "yield": 1,
      "needs_human_since": 3,
      "applied": [
        {
          "step": "role:plan-skeptic",
          "added": [],
          "deferred": [
            {
              "kind": "good",
              "text": "위치: #2 plan 합의안의 done_when dw2·dw5·dw6. 주장: `level`과 관측 대상이 서로 모순이다 — dw2·dw6은 'HTTP 응답이 503'이라는 라우트 표면 단언인데 level이 unit이고, dw5는 '같은 값이 저장된 행에서도 읽힌다'는 DB 조회인데 level이 unit이다. 지정된 레벨에서 증명할 수 없는 done_when은 구현자에게 두 개의 나쁜 선택만 남긴다: 레벨을 지키려고 text를 조용히 줄이거나, text를 지키려고 레벨을 어긴다 — 어느 쪽이든 done_when이 판정 기준이기를 멈춘다. 근거: #2의 dissent_log 항목 3건이 같은 결함을 dw2·dw5·dw6에서 각각 지목했고, `docs/factory/runs/2.md`의 implement 스테이지는 `FACTORY_GATES: ... failing=prove-test`로 RED였다(같은 이슈 기록, 인과는 기록으로 확정되지 않음). 요구: dw5는 'unit=직렬화 형식 / integration=응답과 저장된 행의 일치'로 쪼개고, HTTP 상태 코드를 단언하는 dw는 level=integration으로 올리거나 이번 범위 밖으로 보낸다.",
              "reason": "insufficient-evidence"
            },
            {
              "kind": "perspectives",
              "text": "**증명 레벨의 감사관**: 각 done_when의 `level`에서 그 text가 실제로 관측 가능한가 — unit 테스트는 HTTP 상태 코드도, 저장된 행도 볼 수 없다. 관측할 수 없는 레벨이 붙은 done_when은 구현자가 text를 줄이거나 레벨을 어기게 만든다.",
              "reason": "insufficient-evidence"
            }
          ]
        },
        {
          "step": "role:plan-architect",
          "added": [],
          "deferred": [
            {
              "kind": "good",
              "text": "위치: #2 plan의 `files_expected`와 dw2·dw3. 주장: '같은 테스트 트랜잭션 위에서 실행되는 생 SQL'을 요구하는 done_when은 제안된 파일 목록으로는 성립할 수 없다 — 앱 요청과 테스트가 같은 DB 커넥션을 공유하려면 pool에 주입 이음매가 있어야 하는데 `src/db/pool.js`가 `files_expected`에 없다. 검증 방법이 files_expected 밖의 파일을 고쳐야만 성립하는 계획은 implement에서 diff가 범위를 넘거나 done_when이 조용히 약해진다. 근거: #2의 architect dissent_log 항목, 그리고 이 창이 끝난 시점의 작업 트리에 `src/app.js` 하나만 있어(`src/db/pool.js` 없음) 해당 이음매가 존재하지 않음이 확인된다. 요구: 계획이 (a) pool 모듈이 테스트에서 단일 커넥션으로 바인딩되는 이음매를 갖는다, 또는 (b) 케이스마다 `TRUNCATE notes`로 정리한다 중 하나를 명시하고, 고를 경로를 `files_expected`에 넣는다.",
              "reason": "insufficient-evidence"
            }
          ]
        },
        {
          "step": "role:plan-operator",
          "added": [],
          "deferred": [
            {
              "kind": "good",
              "text": "위치: #2 plan의 `migrate()`/`rollback()`(`src/repo/schema.js`)과 그 검증 조건 '두 번 호출해도 실패하지 않는다'. 주장: 이 함수들을 프로덕션에서 **언제·누가** 호출하는지가 계획에도 `docs/TECHNICAL.md`의 Data Flow에도 없고, '두 번 호출해도 실패하지 않는다'는 순차 재실행에 대한 멱등성이지 동시 호출에 대한 안전성이 아니다 — migrate()가 부팅 경로에서 자동 호출되면 배포 창에서 두 프로세스가 동시에 DDL을 실행할 수 있다. 근거: #2의 operator dissent_log 항목이 호출 시점 부재를 지목했고, `docs/TECHNICAL.md`에 자동 호출 지점이 기록돼 있지 않다. 요구: 호출 주체와 시점(부팅 자동 / 수동 스크립트 / CI 단계)을 계획에 한 줄로 고정하고, 부팅 자동이면 done_when을 '동시 호출에서도 한쪽만 DDL을 적용한다'로 올린다 — 호출 시점이 비어 있으면 구현자가 즉흥으로 정한다.",
              "reason": "insufficient-evidence"
            }
          ]
        },
        {
          "step": "harness",
          "title": "harness: promote to M2 — HTTP route surface present (express/fastify/hono/koa/next dependency, or routes-style files) but harness maturity is M1 or below",
          "issue": 15
        }
      ],
      "n_before": 1,
      "n_after": 1
    }
  ],
  "candidates": {
    "lessons": [
      {
        "role": "correctness",
        "text": "출하되는 유일한 운영 경로(`npm start` = `node src/app.js`)는 `createApp()`을 **인자 없이** 부른다. `db`가 undefined라 `POST /notes`는 DB가 정상이어도 항상 500 `internal_error`로 끝나고 행을 만들지 않는다. 그런데 같은 diff가 추가한 docs/TECHNICAL.md:48은 \"`pg.Pool` 생성은 `src/app.js`의 진입점 가드 안에서만 일어난다\", :66은 \"진입점은 `process.env.DATABASE_URL`만 읽는다 … 설정이 틀리면 요청 시점에 503으로 드러난다\"고 사실로 단언한다. 저장소 전체에서 `DATABASE_URL`/`pg.Pool`은 문서 세 줄에만 있고 코드에는 0건이다(rg). 문서가 존재하지 않는 배선을 기술하므로, 이것을 읽고 배포하는 사람과 이 기본 배선을 전제할 002는 둘 다 틀린 사실 위에 선다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "architecture",
        "text": "이 diff가 TECHNICAL.md에 기록한 진입점 배선(`pg.Pool` 생성, `process.env.DATABASE_URL`, 요청 시점 503)이 코드에 존재하지 않는다. 같은 문서 :87은 정반대(`pg`는 설치돼 있지 않다)를 적는다 — 결정 기록이 한 커밋 안에서 서로 모순되고, 유일한 배포 경로(`npm start`)의 POST /notes는 영구히 500이다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "diff가 files_expected 밖의 새 파일을 사유 없이 추가했고, 그 파일이 dw8의 verify id를 다른(정당한) 파일과 중복 사용해 '어느 테스트가 dw8을 지키는가'를 판별 불가능하게 만든다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "files_expected인 docs/TECHNICAL.md가 이번 diff 자신이 추가한 문장으로 '진입점은 process.env.DATABASE_URL만 읽는다'와 'pg.Pool 생성은 src/app.js의 진입점 가드 안에서만 일어난다'고 약속하지만, 같은 diff의 src/app.js 진입점 가드는 그 약속을 이행하지 않는다 — DATABASE_URL을 전혀 읽지 않고 pg를 import하지도, Pool을 생성하지도 않는다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "Started the real, deployable app exactly the way a user would (`npm start` / `node src/app.js`, PORT=3100) and sent the exact request from the issue's own Scenario (`POST /notes {\"title\":\"pg pool leak\",\"body\":\"max=10 causes starvation\"}`). Every single request fails with 500 `{\"error\":{\"code\":\"internal_error\",\"message\":\"internal error\"}}` — the one feature this issue exists to ship (persist a note and get back `{id,title,body,created_at}`) does not work at all outside of tests. Root cause: the entry-point guard calls `createApp()` with **no `db`** (`createApp().listen(...)`), so `insertNote(undefined, …)` throws a TypeError before ever touching Postgres. There is no `pg.Pool` construction anywhere in `src/`, no read of `process.env.DATABASE_URL`, and `pg` is not even a dependency (`grep -rn \"pg\\.\\|DATABASE_URL\\|Pool(\" src/` → no hits; `pg` absent from package.json and package-lock.json). This directly contradicts the architecture this very diff documents in docs/TECHNICAL.md (added in commit ba00816): '`pg.Pool` 생성은 `src/app.js`의 진입점 가드 안에서만 일어난다' and '연결 설정: 진입점은 `process.env.DATABASE_URL`만 읽는다.' The plan's own non_goals text assumes the same ('주입 이음매를 쓰면 `pg.Pool` 생성은 `src/app.js` 진입점 가드 안 두 줄로 끝난다') and its open_risks explicitly flagged that no gate test exercises this path ('npm start가 실제로 타는 기본 배선... 게이트 안 어떤 테스트도 밟지 않는다') — that risk materialized as a total feature failure, not a theoretical gap. All 8 done_when items pass only because every integration test injects its own test-owned connection (a psql session or a fake executor) directly into `createApp({db})`, bypassing the real wiring entirely; not one test (unit, integration, or the pre-existing smoke test) ever calls `POST /notes` against the actual entry point.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "correctness",
        "text": "body-parser가 내는 4xx 클라이언트 오류 중 `entity.*`가 아닌 것(`encoding.unsupported`, `charset.unsupported` — 둘 다 status 415, expose=true)이 전부 마지막 fallback으로 떨어져 **500 internal_error**로 응답된다. 스펙 :63 '읽을 수 없는 body → 400, 500이 아니다'와 정면으로 어긋나고, 이 diff 자신이 dw6에서 세운 '클라이언트 잘못을 서버 장애로 보고하지 않는다'는 기준(repo/notes.js:32의 주석 '새벽 당직자가 DB를 30분 들여다보게 된다')도 같은 이유로 깨진다. express 기본 핸들러였다면 415였을 것이므로 이 분기가 상황을 더 나쁘게 만든다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "The issue's own Story 1 Acceptance Criteria — '서비스가 떠 있고 DB가 비어 있다' → `POST /notes` → 201 + persisted row — are explicitly tagged `level: full` in docs/features/001-create-note.md, meaning: the real running service against a real DB. The plan silently substitutes `level: integration` done_when (dw1, dw2, dw5) that only ever exercise a test-supplied `{query}` executor (a hand-rolled psql-session shell, per docs/TECHNICAL.md:89) injected directly into `createApp({db})` — none of them ever go through `createDbFromEnv`/`createAppFromEnv`, the only code path `node src/app.js` (= `npm start`) actually runs. Because `pg` is never installed in this diff — `package.json` and `package-lock.json` are both listed in `files_expected` but neither is touched by the diff — the real entrypoint's dynamic `import(\"pg\")` always throws and every `POST /notes` against the actually-deployed app falls back to `unavailableDb`, returning 503 forever, even with a real, reachable, empty Postgres. This is not a builder scope violation — the diff faithfully implements what the plan's done_when actually ask for — but the plan itself fails to deliver the issue's own Story 1, and that gap was not silent: the plan's dissent_log contains a signed, evidence-backed skeptic objection (final entry) stating verbatim that this makes '4 of 8 done_when unbuildable and unverifiable' and offering two concrete remedies — (1) drop package.json/package-lock.json from files_expected and record `pg` as a blocking precondition landed by a human-merged harness PR before implement starts, or (2) split the issue so this round ships only dw3/dw4/dw6/dw7 (all unit, zero new dependency) and defer dw1/dw2/dw5/dw8 to a follow-up gated on the harness PR. The plan's resolution is 'unresolved — proceeding,' adopting neither remedy, and open_risks item 4 explicitly predicted the exact consequence. That predicted failure has now been directly reproduced (see qa1 in this same round): a real, empty, reachable Postgres + `node src/app.js` + `POST /notes {title, body}` → 503 `db_unavailable`, not 201. The feature this issue exists to deliver — being able to actually create and persist a note through the shipped service — does not work, and no done_when in the plan would have caught that, by design.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "The shipped, real running application can never actually create a note. `pg` is not installed (not in package.json, not in package-lock.json, not in node_modules), so `createDbFromEnv()`'s dynamic `import(\"pg\")` always throws and every `POST /notes` against the real process falls back to `unavailableDb`, returning 503 forever — even when a real, reachable, empty Postgres is running. I reproduced the issue's own Story 1 scenario literally ('서비스가 떠 있고 DB가 비어 있다' → `POST /notes {title, body}` → expect 201) against the actual `node src/app.js` entrypoint with `docker-compose.test.yml`'s Postgres up and `DATABASE_URL` pointed at it, and got 503 `db_unavailable`, not 201. This directly falsifies done_when dw1 ('유효한 요청이 201과 영속된 id를 반환한다') and the feature's core Acceptance Criteria for the real, deployed system. The only place this passes is inside tests that either (a) inject a fake driver via `loadDriver`, or (b) bypass `pg`/`createDbFromEnv` entirely by handing a hand-rolled `psql`-session executor straight into `createApp({db})` (test/integration/helpers/db.js). No test anywhere exercises 'pg installed + createDbFromEnv + real reachable Postgres' together, because pg genuinely isn't installed. TECHNICAL.md:30 itself says `pg(001에서 추가 예정)` — 'pg is to be added in issue 001' — but this diff does not add it (package.json is protected), so issue #2 ships without the dependency its own architecture doc says it should add. The graceful-degradation engineering (dynamic import, 503-not-500, /healthz preserved) is well done, but it is degrading a capability that has never actually existed yet, not falling back from a real one.",
        "runs": [
          2
        ],
        "source": "must_fix"
      }
    ],
    "examples": [
      {
        "role": "skeptic",
        "kind": "good",
        "text": "dw5와 dw6은 level과 관측 대상이 모순이다. dw5의 text는 '같은 값이 저장된 행에서도 읽힌다'(DB 조회)인데 level이 unit이고, dw6은 'HTTP 응답이 503'인데 level이 unit이다. 둘 다 지정된 레벨에서 증명 불가능하므로, 구현자는 레벨을 지키려고 text를 조용히 줄이거나, text를 지키려고 레벨을 어긴다 — 어느 쪽이든 done_when이 판정 기준이기를 멈춘다. dw5는 'unit=직렬화 형식 / integration=응답과 행의 일치'로 쪼개고, dw6은 범위 밖으로 보내라.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "dw2는 (a) level이 unit인데 '라우트가 503을 반환한다'는 HTTP 표면 단언이고, (b) '에러가 console.error에 기록된다'는 스펙에 없는 로그 포맷을 게이트에 고정한다. 로그 문자열이 done_when이 되면 이후 어떤 로깅 개선도 테스트를 깨뜨린다(기존 테스트는 load-bearing이라 고칠 수 없다). 503 자체를 이번에 하려면 레벨은 integration이어야 하고, 로깅은 done_when이 아니라 open_risks로 남겨야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "pool 파일 경로가 세 역할 사이에서 갈린다(architect `src/repo/pool.js` vs product-advocate·operator `src/db/pool.js`). 계획이 하나를 고르지 않으면 구현 diff가 files_expected 밖으로 나가 리뷰에서 reject된다. 또한 architect의 files_expected 14개는 이슈 본문이 요구한 3개 done_when보다 넓다 — `docs/TECHNICAL.md`를 files_expected에 넣는 것은 §Data에 결정을 한 줄 기록하는 목적에 한정한다고 명시해야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "architect",
        "kind": "good",
        "text": "dw2·dw3이 요구하는 \"같은 테스트 트랜잭션 위에서 실행되는 생 SQL\"은 현재 제안된 파일 목록으로는 성립하지 않는다. 앱 요청과 테스트가 같은 DB 커넥션을 공유하려면 주입 이음매가 필요한데 files_expected에 `src/db/pool.js`가 없다. 계획은 (a) pool 모듈이 테스트에서 단일 커넥션으로 바인딩될 수 있는 이음매를 갖는다, 또는 (b) 케이스마다 `TRUNCATE notes`로 정리한다 중 하나를 명시하고 `src/db/pool.js`를 files_expected에 넣어야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "migrate()/rollback()을 src/repo/schema.js에 두고 '두 번 호출해도 실패하지 않음'으로 검증하면 마이그레이션 적용 경로가 충분히 안전하다 — 이 함수들이 프로덕션에서 언제·누가 호출하는지가 docs/TECHNICAL.md:45 Data Flow에도 architect의 입장문에도 없다. migrate()가 부팅 경로에서 자동 호출된다면 배포 창에서 두 프로세스가 동시에 DDL을 실행할 수 있고, '두 번 호출해도 실패하지 않는다'는 순차 재실행에 대한 멱등성이지 동시 호출에 대한 안전성이 아니다. 계획에 호출 시점이 없으면 구현자가 즉흥으로 정한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "우리는 2026-09-12에, CI에서 단 한 번도 실행된 적이 없고(.github/** grep 0건) 브라우저 프로비저닝 스텝도 없는(.factory/actions/setup/action.yml:10-37) `npm run e2e`를, 되돌리는 데 또 한 번의 사람 머지가 필요한 protected 파일(.factory/harness.toml:78-80)을 통해, 모든 standard tier PR의 차단 게이트로 승격시켰다 — 그리고 그 계약은 이미 test/smoke.test.js:81-103이 M1 게이트 안에서 지키고 있었다.",
        "runs": [
          15
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "이 이슈의 '왜'로 인용된 CHARTER:56의 근거 절반이 저장소에 존재하지 않는다. '컴포즈 healthcheck가 /healthz에 걸려 있다'는 사실이 아니다(docker-compose.test.yml:1-6 — 서비스는 db 하나, healthcheck는 pg_isready) — 따라서 '지금 HTTP 계약을 아무 게이트도 지키지 않는다'는 판결은 남은 근거(playwright webServer) 하나에만 기대고, 그 playwright는 바로 이 이슈가 게이트로 만들려는 대상이다(순환 논증).",
        "runs": [
          15
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "dw2가 제안한 `test/integration/e2e_suite.test.js`는 `[commands].unit`에 잡히므로, docs tier PR을 포함한 모든 PR이 playwright 전체 스위트를 돌게 된다 — skeptic 자신이 '런타임 예산 침식'으로 경고한 바로 그 비용을 dw2가 도입한다. 더구나 새 테스트는 `repeatNewTests`가 `new_test_repeats = 3`회 추가 실행하므로 implement 런 한 번에 e2e 스위트가 4회 이상 돈다.",
        "runs": [
          15
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "done_when 7개 + files_expected 14개는 이 이슈가 직전에 죽은 바로 그 모양이다. 이슈 본문과 스펙 :82-84가 통과시킨 draft는 3개이고, docs/factory/CHARTER.md:48은 '전항목이 verify 테스트로 증명됨', :52는 'diff가 files_expected 밖으로 나가지 않음'을 DoD로 못박는다 — done_when 하나가 테스트 파일 한 덩이다. 지난 회차는 9개로 시작해 테스트 0개짜리 diff를 남기고 RED가 됐다(runs/2.md:25-29, prove-test.js:11). 요구: dw1(201+영속), dw2(400+필드명+행 없음), dw3(service unit), dw4(파싱 불가 400 봉투), /healthz 하나 — 다섯을 넘지 않게 하고, 나머지는 같은 테스트 파일 안의 추가 단언으로 접거나 open_risks로 내린다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "dw8의 동시성 절반은 자기가 막겠다는 비결정성을 재현하지 않는다. 실제 경쟁은 vitest 워커 프로세스 두 개가 각자 migrate()를 부르는 것인데, dw8은 한 프로세스 안에서 커넥션 두 개를 Promise.all로 부른다 — 다른 기제다. 게다가 그 조건은 하네스가 이미 관측한다(.factory/harness.toml:47의 new_test_repeats=3, prove-test.js:38의 동시 전체 스위트 실행). 남는 것은 pg_advisory_xact_lock이라는 구현 디테일을 테스트가 복사하는 모양이고 docs/TECHNICAL.md:76은 'pg 드라이버'를 What NOT to Test로 분류한다. 축소안: test/integration/schema.test.js를 만들지 말고 information_schema 컬럼 집합 단언만 notes.create.test.js의 setup 경로에 남긴다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "dw6의 판별 기준 `code: \"ECONNREFUSED\"` 하나로 'DB 연결 실패'와 '프로그래밍 오류'를 가르는 것은 실제 운영에서 발생하는 DB 장애의 대부분을 놓친다 — 연결 거부만 503이고 타임아웃·풀 고갈·DNS 실패는 500(프로그래밍 오류 취급)으로 떨어진다. 판별자는 특정 에러 코드 하나가 아니라 연결류 에러 코드 집합(또는 pg 에러의 severity/객체 형태) 기준이어야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "migrate()를 부팅 경로에 넣지 않기로 하고 '운영에서 누가 언제 부르는지는 정하지 않는다'를 open risk로만 남긴 것은, 이 결정을 코드로 강제하지 않으면 나중에 누군가 '멱등이니 부팅 때 부르자'며 src/app.js에 migrate()를 붙이는 것을 막을 장치가 계획에 없다는 뜻이다. 그렇게 되면 GET /healthz가 DB 가용성에 묶여 CHARTER Preserve가 깨진다. architect의 dw6은 createApp()을 인자 없이 띄운 상태에서만 확인하므로, 이후 누군가 healthz 경로에 DB 체크나 migrate 호출을 끼워 넣어도 이 done_when은 여전히 통과한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "OBJECT — one item, and it is not wording: the plan's enabling assumption about `pg` is factually wrong against this repo's own implement-stage contract, which makes 4 of 8 done_when unbuildable and unverifiable.\n\nWHAT IS WRONG. `files_expected` contains `package.json` and `package-lock.json`, and open_risks #2 instructs \"구현자가 스테이지 안에서 직접 설치해 lockfile까지 갱신해야 한다\". Evidence: (1) `.factory/ci-settings.json:11-12` denies `Edit(package.json)`, `Write(package.json)`, `Edit(package-lock.json)`, `Write(package-lock.json)`; (2) `.factory/bin/run-stage.js:605` launches every CI stage agent with `--settings .factory/ci-settings.json`, so that deny is live in implement — the builder physically cannot Edit/Write those two paths; (3) `.claude/workflows/factory-implement.js:274-277` tells the builder verbatim: \"If the change genuinely needs a new dependency … write what is needed and why into the PR body under a 'Harness change needed' heading and **finish the issue without it** … Do NOT `npm install`, edit a lockfile, or otherwise work around the deny.\" Same rule in `.claude/agents/factory-builder.md:35-36` and `:56-57` (\"`npm install`로 deny를 우회하지 않는다\"). So the plan's mitigation is an instruction to do the one thing the builder is told never to do. open_risks #3's framing (\"위반이 아니라 사람 머지가 하나 끼는 사실\") is the milder, wrong version of this: the issue is not merge-time, it is build-time.\n\nWHY THAT MAKES THE CHANGE UNVERIFIABLE. `pg` is not installed (`node_modules/pg` absent; `test/integration/db.test.js:4` shells to `docker compose exec psql` precisely because no driver exists), and `.github/workflows/factory-implement.yml:53` runs `npm ci` before `:57` \"Run stage\" and never again. The injected `{query}` seam means `src/repo/notes.js` does not import `pg` — but `test/integration/helpers/db.js` and the `src/app.js` entry guard do. Two branches, both bad: (a) builder obeys its contract → no `pg` → dw1, dw2, dw5, dw8 cannot be written at all → CHARTER.md:48 (\"전항목이 verify 테스트로 증명됨\") fails at review; (b) builder writes them anyway → the required `unit` gate (`harness.toml:20`, glob `:59` = `test/**/*.test.js`, which includes `test/integration/**`) goes RED with `ERR_MODULE_NOT_FOUND` — the same gates-RED shape that killed the previous round (`docs/factory/runs/2.md:25-29`). This is the costliest failure of this plan and it is currently recorded only in its inverted, reassuring form.\n\nWHAT WOULD MAKE ME ACCEPT — either one, no third round needed.\n(1) PRECONDITION: delete `package.json` and `package-lock.json` from `files_expected`, and record in `summary` that `pg` is a **blocking precondition** landed by a human-merged `factory:harness` PR BEFORE this issue enters implement — the builder never touches the lockfile, matching the escape hatch its own prompt names (factory-implement.js:274-277). If that PR has not landed, the builder ships only the subset in (2) and writes \"Harness change needed\".\n(2) SPLIT NOW (smaller first step, my preference): this issue = dw3, dw4, dw6, dw7 only. All four are `unit`, all four run with zero new dependencies (dw6's fake db needs no driver because the repo layer takes an injected executor), and `files_expected` shrinks to `src/app.js`, `src/routes/notes.js`, `src/service/notes.js`, `src/repo/notes.js`, `test/fixtures/notes.js`, `test/notes.service.test.js`, `test/app.test.js` — no protected path, no docker. dw1, dw2, dw5, dw8 plus `src/repo/schema.js`, `db/migrations/001_create_notes.sql`, `test/integration/**` move to a follow-up issue that depends on the `pg` harness PR. This also fixes, for free, the budget objection I have logged twice (8 > 5) and the `harness.toml:20` risk of permanently welding docker-dependent tests into every future issue's required gate.\n\nCONCESSIONS (not re-litigated). dw8 now carries my signed accept condition (2) verbatim — outcome-based (42P07 / pg_type unique-violation tolerated and resolved, 42601 propagated, blanket-catch fails) instead of pinning an unobservable lock mechanism — and condition (1)'s `BEGIN → lock → DDL → COMMIT on a dedicated client` is written into the text with its unobservability recorded in open_risks. That objection is withdrawn. dw2's narrowing to one integration case, dw4's demotion to unit, and the /healthz consolidation into dw7 are real concessions to my budget argument and I acknowledge them. My remaining unresolved dissents (8 > 5 items; the two-connection `Promise.all` being a weak proxy for worker-process contention; `.code`-less pool exhaustion classified 500; nothing structurally preventing a future `migrate()` on the boot path) are correctly recorded in `dissent_log` and I do not block on them.",
        "runs": [
          2
        ],
        "source": "dissent"
      }
    ],
    "flaky": [],
    "needs_human": [
      {
        "issue": 2,
        "reason": "stage artifact missing or invalid: claude -p reported is_error; no candidate matched the stage schema — no JSON object in result",
        "at": "2026-09-12T15:25:22Z"
      },
      {
        "issue": 14,
        "reason": "prerequisite handoff missing: review handoff missing",
        "at": "2026-09-12T17:07:36Z"
      },
      {
        "issue": 18,
        "reason": "gates file status is RED",
        "at": "2026-09-12T19:14:54Z"
      },
      {
        "issue": 15,
        "reason": "verifier rejected",
        "at": "2026-09-12T19:04:04Z"
      }
    ]
  },
  "stats": {
    "merged": 0,
    "review_rounds_avg": 0,
    "rejects_by_role": {},
    "needs_human": 3,
    "usage": {
      "cost_usd": 101.804223,
      "tokens": {
        "input": 1795037,
        "output": 220659
      }
    }
  },
  "stats_total": {
    "merged": 1,
    "review_rounds_avg": 1,
    "rejects_by_role": {},
    "needs_human": 3,
    "usage": {
      "cost_usd": 81.812379,
      "tokens": {
        "input": 50,
        "output": 128059
      }
    },
    "retro_usage": {
      "cost_usd": 0.722729,
      "tokens": {
        "input": 2,
        "output": 2998
      }
    },
    "retros": 1
  },
  "deferred_proposals": [],
  "deletion_candidates": []
}
```
