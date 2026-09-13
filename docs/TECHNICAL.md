---
status: complete
areasExplored:
  stack: { depth: 2, decisions: 2 }
  architecture: { depth: 1, decisions: 1 }
  data: { depth: 2, decisions: 2 }
  testing: { depth: 2, decisions: 2 }
assumptions:
  - "노트 수는 1만 건 이하 — 단일 테이블 + LIKE 검색으로 버틴다"
riskiestDecision: "TDR-2 부분일치 검색 — validate by: 1k건 시드 후 003의 p95 응답 측정"
generatedBy: know-thy-build
version: 1.0.0
date: 2026-09-12
---

# know-thy-build-demo — Technical Foundation

Express 5 단일 프로세스 + PostgreSQL 단일 테이블. 테스트 환경은 `docker-compose.test.yml`로 띄운다.

## Tech Stack

| Category | Choice | Why |
|----------|--------|-----|
| Language | JavaScript (ESM), Node 22 | 러너·CI가 이미 Node 22, 빌드 단계 없음 |
| Framework | Express 5 | 라우팅만 필요, 이미 설치됨 |
| Storage | PostgreSQL 16 | 테스트 환경(`docker-compose.test.yml`)에 이미 존재, 검색을 나중에 full-text로 올릴 여지 |
| Test runner | vitest 3 | unit + integration 동일 러너 |
| E2E | Playwright | 이미 설치됨 — M2 승격 전까지 게이트에서 쓰지 않음 |

