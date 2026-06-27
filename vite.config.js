import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          upload: resolve(__dirname, 'upload.html'),
        }
      }
    },
    define: {
      '__VITE_SUPABASE_URL__': JSON.stringify(env.VITE_SUPABASE_URL || ''),
      '__VITE_SUPABASE_ANON_KEY__': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
    server: { port: 3000 }
  };
});
