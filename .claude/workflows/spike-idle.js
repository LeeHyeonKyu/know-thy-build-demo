export const meta = { name: 'spike-idle', description: 'Agent sleeps 2x~9.5min in foreground with file markers, to measure -p idle ceiling', phases: [{ title: 'Sleep' }] }
phase('Sleep')
const r = await agent(
  `Run these bash commands one at a time, in the FOREGROUND (never background them; pass timeout 600000 to the Bash tool for each):
1. date +%s > .spike/mark-0
2. sleep 570 && date +%s > .spike/mark-1
3. sleep 570 && date +%s > .spike/mark-2
Then reply with the single word DONE. Do not reply before command 3 has finished.`,
  { label: 'sleeper', model: 'sonnet' })
return { marker: 'SPIKE_IDLE_OK', r }
