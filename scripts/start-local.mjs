// Starts the user's own local backend and opens Safari only after a health check.
// --no-browser is useful for headless validation. Never exposes a public port.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, SKYTILE_HOST: '127.0.0.1', PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let ready = false, stopping = false;
const timer = setTimeout(() => {
  if (!ready) {
    console.error('A Skytile não iniciou a tempo. Feche esta janela e tente novamente.');
    child.kill('SIGTERM');
  }
}, 15000);
const lines = createInterface({ input: child.stdout });
lines.on('line', async line => {
  console.log(line);
  const match = line.match(/http:\/\/127\.0\.0\.1:\d+/);
  if (ready || stopping || !match) return;
  try {
    const base = match[0];
    const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(5000) });
    const health = await response.json();
    if (!response.ok || health.ok !== true || health.storage !== 'sqlite') throw new Error('health');
    ready = true; clearTimeout(timer);
    console.log('Skytile pronta: ' + base);
    if (process.platform === 'darwin' && !process.argv.includes('--no-browser')) {
      const browser = spawn('open', ['-a', 'Safari', base], { stdio: 'ignore' });
      browser.on('error', () => console.error('Abra no Safari o endereço exibido acima.'));
      browser.on('exit', code => { if (code) console.error('Abra no Safari o endereço exibido acima.'); });
    }
  } catch {
    console.error('Não foi possível confirmar que o aplicativo iniciou.');
    child.kill('SIGTERM');
  }
});
child.on('error', () => {
  clearTimeout(timer);
  console.error('Não foi possível iniciar o servidor local.');
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  clearTimeout(timer); lines.close();
  process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  child.kill('SIGTERM');
});

