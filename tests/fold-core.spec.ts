import { describe, expect, it } from 'vitest'
import { planRunningTurnFold, planTurnFold, type FoldNodeDto, type FoldTurnDto } from '../src/client/fold-core.ts'

function completeTurn(overrides: Partial<FoldTurnDto> = {}): FoldTurnDto {
  const nodes: readonly FoldNodeDto[] = [
    { key: 'context-before', kind: 'context', anchorSeq: 1 },
    { key: 'user', kind: 'user', anchorSeq: 2 },
    { key: 'fold-start', kind: 'fold-start', anchorSeq: 2.001, sourceSeq: 2 },
    { key: 'assistant-process', kind: 'assistant-step', anchorSeq: 3 },
    { key: 'tool', kind: 'tool-call', anchorSeq: 4 },
    { key: 'steering', kind: 'steering', anchorSeq: 5 },
    { key: 'closing', kind: 'assistant-step', anchorSeq: 10, finalSeq: 10, reasoningCount: 1 },
    { key: 'fold-end', kind: 'fold-end', anchorSeq: 10.001 },
    { key: 'tail', kind: 'turn-tail', anchorSeq: 10.1 },
  ]
  return {
    turn: 7,
    status: 'closed',
    startTime: 1_000,
    endTime: 13_340,
    endReason: 'completed',
    closing: { finalSeq: 10, branchUnavailable: false },
    nodes,
    ...overrides,
  }
}

describe('planTurnFold', () => {
  it('folds only classified process rows after the normal user boundary', () => {
    const plan = planTurnFold(completeTurn())

    expect(plan).toMatchObject({
      eligible: true,
      startInputKey: 'user',
      startCandidateKey: 'fold-start',
      endToggleKey: 'fold-end',
      closingKey: 'closing',
      tailKey: 'tail',
      durationMs: 12_340,
      closingReasoningCount: 1,
    })
    expect(plan.hiddenKeys).toEqual(['assistant-process', 'tool'])
    expect(plan.hiddenKeys).not.toContain('context-before')
    expect(plan.hiddenKeys).not.toContain('steering')
  })

  it.each([
    ['open', 'completed', 'turn-not-closed'],
    ['closed', 'aborted', 'turn-not-completed'],
  ] as const)('fails open for %s/%s', (status, endReason, reason) => {
    const plan = planTurnFold(completeTurn({ status, endReason }))
    expect(plan).toMatchObject({ eligible: false, reason })
    expect(plan.hiddenKeys).toEqual([])
  })

  it('fails open for incomplete closing evidence and invalid duration', () => {
    expect(planTurnFold(completeTurn({ closing: undefined }))).toMatchObject({
      eligible: false,
      reason: 'missing-closing',
    })
    expect(planTurnFold(completeTurn({ closing: { finalSeq: 10, branchUnavailable: true } }))).toMatchObject({
      eligible: false,
      reason: 'branch-unavailable',
    })
    expect(planTurnFold(completeTurn({ endTime: 999 }))).toMatchObject({
      eligible: false,
      reason: 'invalid-duration',
    })
  })

  it('uses the latest normal user boundary and preserves everything before it', () => {
    const earlier = [
      { key: 'user-early', kind: 'user', anchorSeq: 0.5 },
      { key: 'fold-start-early', kind: 'fold-start', anchorSeq: 0.501, sourceSeq: 0.5 },
      { key: 'tool-before-final-user', kind: 'tool-call', anchorSeq: 0.75 },
    ] satisfies readonly FoldNodeDto[]
    const original = completeTurn()
    const plan = planTurnFold({ ...original, nodes: [...earlier, ...original.nodes] })

    expect(plan).toMatchObject({ eligible: true, startInputKey: 'user', startCandidateKey: 'fold-start' })
    expect(plan.hiddenKeys).not.toContain('tool-before-final-user')
  })

  it('fails open instead of falling back to an earlier user whose start candidate exists', () => {
    const original = completeTurn()
    const nodes = [
      { key: 'user-early', kind: 'user', anchorSeq: 0.5 },
      { key: 'fold-start-early', kind: 'fold-start', anchorSeq: 0.501, sourceSeq: 0.5 },
      ...original.nodes,
    ].filter(node => node.key !== 'fold-start') satisfies readonly FoldNodeDto[]

    expect(planTurnFold({ ...original, nodes })).toMatchObject({
      eligible: false,
      reason: 'missing-fold-start',
    })
  })

  it('fails the complete turn open when a visible node kind is not classified', () => {
    const original = completeTurn()
    const nodes = [...original.nodes]
    nodes.splice(5, 0, { key: 'future-plugin-node', kind: 'future-plugin-node', anchorSeq: 4.5 })

    expect(planTurnFold({ ...original, nodes })).toMatchObject({
      eligible: false,
      reason: 'unknown-node-kind',
    })
  })

  it('falls back to a claimed next-step steering message when no normal user is present', () => {
    const original = completeTurn()
    const nodes = original.nodes.map(node => node.key === 'user' ? { ...node, kind: 'steering' } : node)

    expect(planTurnFold({ ...original, nodes })).toMatchObject({
      eligible: true,
      startInputKey: 'user',
      startCandidateKey: 'fold-start',
    })
  })

  it('keeps a think-only completed turn eligible but omits controls with no process or Think content', () => {
    const original = completeTurn()
    const thinkOnlyNodes = original.nodes.filter(node => node.key !== 'assistant-process' && node.key !== 'tool')
    expect(planTurnFold({ ...original, nodes: thinkOnlyNodes }).eligible).toBe(true)

    const noContentNodes = thinkOnlyNodes.map(node => node.key === 'closing' ? { ...node, reasoningCount: 0 } : node)
    expect(planTurnFold({ ...original, nodes: noContentNodes })).toMatchObject({
      eligible: false,
      reason: 'no-collapsible-content',
    })
  })

  it('exposes a running status only after an open human input receives its start candidate', () => {
    const original = completeTurn()
    const runningNodes = original.nodes.slice(0, 4)
    const running = planRunningTurnFold({
      ...original,
      status: 'open',
      endTime: undefined,
      endReason: undefined,
      closing: undefined,
      nodes: runningNodes,
    })

    expect(running).toEqual({ turn: 7, startCandidateKey: 'fold-start', startedAt: 1_000 })
  })
})
