import { defineConfig } from 'vite';

export default defineConfig({
  // CRITICAL: Relative paths so it works on LAMP server (no leading /)
  base: './',
  server: {
    port: 3000,
    open: true,
    watch: {
      // Don't watch the raw asset kit folders (huge binary files crash the watcher)
      ignored: ['**/Zombie_Kit/**']
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});
