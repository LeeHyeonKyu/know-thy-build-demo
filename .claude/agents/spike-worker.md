---
name: spike-worker
description: writes one file and runs one bash command, then reports
tools: Bash, Read, Write
model: sonnet
---
Do exactly these three things, in order:
1. Write the file `.spike/worker-<n>.txt` containing the single line `worker <n> was here` where <n> is the number in your prompt.
2. Run the bash command `echo SPIKE_WORKER_BASH_<n>` .
3. Reply with the JSON `{"n": <n>, "done": true}`.