**Key Dependencies:** `express` — HTTP, `pg` — DB 드라이버(`^8.23.0`. `package.json`은 protected라 도입 경로가 하나뿐이었고 — 사람이 머지하는 `factory:harness` PR — 커밋 `d7f7996`(PR #24)로 실제로 들어왔다. 001이 세 회차 동안 기다린 것이 이것이다)
**Dev Tools:** `vitest`, `@playwright/test`, `docker compose`
**Weakest Link:** 검색 구현(LIKE) — 데이터가 커지면 가장 먼저 바뀐다.

## Architecture

`routes → service → repository` 3층. 각 층은 아래층만 안다.

| Component | Responsibility | NOT Responsible For | Depends On |
|-----------|---------------|---------------------|------------|
| `src/app.js` | `createApp({db, now})` 팩토리, 라우트 등록, 도메인 code → 상태코드 매핑과 에러 봉투, 진입점 배선(`createDbFromEnv`/`createAppFromEnv`) | 비즈니스 규칙, SQL, **pg 오류의 분류**(repo가 한다) | routes, service·repo가 export한 오류 code 상수, 진입점 한정 `pg` 드라이버 로딩 |
| `src/routes/notes.js` | 요청 파싱, 상태코드 | 검증 규칙, SQL, 저장 순서 | service |
| `src/service/notes.js` | 노트 규칙(필수 필드·공백·트림, 정렬, 검색어 정규화) | HTTP(상태코드를 오류에 싣지 않는다), SQL 문법 | repository |
| `src/repo/notes.js` | SQL 실행, 행↔객체 매핑, pg 오류 → 도메인 code 번역 | 검증, 상태코드 | 주입된 실행자 `{query(text, params)}` |

**Data Flow:** `POST /notes` → routes가 body를 파싱 → **service가 필수·공백을 검증하고 title/body를 트림** → repo가 INSERT ... RETURNING → routes가 201 + `{id, title, body, created_at}`.
검증을 service에 두는 이유는 `001-create-note.md`가 "검증 규칙이 DB 없이 단위 테스트로 고정된다"를 요구하기 때문이다 — routes에 있으면 HTTP 없이는 증명할 수 없다.

**DB 핸들:** repo 함수는 실행자(`{query(text, params)}` — pg의 `Pool`과 `PoolClient`가 둘 다 만족)를 인자로 받고, `createApp({ db })`가 그것을 라우트에 내려준다. 그래서 테스트가 **자기 트랜잭션 커넥션을 그대로 주입**해 케이스별 `BEGIN` → 단언 → `ROLLBACK`(docs/QA.md)을 지킬 수 있다. `pg.Pool` 생성은 `src/app.js`의 진입점 가드 안에서만 일어난다(`node src/app.js`). 모듈 import는 포트를 잡지 않는다.

## Data

**Storage:** PostgreSQL 16 — 테스트 컴포즈에 이미 있고, LIKE → full-text 이관 경로가 열려 있다.

**Key Entities:**
- `notes(id bigserial pk, title text not null, body text not null, created_at timestamptz not null default now())`

**Data Lifecycle:** 생성만 있고 삭제·수정은 MVP 범위 밖. 테스트는 매 케이스 트랜잭션 롤백으로 격리한다.

**`created_at`의 출처는 앱이다.** DDL의 `default now()`는 fallback으로만 남고, 값은 `createApp({ now })`로 주입된 시계가 만들어 repo의 INSERT가 컬럼에 명시한다. `vi.useFakeTimers`로 전역 `Date`를 얼리는 방법(docs/QA.md의 기본 규칙)은 pg 소켓·undici 타이머와 같은 프로세스에서 도는 이 저장소에서는 쓰지 않는다 — 주입된 clock으로 대체한다(`docs/features/004-cache-expiry.md`의 선례). 002의 정렬 계약이 이 값 위에 얹힌다.

**마이그레이션:** `db/migrations/001_create_notes.sql`은 전진 전용(`CREATE TABLE IF NOT EXISTS`)이고, **제품 코드에는 마이그레이션 러너를 두지 않는다**. `migrate()`를 `src/`에 두면 제품 호출자가 0인 모듈이 되고, 부팅 경로에 붙이면 `GET /healthz`가 DB 가용성에 묶여 CHARTER Preserve가 깨진다. 적용 주체는 둘이다: 운영은 아래 런북(사람), 테스트는 `test/integration/notes.test.js`의 `beforeAll`이 **자기 소유 스키마 안에서** 이 파일을 그대로 읽어 실행한다. 스키마 이름이 `test_2_<pid>_<rand>`로 고유하므로 동시 적용 경쟁 자체가 없다 — advisory lock도 `42P07`/`23505` 흡수도 쓰지 않는다(그 비결정성 기계가 사라진 것이 전용 스키마를 택한 부수 이득이다). 그래서 출하되는 SQL이 게이트가 실제로 실행하는 경로 위에 있고, DDL의 컬럼 집합이 repo의 INSERT와 어긋나면 그 자리에서 RED가 된다.

**SQL은 스키마를 한정하지 않는다(계약).** `db/migrations/001_create_notes.sql`도 `src/repo/notes.js`의 문장도 `public.`을 쓰지 않고, `src/app.js`는 Pool config에 `options`를 넣지 않는다(config가 env를 이기므로 — `pg/lib/connection-parameters.js:83` — 넣는 순간 `PGOPTIONS`가 죽는다). 프로덕션은 기본 `search_path`(public)로 돌고 게이트는 전용 스키마로 도는데, 이 계약이 그 둘을 같은 코드 경로 위에 남게 하는 유일한 장치다. 002·003이 `public.`을 한 줄 박으면 조용히 죽는 것은 001의 integration 테스트다.

**운영 적용 런북(사람이 실행한다):** `psql "$DATABASE_URL" -f db/migrations/001_create_notes.sql`.
되돌림은 코드로 출하하지 않는다 — 이 PR을 revert해도 `notes` 테이블은 남고(순수 additive라 무해하다), 제거가 필요하면 사람이 `DROP TABLE notes`를 직접 판단해 실행한다(파괴적 스키마 변경은 CHARTER NEVER_AUTOMATE).

**연결 설정:** 진입점은 `process.env.DATABASE_URL`만 읽는다. 하드코딩 DSN fallback도, 기동 시점 fail-fast도 두지 않는다(후자는 `/healthz` ready 신호를 굶긴다). 설정이 틀리면 요청 시점에 503으로 드러난다 — repo가 연결류 오류를 `db_unavailable`로 번역하고 `src/app.js`가 그 code만 503으로 매핑한다. **DSN에서 자주 틀리는 것(비밀번호·사용자·데이터베이스 이름)은 소켓 오류가 아니라 서버가 핸드셰이크에서 돌려주는 SQLSTATE로 온다**(`28P01`·`28000`·`3D000`) — 그래서 그 셋도 연결류 집합에 있고 503이다(`test_2_connection_setup_failures_are_503`). 연결류가 아닌 예외는 500이다(전면 catch→503은 진짜 장애를 구별 불가능하게 만든다).
`DATABASE_URL`을 아예 빠뜨리면 pg 자신의 기본 해석(localhost:5432, user = `$USER`)으로 붙는다 — 기동은 성공하고, 잘못된 로컬 DB가 있으면 조용히 그쪽에 쓴다. 게이트는 이 경로를 밟지 않는다(결과가 코드가 아니라 실행 머신의 성질에 걸리기 때문이다 — 001 plan handoff non_goals). 배포 체크리스트의 항목이다.

**당직 런북 — 마이그레이션을 빠뜨린 배포에서 실제로 보이는 것:** `POST /notes`가 **500 `{"error":{"code":"internal_error"}}`**이고 503이 아니다. pg는 SQLSTATE를 `ECONNREFUSED`와 같은 `err.code` 필드에 싣지만(`pg-protocol`), repo는 "DB에 닿지 못했다"에 해당하는 코드 집합만 `db_unavailable`로 번역하므로 `42P01`(relation "notes" does not exist)은 번역되지 않는다 — 그 커넥션은 **성공했다**. 즉 **503이면 DB에 닿지 못한 것(주소·자격증명·데이터베이스 이름·서버 상태)이고, 500이면 붙기는 했는데 이 배포가 위 런북을 실행하지 않은 것이다** — 503을 보고 DB를 30분 들여다보는 일이 없도록 두 신호를 갈라 둔다. 관측은 `test_2_db_failure_503_but_bug_is_not_503`(주입된 42P01 → 500)과 `test_2_connection_setup_failures_are_503`(주입된 28P01·28000·3D000 → 503), 그리고 integration의 dw1(repo SQL을 `public.notes`로 한정하면 같은 500 봉투가 나온다)이 함께 지킨다.

**배선의 위치와 드라이버 로딩:** `src/app.js`의 `createDbFromEnv()`가 `DATABASE_URL`로 `pg.Pool`을 만들고 `createAppFromEnv()`가 그것을 `createApp({ db })`에 넘긴다. 진입점 가드(`node src/app.js`)는 그 둘을 부르고 `listen`할 뿐이다 — 이것이 `npm start`가 타는 유일한 배선이다. **이 배선은 이제 실제 Postgres 앞에서 관측된다**: `test_2_shipped_entrypoint_persists_note_in_isolated_schema`(dw1)가 그 명령을 그대로 자식 프로세스로 띄워 201을 받고, 앱이 아닌 테스트 커넥션이 저장된 행을 본다. 드라이버 로딩이 동적 import로 남아 있는 이유는 하나뿐이다 — `loadDriver`를 주입해 **배선만** 보는 단위 테스트(`test_2_entrypoint_wires_db_from_database_url`)가 소켓 없이 돌아야 한다. 드라이버를 못 부르면 기동이 그 자리에서 실패한다: 그것은 요청 시점 503으로 덮을 일이 아니라 설치 사고다.
**드라이버 부재용 fallback은 지웠다.** `pg`가 랜딩하기 전의 `createDbFromEnv`는 로딩 실패를 삼키고 모든 `query`를 `db_unavailable`로 reject하는 실행자를 돌려줬다. 그 형태는 정상 Postgres를 앞에 두고도 `POST /notes`가 201 대신 503을 답하고 **한 행도 저장되지 않는 상태**를 "기동 성공"으로 보이게 했다(#2 review의 must_fix `spec1`·`qa1` — 두 리뷰어가 실제 Postgres 앞에서 503과 `count(*) = 0`을 독립으로 재현했다). 같은 상태를 이름 붙여 게이트에 고정하는 테스트도 두지 않는다 — `tests_are_load_bearing=true` 아래에서 "저장이 안 되는 게 정상"이 영구 계약이 된다(001 plan handoff non_goals).
**idle client 오류:** 만들어진 pool에는 `error` 리스너를 붙인다. node-postgres의 Pool은 idle client가 죽으면 자기 자신에게 `error`를 emit하고, 리스너가 없는 EventEmitter의 `error`는 Node가 throw해 프로세스를 죽인다 — DB 블립이 요청 시점 503이 아니라 프로세스 사망(그리고 `/healthz` 정지)이 되는 것을 막는다. **이 한 줄을 지키는 게이트는 없다**: 그것을 관측하는 done_when을 001이 만들지 않기로 했고(plan handoff non_goals — 스펙 전문에 유휴 커넥션·프로세스 생존 요구가 0건이다), 그래서 누군가 이 리스너를 지워도 스위트는 초록이다. 귀결은 아래 §Constraints에 적는다.

## Interfaces

| Method | Path | 응답 |
|--------|------|------|
| POST | `/notes` | 201 `{id,title,body,created_at}` / 400 |
| GET | `/notes?limit=&offset=` | 200 `{items:[...],total}` |
| GET | `/notes?q=` | 200 `{items:[...],total}` |
| GET | `/healthz` | 200 `{ok:true}` + 응답 헤더 `Cache-Control: no-store` (#8 — 프록시·브라우저가 헬스체크 응답을 재사용하지 못하게) |

**`id`와 `created_at`의 와이어 타입(관측으로 확정).** `POST /notes` 201의 `id`는 **JSON 문자열**이다(`"1"`, `/^[0-9]+$/`). DDL이 `bigserial`(= `int8`)이고 node-postgres는 `int8`을 기본으로 JS 문자열로 돌려주기 때문이다 — JS `number`가 2^53-1 너머의 값을 잃지 않게 하려는 드라이버의 기본값이고, 바꾸려면 `pg.types.setTypeParser(20, …)`를 명시해야 한다. `created_at`은 **밀리초까지 있는 UTC ISO-8601 문자열**이다(`2026-01-01T00:00:00.000Z` — `new Date(v).toISOString() === v`). 이 두 값은 `test_2_shipped_entrypoint_persists_note_in_isolated_schema`(dw1)가 실제 드라이버를 지나 관측한 것이고, 바꾸는 것은 클라이언트를 깨뜨리는 사람의 결정이다(CHARTER NEVER_AUTOMATE). 002의 `id DESC` 계약(`docs/features/002-list-notes.md:36,:57,:82`)은 정렬을 DB에 맡겨야 한다 — 문자열 `"10" < "9"` 이므로 JS에서 정렬하면 조용히 틀린다.

**오류 code의 이름은 여기서 정한다(클라이언트가 `code`로 분기한다 — CHARTER).** `invalid_request` → 400(검증 실패, body-parser가 클라이언트 잘못으로 표시한 4xx), **`db_unavailable` → 503**(repo가 "DB에 닿지 못했다"를 번역한 것 — `ECONNREFUSED`·`ETIMEDOUT` 같은 소켓 오류, PostgreSQL class 08·57P0x·53300, 그리고 **연결 수립 자체가 거절되는 SQLSTATE `28000`·`28P01`(자격증명/`pg_hba`)과 `3D000`(DSN이 가리키는 데이터베이스가 없다)**), **`internal_error` → 500**(그 밖의 모든 예외: 프로그래밍 버그, 그리고 `42P01`처럼 **연결은 됐는데 스키마가 없는** 경우). 002·003은 새 이름을 발명하지 말고 이 셋을 쓴다.

**Error Format:** `{ "error": { "code": "invalid_request", "message": "title is required" } }` — 조용히 버리지 않는다(PROJECT 원칙 3).

**클라이언트 잘못은 4xx로 남는다.** body-parser가 `expose: true`와 4xx 상태코드로 표시한 오류(파싱 실패 400, 지원하지 않는 charset·content-encoding 415, 압축 해제 실패 400)는 그 상태코드를 그대로 쓰고 code는 `invalid_request`다 — 500 `internal_error`로 내리면 사용자가 고칠 수 있는 실수가 서버 장애로 보고된다(`001-create-note.md` "500이 아니다"). 메시지는 요청 본문도 헤더 값도 에코하지 않는 고정 문장이다. 본문 길이 상한과 413 의미론은 여전히 이 프로젝트가 정하지 않고 파서에 위임한다.

## Testing Strategy

| Level | Scope | Tool | Rationale |
|-------|-------|------|-----------|
| unit | service 규칙(검증·정규화·정렬 키), 순수 함수 | vitest | DB 없이 빠르게 규칙을 고정 |
| integration | routes→service→repo, 실제 Postgres에 SQL 실행 | vitest + docker compose | SQL·스키마 오류는 unit이 못 잡는다 |
| e2e | 앱 기동 후 HTTP 표면 | Playwright | 존재하지만 M1에서는 게이트가 아님(M2 승격 대상) |

**Coverage Principle:** 변경된 줄 기준 diff coverage 90% — 전체 % 는 쓰지 않는다.
**What NOT to Test:** Express 내부, pg 드라이버, 라우팅 등록 같은 글루 — 프레임워크가 이미 보장하는 것.
단 `/healthz`의 **관측 가능한 응답 계약**(200 / `{ok:true}` / `Cache-Control: no-store`)은 글루가 아니라 계약이므로 회귀 가드를 둔다(#8, `test/smoke.test.js`).

## Constraints

**Performance:** 검색 p95 < 200ms @ 1k건. **Security:** 인증 없음(내부망 전용, PROJECT Boundaries). **Deployment:** `npm start` 단일 프로세스. **Platforms:** Linux/macOS, Node 22.

**단일 프로세스 배포의 귀결(001이 게이트를 두지 않은 자리):** 배포가 `npm start` 단일 프로세스이므로 그 프로세스가 죽으면 `/notes`와 `/healthz`가 **함께** 사라지고, 그때 사용자가 보는 것은 503 봉투가 아니라 connection refused다. 알려진 벡터 둘이 커버리지 0으로 남는다. (1) 유휴 커넥션 오류 — `src/app.js`가 `pool.on("error")`를 등록하지만 그 사실을 관측하는 테스트가 없다. (2) 응답하지 않는 `query` — 저장소 어디에도 `connectionTimeoutMillis`/`query_timeout` 설정이 없고 node-postgres 기본은 무한 대기라, 걸린 요청이 쌓이면 단일 프로세스가 통째로 응답 불가가 된다. 둘 다 001의 스펙에 근거가 없어(타임아웃 값·소유 계층·`error.code`가 docs/** 어디에도 기록이 없다) 이 이슈에서 운영 파라미터를 발명하지 않기로 했다 — 별도 이슈의 자리이고, 반대 의견은 001 plan handoff의 `dissent_log`·`open_risks`에 operator·product-advocate 이름으로 남아 있다.

## Key Decisions

### TDR-1: 저장소로 PostgreSQL을 쓴다 (SQLite 아님)

**Context:** 노트를 어디에 저장할지 — 파일 기반 SQLite가 더 가볍다.

| Option | Pros | Cons |
|--------|------|------|
| SQLite(파일) | 의존성 0, 컴포즈 불필요 | 테스트 환경이 이미 Postgres — 두 DB를 동시에 들고 가게 됨 |
| PostgreSQL 16 | 테스트 컴포즈·integration 스모크가 이미 존재, full-text 이관 가능 | 컨테이너가 필요(테스트 시작 비용) |

**Decision:** PostgreSQL 16.
**Why:** repo에 이미 `docker-compose.test.yml`(postgres:16)과 `test/integration/db.test.js`가 살아 있다. 하네스 성숙도 M1의 근거가 그 파일들이므로, 저장소를 SQLite로 잡으면 선언(TECHNICAL)과 실제 하네스가 어긋난다.
**Consequences:** integration 레벨이 컴포즈에 묶인다(그래서 `[test.env].compose`가 채워져 있다). 로컬에서 docker가 없으면 unit만 돈다.
**Validation:** `factory doctor`의 integration 스모크가 GREEN이면 선언과 하네스가 일치한다.

### TDR-2: 검색은 `ILIKE '%q%'`로 시작한다

**Context:** 003 검색을 어떻게 구현할지.

| Option | Pros | Cons |
|--------|------|------|
| `ILIKE '%q%'` | 한 줄, 스키마 변경 없음 | 인덱스를 못 타 건수가 늘면 선형 |
| `tsvector` full-text | 확장성 | 마이그레이션·형태소 설정 비용, MVP에 과함 |

**Decision:** `ILIKE '%q%'` + `created_at DESC` 정렬.
**Why:** MVP 가정은 1만 건 이하(Assumptions). 되찾기의 체감 가치를 먼저 확인한다.
**Consequences:** 1k건에서 p95를 측정해 임계를 넘으면 full-text 이관 이슈를 연다.
**Validation:** 003의 done_when에 1k건 시드 후 응답 시간 확인 항목을 둔다.

## Risk Register

**Riskiest Decision:** TDR-2
- **Why risky:** 데이터가 커진 뒤 바꾸면 인덱스·마이그레이션·API 호환을 한 번에 건드려야 한다.
- **Validate by:** 003 머지 직후 1k건 시드 측정.
- **Fallback:** `tsvector` 컬럼 + GIN 인덱스 추가(응답 형식 불변).

## Assumptions

- 노트 1만 건 이하 — if wrong: LIKE 검색이 무너짐 → TDR-2의 fallback 실행

---

*Generated by know-thy-build | 2026-09-12*
