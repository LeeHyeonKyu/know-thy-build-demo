---
schema: factory.charter.v1
status: ready
tier_default: standard
limits: { K: 3, M: 3, R: 2 }
roster:
  docs: [correctness, spec-conformance]
  standard: [correctness, architecture, spec-conformance, qa]
  load-bearing: [correctness, security, architecture, spec-conformance, qa]
plan_roles:
  docs: [architect, skeptic]
  default: [product-advocate, architect, skeptic, operator]
plan_rounds: { docs: 2, default: 3 }
back_pressure: { awaiting_review_max: 4 }   # quarantine 상한은 두지 않는다 — harness.toml [gates.thresholds].quarantine_max가 유일한 출처(§5.1, Plan 1b 실행 판결)
budget: {}
retro: { every_merges: { initial: 1, min: 1, max: 20 }, light_on_merge: true }
merge: { human_gate: false }   # dark dogfood repo — owner decision (audit H6)
triage: { default: ready }     # dogfood repo: default-allow on purpose (audit M1)
---

# Charter — know-thy-build-demo

## Tiers
| tier | 판정 기준 | 리뷰 로스터 | gate 레벨 | 예산(토큰/이슈) — 참고값, 기본 미적용 |
|---|---|---|---|---|
| docs | diff가 `docs/**`, `*.md`만 | correctness, spec-conformance | fast | 100k |
| standard | 기본 | correctness, architecture, spec-conformance, qa | full | 600k |
| load-bearing | `harness.toml [load_bearing]` 경로 포함 | correctness, security, architecture, spec-conformance, qa | deep | 1.2M |

## Plan 토론 로스터
| tier | 토론자 | 라운드 |
|---|---|---|
| docs | architect, skeptic | 2 (입장 → synthesizer 종합; 교차검토 생략) |
| standard / load-bearing | product-advocate, architect, skeptic, operator | 3 + 서명 |

## Hard limits
- review rounds K = 3
- same gate RED M = 3
- runner retries R = 2
- review 대기(awaiting-review) 이슈가 4개 이상이면 implement는 새 claim을 하지 않는다 (back-pressure)
- budget_tokens_per_issue: unset   # 선택·기본 off (ADR-005). 켜면 초과 시 **새 claim만** 거부하고 진행 중 스테이지는 죽이지 않는다. 기본 동작은 보고만(§4.4)

## NEVER_AUTOMATE (triage가 wont-do로 보냄)
- `notes` 테이블의 파괴적 스키마 변경(DROP/컬럼 삭제/타입 축소)과 기존 행을 잃는 마이그레이션 — 되돌릴 수 없는 데이터 손실은 사람의 결정이다
- 인증·접근 제어 도입 — PROJECT.md Boundaries("권한 모델 아님")를 넘는 범위 확장이므로 factory가 스스로 결정하지 않는다
- 공개 API(`src/routes/**`)의 breaking change
- `.env*`, 시크릿, 배포 스크립트(`scripts/deploy.sh`)

## Definition of Done (모든 tier 공통)
- plan handoff의 done_when 전항목이 verify 테스트로 증명됨
- gates GREEN (tier의 레벨)
- 새 테스트가 변경 없이 실패함 (prove-test)
- 기존 테스트 미수정
- diff가 files_expected 밖으로 나가지 않음 (초과 시 spec-conformance가 reject)
- run 기록 존재

## Preserve (바꾸면 안 되는 동작)
- `GET /healthz`는 200 `{"ok":true}`를 반환한다 — 컴포즈 healthcheck와 playwright webServer의 ready 신호가 여기에 걸려 있다
- 에러 응답은 항상 `{"error":{"code","message"}}` 형태다 — 클라이언트가 `code`로 분기하므로 필드명·중첩을 바꾸지 않는다

## Retro
every_merges: { initial: 1, min: 1, max: 20 }   # N은 수확량에 따라 자가 조정 (§8.4)
light_on_merge: true
