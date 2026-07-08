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
