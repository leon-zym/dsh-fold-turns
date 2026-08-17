import { describe, expect, it } from 'vitest'
import { createFoldStore } from '../src/client/fold-store.ts'

describe('createFoldStore', () => {
  it('keeps each session instance isolated and deliberately has no persistence', () => {
    const handle = createFoldStore()
    const first = handle.create('first-session')
    const second = handle.create('second-session')

    expect(handle.spec.persist).toBeUndefined()
    first.actions.expand(12)
    expect(first.getSnapshot().expandedByTurn).toEqual({ 12: true })
    expect(second.getSnapshot().expandedByTurn).toEqual({})

    first.actions.collapse(12)
    expect(first.getSnapshot().expandedByTurn).toEqual({})
  })
})
