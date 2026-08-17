import type {
  ChatConversationViewNode,
  ChatSnapshot,
  TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { FoldClosingDto, FoldNodeDto, FoldTurnDto } from '../fold-core.ts'

/** Structurally validated subset of the host turn-tail payload. */
export interface ProjectedTurnTail {
  readonly finalSeq: number
  readonly branchUnavailable: boolean
}

/** Project one host turn into the DOM-independent facts consumed by FoldCore. */
export function projectTurn(chat: ChatSnapshot, turn: TurnLocation): FoldTurnDto {
  const nodes = chat.locations.getTurn(turn.turn).map((key): FoldNodeDto => {
    const raw = chat.nodes.get(key)
    return raw === undefined ? {
      key,
      kind: '__missing-node__',
      anchorSeq: Number.NaN,
    } : projectNode(raw)
  })
  const tail = readTurnTail(turn.data.get('turn-tail'))
  const closing: FoldClosingDto | undefined = tail === undefined ? undefined : {
    finalSeq: tail.finalSeq,
    branchUnavailable: tail.branchUnavailable,
  }
  const startTime = finiteNumber(objectField(turn.start, 'time'))
  const endTime = finiteNumber(objectField(turn.end, 'time'))
  const endReason = stringField(objectField(objectField(turn.end, 'data'), 'reason'), 'kind')
  return {
    turn: turn.turn,
    status: turn.status,
    ...(startTime === undefined ? {} : { startTime }),
    ...(endTime === undefined ? {} : { endTime }),
    ...(endReason === undefined ? {} : { endReason }),
    nodes,
    ...(closing === undefined ? {} : { closing }),
  }
}

/** Project the host node kinds whose payload contributes to folding. */
export function projectNode(raw: ChatConversationViewNode): FoldNodeDto {
  const data = raw.data
  const base: FoldNodeDto = { key: raw.key, kind: raw.kind, anchorSeq: raw.anchorSeq }
  if (raw.kind === 'fold-start') {
    const sourceSeq = numberField(data, 'sourceSeq')
    return sourceSeq === undefined ? base : { ...base, sourceSeq }
  }
  if (raw.kind !== 'assistant-step') return base
  const finalSeq = nestedNumber(data, 'finalNode', 'seq')
  const blocks = objectField(data, 'blocks')
  const reasoningCount = Array.isArray(blocks)
    ? blocks.filter(block => stringField(block, 'kind') === 'reasoning').length
    : undefined
  return {
    ...base,
    ...(finalSeq === undefined ? {} : { finalSeq }),
    ...(reasoningCount === undefined ? {} : { reasoningCount }),
  }
}

/** Read only a complete, well-formed host closing contract. */
export function readTurnTail(value: unknown): ProjectedTurnTail | undefined {
  const closing = objectField(value, 'closing')
  const finalSeq = nestedNumber(closing, 'finalNode', 'seq')
  const branchUnavailable = booleanField(value, 'branchUnavailable')
  if (finalSeq === undefined || branchUnavailable === undefined) return undefined
  return { finalSeq, branchUnavailable }
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
  return (value as Record<string, unknown>)[key]
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  return finiteNumber(objectField(value, key))
}

function nestedNumber(value: unknown, parent: string, key: string): number | undefined {
  return numberField(objectField(value, parent), key)
}

function booleanField(value: unknown, key: string): boolean | undefined {
  const candidate = objectField(value, key)
  return typeof candidate === 'boolean' ? candidate : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = objectField(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}
