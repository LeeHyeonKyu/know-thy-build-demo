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

**Key Dependencies:** `express` — HTTP, `pg`(001에서 추가 예정) — DB 드라이버
**Dev Tools:** `vitest`, `@playwright/test`, `docker compose`
**Weakest Link:** 검색 구현(LIKE) — 데이터가 커지면 가장 먼저 바뀐다.

## Architecture

`routes → service → repository` 3층. 각 층은 아래층만 안다.

| Component | Responsibility | NOT Responsible For | Depends On |
|-----------|---------------|---------------------|------------|
| `src/app.js` | `createApp({db, now})` 팩토리, 라우트 등록, 도메인 code → 상태코드 매핑과 에러 봉투 | 비즈니스 규칙, SQL, 드라이버 오류 해석 | routes |
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

**마이그레이션:** `db/migrations/001_create_notes.sql`은 전진 전용(`CREATE TABLE IF NOT EXISTS`)이고, `src/repo/schema.js`의 `migrate(db)`가 그 파일을 적용한다. 동시 적용 경쟁의 패자 오류(`42P07`, `pg_type`/`pg_class` 고유 위반)는 이미 원하던 상태이므로 삼키고, 그 밖의 오류는 전파한다. **부팅 경로에서는 절대 부르지 않는다** — `GET /healthz`를 DB 가용성에 묶지 않기 위해서다(CHARTER Preserve). 코드 안의 호출자는 테스트 헬퍼뿐이다.

**운영 적용 런북(사람이 실행한다):** `psql "$DATABASE_URL" -f db/migrations/001_create_notes.sql`.
되돌림은 코드로 출하하지 않는다 — 이 PR을 revert해도 `notes` 테이블은 남고(순수 additive라 무해하다), 제거가 필요하면 사람이 `DROP TABLE notes`를 직접 판단해 실행한다(파괴적 스키마 변경은 CHARTER NEVER_AUTOMATE).

**연결 설정:** 진입점은 `process.env.DATABASE_URL`만 읽는다. 하드코딩 DSN fallback도, 기동 시점 fail-fast도 두지 않는다(후자는 `/healthz` ready 신호를 굶긴다). 설정이 틀리면 요청 시점에 503으로 드러난다 — repo가 연결류 오류를 `db_unavailable`로 번역하고 `src/app.js`가 그 code만 503으로 매핑한다. 연결류가 아닌 예외는 500이다(전면 catch→503은 진짜 장애를 구별 불가능하게 만든다).

## Interfaces

| Method | Path | 응답 |
|--------|------|------|
| POST | `/notes` | 201 `{id,title,body,created_at}` / 400 |
| GET | `/notes?limit=&offset=` | 200 `{items:[...],total}` |
| GET | `/notes?q=` | 200 `{items:[...],total}` |
| GET | `/healthz` | 200 `{ok:true}` + 응답 헤더 `Cache-Control: no-store` (#8 — 프록시·브라우저가 헬스체크 응답을 재사용하지 못하게) |

**Error Format:** `{ "error": { "code": "invalid_request", "message": "title is required" } }` — 조용히 버리지 않는다(PROJECT 원칙 3).

## Testing Strategy

| Level | Scope | Tool | Rationale |
|-------|-------|------|-----------|
| unit | service 규칙(검증·정규화·정렬 키), 순수 함수 | vitest | DB 없이 빠르게 규칙을 고정 |
| integration | routes→service→repo, 실제 Postgres에 SQL 실행 | vitest + docker compose | SQL·스키마 오류는 unit이 못 잡는다 |
| e2e | 앱 기동 후 HTTP 표면 | Playwright | 존재하지만 M1에서는 게이트가 아님(M2 승격 대상) |

**Coverage Principle:** 변경된 줄 기준 diff coverage 90% — 전체 % 는 쓰지 않는다.
**What NOT to Test:** Express 내부, pg 드라이버, 라우팅 등록 같은 글루 — 프레임워크가 이미 보장하는 것.
단 `/healthz`의 **관측 가능한 응답 계약**(200 / `{ok:true}` / `Cache-Control: no-store`)은 글루가 아니라 계약이므로 회귀 가드를 둔다(#8, `test/smoke.test.js`; #2가 `createApp()` 경로에도 같은 가드를 둔다 — `test/app.test.js`).
같은 이유로 **에러 봉투**(`{"error":{"code","message"}}`)와 **code → 상태코드 매핑**(400/503/500)도 테스트한다: 프레임워크가 보장하는 것은 라우팅이지 이 프로젝트의 오류 어휘가 아니다. 드라이버 내부(pg의 오류 객체가 어떻게 만들어지는지)는 여전히 테스트하지 않는다 — 가짜 실행자에 오류 **형태**만 주입한다.

## Constraints

**Performance:** 검색 p95 < 200ms @ 1k건. **Security:** 인증 없음(내부망 전용, PROJECT Boundaries). **Deployment:** `npm start` 단일 프로세스. **Platforms:** Linux/macOS, Node 22.

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
