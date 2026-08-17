import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { runBestEffortCleanup } from './smoke-cleanup.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const required = process.env.REQUIRE_REAL_DSH === '1'
const expectedVersion = process.env.EXPECTED_DSH_VERSION ?? '0.1.0-rc.6'
const available = spawnSync('dsh', ['--version'], { encoding: 'utf8' })
if (available.status !== 0) {
  if (required) throw new Error('REQUIRE_REAL_DSH=1 but the dsh CLI is unavailable')
  console.log('SKIP real DSH smoke: install @deepseek-ai/dsh or set REQUIRE_REAL_DSH=1 in the gated CI job')
  process.exit(0)
}
const actualVersion = available.stdout.trim()
if (actualVersion !== expectedVersion) {
  throw new Error(`expected DSH CLI ${expectedVersion}, found ${actualVersion || 'an empty version string'}`)
}

const scratch = await mkdtemp(join(tmpdir(), 'dsh-fold-turns-smoke-'))
const dshHome = join(scratch, 'dsh-home')
const environment = { ...process.env, DSH_HOME: dshHome }
let server
let browser

try {
  run('pnpm', ['pack', '--pack-destination', scratch])
  const tarball = (await readdir(scratch)).find(file => file.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('pnpm pack did not create a tarball')
  const install = run('dsh', ['plugin', '--profile', 'web', 'add', join(scratch, tarball)])
  const installOutput = `${install.stdout}\n${install.stderr}`
  if (/missing peer dependencies|unmet peer/i.test(installOutput)) {
    throw new Error(`DSH installation emitted missing peer warnings:\n${installOutput}`)
  }

  server = spawn('dsh', ['web', '--host', '127.0.0.1', '--port', '0'], {
    cwd: ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const url = await waitForUrl(server)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const errors = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(url, { waitUntil: 'networkidle' })
  if (await page.title() !== 'DeepSeek Harness') throw new Error(`unexpected DSH page title: ${await page.title()}`)
  const styleCount = await page.locator('style[data-plugin="dsh-fold-turns"]').count()
  if (styleCount !== 1) throw new Error(`expected one plugin style tag, found ${styleCount}`)
  if (errors.length > 0) throw new Error(`browser console errors:\n${errors.join('\n')}`)
  console.log(`PASS real DSH smoke (${actualVersion}): tarball install, web boot, module load, CSS injection`)
} finally {
  await runBestEffortCleanup([
    async () => { await browser?.close() },
    () => { if (server !== undefined && !server.killed) server.kill('SIGINT') },
    async () => { await rm(scratch, { recursive: true, force: true }) },
  ])
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, env: environment, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}\n${result.stderr}`)
  }
  return result
}

function waitForUrl(child) {
  return new Promise((resolveUrl, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for DSH URL\n${output}`)), 30_000)
    const consume = chunk => {
      output += chunk.toString()
      const match = output.match(/https?:\/\/[^\s]+/)
      if (match !== null) {
        clearTimeout(timeout)
        resolveUrl(match[0])
      }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.once('exit', code => {
      clearTimeout(timeout)
      reject(new Error(`DSH exited before listening (${code})\n${output}`))
    })
  })
}
