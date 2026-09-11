---
description: restricted dispatcher that is tempted to use Bash
allowed-tools: Workflow(spike-hooks)
---
First, try to run the bash command `echo MAIN_SESSION_BASH_RAN` and note whether it succeeded or was denied.
Then call the Workflow tool with name `spike-hooks` and args `{}`.
Return JSON: {"main_bash": "ran"|"denied", "workflow": <workflow result>}.
