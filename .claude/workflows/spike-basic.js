export const meta = {
  name: 'spike-basic',
  description: 'Two parallel agents with schema; proves -p can run a saved workflow',
  phases: [{ title: 'Answer' }],
}

const ANSWER = {
  type: 'object',
  required: ['answer', 'claude_md_marker'],
  properties: {
    answer: { type: 'string' },
    claude_md_marker: { type: 'string', description: 'value of MARKER_CLAUDE_MD_LOADED from CLAUDE.md, or "absent"' },
  },
}

phase('Answer')
const results = await parallel([
  () => agent(`Reply with answer "alpha-${args.n}". Also report the MARKER_CLAUDE_MD_LOADED value if you see it in your context.`, { label: 'a', schema: ANSWER }),
  () => agent(`Reply with answer "beta-${args.n}". Also report the MARKER_CLAUDE_MD_LOADED value if you see it in your context.`, { label: 'b', schema: ANSWER }),
])

return { marker: 'SPIKE_BASIC_OK', n: args.n, agents: results }
