import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { describe, it } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const ROOT = resolve(process.env.DSH_FOLD_TURNS_ROOT ?? resolve(import.meta.dirname, '../..'))
const DSH_ROOT = resolve(process.env.DSH_SOURCE_DIR ?? join(ROOT, '../deepseek-harness'))
const FIXTURE = join(DSH_ROOT, 'apps/web/tests/snapshots/fresh-round-trip/session.jsonl')
const PROMPT = 'Use the bash tool to run exactly: echo WEB_E2E_OK. Then reply with the single word DONE and stop.'

let scaffold: Awaited<ReturnType<any>> | undefined
let browser: { close(): Promise<void> } | undefined

async function runGate(): Promise<void> {
 const harnessHome = await mkdtemp(join(tmpdir(), 'dsh-fold-turns-session-gate-'))
 try {
  const fallback = join(harnessHome, 'profiles/node_modules')
  await mkdir(fallback, { recursive: true })
  await symlink(ROOT, join(fallback, 'dsh-fold-turns'), 'dir')
  scaffold = await launchWebScaffold({
    extraOverlayPath: join(ROOT, 'cordis.patch.yml'),
    replayFixture: FIXTURE,
    paceMs: 35,
    replayContextWindow: 10_000_000,
    harnessHome,
  })
  const history = createChatScrollFixture({
    markerPrefix: 'FOLD_GATE',
    title: 'FOLD_GATE long paging session',
    turns: 48,
  })
  await seedSession(scaffold, history.log, 'fold-gate-history')

  browser = await chromium.launch({ headless: true })
  const page = await newEnglishPage(browser, 900)
  const tripwire = watchConsole(page)
  const pluginBundle = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === '/plugins/dsh-fold-turns/client.js'
  })
  await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
  const [servedBundle, builtBundle] = await Promise.all([
    (await pluginBundle).body(),
    readFile(join(ROOT, 'lib/client.js')),
  ])
  assert(sha256(servedBundle) === sha256(builtBundle), 'browser did not load the latest built dsh-fold-turns bundle')
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await connectFreshWorkspace(page, scaffold.workspaceCwd)

  const settled = scaffold.whenTurnSettled(60_000)
  const composer = page.locator('textarea:enabled').last()
  await composer.fill(PROMPT)
  await composer.press('Enter')
  await page.getByText(/^Running for /).first().waitFor({ timeout: 15_000 })
  await settled
  await page.getByText('DONE', { exact: true }).last().waitFor({ timeout: 15_000 })

  const top = page.getByRole('button', { name: 'Expand turn 1', exact: true })
  await top.waitFor({ timeout: 15_000 })
  assert(await page.locator('[data-dsh-fold-hidden]').count() > 0, 'completed process rows were not collapsed')
  assert(await page.locator('[data-dsh-fold-reasoning-hidden]').count() > 0, 'closing Think was not collapsed')

  await top.click()
  await page.getByRole('button', { name: 'Collapse turn 1', exact: true }).first().waitFor({ timeout: 10_000 })
  assert(await page.locator('[data-dsh-fold-hidden]').count() === 0, 'expanded process rows remained hidden')
  assert(await page.locator('[data-dsh-fold-reasoning-hidden]').count() === 0, 'expanded Think remained hidden')

  const bottom = page.locator('[data-dsh-fold-toggle-button="end"]:visible').last()
  await bottom.waitFor({ timeout: 10_000 })
  const order = await bottom.evaluate((button) => {
    const bottomRow = button.closest<HTMLElement>('[data-chat-flow-key]')
    const closingRow = bottomRow?.nextElementSibling
    const thinking = closingRow?.querySelector<HTMLElement>('[data-variant="think"]')
    const body = thinking?.parentElement
    const lowerContent = thinking === undefined || body === null || body === undefined
      ? undefined
      : Array.from(body.children).find((child) => child instanceof HTMLElement && child !== thinking) as HTMLElement | undefined
    const bottomRect = bottomRow?.getBoundingClientRect()
    const thinkingRect = thinking?.getBoundingClientRect()
    const lowerContentRect = lowerContent?.getBoundingClientRect()
    return {
      closingKind: closingRow instanceof HTMLElement ? closingRow.dataset.chatFlowKind : undefined,
      followsClosingInDom: closingRow instanceof HTMLElement && bottomRow instanceof HTMLElement
        ? (bottomRow.compareDocumentPosition(closingRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        : false,
      toggleAfterThinking: bottomRect !== undefined && thinkingRect !== undefined
        ? bottomRect.top >= thinkingRect.bottom - 1
        : false,
      toggleBeforeFinal: bottomRect !== undefined && lowerContentRect !== undefined
        ? bottomRect.bottom <= lowerContentRect.top + 1
        : false,
      thinkingTransform: thinking?.style.transform,
      toggleTransform: bottomRow?.style.transform,
    }
  })
  assert(order.closingKind === 'assistant-step' && order.followsClosingInDom, 'bottom toggle is not followed by the closing assistant in DOM order')
  assert(order.toggleAfterThinking && order.toggleBeforeFinal, 'bottom toggle is not visually between closing Think and final assistant content')

  await bottom.click()
  await top.waitFor({ state: 'visible', timeout: 10_000 })
  await poll(async () => await top.getAttribute('aria-label') === 'Expand turn 1', 'bottom toggle did not collapse the turn')
  assert(await top.evaluate(button => document.activeElement === button), 'bottom collapse did not move focus to the top toggle')

  await openSeededHistory(page, history)
  const scrollHost = page.locator('[data-conversation-scroll]')
  await scrollHost.evaluate((host) => {
    host.scrollTop = 0
    host.dispatchEvent(new Event('scroll'))
  })
  const older = page.getByRole('button', { name: 'Load earlier', exact: true })
  await older.waitFor({ timeout: 15_000 })
  const beforeRows = await page.locator('[data-chat-flow-key]').count()
  const anchor = await firstVisibleFlowAnchor(page)
  await older.click()
  await poll(async () => await page.locator('[data-chat-flow-key]').count() > beforeRows, 'paging did not prepend older rows', 30_000)
  await nextPaint(page)
  const finalOffset = await waitForFlowOffset(page, anchor)
  assert(Math.abs(finalOffset) <= 3, `paging moved the reader anchor by ${String(finalOffset)}px after 10s`)
  assert(await page.locator('[data-dsh-fold-toggle-button="start"]:visible').count() > 0, 'session switch/paging left no usable fold controls')
  assert(tripwire.pageErrors.length === 0, `browser page errors: ${tripwire.pageErrors.join('\n')}`)
  assert(tripwire.warnings.length === 0, `browser warnings: ${tripwire.warnings.join('\n')}`)

  console.log('PASS real DSH session gate: stream, completed fold, DOM/focus order, session switch, pagination anchor')
 } finally {
   await browser?.close().catch(() => undefined)
   await scaffold?.close().catch(() => undefined)
   await rm(harnessHome, { recursive: true, force: true }).catch(() => undefined)
 }
}

