# know-thy-build-demo

## What

HTTP로 메모를 남기고 되찾기 위한 최소 노트 API다. Node 22 + Express 5 단일 프로세스로 돌고,
테스트용 저장소는 PostgreSQL 16(`docker-compose.test.yml`)이다.

이 README는 **오늘 이 저장소에 실제로 있는 것**만 적는 인덱스다. 제품 배경과 대상 사용자는
`docs/PROJECT.md`, 스택·아키텍처·테스트 전략과 그 결정 근거는 `docs/TECHNICAL.md`,
테스트 작성 규칙(결정성·네이밍·증거)은 `docs/QA.md`를 본다. 아직 구현되지 않은 기능의 스펙은
`docs/features/` 아래에 있다 — 그 문서들이 묘사하는 구조는 **목표 상태**이지 현재 트리가 아니다.

## Endpoints

오늘 이 서비스가 등록하는 라우트는 하나뿐이다. 나머지 줄은 스펙 문서를 가리키며, 그 문서가
묘사하는 것은 아직 코드가 아니다 — 구현하는 사람은 해당 스펙부터 읽는다.

- GET /healthz — 오늘 응답한다. 200 `{"ok":true}` + 응답 헤더 `Cache-Control: no-store`
- POST /notes — 스펙: `docs/features/001-create-note.md`
- GET /notes — 스펙: `docs/features/002-list-notes.md`(목록), `docs/features/003-search.md`(검색)

서비스를 띄워 오늘 응답하는 라우트를 직접 확인하려면(기본 3000 포트, 환경변수 **PORT**로 바꾼다):

```bash
npm start
curl -i http://localhost:3000/healthz
```

## Run tests

아래 순서를 그대로 따른다. 두 번째 줄을 건너뛰면 세 번째 줄이 통합 테스트에서 터진다.

```bash
npm ci
docker compose -f docker-compose.test.yml up -d --wait
npm test
```

1. `npm ci` — 의존성 설치.
2. DB 기동 — `--wait`은 Postgres의 healthcheck가 통과할 때까지 기다렸다가 반환한다.
   `test/integration/db.test.js`는 가용성을 스스로 확인하지 않고 곧바로 `psql`을 부르므로,
   기다리지 않고 다음 줄로 넘어가면 그 실패는 "DB가 아직 안 떴다"가 아니라 불투명한 연결 오류로 보인다.
   고정 대기(`sleep`)로 대신하지 않는다 — `docs/QA.md`의 결정성 규칙이 조건 대기만 허용한다.
3. `npm test` — `test/` 아래 unit과 integration이 **한 실행**에 함께 돈다(러너는 vitest).

docker를 쓸 수 없는 환경이라면 통합 테스트만 제외하고 돌린다 — 파일을 하나씩 열거하지 않으므로
나중에 추가된 unit 테스트도 함께 돈다:

```bash
npx vitest run --exclude 'test/integration/**'
```

이때 통합 테스트는 실행되지 않으므로, 머지 전에는 DB를 띄운 전체 실행으로 한 번 더 확인한다.

e2e(`e2e/smoke.spec.js`, Playwright)는 `npm run e2e`로 돌린다. 하네스 성숙도가 M1인 동안
e2e는 게이트 밖이다(`docs/TECHNICAL.md` §Testing Strategy).

## Layout

| 경로 | 무엇이 있나 |
|---|---|
| `src/app.js` | 소스 전부. Express 앱 구성 + 헬스 라우트 등록 + `app.listen()` 호출. `npm start`의 진입점 |
| `test/smoke.test.js` | unit 스모크 + 헬스 응답 계약 회귀 가드 |
| `test/readme.test.js` | 이 README의 회귀 가드 — 아래 규칙을 강제한다 |
| `test/integration/db.test.js` | integration 스모크 — 컴포즈로 띄운 Postgres에 접속한다 |
| `e2e/smoke.spec.js` | Playwright e2e — M1에서는 게이트 밖 |
| `docker-compose.test.yml` | 테스트용 PostgreSQL 16 |
| `docs/` | 제품·기술·QA 문서와 기능 스펙 |

`src/` 아래에는 오늘 `src/app.js` 하나뿐이다. `docs/TECHNICAL.md` §Architecture가 그리는
`routes → service → repository` 3층은 001~003을 구현할 때 만들어질 목표 구조다 —
`src/routes/notes.js`·`src/service/notes.js`·`src/repo/notes.js` (아직 없음).

이 README에서 백틱으로 적힌 저장소 경로는 (아직 없음) 이라고 밝힌 것을 빼면 전부 디스크에
실재해야 하고, 안내하는 npm 스크립트는 `package.json`에 실재해야 한다. 경로가 아닌 낱말
(환경변수, 어휘)은 백틱 대신 굵게 적는다. 그래서 이 파일을 고칠 때는 `npm test`가 같이 돈다.
