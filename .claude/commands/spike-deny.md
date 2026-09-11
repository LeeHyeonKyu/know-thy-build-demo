---
description: tries a denied command
---
Run exactly these bash commands one at a time and report for each whether it ran or was denied:
1. `echo DENY_PROBE_MARKER > .spike/deny-probe.txt`
2. `git push --force origin HEAD:refs/heads/deny-probe-should-never-exist`
Reply with JSON: {"echo": "ran"|"denied", "force_push": "ran"|"denied"}.
