// Validate the shipped runtime bundle on Linux. Finder/Safari still need a Mac.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

const root = new URL('..', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'skytile-mac-check-'));
const testKey = 'fake-mac-package-key-not-a-real-credential';
let child;
try {
  execFileSync(process.execPath, ['scripts/build-mac.mjs'], { cwd: root, stdio: 'pipe' });
  cpSync(new URL('../.local/mac-package', import.meta.url), dir, { recursive: true });
  execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--cache', join(dir, 'npm-cache')], { cwd: dir, stdio: 'pipe' });
  // This mock is added ONLY to the throwaway validation copy, not the download.
  const mock = join(dir, 'mock-validation.mjs');
  copyFileSync(new URL('../tests/helpers/mock-vision.mjs', import.meta.url), mock);
  const env = { ...process.env, NODE_ENV: 'test', SKYTILE_AUTH: 'demo', SKYTILE_PUBLIC_ORIGIN: '', SKYTILE_BOOTSTRAP_PASSWORD: '', SKYTILE_DATA_DIR: join(dir, 'user-data'), SKYTILE_AI_KEY: testKey, OPENAI_API_KEY: '', NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --import=' + pathToFileURL(mock).href).trim() };
  const preflight = execFileSync(process.execPath, ['scripts/test-live-vision.mjs', '--confirm-api-usage'], { cwd: dir, env, encoding: 'utf8', timeout: 15000 });
  assert.equal(JSON.parse(preflight.trim()).result, 'passed'); assert.ok(!preflight.includes(testKey));
  const launch = () => {
    child = spawn(process.execPath, ['scripts/start-local.mjs', '--no-browser'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    return new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Local launcher timeout')), 15000);
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/Skytile pronta: (http:\/\/127\.0\.0\.1:\d+)\n/);
        if (match) { clearTimeout(timer); assert.ok(!output.includes(testKey)); resolve(match[1]); }
      });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('Local launcher exited before readiness')); });
    });
  };
  const stop = async () => { if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; } };
  let base = await launch();
  const request = async (path, body) => {
    const response = await fetch(base + '/api' + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Skytile-User': 'thiago' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.ok(response.ok, path); return response.json();
  };
  assert.equal((await request('/health')).ok, true);
  const job = await request('/jobs', { name: 'Teste isolado do pacote Mac', address: 'Sem endereço real', rooms: [{ name: 'Banheiro', services: ['Rejunte'] }] });
  const upload = await request('/upload', { name: 'synthetic.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=' });
  const entryPath = '/jobs/' + job.id + '/entries';
  const saved = await request(entryPath, { roomId: job.rooms[0].id, service: 'Rejunte', phase: 'update', progress: 'ongoing', note: 'Registro parcial de validação técnica.', photos: [upload] });
  const result = await request(entryPath + '/' + saved.createdEntryId + '/analyze', {});
  assert.equal(result.analysis.status, 'complete'); assert.equal(result.analysis.basis, 'current_only');
  await stop();
  base = await launch();
  const restored = (await request('/state')).jobs.find(item => item.id === job.id).entries.find(item => item.id === saved.createdEntryId);
  assert.equal(restored.progress, 'ongoing'); assert.equal(restored.analysis.status, 'complete');
  const file = await fetch(base + upload.url); assert.equal(file.status, 200); assert.ok((await file.arrayBuffer()).byteLength > 0);
  await stop();
  assert.ok(!readFileSync(join(dir, 'Iniciar Skytile.command'), 'utf8').includes(testKey));
  console.log('PASS Mac bundle runtime: production dependencies, explicit preflight, local launcher readiness, photo upload/analysis and persistence across restart. OpenAI transport is MOCKED here; no real API call was made. Finder/Safari require the Mac first run.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
  rmSync(dir, { recursive: true, force: true });
}
