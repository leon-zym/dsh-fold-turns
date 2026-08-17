import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')

describe('release package contract', () => {
  it('allows only esbuild to run a dependency install script', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly scripts: Record<string, string>
    }
    const workspaceSettings = await readFile(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf8')

    expect(workspaceSettings).toBe('allowBuilds:\n  esbuild: true\n')
    expect(manifest.scripts).not.toHaveProperty('prepare')
  })

  it('keeps real-host gates mandatory for a formal publish', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly scripts: Record<string, string>
    }

    expect(manifest.scripts['test:dsh-session']).toMatch(/^pnpm run build && /)
    expect(manifest.scripts['verify:host']).toContain('REQUIRE_REAL_DSH=1 pnpm run test:dsh')
    expect(manifest.scripts['verify:host']).toContain('pnpm run test:dsh-session')
    expect(manifest.scripts.prepublishOnly).toContain('pnpm run verify:release')
    expect(manifest.scripts.prepublishOnly).toContain('pnpm run verify:host')
  })

  it('ships the MIT notice and includes it in the package allowlist', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly license?: string
      readonly files?: readonly string[]
    }
    const license = await readFile(resolve(ROOT, 'LICENSE'), 'utf8')

    expect(manifest.license).toBe('MIT')
    expect(manifest.files).toContain('LICENSE')
    expect(manifest.files).toContain('README.md')
    expect(manifest.files).toContain('README.zh-CN.md')
    expect(license).toContain('Permission is hereby granted, free of charge')
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"')
  })

  it('builds publishable entrypoints without embedding checkout-specific paths', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly main: string
      readonly types: string
      readonly exports: { readonly './client': { readonly default: string; readonly types: string } }
    }
    const entrypoints = [
      manifest.main,
      manifest.types,
      manifest.exports['./client'].default,
      manifest.exports['./client'].types,
    ]
    for (const entrypoint of entrypoints) {
      await expect(readFile(resolve(ROOT, entrypoint))).resolves.toBeDefined()
    }

    const client = await readFile(resolve(ROOT, manifest.exports['./client'].default), 'utf8')
    expect(client).toContain('dsh-fold-turns-css:src/client/components/FoldToggle.module.css.mjs')
    expect(client).not.toMatch(/\/(?:Users|home|private\/tmp)\//)
    expect(client).not.toMatch(/[A-Za-z]:\\(?:Users|Documents and Settings|projects?|workspaces?)\\/i)
  })
})
