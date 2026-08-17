import type { ChatConversationViewNode, ChatSnapshot, SessionFace, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { FoldModelController } from '../src/client/fold-model-controller.ts'

type SnapshotInput = {
  readonly turn: number
  readonly loadingOlder?: boolean
  readonly order?: readonly string[]
  readonly timeline?: object
  readonly closingBlocks?: readonly unknown[]
}

class FakeSession {
  private readonly listeners = new Set<() => void>()

  constructor(private snapshot: ReturnType<typeof snapshotFor>) {}

  getSnapshot(): ReturnType<typeof snapshotFor> {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(next: ReturnType<typeof snapshotFor>): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function snapshotFor({ turn, loadingOlder = false, order, timeline, closingBlocks = [{ kind: 'reasoning' }] }: SnapshotInput) {
  const keys = order ?? [`user-${turn}`, `start-${turn}`, `process-${turn}`, `end-${turn}`, `closing-${turn}`, `tail-${turn}`]
  const nodes = new Map<string, ChatConversationViewNode>([
    [keys[0] as string, node(keys[0] as string, 'user', 1)],
    [keys[1] as string, node(keys[1] as string, 'fold-start', 1.001, { sourceSeq: 1 })],
    [keys[2] as string, node(keys[2] as string, 'assistant-step', 2)],
    [keys[3] as string, node(keys[3] as string, 'fold-end', 2.999)],
    [keys[4] as string, node(keys[4] as string, 'assistant-step', 3, {
      finalNode: { seq: 3 },
      blocks: closingBlocks,
    })],
    [keys[5] as string, node(keys[5] as string, 'turn-tail', 3.1)],
  ])
  const tailData = { closing: { finalNode: { seq: 3 } }, branchUnavailable: false }
  const turnLocation = {
    turn,
    status: 'closed',
    start: { time: 1_000 },
    end: { time: 2_000, data: { reason: { kind: 'completed' } } },
    data: { get: (key: string) => key === 'turn-tail' ? tailData : undefined },
  } as unknown as TurnLocation
  const activeTimeline = timeline ?? { turnOrder: [turn], turns: new Map([[turn, turnLocation]]) }
  const chat = {
    order: keys,
    nodes: {
      get: (key: string) => nodes.get(key),
      values: () => [...nodes.values()],
    },
    locations: {
      getTurn: (candidate: number) => candidate === turn ? keys : [],
      getStep: () => [],
    },
    timeline: activeTimeline,
    legacy: {},
  } as unknown as ChatSnapshot
  return {
    chat,
    openState: 'open',
    loadingOlder,
  }
}

function node(key: string, kind: string, anchorSeq: number, data: unknown = {}): ChatConversationViewNode {
  return { key, kind, id: key, target: 'chat', anchorSeq, location: { kind: 'turn', turn: {} }, visibility: 'visible', data } as ChatConversationViewNode
}

describe('FoldModelController', () => {
  it('does not rescan ordinary content-only snapshot notifications', () => {
    const initial = snapshotFor({ turn: 1 })
    const session = new FakeSession(initial)
    const controller = new FoldModelController(session as unknown as SessionFace)
    const firstCount = controller.recomputeCount

    session.emit({ ...initial })
    expect(controller.recomputeCount).toBe(firstCount)
    expect(controller.getSnapshot().byStartKey.get('start-1')?.eligible).toBe(true)
    controller.dispose()
  })

  it('marks a turn discovered during pagination late and default-expanded', () => {
    const initial = snapshotFor({ turn: 1 })
    const session = new FakeSession(initial)
    const controller = new FoldModelController(session as unknown as SessionFace)
    const older = snapshotFor({ turn: 2, loadingOlder: true })

    session.emit(older)
    expect(controller.getSnapshot().presentationByTurn.get(2)).toBe('late')
    expect(controller.getSnapshot().loadingOlder).toBe(true)

    session.emit({ ...older, loadingOlder: false })
    expect(controller.getSnapshot().defaultExpandedByTurn.get(2)).toBe(true)
    controller.acknowledgeLateDefault(2)
    expect(controller.getSnapshot().defaultExpandedByTurn.get(2)).toBeUndefined()
    controller.dispose()
  })

  it('recomputes when closing node data settles without replacing chat order or timeline', () => {
    const initial = snapshotFor({ turn: 1, closingBlocks: [{ kind: 'reasoning' }] })
    const session = new FakeSession(initial)
    const controller = new FoldModelController(session as unknown as SessionFace)
    const firstCount = controller.recomputeCount
    const settled = snapshotFor({
      turn: 1,
      order: initial.chat.order,
      timeline: initial.chat.timeline,
      closingBlocks: [],
    })

    session.emit(settled)

    expect(controller.recomputeCount).toBe(firstCount + 1)
    expect(controller.getSnapshot().byStartKey.get('start-1')?.closingReasoningCount).toBe(0)
    controller.dispose()
  })
})
