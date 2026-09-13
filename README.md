# know-thy-build-demo

## What

HTTP로 메모를 남기고 되찾기 위한 최소 노트 API다. Node 22 + Express 5 단일 프로세스로 돌고,
테스트용 저장소는 PostgreSQL 16(`docker-compose.test.yml`)이다.

이 README는 **오늘 이 저장소에 실제로 있는 것**만 적는 인덱스다. 제품 배경과 대상 사용자는
`docs/PROJECT.md`, 스택·아키텍처·테스트 전략과 그 결정 근거는 `docs/TECHNICAL.md`,
테스트 작성 규칙(결정성·네이밍·증거)은 `docs/QA.md`를 본다. 아직 구현되지 않은 기능의 스펙은
`docs/features/` 아래에 있다 — 그 문서들이 묘사하는 구조는 **목표 상태**이지 현재 트리가 아니다.

## Endpoints

상태 표기는 둘 중 하나다: `implemented` = 지금 소스에 존재해 응답한다 / `planned` = 스펙만 있고 코드가 없다.

- GET /healthz — implemented — 200 `{"ok":true}` + 응답 헤더 `Cache-Control: no-store`
- POST /notes — planned — 스펙: `docs/features/001-create-note.md`
- GET /notes — planned — 스펙: `docs/features/002-list-notes.md`, `docs/features/003-search.md`

`planned` 항목은 아직 소스에 라우트가 없다 — 응답을 기대하지 말고, 구현하는 사람은 해당 스펙 문서부터 읽는다.

서비스를 띄워 `implemented` 항목을 확인하려면(기본 3000 포트, `PORT` 환경변수로 바꾼다):

```bash
npm start
curl -i http://localhost:3000/healthz
```

## Run tests

아래 순서를 그대로 따른다. 2번을 건너뛰면 3번이 통합 테스트에서 실패한다.

```bash
npm ci
docker compose -f docker-compose.test.yml up -d
npm test
```

1. `npm ci` — 의존성 설치.
2. compose 기동 — `test/integration/db.test.js`가 `docker compose ... psql`을 무조건 실행하므로,
   Postgres가 떠 있지 않으면 그 파일은 예외로 끝난다.
3. `npm test` — `test/` 아래 unit과 integration이 **한 실행**에 함께 돈다(러너는 vitest).

docker를 쓸 수 없는 환경이라면 통합 테스트만 제외하고 돌린다 — 파일을 하나씩 열거하지 않으므로
나중에 추가된 unit 테스트도 함께 돈다:

```bash
npx vitest run --exclude 'test/integration/**'
```

이때 통합 테스트는 실행되지 않으므로, 머지 전에는 compose를 띄운 전체 실행으로 한 번 더 확인한다.

e2e(`e2e/smoke.spec.js`, Playwright)는 `npm run e2e`로 돌린다. 하네스 성숙도가 M1인 동안
e2e는 게이트 밖이다(`docs/TECHNICAL.md` §Testing Strategy).

## Layout

| 경로 | 무엇이 있나 |
|---|---|
| `src/app.js` | 소스 전부. Express 앱 구성 + `/healthz` 라우트 등록 + `app.listen`. `npm start`의 진입점 |
| `test/smoke.test.js` | unit 스모크 + `/healthz` 응답 계약 회귀 가드 |
| `test/integration/db.test.js` | integration 스모크 — compose로 띄운 Postgres에 접속한다 |
| `e2e/smoke.spec.js` | Playwright e2e — M1에서는 게이트 밖 |
| `docker-compose.test.yml` | 테스트용 PostgreSQL 16 |
| `docs/` | 제품·기술·QA 문서와 기능 스펙 |

`src/` 아래에는 오늘 `src/app.js` 하나뿐이다. `docs/TECHNICAL.md` §Architecture가 그리는
`routes → service → repository` 3층은 001~003을 구현할 때 만들어질 **목표 구조**이며,
그 디렉터리들은 아직 존재하지 않는다.
