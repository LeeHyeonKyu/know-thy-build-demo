# Retro State

- last retro: 2026-09-20T11:32:45.992Z
- merges since last retro: 0
- current N: 1

## History (last 5)

| at | yield | n_before | n_after | needs_human_since |
| --- | --- | --- | --- | --- |
| 2026-09-12T17:07:22.748Z | 1 | 1 | 1 | 3 |
| 2026-09-20T11:32:45.992Z | 7 | 1 | 1 | 16 |

## Stats

| metric | this window | cumulative |
| --- | --- | --- |
| merged | 0 | 2 |
| review rounds avg | 0 | 1 |
| rounds/issue (plan/impl/review) | 0 / 0 / 0 | 0.5 / 1 / 1 |
| escaped defects | 0 | 0 |
| revert rate | 없음 | 0.00 (0/2) |
| needs-human | 0 | 19 |
| rejects by role | 없음 | 없음 |
| reviewer overlap | 없음 | 없음 |
| unique findings by role | 없음 | 없음 |
| qa na ratio | 없음 | 0.00 (0/15 claims, na-heavy 0/1 approvals) |
| cost (usd) | 0.00 | 578.70 |
| tokens | input 0 / output 0 | input 9329121 / output 1029151 |
| retro cost (usd) | 0.00 | 2.55 |
| retro tokens | input 0 / output 0 | input 4 / output 6012 |
| full retros | — | 2 |

### Phase-2 gate baseline (this session)

- baseline: KTB #18 = $143 / 12 stage-runs; own-cal #3 = 4 review rounds
- frozen thresholds: escaped_defects ≤ 0, revert_rate ≤ 0.00
- rounds-per-issue exemplar: own-cal #3 = 4 review rounds (reject-heavy; caught in review, escaped_defects=0)
- must-not-recur escaped defects: KTB #18 R3 finish() regression (approve→reject flip — a post-approval escaped defect)
- gate (ADR-026): Phase 2 (plan Tasks 6, 7) starts only when, over ≥5 post-Phase-1 issues, escaped-defect rate AND revert rate are ≤ baseline while rounds-per-issue fell.

