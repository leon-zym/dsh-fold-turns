import type { ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { foldEndDefinition } from '../src/client/definitions/fold-end.ts'
import { foldStartDefinition } from '../src/client/definitions/fold-start.ts'

describe('fold node Definitions', () => {
  it('creates a fold-start candidate only for ordinary user-source messages', () => {
    const event = {
      type: 'user/message',
      seq: 42,
      data: { id: 'message-1', source: { kind: 'user' }, surface: { placement: 'append' } },
    }
    const match = foldStartDefinition.match(event as never)
    expect(match).toEqual({ id: 'message-1', role: 'start' })
    const state = foldStartDefinition.start({} as never, { event } as never, {} as never)
    const context = {
      key: 'candidate-1',
      id: 'message-1',
      state,
      start: { location: { kind: 'turn', turn: {} } },
      matches: [],
    } as unknown as ConversationNodeContext<typeof state>

    expect(foldStartDefinition.buildViewNode?.(context)).toMatchObject({
      kind: 'fold-start',
      anchorSeq: 42.001,
      data: { sourceSeq: 42 },
    })
  })

  it('anchors fold-end immediately after the host-provided closing assistant', () => {
    const turn = {
      data: { get: () => ({ closing: { finalNode: { seq: 88 } }, branchUnavailable: false }) },
    }
    const context = {
      key: 'end-1',
      id: '7',
      state: { turn: 7, endSeq: 99 },
      start: { location: { kind: 'turn', turn } },
      matches: [],
    } as unknown as ConversationNodeContext<{ readonly turn: number; readonly endSeq?: number }>

    expect(foldEndDefinition.buildViewNode?.(context)).toMatchObject({
      kind: 'fold-end',
      anchorSeq: 88.001,
      visibility: 'visible',
      data: { turn: 7 },
    })
  })

  it('keeps fold-end hidden when closing.finalNode is structurally incomplete', () => {
    const turn = {
      data: { get: () => ({ closing: {}, branchUnavailable: false }) },
    }
    const context = {
      key: 'end-1',
      id: '7',
      state: { turn: 7, endSeq: 99 },
      start: { location: { kind: 'turn', turn } },
      matches: [],
    } as unknown as ConversationNodeContext<{ readonly turn: number; readonly endSeq?: number }>

    expect(() => foldEndDefinition.buildViewNode?.(context)).not.toThrow()
    expect(foldEndDefinition.buildViewNode?.(context)).toMatchObject({
      anchorSeq: 99,
      visibility: 'hidden',
    })
  })
})
