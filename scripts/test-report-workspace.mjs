import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const dir = mkdtempSync(join(tmpdir(), 'report-workspace-')), password = 'Only-browser-test-2026';
let browser, child, base;
async function start(auth) {
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'test', PORT: '0', SKYTILE_AUTH: auth, SKYTILE_PUBLIC_ORIGIN: '', SKYTILE_BOOTSTRAP_PASSWORD: password, SKYTILE_DATA_DIR: dir, SKYTILE_AI_KEY: '', OPENAI_API_KEY: '' } });
  base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } }); child.once('error', reject); });
}
async function stop() { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
async function ready(page) { await page.waitForFunction(() => document.querySelector('#save-status').textContent.includes('navegador')); }
async function login(page, id) {
  await page.locator('#cloud-login').waitFor({ state: 'visible' });
  await page.locator('#cloud-login [name=login]').fill(id); await page.locator('#cloud-login [name=password]').fill(password); await page.locator('#cloud-login button').click(); await page.locator('#cloud-account').waitFor({ state: 'visible' });
}
try {
  browser = await chromium.launch({ executablePath: process.env.SKYTILE_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  await start('demo');
  const context = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Seed the exact old v1 store before the new application runs.
  await page.goto(base + '/');
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('field-report-v1', 1); request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onerror = reject; request.onsuccess = () => {
      const db = request.result, tx = db.transaction('draft', 'readwrite');
      tx.objectStore('draft').put({ version: 1, savedAt: Date.now(), fields: { title: 'REALISTIC V1 MIGRATION', date: '2026-10-24', author: 'Bruno', scope: 'Grout', language: 'en', percent: '75', company: 'Example company', completed: 'Floor', remaining: '' }, photos: { before: [{ id: crypto.randomUUID(), name: 'old.png', blob: new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII='), c => c.charCodeAt(0))], { type: 'image/png' }) }], after: [], pending: [] }, logo: null }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.goto(base + '/relatorio/'); await ready(page);
  assert.equal(await page.locator('[name=title]').inputValue(), 'REALISTIC V1 MIGRATION'); assert.equal(await page.locator('.photo-tile').count(), 1);
  await page.locator('#show-services').click(); await page.locator('#service-library').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.service-item').count(), 1);
  await page.locator('#new-service').click(); await page.waitForFunction(() => document.querySelector('[name=title]').value === '');
  await page.locator('[name=title]').fill('SECOND SERVICE'); await page.locator('#save-service').click();
  await page.locator('.service-item').filter({ hasText: 'SECOND SERVICE' }).waitFor();
  await page.locator('.service-item').filter({ hasText: 'REALISTIC V1 MIGRATION' }).getByRole('button', { name: 'Abrir serviço' }).click();
  await page.waitForFunction(() => document.querySelector('[name=title]').value === 'REALISTIC V1 MIGRATION'); assert.equal(await page.locator('.photo-tile').count(), 1);
  await page.locator('#archive-report').click(); await page.waitForFunction(() => document.querySelector('#archive-report').textContent === 'Reabrir registro');
  await page.locator('#show-services').click(); await page.locator('#service-filter').selectOption('archived');
  await page.locator('.service-item').filter({ hasText: 'REALISTIC V1 MIGRATION' }).waitFor();
  await page.locator('.service-item').getByRole('button', { name: 'Abrir serviço' }).click(); await page.locator('#archive-report').click();
  await page.waitForFunction(() => !document.querySelector('#report-fields').disabled);
  assert.equal(await page.locator('[name=percent]').inputValue(), '75');
  await page.reload(); await ready(page); assert.equal(await page.locator('.photo-tile').count(), 1);
  await page.locator('#show-services').click(); await page.locator('#service-filter').selectOption('all');
  await page.locator('.service-item').filter({ hasText: 'SECOND SERVICE' }).waitFor();
  const dialog = page.waitForEvent('dialog').then(dialog => dialog.accept()); await page.locator('.service-item').filter({ hasText: 'SECOND SERVICE' }).getByRole('button', { name: 'Remover do aparelho' }).click(); await dialog;
  await page.waitForFunction(() => document.querySelectorAll('.service-item').length === 1);
  await context.close(); await stop();

  await start('required');
  const adminContext = await browser.newContext({ ...devices['iPhone 13'] }), admin = await adminContext.newPage();
  const workerContext = await browser.newContext({ ...devices['iPhone 13'] }), worker = await workerContext.newPage();
  for (const p of [admin, worker]) p.on('pageerror', error => errors.push(error.message));
  await admin.goto(base + '/relatorio/'); await ready(admin); await login(admin, 'thiago');
  await admin.evaluate(async password => { const r = await fetch('/api/auth/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'bruno', password }) }); if (!r.ok) throw new Error('grant failed'); }, password);
  await worker.goto(base + '/relatorio/'); await ready(worker); await login(worker, 'bruno');
  await worker.locator('[name=title]').fill('SHARED GROUT REPORT'); await worker.locator('[name=percent]').fill('80');
  const image = await worker.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100; canvas.getContext('2d').fillRect(0, 0, 100, 100); return canvas.toDataURL('image/png').split(',')[1]; });
  await worker.locator('.gallery[data-group=before]').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await worker.waitForFunction(() => !document.querySelector('#report-fields').disabled);
  await worker.locator('#cloud-job').selectOption('demo-manhattan');
  let uploadRelease, uploadStarted;
  const uploadHeld = new Promise(resolve => { uploadStarted = resolve; }), uploadGate = new Promise(resolve => { uploadRelease = resolve; });
  await worker.route('**/api/field-report-images', async route => { uploadStarted(); await uploadGate; await route.continue(); });
  await worker.locator('#publish-report').click(); await uploadHeld;
  await worker.locator('[name=completed]').fill('Change entered during upload'); uploadRelease();

  await worker.waitForFunction(() => document.querySelector('#sync-status').textContent.startsWith('Salvo no servidor'));
  await worker.unroute('**/api/field-report-images', { behavior: 'wait' });
  await admin.locator('#show-services').click();
  await admin.locator('.service-item').filter({ hasText: 'SHARED GROUT REPORT' }).waitFor();
  await admin.locator('.service-item').filter({ hasText: 'SHARED GROUT REPORT' }).getByRole('button', { name: 'Abrir serviço' }).click();
  await admin.locator('.photo-tile').waitFor(); await admin.waitForFunction(() => document.querySelector('[name=completed]').value === 'Change entered during upload'); assert.equal(await admin.locator('[name=percent]').inputValue(), '80');
  // Save on the worker, receive on the owner's already open screen through real SSE.
  await worker.locator('[name=percent]').fill('90');
  await admin.waitForFunction(() => document.querySelector('[name=percent]').value === '90', { timeout: 10000 });
  // Offline writes stay local and are automatically sent on reconnection.
  await workerContext.setOffline(true); await worker.locator('[name=percent]').fill('95'); await worker.waitForTimeout(2100);
  assert.equal(await admin.locator('[name=percent]').inputValue(), '90');
  await workerContext.setOffline(false); await admin.waitForFunction(() => document.querySelector('[name=percent]').value === '95', { timeout: 10000 });
  await workerContext.setOffline(true); await worker.locator('[name=remaining]').fill('Queued while another service is open');
  await worker.locator('#show-services').click(); await worker.locator('#new-service').click();
  await worker.waitForFunction(() => document.querySelector('[name=title]').value === '');
  await worker.locator('[name=title]').fill('LOCAL OTHER SERVICE'); await workerContext.setOffline(false);
  await admin.waitForFunction(() => document.querySelector('[name=remaining]').value === 'Queued while another service is open', { timeout: 10000 });
  await worker.locator('#show-services').click();
  await worker.locator('.service-item').filter({ has: worker.locator('h3', { hasText: /^SHARED GROUT REPORT$/ }) }).getByRole('button', { name: 'Abrir serviço' }).click();
  await worker.waitForFunction(() => document.querySelector('[name=title]').value === 'SHARED GROUT REPORT');
  // Deliberately hold the worker's upload, let the owner edit, then release the conflict.
  let release, intercepted; const held = new Promise(resolve => { intercepted = resolve; }), gate = new Promise(resolve => { release = resolve; });
  await worker.route('**/api/field-reports/*', async route => { if (route.request().method() === 'PUT') { intercepted(); await gate; } await route.continue(); });
  await worker.locator('[name=remaining]').fill('Worker local change'); await held;
  await admin.locator('[name=remaining]').fill('Owner server change'); await admin.locator('#publish-report').click();
  await admin.waitForFunction(() => document.querySelector('#sync-status').textContent.startsWith('Salvo no servidor'));
  release(); await worker.locator('#reload-remote').waitFor({ state: 'visible' });
  assert.equal(await worker.locator('[name=remaining]').inputValue(), 'Worker local change');
  await worker.unroute('**/api/field-reports/*'); await worker.locator('#reload-remote').click();
  await worker.waitForFunction(() => document.querySelector('[name=remaining]').value === 'Owner server change');
  await worker.locator('#show-services').click(); await worker.locator('.service-item').filter({ hasText: 'cópia local' }).waitFor();
  // Removing a sent copy only removes local images; another device and the server retain it.
  const removeDialog = worker.waitForEvent('dialog').then(dialog => dialog.accept());
  await worker.locator('.service-item').filter({ has: worker.locator('h3', { hasText: /^SHARED GROUT REPORT$/ }) }).getByRole('button', { name: 'Remover do aparelho' }).click(); await removeDialog;
  const removed = await worker.evaluate(() => new Promise(resolve => { const request = indexedDB.open('field-report-v1', 2); request.onsuccess = () => { const db = request.result, r = db.transaction('reports').objectStore('reports').getAll(); r.onsuccess = () => { const result = r.result.map(item => ({ title: item.fields.title, cloud: !!item.cloud })); db.close(); resolve(result); }; }; }));
  assert.ok(!removed.some(item => item.title === 'SHARED GROUT REPORT' && item.cloud));
  assert.equal(await admin.locator('.photo-tile').count(), 1);
  const logoutDialog = worker.waitForEvent('dialog').then(dialog => dialog.accept()); await worker.locator('#cloud-logout').click(); await logoutDialog;
  await worker.locator('#cloud-login').waitFor({ state: 'visible' }); assert.equal(await worker.locator('#cloud-tools').isVisible(), false);
  assert.equal(await worker.evaluate(async () => (await fetch('/api/field-reports')).status), 401);
  assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await admin.goto(base + '/#jobs/demo-manhattan');
  await admin.getByRole('link', { name: 'Relatórios em vídeo' }).click();
  await admin.locator('#service-library').waitFor({ state: 'visible' });
  assert.equal(await admin.locator('#service-job').inputValue(), 'demo-manhattan');
  await admin.locator('.service-item').filter({ hasText: 'SHARED GROUT REPORT' }).waitFor();
  mkdirSync(new URL('../.local', import.meta.url), { recursive: true });
  await admin.screenshot({ path: new URL('../.local/report-shared-mobile.png', import.meta.url).pathname, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: v1 photo migration, multiple services, navigation, archive/reopen, local deletion, authenticated two-device photo sharing, live SSE progress, offline retry, conflict preservation, local cleanup without server deletion and logout. Chromium mobile emulation; no third-party messages or AI calls.');
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) await stop();
  rmSync(dir, { recursive: true, force: true });
}
