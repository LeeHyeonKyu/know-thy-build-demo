export const meta = { name: 'spike-idle', description: 'One agent sleeps 12 minutes silently', phases: [{ title: 'Sleep' }] }
phase('Sleep')
const r = await agent('Run exactly this bash command and nothing else, then reply "SLEPT": sleep 720', { label: 'sleeper', model: 'sonnet' })
return { marker: 'SPIKE_IDLE_OK', r }
