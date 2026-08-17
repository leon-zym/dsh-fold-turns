import { readFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type TsdownPlugin, type UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-fold-turns'
const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const
const CSS_PREFIX = '\0dsh-fold-turns-css:'
const CSS_SUFFIX = '.mjs'

/** Build node Loader placeholder and browser module-table factory separately. */
export default defineConfig([
  {
    name: `${PLUGIN_ID}/node`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    sourcemap: true,
    dts: false,
    clean: true,
  },
  clientConfig(),
])

function clientConfig(): UserConfig {
  return {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    sourcemap: true,
    dts: false,
    clean: false,
    deps: {
      neverBundle: [...PLATFORM_EXTERNALS],
      alwaysBundle: id => PLATFORM_EXTERNALS.includes(id as typeof PLATFORM_EXTERNALS[number]) ? undefined : true,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [cssModulePlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

function cssModulePlugin(): TsdownPlugin {
  const files = new Map<string, string>()
  return {
    name: 'dsh-fold-turns-css-modules',
    resolveId(source, importer) {
      if (!source.endsWith('.module.css')) return null
      const file = resolve(dirname(importer ?? process.cwd()), source)
      const projectPath = relative(process.cwd(), file).replaceAll('\\', '/')
      if (projectPath === '..' || projectPath.startsWith('../')) {
        throw new Error(`CSS module is outside the project root: ${projectPath}`)
      }
      const id = `${CSS_PREFIX}${projectPath}${CSS_SUFFIX}`
      files.set(id, file)
      return id
    },
    async load(id) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = files.get(id)
      if (file === undefined) throw new Error(`Unknown CSS module: ${id}`)
      const projectPath = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const compiled = transform({
        filename: projectPath,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(compiled.exports ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
        classes[local] = value.name
      }
      const tagId = `${PLUGIN_ID}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(compiled.code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `const styleOwnerKey = ${JSON.stringify('__dshFoldTurnsStyleOwner')};`,
        'const styleOwner = {};',
        "if (typeof document !== 'undefined') {",
        "  let tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']');",
        '  if (tag === null) {',
        "    tag = document.createElement('style');",
        `    tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        "    tag.dataset.pluginCss = tagId;",
        '    document.head.appendChild(tag);',
        '  }',
        '  tag[styleOwnerKey] = styleOwner;',
        '  tag.textContent = css;',
        '}',
        'export function disposeStyles() {',
        "  if (typeof document === 'undefined') return;",
        "  const tag = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']');",
        '  if (tag !== null && tag[styleOwnerKey] === styleOwner) tag.remove();',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}
