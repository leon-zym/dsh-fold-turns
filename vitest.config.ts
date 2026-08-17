import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-runtime/client': new URL('./tests/mocks/runtime.ts', import.meta.url).pathname,
      '@deepseek-ai/dsh-client-ui-primitives': new URL('./tests/mocks/primitives.tsx', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
