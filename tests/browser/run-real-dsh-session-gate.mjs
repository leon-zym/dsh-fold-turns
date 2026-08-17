import { spawnSync } from 'node:child_process'
import {
  closeSync,
  constants,
  copyFileSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
} from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const dshRoot = resolve(process.env.DSH_SOURCE_DIR ?? resolve(root, '../deepseek-harness'))
const expectedVersion = process.env.EXPECTED_DSH_VERSION ?? '0.1.0-rc.6'
const gate = resolve(import.meta.dirname, 'real-dsh-session-gate.ts')
const gateSource = readFileSync(gate)
const mountedGate = resolve(dshRoot, 'apps/web/tests/dsh-fold-turns.external.e2e.ts')
let createdGateIdentity
let createdGateDescriptor

try {
  const manifest = JSON.parse(readFileSync(resolve(dshRoot, 'package.json'), 'utf8'))
  if (manifest.version !== expectedVersion) {
    throw new Error(`expected DSH source ${expectedVersion}, found ${String(manifest.version)}`)
  }
  try {
    lstatSync(mountedGate)
    throw new Error(`${mountedGate} already exists; refusing to claim ownership`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    copyFileSync(gate, mountedGate, constants.COPYFILE_EXCL)
    createdGateDescriptor = openSync(mountedGate, 'r')
    const created = fstatSync(createdGateDescriptor)
    createdGateIdentity = { dev: created.dev, ino: created.ino }
  }
  const result = spawnSync('pnpm', [
    '--dir', dshRoot, 'exec', 'vitest', 'run',
    '--config', resolve(dshRoot, 'vitest.web.config.ts'),
    'apps/web/tests/dsh-fold-turns.external.e2e.ts',
  ], {
    env: { ...process.env, DSH_FOLD_TURNS_ROOT: root, DSH_SOURCE_DIR: dshRoot },
    stdio: 'inherit',
  })

  if (result.error !== undefined) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  try {
    if (createdGateIdentity !== undefined) removeCreatedGateCopy(createdGateIdentity)
  } finally {
    if (createdGateDescriptor !== undefined) closeSync(createdGateDescriptor)
  }
}

function removeCreatedGateCopy(identity) {
  try {
    const current = lstatSync(mountedGate)
    if (current.isFile()
      && current.dev === identity.dev
      && current.ino === identity.ino
      && readFileSync(mountedGate).equals(gateSource)) unlinkSync(mountedGate)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
