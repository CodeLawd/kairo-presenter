import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main':   resolve('src/main'),
        '@shared': resolve('src/lib'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/lib'),
      },
    },
    build: {
      rollupOptions: {
        // `program` is the NDI program window's audio bridge — see src/preload/program.ts.
        input: {
          index: resolve('src/preload/index.ts'),
          program: resolve('src/preload/program.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@':       resolve('src/renderer/src'),
        '@shared': resolve('src/lib'),
      },
    },
    plugins: [react()],
  },
})
