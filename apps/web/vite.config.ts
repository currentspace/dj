import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Enable React Compiler if available
          // ['babel-plugin-react-compiler', {}]
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@dj/shared-types': path.resolve(__dirname, '../../packages/shared-types/src'),
      '@dj/api-client': path.resolve(__dirname, '../../packages/api-client/src')
    }
  },
  build: {
    outDir: 'dist',
    target: 'esnext',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          api: ['@dj/api-client', '@dj/shared-types']
        }
      }
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom']
  }
});