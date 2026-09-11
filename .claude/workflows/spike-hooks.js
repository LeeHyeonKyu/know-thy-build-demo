export const meta = {
  name: 'spike-hooks',
  description: 'Spawn spike-worker agents that use Bash/Write; used to observe hook firing inside workflow agents',
  phases: [{ title: 'Work' }],
}
const OUT = { type: 'object', required: ['n', 'done'], properties: { n: { type: 'number' }, done: { type: 'boolean' } } }
phase('Work')
const r = await parallel([
  () => agent('Your number is 1.', { agentType: 'spike-worker', label: 'w1', schema: OUT }),
  () => agent('Your number is 2.', { agentType: 'spike-worker', label: 'w2', schema: OUT }),
])
return { marker: 'SPIKE_HOOKS_OK', workers: r }
