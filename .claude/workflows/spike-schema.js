export const meta = {
  name: 'spike-schema',
  description: 'Measure StructuredOutput reliability: 20 agents with a verdict-like schema',
  phases: [{ title: 'Verdicts' }],
}
const VERDICT = {
  type: 'object',
  required: ['verdict', 'confidence', 'must_fix', 'verified'],
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'reject'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    must_fix: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'where', 'claim', 'evidence'], additionalProperties: false,
        properties: { id: { type: 'string' }, where: { type: 'string' }, claim: { type: 'string' }, evidence: { type: 'string' } },
      },
    },
    verified: { type: 'array', items: { type: 'string' } },
  },
}
const SNIPPET = `
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
export function isWeekend(d) { return [0, 6].includes(new Date(d).getDay()); }
`
phase('Verdicts')
const items = Array.from({ length: 20 }, (_, i) => i)
const out = await pipeline(items, i =>
  agent(`You are a correctness reviewer. Review this snippet and produce a verdict. Case ${i}.\n${SNIPPET}\nIf you find a timezone issue, reject with one must_fix item; otherwise approve.`, { label: `v${i}`, schema: VERDICT, model: i % 2 ? 'sonnet' : 'opus' }))
const nulls = out.filter(x => x === null).length
const total = 20
const rejects = out.filter(x => x && x.verdict === 'reject').length
// even index = opus, odd index = sonnet (see model: i % 2 ? 'sonnet' : 'opus')
return { marker: 'SPIKE_SCHEMA_OK', total, nulls, rejects, out }
