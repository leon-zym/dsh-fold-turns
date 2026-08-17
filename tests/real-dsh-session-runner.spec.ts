import { spawnSync } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')
const RUNNER = resolve(ROOT, 'tests/browser/run-real-dsh-session-gate.mjs')
const GATE = resolve(ROOT, 'tests/browser/real-dsh-session-gate.ts')
const SMOKE = resolve(ROOT, 'tests/browser/real-dsh-smoke.mjs')
const scratch: string[] = []

afterEach(async () => {
  await Promise.all(scratch.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture(version: string): Promise<{ bin: string; dshRoot: string; mountedGate: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-fold-turns-runner-'))
  scratch.push(root)
  const dshRoot = join(root, 'deepseek-harness')
  const tests = join(dshRoot, 'apps/web/tests')
  const bin = join(root, 'bin')
  await mkdir(tests, { recursive: true })
  await mkdir(bin)
  await writeFile(join(dshRoot, 'package.json'), JSON.stringify({ version }))
  const pnpm = join(bin, 'pnpm')
  await writeFile(pnpm, `#!/usr/bin/env node
const { lstatSync, readFileSync } = require('node:fs')
const { join } = require('node:path')
const pluginRoot = process.env.DSH_FOLD_TURNS_ROOT
if (!pluginRoot) process.exit(21)
const mounted = join(process.env.DSH_SOURCE_DIR, 'apps/web/tests/dsh-fold-turns.external.e2e.ts')
if (lstatSync(mounted).isSymbolicLink()) process.exit(22)
if (!readFileSync(mounted).equals(readFileSync(join(pluginRoot, 'tests/browser/real-dsh-session-gate.ts')))) process.exit(23)
`)
  await chmod(pnpm, 0o755)
  return {
    bin,
    dshRoot,
    mountedGate: join(tests, 'dsh-fold-turns.external.e2e.ts'),
    path: `${bin}:${process.env.PATH ?? ''}`,
  }
}

describe('real DSH session runner', () => {
  it('keeps the copied gate inside the DSH static module graph', async () => {
    const source = await readFile(GATE, 'utf8')

    expect(source).toContain("from './scaffold.ts'")
    expect(source).toContain("from './support.ts'")
    expect(source).toContain("from './chat-scroll-fixture.ts'")
    expect(source).toContain("from 'playwright'")
    expect(source).not.toContain('pathToFileURL')
    expect(source).not.toContain('createRequire')
    expect(source).not.toContain('await import(')
  })

  it('rejects a real CLI that does not match the default supported version', async () => {
    const view = await fixture('0.1.0-rc.6')
    const dsh = join(view.bin, 'dsh')
    await writeFile(dsh, '#!/bin/sh\necho 0.1.0-rc.5\n')
    await chmod(dsh, 0o755)
    const env = { ...process.env, PATH: view.path, REQUIRE_REAL_DSH: '1' }
    delete env.EXPECTED_DSH_VERSION

    const result = spawnSync(process.execPath, [SMOKE], { env, encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected DSH CLI 0.1.0-rc.6, found 0.1.0-rc.5')
  })

  it('rejects a source checkout that does not match the default supported version', async () => {
    const view = await fixture('0.1.0-rc.5')
    const env = { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path }
    delete env.EXPECTED_DSH_VERSION

    const result = spawnSync(process.execPath, [RUNNER], { env, encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected DSH source 0.1.0-rc.6, found 0.1.0-rc.5')
  })

  it('mounts a regular gate copy in the DSH module tree and removes it after success', async () => {
    const view = await fixture('0.1.0-rc.6')

    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path },
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    await expect(lstat(view.mountedGate)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to claim or remove a pre-existing byte-identical gate copy', async () => {
    const view = await fixture('0.1.0-rc.6')
    await copyFile(GATE, view.mountedGate)

    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('already exists; refusing to claim ownership')
    expect(await readFile(view.mountedGate)).toEqual(await readFile(GATE))
  })

  it('removes its gate copy when the DSH test command fails', async () => {
    const view = await fixture('0.1.0-rc.6')
    const pnpm = join(view.bin, 'pnpm')
    await writeFile(pnpm, '#!/bin/sh\nexit 7\n')
    await chmod(pnpm, 0o755)

    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path },
      encoding: 'utf8',
    })

    expect(result.status).toBe(7)
    await expect(lstat(view.mountedGate)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not remove a same-content replacement created while the command runs', async () => {
    const view = await fixture('0.1.0-rc.6')
    const pnpm = join(view.bin, 'pnpm')
    await writeFile(pnpm, `#!/usr/bin/env node
const { copyFileSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')
const mounted = join(process.env.DSH_SOURCE_DIR, 'apps/web/tests/dsh-fold-turns.external.e2e.ts')
unlinkSync(mounted)
copyFileSync(join(process.env.DSH_FOLD_TURNS_ROOT, 'tests/browser/real-dsh-session-gate.ts'), mounted)
`)
    await chmod(pnpm, 0o755)

    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path },
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    expect(await readFile(view.mountedGate)).toEqual(await readFile(GATE))
  })

  it('refuses to overwrite or remove an existing gate file with different content', async () => {
    const view = await fixture('0.1.0-rc.6')
    const foreign = 'foreign test owned by the DSH checkout\n'
    await writeFile(view.mountedGate, foreign)

    const result = spawnSync(process.execPath, [RUNNER], {
      env: { ...process.env, DSH_SOURCE_DIR: view.dshRoot, PATH: view.path },
      encoding: 'utf8',
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('already exists; refusing to claim ownership')
    expect(await readFile(view.mountedGate, 'utf8')).toBe(foreign)
  })
})
