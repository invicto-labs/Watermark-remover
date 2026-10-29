import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const python = process.env.CLEARPAGE_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const backend = spawn(python, ['scripts/dev_backend.py'], {
  cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
});
let server;
let stopping = false;
const sessionFile = path.join(root, '.clearpage-dev.json');

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await server?.close();
  backend.kill();
  await unlink(sessionFile).catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

try {
  const session = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The PDF backend did not start within 30 seconds.')), 30000);
    const lines = createInterface({ input: backend.stdout });
    const fail = error => { clearTimeout(timeout); lines.close(); reject(error); };
    backend.once('error', fail);
    backend.once('exit', code => fail(new Error(`The PDF backend exited (${code}). Check the Python environment.`)));
    lines.once('line', line => {
      clearTimeout(timeout);
      try { resolve(JSON.parse(line)); } catch { reject(new Error('The PDF backend returned an invalid startup response.')); }
      lines.close();
    });
  });
  process.env.CLEARPAGE_DEV_BACKEND = session.backend;
  const { createServer } = await import('vite');
  server = await createServer();
  await server.listen();
  const url = 'http://127.0.0.1:5173/';
  await writeFile(sessionFile, JSON.stringify({ url, backend: session.backend, pid: process.pid, backendPid: backend.pid }, null, 2));
  console.log('\nClearPage development server — React Fast Refresh and Tailwind hot reload.');
  console.log(`Open ClearPage: ${url}`);
  console.log('Press Ctrl+C to stop both servers.\n');
  backend.on('exit', () => { if (!stopping) void stop(1); });
} catch (error) {
  console.error(error.message);
  await stop(1);
}
