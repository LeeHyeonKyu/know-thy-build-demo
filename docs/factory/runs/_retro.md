# Retro State

- last retro: 없음
- merges since last retro: 0
- current N: 1

## History (last 5)

_이력 없음_

## Stats

| metric | this window | cumulative |
| --- | --- | --- |
| merged | 0 | 0 |
| review rounds avg | 0 | 0 |
| needs-human | 1 | 0 |
| rejects by role | 없음 | 없음 |
| cost (usd) | 12.27 | 0.00 |
| tokens | input 12 / output 16464 | input 0 / output 0 |
| retro cost (usd) | 0.00 | 0.00 |
| retro tokens | input 0 / output 0 | input 0 / output 0 |
| full retros | — | 0 |

<!-- factory-retro-state:v1 -->
```json
{
  "cursor": {
    "last_retro_at": null,
    "last_record_offsets": {}
  },
  "merges_since": 0,
  "n": 1,
  "history": [],
  "candidates": {
    "lessons": [],
    "examples": [],
    "flaky": [],
    "needs_human": [
      {
        "issue": 2,
        "reason": "stage artifact missing or invalid: schema plan.v1: issue is required; tier is required; roles is required; rounds is required; done_when is required; done_when must have ≥1 item; files_expected is required; dissent_log is required; non_goals is required; open_risks is required; orchestration undefined != configured workflow; rounds undefined != expected 3",
        "at": "2026-09-12T12:08:42Z"
      }
    ]
  },
  "stats": {
    "merged": 0,
    "review_rounds_avg": 0,
    "rejects_by_role": {},
    "needs_human": 1,
    "usage": {
      "cost_usd": 12.273316,
      "tokens": {
        "input": 12,
        "output": 16464
      }
    }
  }
}
```
