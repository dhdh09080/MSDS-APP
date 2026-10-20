// Own the server lifecycle; never connect to a configured production backend.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'vite';
const server = await createServer({
  server: { host: '127.0.0.1', port: 0 },
  define: { __VITE_SUPABASE_URL__: JSON.stringify(''), __VITE_SUPABASE_ANON_KEY__: JSON.stringify('') },
});
let child;
try {
  await server.listen();
  const { port } = server.httpServer.address();
  child = spawn(process.env.PYTHON || 'python', ['tests/warning-print.browser.py'], {
    stdio: 'inherit', env: { ...process.env, BASE_URL: `http://127.0.0.1:${port}` },
  });
  child.on('error', e => console.error(e));
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  child?.kill();
  await server.close();
}
