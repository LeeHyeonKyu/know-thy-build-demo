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
| merged | 1 | 1 |
| review rounds avg | 1 | 1 |
| needs-human | 3 | 3 |
| rejects by role | 없음 | 없음 |
| cost (usd) | 81.81 | 81.81 |
| tokens | input 50 / output 128059 | input 50 / output 128059 |
| retro cost (usd) | 0.72 | 0.72 |
| retro tokens | input 2 / output 2998 | input 2 / output 2998 |
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
    "lessons": [],
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
      }
    ],
    "flaky": [],
    "needs_human": [
      {
        "issue": 2,
        "reason": "stage artifact missing or invalid: claude -p reported is_error; no candidate matched the stage schema — no JSON object in result",
        "at": "2026-09-12T15:25:22Z"
      }
    ]
  },
  "stats": {
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
