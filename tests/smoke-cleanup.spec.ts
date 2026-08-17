import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runBestEffortCleanup } from './browser/smoke-cleanup.mjs'

const SMOKE = resolve(import.meta.dirname, 'browser/real-dsh-smoke.mjs')

describe('real DSH smoke cleanup', () => {
  it('attempts every cleanup and preserves the original failure', async () => {
    const original = new Error('smoke failed')
    const closeBrowser = vi.fn(async () => { throw new Error('browser cleanup failed') })
    const stopServer = vi.fn(() => { throw new Error('server cleanup failed') })
    const removeScratch = vi.fn(async () => { throw new Error('scratch cleanup failed') })
    const run = async () => {
      try {
        throw original
      } finally {
        await runBestEffortCleanup([closeBrowser, stopServer, removeScratch])
      }
    }

    await expect(run()).rejects.toBe(original)
    expect(closeBrowser).toHaveBeenCalledOnce()
    expect(stopServer).toHaveBeenCalledOnce()
    expect(removeScratch).toHaveBeenCalledOnce()
  })

  it('routes browser, server, and scratch cleanup through the best-effort helper', async () => {
    const source = await readFile(SMOKE, 'utf8')

    expect(source).toContain("import { runBestEffortCleanup } from './smoke-cleanup.mjs'")
    expect(source).toMatch(/runBestEffortCleanup\(\[[\s\S]*browser\?\.close\(\)[\s\S]*server\.kill\('SIGINT'\)[\s\S]*rm\(scratch/)
  })
})