async function openSeededHistory(page: any, fixture: any): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(fixture.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await poll(async () => await results.count() === 1, 'seeded history search did not resolve', 60_000)
  await results.click()
  await page.getByText(fixture.markers.assistant(fixture.turns), { exact: false }).last().waitFor({ timeout: 30_000 })
  await nextPaint(page)
}

async function firstVisibleFlowAnchor(page: any): Promise<{ key: string; top: number }> {
  return await page.locator('[data-chat-flow-key]').evaluateAll((rows: HTMLElement[]) => {
    const host = rows[0]?.closest<HTMLElement>('[data-conversation-scroll]')
    if (host === null || host === undefined) throw new Error('conversation scroll host is unavailable')
    const bounds = host.getBoundingClientRect()
    const row = rows.find((candidate) => {
      const rect = candidate.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    const key = row?.dataset.chatFlowKey
    if (row === undefined || key === undefined) throw new Error('no visible chat flow anchor')
    return { key, top: row.getBoundingClientRect().top - bounds.top }
  })
}

async function flowTop(page: any, key: string): Promise<number> {
  return await page.locator(`[data-chat-flow-key=${JSON.stringify(key)}]`).evaluate(
    (row: HTMLElement) => {
      const host = row.closest('[data-conversation-scroll]')
      if (!(host instanceof HTMLElement)) throw new Error('flow row has no conversation scrollport')
      return row.getBoundingClientRect().top - host.getBoundingClientRect().top
    },
  )
}

async function waitForFlowOffset(
  page: any,
  anchor: { readonly key: string; readonly top: number },
): Promise<number> {
  const deadline = Date.now() + 10_000
  let offset = Number.POSITIVE_INFINITY
  while (Date.now() < deadline) {
    offset = (await flowTop(page, anchor.key)) - anchor.top
    if (Math.abs(offset) <= 3) return offset
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  return offset
}

async function nextPaint(page: any): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(() => { resolvePaint() })))
  })
}

async function poll(check: () => Promise<boolean>, message: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolveWait => setTimeout(resolveWait, 50))
  }
  throw new Error(message)
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('real DSH session release gate', () => {
  it('passes stream, fold, session-switch, paging, scroll, and accessibility contracts', runGate, 240_000)
})