<!-- factory-retro-state:v1 -->
```json
{
  "cursor": {
    "last_retro_at": "2026-09-20T11:32:45.992Z",
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
    },
    {
      "at": "2026-09-20T11:32:45.992Z",
      "yield": 7,
      "needs_human_since": 16,
      "applied": [
        {
          "step": "lessons:reviewer-qa",
          "added": [
            "L-2026-09-20-01",
            "L-2026-09-20-02"
          ],
          "rejected": [],
          "evicted": [],
          "cited": []
        },
        {
          "step": "lessons:reviewer-spec-conformance",
          "added": [
            "L-2026-09-20-01"
          ],
          "rejected": [],
          "evicted": [],
          "cited": []
        },
        {
          "step": "lessons:plan-synthesizer",
          "added": [
            "L-2026-09-20-01"
          ],
          "rejected": [],
          "evicted": [],
          "cited": []
        },
        {
          "step": "role:reviewer-qa",
          "added": [
            {
              "section": "### 좋은 발견",
              "text": "위치: 저장소가 문서로 선언한 설치·실행 경로(CLAUDE.md의 `npm ci` → `npx vitest run`, `npm start` = `node src/app.js`). 주장: 게이트는 GREEN인데 그 명령만 쓴 깨끗한 체크아웃에서는 기능이 존재하지 않는다 — #15에서는 새 테스트 3개가 수집 단계에서 죽고(`.factory/node_modules`의 smol-toml은 `npm ci`가 아니라 CI의 별도 스텝만 설치한다), #2에서는 실제 Postgres를 띄우고 `POST /notes`를 보내도 201이 아니라 …"
            }
          ],
          "skipped": [],
          "deferred": []
        },
        {
          "step": "role:plan-skeptic",
          "added": [
            {
              "section": "### 좋은 발견",
              "text": "위치: 계획이 '사실'과 '가능하다'로 든 전제(#2의 `pg` 설치 전제, #15의 '지금 HTTP 계약을 아무 게이트도 지키지 않는다'). 주장: 두 전제 모두 저장소 파일과 다르다 — skeptic 자신이 인용한 `.factory/ci-settings.json:11-12`는 `package.json`/`package-lock.json`의 Edit·Write를 deny하므로 builder가 lockfile을 갱신할 수 없고, `docker-compose.test.yml:1-6`의 healthcheck는 `/healthz`가 아…"
            },
            {
              "section": "## Perspectives",
              "text": "**전제 대조자**: 계획이 '가능하다'·'이미 그렇다'로 깔고 들어간 전제마다 저장소의 설정 파일 한 줄을 댄다 — 댈 수 없는 전제는 done_when이 아니라 사람이 머지할 선행 조건이다."
            }
          ],
          "skipped": [],
          "deferred": []
        },
        {
          "step": "publish-lessons",
          "pr": 42,
          "merged": true,
          "reason": null,
          "files": [
            ".factory/lessons/reviewer-qa.md",
            ".factory/lessons/reviewer-spec-conformance.md",
            ".factory/lessons/plan-synthesizer.md",
            ".claude/agents/reviewer-qa.md",
            ".claude/agents/plan-skeptic.md"
          ]
        },
        {
          "step": "harness",
          "title": "harness: promote to M2 — HTTP route surface present (express/fastify/hono/koa/next dependency, or routes-style files) but harness maturity is M1 or below",
          "skipped": "duplicate"
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
      },
      {
        "role": "spec-conformance",
        "text": "이슈 #2의 핵심 약속(`POST /notes` 한 번으로 노트를 실제로 남기고 돌려받는다 — 이슈 본문 Story 1, `npm start`가 타는 실제 배포 경로)이 이 커밋에서도 구조적으로 항상 깨진다. dw1·dw2·dw5·dw8이 검증하는 것은 테스트가 직접 연 psql 세션을 `createApp({db})`에 주입한 경로뿐이고, `npm start`가 유일하게 pool을 만드는 진입점 가드(`createDbFromEnv`, src/app.js:95)는 어떤 done_when에서도 '정상 Postgres에 붙어 201을 반환'하는 형태로 관측되지 않는다 — 오히려 새로 추가된 `test_2_started_process_serves_notes_with_db_wired`(test/app.test.js:392-452)가 스스로 '드라이버가 있든 없든 결과는 하나(503)다'라고 주석에 적고 도달 불가능한 DSN만 써서 503을 정상으로 고정한다. 이는 plan의 open_risks #4('이 저장소 최초의 DB 쓰기 배선인데 그 경로를 한 번도 밟아 본 적이 없다')가 '미검증'이라 적어 둔 위험이 diff에서 '기능이 실제로 동작하지 않음'으로 확정된 것이다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "Re-confirmed against the current HEAD (033bbb7) with a real Postgres 16 container up and DATABASE_URL pointed at it: starting the shipped entrypoint exactly as `npm start` would (`node src/app.js`) and POSTing a valid `{title, body}` to `/notes` does NOT create a note. The process logs `pg pool unavailable — /notes will answer 503: Cannot find package 'pg' imported from .../src/app.js`, `/healthz` stays 200 (good), but `POST /notes` returns 503 `db_unavailable` instead of 201, and a direct psql count against the real table confirms 0 rows were written. `pg` is still absent from package.json, package-lock.json, and node_modules. The diff's only response to this gap is a docs/TECHNICAL.md rewrite that reclassifies installing `pg` as a future, separate `factory:harness` PR's job ('제거 트리거: pg를 들이는 factory:harness PR이 머지되면…') and a new unit test (`test_2_entrypoint_without_driver_answers_503_not_500`) that asserts the *absence* of pg as the expected, permanent behavior rather than as a gap to close. This is the same open item from the previous round (ruled 'uphold' — the dispute framed it as an out-of-scope harness concern, but the plan handoff's own files_expected/open_risks put installing pg and updating the lockfile in scope for issue #2). The core capability the issue text promises — `POST /notes` persists a note and returns id + created_at — still does not exist for any real deployment of this code.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "done_when dw2(c)는 'README 전체의 백틱 저장소 상대경로 토큰과 상대 마크다운 링크 대상이 모두 fs에 존재한다(면제 키워드 없음)'을 요구하지만, 구현은 백틱 토큰에 한해 하드코딩된 접두사/확장자 화이트리스트로 대상을 좁혀 놓아 그 범위 밖의 진짜 저장소-상대경로 토큰은 조용히 검사 대상에서 빠진다 — '면제 키워드 없음'이라는 문구와 어긋나는 구조적 면제다.",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "dw2(c) requires that ALL backtick repo-relative path tokens in the README resolve on disk, 'exemption-keyword-free' (모두 fs에 존재한다, 면제 키워드 없음). The rework (commit e9e2c04) removed the prior hardcoded prefix/extension whitelist (spec1 from round 2) and replaced it with a shape rule — a bare token is only treated as a path claim if it contains a '/' separator or a file extension. This closes the specific whitelist gaps previously found (scripts/build.sh, config/nginx.conf, .github/workflows/ci.yml now resolve), but it re-introduces the same class of defect for a different, undisclosed-to-the-plan subset: bare, extensionless, single-word repo-relative filenames (e.g. `Makefile`, `LICENSE`) are still structurally excluded from the check by design, not by accident. This is admitted in the code's own comments (lines 161-164: '남는 틈은 하나이며 목록이 아니라 형태의 모호성이다... 그것까지 경로 주장으로 보면... 수집하지 않는다 — open risk로 PR 본문에 적는다') and in the rework_response ('남는 틈(확장자·구분자 없는 한 단어 Makefile/LICENSE)은... 화이트리스트가 아니라 산문 어휘와의 형태 모호성이며... open risk로 명시했다'). The new test that is supposed to measure dw2(c) exhaustively (test_18_readme_path_claims_exhaustive) deliberately does not assert on any bare extensionless token — its positive list (lines 276-289) contains only tokens with a separator or extension (Dockerfile.dev, scripts/build.sh, config/nginx.conf, .github/workflows/ci.yml, .env.example, docs/features/001-create-note.md, tools/seed.js, fixtures/seed.sql). A test whose name promises to measure exhaustiveness but whose assertions skip exactly the class of token known to defeat it does not verify what dw2(c)'s text says.",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "I independently reproduced this as a live user-facing failure of the issue's core promise, not just a static code-reading concern: I built a real git worktree at the reviewed commit (e9e2c04), injected exactly one false backtick claim into the shipped README.md's Layout table (`| \\`Makefile\\` | 편의 명령 모음 |`, a file that does not exist anywhere in the repo), changed nothing else, ran `npm ci` + `npx vitest run test/readme.test.js` in that worktree, and all 5 tests — including test_18_readme_references_resolve, the one whose job is exactly 'every backtick repo-relative path resolves on disk' — stayed green. The guard's own source comments (lines 161-164) admit this is deliberate: bare, separator-less, extension-less single-word tokens (`Makefile`, `LICENSE`) are structurally never added to the `claims` set, so a README that lies about such a file is indistinguishable from one that doesn't mention it. This directly contradicts the done_when dw2(c) text as given to me in context.json: '(c) README 전체의 백틱 저장소 상대경로 토큰과 상대 마크다운 링크 대상이 모두 fs에 존재한다(면제 키워드 없음)' — 'Makefile' is a syntactically valid repo-relative path token; excluding it by token *shape* rather than by a named keyword list still leaves an entire class of false claims silently unverified, which is the exact failure mode this done_when exists to close (and the same failure mode round-1 already forced two rounds of rework on: whitelist-by-prefix, then whitelist-by-extension, now shape-based).",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "correctness",
        "text": "The 'bidirectional' status tripwire only sees `app.<method>(\"...\"` literals, so it is unsound for the router/mount style the repo's own architecture prescribes: a README that keeps lying stays GREEN, and the honest fix (flipping `planned` -> `implemented`) is the RED path. The test's header comment (lines 8-11) declares exactly this failure mode as the thing it avoids.",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "architecture",
        "text": "엔드포인트 상태 판정이 `app.<method>(\"<전체 경로>\")`라는 등록 구문 한 형태에 묶여 있다. TECHNICAL.md §Architecture가 001~003에 대해 처방한 routes 층(`src/routes/notes.js` + Router 마운트)으로 구현하면 라우트가 실제로 201을 응답하는데도 가드는 미등록으로 읽는다 — README의 거짓 `planned`이 GREEN이고 정직한 `implemented`가 RED가 된다. 다음 PR의 유일한 GREEN 경로가 거짓 문서다.",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "correctness",
        "text": "dw3 가드가 **참인 README**에 대해 RED를 내고, 그 메시지는 파일 내용과 반대되는 진단을 말한다. (a) install과 dbUp이 같은 줄이면 `!(install < dbUp)`이 참이 되어 '설치 단계가 DB 기동 단계보다 뒤에 있다'고 말한다 — 실제로는 앞에 있다. (b) `runTests` 정규식이 `vitest run`을 테스트 실행으로 세므로, README 자신이 가르치는 DB 불필요 명령(`npx vitest run --exclude 'test/integration/**'`)이나 섹션 인트로의 `npm test` 언급이 dbUp보다 앞서면 '그 순서로 따라 하면 통합 테스트가 터진다'는 거짓 진단으로 RED가 된다. 같은 설계 때문에 반대 방향(거짓 음성)도 열려 있다: 올바른 블록 뒤에 `npm test` → `up -d`(--wait 없음) 순서의 두 번째 quickstart를 덧붙이면 GREEN이다 — 이슈가 막으려던 증상이 게이트를 통과한다.",
        "runs": [
          18
        ],
        "source": "must_fix"
      },
      {
        "role": "architecture",
        "text": "이 diff가 처음으로 프로젝트 테스트 레이어를 벤더링된 factory 런타임(.factory/lib/**)에 묶었고, 그 런타임의 의존성은 저장소의 선언된 설치 경로(`npm ci`)로 설치되지 않는다 — 깨끗한 클론에서 문서가 안내하는 `npx vitest run`(= `[commands].unit` 문자열 그대로)이 5개 테스트 파일 중 3개에서 import 실패한다.",
        "runs": [
          15
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "머지 시점에 반드시 있어야 한다고 plan 스스로 못 박은 qa 증거 파일이 diff/저장소 어디에도 없다 — 이 이슈가 켜는 required e2e 게이트(webServer 모드, `node src/app.js` 실 기동)는 어떤 done_when에서도 CI green으로 관측되지 않는다(M1 상한 때문에 구조적으로 불가능하다는 것을 plan 스스로 인정한다).",
        "runs": [
          15
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "Following CLAUDE.md exactly (npm ci then npx vitest run) on a clean checkout, the three new test files fail immediately at collection time, because .factory/node_modules (smol-toml) is never installed by npm ci. No project doc (CLAUDE.md, docs/QA.md, docs/TECHNICAL.md, docs/PROJECT.md) explains how to populate .factory/node_modules locally -- that install only happens in a separate step of .factory/actions/setup/action.yml (npm install --prefix .factory --no-audit --no-fund), which is not [runtime].setup.",
        "runs": [
          15
        ],
        "source": "must_fix"
      },
      {
        "role": "correctness",
        "text": "연결 수립 자체가 실패하는 흔한 두 경우 — 잘못된 자격증명(SQLSTATE 28P01)과 존재하지 않는 DB 이름(3D000) — 이 503 db_unavailable이 아니라 500 internal_error로 나간다. 스펙 Key States(docs/features/001-create-note.md:78 'DB 연결 실패 → 503')와 이 diff가 같은 커밋에 쓴 docs/TECHNICAL.md:68('설정이 틀리면 요청 시점에 503으로 드러난다')·:71('503이면 DB에 못 닿는 것이고, 500이면 이 배포가 위 런북을 실행하지 않은 것이다')이 코드와 어긋난다. 당직자는 DSN 오타를 '마이그레이션 미적용'으로 읽는다 — 이 PR이 막겠다고 명시한 바로 그 오진이다.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "Re-verified independently this round with fresh commands against the exact commit under review: `git show HEAD:package.json` still shows dependencies = {express only}, `node_modules` still contains no pg, and `git log --oneline HEAD` still does not contain d7f7996 (the human-merged commit that added pg on origin/main) anywhere in its ancestry — confirmed via `git show origin/main:package.json` (has pg ^8.23.0) and `git log --oneline origin/main -5` (shows d7f7996 as a distinct, unabsorbed commit). The branch under review was never rebased onto or merged with the commit that actually landed pg. A clean `npm ci` on this exact commit installs no pg, so `node src/app.js` (the shipped `npm start` path, whose missing-driver fallback this same diff deliberately deletes) crashes at boot with ERR_MODULE_NOT_FOUND, and `test/integration/notes.test.js` (which carries dw1 and dw3) fails to even load. New evidence this round: docs/TECHNICAL.md's own added text now cites a specific artifact as proof the fix was verified — '재현 로그 `.factory/out/qa/2-real-pg-repro-round2.log`' — but `.factory/out/qa/` does not exist in this repo at all (confirmed: `ls .factory/out/qa` → No such file or directory). The diff asserts a repro log exists as evidence that spec1/qa1 are fixed, and that log is not present anywhere in the reviewed tree. This is the same pattern Lens item 5 names for qa artifacts ('파일이 없는데 확인함이라고 적힌 상태는 reject') applied to a doc's own citation of it — an unevidenced claim of verification. I also note, without adopting their lens, that correctness's and architecture's round-1 verified sections report GREEN suites and real-Postgres behavior for this exact commit, which is only possible if their execution environment had a stale `pg` present in `node_modules` from a prior session's manual install (as qa's own must_fix explicitly did for diagnostic purposes and says it reverted) — that would explain the discrepancy without contradicting my fresh, clean re-check of the committed package.json/lock and node_modules state just now.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "spec-conformance",
        "text": "handoffs.plan.non_goals' final bullet restricts documentation edits to exactly four locations in docs/TECHNICAL.md: ':30, :41/:45, §Interfaces, §Data/§Architecture/§Constraints'. `## Testing Strategy` is not one of the four named locations. Re-running the diff this round confirms roughly 25 lines of new prose were added under that exact heading (six new named subsections plus a materially rewritten `What NOT to Test` paragraph that adds new assertions about error-envelope/code-mapping testing). This is a fifth location, named as out-of-scope by the plan's own non_goals text, still crossed in this commit — unchanged from round 1.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "qa",
        "text": "PR head d3a8268 was branched before origin/main's human-merged commit d7f7996 (\"chore(harness): add pg dependency for the notes API\") and was never rebased onto it. As committed, this exact commit's package.json/package-lock.json do NOT list `pg` at all, even though this very issue's shipped entrypoint (src/app.js) and its own integration test import it. A clean install per this project's own [runtime].setup = \"npm ci\" therefore never installs pg, so `npm start` (= `node src/app.js`, exactly the command CLAUDE.md and package.json's `start` script specify) crashes on boot with ERR_MODULE_NOT_FOUND before it ever listens, and the required `unit` gate command (`npx vitest run --reporter=json --outputFile=.factory/out/unit.json`) fails two whole test files. dw1 (`test_2_shipped_entrypoint_persists_note_in_isolated_schema`, level full — the acceptance criterion 'valid request returns 201 with a persisted id') and dw3 (`test_2_created_at_from_injected_clock_and_no_row_on_reject`, level integration) live inside test/integration/notes.test.js, which fails to even load in this state — those two done_when items have not executed successfully even once against this commit.",
        "runs": [
          2
        ],
        "source": "must_fix"
      },
      {
        "role": "correctness",
        "text": "요청이 DB에 닿지 못해 실패했는데 503 db_unavailable이 아니라 500 internal_error로 나간다. 분류기가 `typeof err.code === \"string\"`인 오류만 보는데, node-postgres가 연결 상실·핸드셰이크 실패에서 던지는 가장 흔한 오류들에는 `code`가 아예 없다. 이 PR이 같은 커밋에 적은 당직 런북(docs/TECHNICAL.md §Data: 503이면 DB에 닿지 못한 것, 500이면 이 배포가 마이그레이션을 빠뜨린 것)과 스펙 docs/features/001-create-note.md Key States(DB 연결 실패 → 503)가 이 클래스에서 거짓이 된다. 바로 앞 커밋 ca6b6f7이 '자격증명 오타가 당직자에게 우리 코드의 버그로 도착하지 않게' 28P01/28000/3D000을 넣었는데, 그 수정이 절반만 된 상태다: `postgres://postgres:wrong@...`(28P01)는 503, `postgres://postgres@...`(비밀번호 누락)는 500 — 같은 오타 계열의 신호가 갈린다.",
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
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "'영구 재발화를 끝낸다'는 이 계획의 두 번째 가치 주장은 코드와 다르다. retro는 **닫힌** 이슈만 다시 만든다 — #15를 열어 둔 채 큐 라벨만 내리면 재발화는 영구히 일어나지 않는다. 즉 '지금 만들지 않는다'는 이 이슈에서 여전히 살아 있는 선택지이고, 그것을 배제한 지난 사이클의 기각 사유도 같은 이유로 무너진다. 근거: `.factory/bin/retro.js:596-599`의 openTitles dedupe, `:703`('harnessTitles: factory:harness 라벨의 **열린** 이슈 제목'), `:594-595` 주석. 대안(비용 0, 되돌림 비용 0): #15를 열린 채 두고 큐 라벨을 내린 뒤, 브라우저 프로비저닝과 e2e 레인 기준이 갖춰진 다음 사이클에 승격한다.",
        "runs": [
          15
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "[to architect] architect의 dw1(진입점 spawn + 별도 psql 조회 + 커밋된 행 + 자기 마커만 DELETE)은 이 계획에서 유일하게 docs/QA.md:19의 두 절을 동시에 어기는 항목이고, 'dw1만의 예외'가 아니다. 하네스가 같은 테스트 두 벌을 동시에 돌린다 — 고정 마커 리터럴이면 '정확히 1건'이 거짓이 되고, POST와 정리 DELETE 사이에 커밋된 행은 다른 워커의 커넥션에 그대로 보인다. (근거: docs/QA.md:19, .factory/lib/prove-test.js:38, .factory/harness.toml:47 new_test_repeats=3, :85 tests_are_load_bearing=true)",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "[to architect, 예산] 이슈 본문과 docs/features/001-create-note.md:82-84의 draft done_when은 3개인데 architect의 files_expected는 14개·done_when 6개다 — docs/factory/CHARTER.md:52가 diff를 files_expected 안으로 묶으므로 plan에서 붙은 살은 review에서 뗄 수 없다. 요구: 다섯을 넘지 않게 하고, 나머지는 같은 테스트 파일 안의 추가 단언으로 접거나 open_risks로 내린다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to product-advocate] precondition PR이 랜딩하지 못했을 때 'dw1·dw2는 후속 이슈로 넘기고 unit 슬라이스는 출하하되 done이라 부르지 않는다'는 중간 상태를 제안하지만, 이 하네스에는 그런 중간 상태가 없다. docs/factory/CHARTER.md:48의 Definition of Done은 'plan handoff의 done_when 전항목이 verify 테스트로 증명됨'이고, '완료라 부르지 않는다'는 PR 텍스트상의 다짐일 뿐 게이트나 리뷰 로스터가 강제하지 못한다. precondition이 없으면 dw1·dw2·dw5류 항목은 이번 done_when에서 아예 제거되어야 한다(skeptic의 분할안) — 남겨 둔 채 진행하면 같은 reject 사이클이 세 번째로 반복된다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to architect, skeptic] pg.Pool 도입이 낳는 유휴 커넥션 오류(idle pool error) 크래시 경로에 대한 요구가 어느 done_when에도 없다 — 이 이슈의 실제 직전 라운드에서 관측되고 고쳐진 바로 그 결함이다(handoffs.implement.summary '진입점 pool의 idle error 리스너 부재(프로세스 사망 경로)를 함께 닫았다', tests_added에 test_2_idle_pool_error_does_not_kill_the_process). 'pg가 있는 상태에서'를 전제한 dw-s1은 프로세스가 살아 있다는 것만 확인할 뿐 pool의 error 이벤트 처리 여부는 관측하지 않고, docs/TECHNICAL.md에도 관련 절이 없다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "[to architect] dw6(b)('`src/routes/notes.js`가 `src/repo/**`를 import하지 않는다')와 dw6(c)('`src/**`에 `child_process`·`docker`·`psql` 문자열이 없다')는 구현을 서술하는 조건이다 — 둘 다 참인데도 사용자가 여전히 노트를 저장하지 못하는 상태가 가능하다. 그 자리에 예산을 쓰면서, 사용자가 서비스 전체를 잃는 경로(유휴 커넥션 오류로 프로세스 사망)를 또 코드 리뷰로 넘기는 거래는 사용자 관점에서 정확히 뒤집혀 있다. 경계 단언은 open_risks나 리뷰 체크로 내리고, skeptic dw5/operator op2를 그 자리에 넣어야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "[to skeptic] dw5가 관측하는 것이 '자식 프로세스가 살아 있다 + `/healthz` 200'뿐이라, 이 조건이 참인데도 Mina는 이후 모든 `POST /notes`가 실패하는 서비스를 볼 수 있다. Story 1의 관측점은 헬스 신호가 아니라 저장이다 — 최소한 커넥션 강제 종료 직후의 유효한 `POST /notes`가 201이라는 절을 같은 케이스에 붙여야 한다(operator op2가 그 형태를 이미 적었다).",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "architect",
        "kind": "good",
        "text": "[to skeptic] '제품 코드가 셸로 DB에 접근하지 않는다'(`src/**/*.js`에 `child_process`·`docker`·`psql` 문자열 없음)를 항목에서 완전히 지우면, psql 서브프로세스로 INSERT하는 구현이 skeptic의 5개 조건을 **전부** 통과한다. 새 done_when 없이 dw2가 사는 `test/app.test.js` 안의 단언 한 줄로 접어야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to architect] risks에서 'DATABASE_URL이 저장소 전체에 0건'이라고 정확히 진단하고도, 이를 닫는 done_when이 없다 — dw7(app factory·레이어 경계)에도 이 값 부재 시의 신호를 요구하는 조항이 없다. 이 값은 boot을 실패시키지 않고도(즉 `test/smoke.test.js`를 깨지 않고도) stderr 경고 한 줄로 조용한 기본값을 시끄럽게 바꿀 수 있는 값싼 조치인데, dw7의 정적 판정(child_process/docker/psql 문자열 부재)에는 이 조항이 들어갈 자리가 있었음에도 비어 있다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "[to architect] '강제 종료 직후의 `POST /notes`가 201인지는 요구하지 않는다'의 근거로 `docs/TECHNICAL.md:76`(What NOT to Test: pg 드라이버)을 드는 것은 같은 문서 `:77`의 자기 예외와 충돌한다 — `:77`은 '관측 가능한 응답 계약은 글루가 아니라 계약이므로 회귀 가드를 둔다'고 이미 적었다. 커넥션이 끊긴 뒤 '저장이 다시 된다'는 드라이버 내부가 아니라 응답 계약이다. 현재 dw6은 '프로세스가 살아 있다 + `/healthz` 200'만 보므로, 살아 있지만 모든 저장이 영구히 실패하는 서비스가 초록으로 통과한다 — Story 1의 관측점은 헬스 신호가 아니라 저장이다. 타이밍 의존이라는 반박은 형태로 해소된다: 고정 대기가 아니라 조건 대기로 `POST /notes`가 201이 될 때까지 폴링하고, 전용 스키마에서 그 행을 확인한다. 구현이 복구하지 못하면 타임아웃 RED이지 flake가 아니다. 새 항목·새 파일 없이 dw6 본문에 절 하나다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "[to architect] `docs/QA.md:16`을 이 diff에서 고치지 않기로 한 결정은 같은 입장 안의 다른 결정과 비대칭이다. 당신은 `docs/TECHNICAL.md:41`/`:45`(검증 위치) 모순은 '침묵하지 않고 문서를 고친다'고 하면서, 이 계획이 정면으로 위반할 결정성 규칙은 별도 이슈로 미룬다. 그 결과 이 diff는 `.factory/harness.toml:55`가 테스트 가이드의 단일 출처로 지목한 파일을 거짓인 채 남기고, 002가 그 거짓 규칙 위에 integration AC를 얹는다. QA.md는 protected가 아니므로 한 줄 수정이 실행 가능하다 — 고치든지, 아니면 TECHNICAL.md 편집도 같은 이유로 별도 이슈여야 한다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to skeptic] dw1의 스키마 격리(`PGOPTIONS=-c search_path=<schema>`)를 채택하면, 이번 계획에서 spec1/qa1(0건 저장 사고)을 닫는 유일한 통합 테스트가 '프로덕션이 실제로 쓰는 구성'(search_path 미설정, 기본값 public)을 한 번도 실행하지 않게 된다. product-advocate·architect의 dw1(공유 public 테이블에 커밋 + 마커 cleanup)은 PGOPTIONS를 전혀 설정하지 않아 프로덕션과 동일한 구성을 그대로 검증하는데, skeptic의 대안은 이 회차가 가장 되돌리기 비싸다고 지목한 그 사고를 '테스트 전용 환경변수가 걸린 구성'에서만 재현한다 — 배포되는 형태와 게이트가 실행하는 형태가 갈라진다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to skeptic] 유휴 pool 오류로 프로세스가 죽지 않는지 확인하는 항목(architect·product-advocate의 dw6/dw7) 자체를 이번 이슈에서 통째로 만들지 말자는 제안은, 이 저장소가 이미 실측으로 확인한 크래시 경로에 대한 유일한 회귀 가드를 없애자는 것과 같다. 이 컨텍스트 자체에 '`pool.on('error')` 등록을 제거하자 `test_2_idle_pool_error_does_not_kill_the_process`가 RED'라는 변이 검증 기록이 있다 — 즉 이 코드 패턴에서 유휴 커넥션의 unhandled `error` 이벤트가 실제로 Node 프로세스를 죽인다는 것은 가설이 아니라 이 저장소에서 이미 관측된 사실이다. docs/TECHNICAL.md:81이 배포를 `npm start` 단일 프로세스로 못박았으므로 그 죽음은 `/notes`뿐 아니라 CHARTER:56의 `/healthz` Preserve까지 함께 지운다. 처음으로 실제 `pg.Pool`을 프로덕션 진입점에 배선하는 바로 이 PR에서 그 회귀 가드를 빼고 후속 이슈로 미루면, 병합 시점부터 후속 이슈가 열릴 때까지 알려진 크래시 벡터가 게이트 커버리지 0인 채로 배포된다. skeptic이 제기한 flake 예산 문제는 정당하지만 해법은 항목 삭제가 아니라 이미 architect·product-advocate가 채택한 결정성 강화(rowCount>=1 선행 단언 + pg_stat_activity 조건 대기)다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to product-advocate] dw1은 클라이언트가 받는 503/500 봉투에 원인을 담지 않는 것이 옳다고 정확히 요구했지만(스펙 :78 '요청 본문을 에코하지 않는다'), 세 역할의 어떤 dw5류 항목도 서버 쪽 stdout/stderr에 원인(`err.code`/`err.message`)을 남기라고 요구하지 않는다. 이 저장소에는 확인 가능한 APM·대시보드·알림 채널이 없고(Glob·rg로 확인되지 않음), `src/app.js:5`의 `console.log(\"listening on ...\")` 하나가 유일하게 확인된 출력이다. 새벽 3시 당직자가 `npm start`의 프로세스 출력을 볼 수 있는 유일한 순간에, 503의 원인이 ECONNREFUSED인지 ETIMEDOUT인지 42P01인지를 서버 로그에서 구분할 방법이 이 계획 어디에도 없다 — 클라이언트에게 보내는 `error.code` 문자열을 재사용하는 것은 클라이언트 계약과 운영 진단 채널을 같은 것으로 취급하는 것이라 클라이언트 봉투가 바뀌면 진단 능력도 함께 바뀐다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "[to architect] 당신의 7항목 중 어느 것도 '요청이 **끝난다**'를 관측하지 않는다. dw5는 `query`가 **reject할 때만** 분류를 고정하고, pending으로 매달릴 때는 아무 항목도 없다. 그 상태에서 사용자가 보는 것은 503도 스택 트레이스도 아니라 **아무것도 아니고**, 걸린 요청이 쌓이면 docs/TECHNICAL.md:81의 단일 프로세스가 통째로 응답 불가로 넘어간다 — `/healthz`(CHARTER:56)까지 함께. 이것은 스펙이 금지한 '조용히'의 가장 순수한 형태다. dw5 본문에 절 하나(`query`가 영원히 pending이면 응답이 유한 시간 안에 같은 JSON 봉투의 5xx로 끝난다)를 접을 것을 요구한다 — 새 항목·새 파일·새 레벨 없이, DB가 경로에 없으므로 unit 그대로다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "product-advocate",
        "kind": "good",
        "text": "[to skeptic] operator op2(응답하지 않는 DB에서 `POST /notes`가 유한 시간 안에 5xx로 끝난다)를 당신의 6항목이 대체하지 않으면서 탈락 사유도 적지 않았다. 당신 자신의 최우선 원칙('integration 표면에서 flake 예산을 한 방울도 낭비하지 않는다')은 이 항목을 배제하지 않는다 — op2는 가짜 `db`의 pending Promise + `listen(0)`이므로 unit이고, docker·자식 프로세스·DDL에 한 번도 닿지 않아 dw1의 격리 예산을 갉아먹지 않는다. 새 파일도 새 의존성도 0이다(test/app.test.js 안).",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "skeptic",
        "kind": "good",
        "text": "[to architect] 'main은 백지다'는 참이지만 '계획은 백지다'는 거짓이고, 세 역할이 그 구분을 지우고 있다. 이전 계획의 구현은 gates GREEN + verifier `accepted-with-reservations`로 이미 존재하며 review must_fix 둘(spec1·qa1)도 'fixed'로 응답됐다. 그런데 이번 R1 세 입장은 그 계획을 verify id까지 그대로 재유도하면서 절만 늘렸다 — 이것은 새 계획이 아니라 4회차 재심리이고, 비용은 이미 관측된 두 결함을 고치는 시간이다. 제안: 이번 계획을 '이전 done_when + findings 2건을 닫는 형태 수정'으로 좁히고, 이미 4역할 accept로 판정된 항목(handoffs.plan.debate.votes)은 재논의하지 않는다.",
        "runs": [
          2
        ],
        "source": "dissent"
      },
      {
        "role": "operator",
        "kind": "good",
        "text": "[to product-advocate] precondition PR이 랜딩하지 못했을 때 'dw1·dw2는 후속 이슈로 넘기고 unit 슬라이스는 출하하되 done이라 부르지 않는다'는 중간 상태를 제안하지만, 이 하네스에는 그런 중간 상��가 없다. docs/factory/CHARTER.md:48의 Definition of Done은 'plan handoff의 done_when 전항목이 verify 테스트로 증명됨'이고, '완료라 부르지 않는다'는 PR 텍스트상의 다짐일 뿐 게이트나 리뷰 로스터가 강제하지 못한다. precondition이 없으면 dw1·dw2·dw5류 항목은 이번 done_when에서 아예 제거되어야 한다(skeptic의 분할안) — 남겨 둔 채 진행하면 같은 reject 사이클이 세 번째로 반복된다.",
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
        "reason": "review rounds exhausted (K=3): 1 must_fix remain",
        "at": "2026-09-13T16:15:26Z"
      },
      {
        "issue": 14,
        "reason": "prerequisite handoff missing: review handoff missing",
        "at": "2026-09-12T17:07:36Z"
      },
      {
        "issue": 18,
        "reason": "blocked (environment/credentials) — needs human",
        "at": "2026-09-13T10:38:57Z"
      },
      {
        "issue": 15,
        "reason": "blocked (job timed out) — needs human",
        "at": "2026-09-13T14:27:10Z"
      },
      {
        "issue": 39,
        "reason": "plan roles [synthesizer,skeptic] != roster []",
        "at": "2026-09-20T10:08:48Z"
      }
    ]
  },
  "stats": {
    "merged": 0,
    "review_rounds_avg": 0,
    "plan_rounds_avg": 0,
    "implement_rounds_avg": 0,
    "rounds_per_issue": [],
    "escaped_defects": 0,
    "escaped_defects_detail": [],
    "reverts": 0,
    "reverted_issues": [],
    "revert_rate": null,
    "rejects_by_role": {},
    "review_runs": 0,
    "findings_total": 0,
    "overlapping_findings": 0,
    "unique_findings_by_role": {},
    "overlap_ratio": 0,
    "needs_human": 0,
    "qa_approvals": 0,
    "qa_claims_total": 0,
    "qa_na_total": 0,
    "qa_na_ratio": 0,
    "qa_na_heavy_approvals": 0,
    "usage": {
      "cost_usd": 0,
      "tokens": {
        "input": 0,
        "output": 0
      }
    }
  },
  "stats_total": {
    "merged": 2,
    "review_rounds_avg": 1,
    "plan_rounds_avg": 0.5,
    "implement_rounds_avg": 1,
    "escaped_defects": 0,
    "reverts": 0,
    "reverted_issues": [],
    "revert_rate": 0,
    "rejects_by_role": {},
    "review_runs": 1,
    "findings_total": 0,
    "overlapping_findings": 0,
    "unique_findings_by_role": {},
    "overlap_ratio": 0,
    "needs_human": 19,
    "qa_approvals": 1,
    "qa_claims_total": 15,
    "qa_na_total": 0,
    "qa_na_ratio": 0,
    "qa_na_heavy_approvals": 0,
    "usage": {
      "cost_usd": 578.698447,
      "tokens": {
        "input": 9329121,
        "output": 1029151
      }
    },
    "retro_usage": {
      "cost_usd": 2.554638,
      "tokens": {
        "input": 4,
        "output": 6012
      }
    },
    "retros": 2
  },
  "deferred_proposals": [],
  "deletion_candidates": []
}
```
