import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mock Tauri APIs in tests
      '@tauri-apps/api/core': path.resolve(__dirname, './src/test/mocks/tauri.ts'),
      '@tauri-apps/plugin-sql': path.resolve(__dirname, './src/test/mocks/tauri-sql.ts'),
    },
  },
})
