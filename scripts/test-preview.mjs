// Validate the exact generated artifact, including viewers that block scripts/storage.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../Skytile.html', import.meta.url));
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(html); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.SKYTILE_CHROMIUM ? { executablePath: process.env.SKYTILE_CHROMIUM } : {}), args: ['--no-sandbox'] });
const interact = async page => {
  await page.locator('#preview-status[data-mode=interactive]').waitFor({ timeout: 10000 });
  await page.locator('.job-card').filter({ hasText: 'Apartamento · Manhattan' }).click(); await page.getByRole('heading', { name: 'Apartamento · Manhattan', exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Registrar avanço' }).click(); await page.locator('#entry-form').waitFor(); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Equipe diária' }).click();
  await page.getByRole('button', { name: 'Novo profissional' }).click(); await page.locator('#person-form').waitFor(); await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Assistente' }).click();
  const count = await page.locator('.chat-answer').count();
  await page.locator('.chat-shortcuts').getByRole('button', { name: 'Quais profissionais estão cadastrados?', exact: true }).click();
  await page.locator('.chat-answer').nth(count).waitFor(); assert.match(await page.locator('.chat-answer').last().innerText(), /Bruno/);
};
try {
  const context = await browser.newContext(); const page = await context.newPage(); const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.url().includes('/api/')) requests.push(r.url()); });
  await page.goto(base); await interact(page); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('PASS exact exported HTML: open job, progress form, staff form and assistant; no API calls.');
  const intercepted = await context.newPage();
  await intercepted.addInitScript(() => {
    // Model an embedded viewer that cancels fragment-link navigation and denies URL writes.
    document.addEventListener('click', e => { if (e.target.closest('a[href^="#"]')) e.preventDefault(); }, true);
    history.pushState = () => { throw new DOMException('Preview URL is read-only', 'SecurityError'); };
  });
  await intercepted.goto(base); await interact(intercepted);
  assert.equal(new URL(intercepted.url()).hash, '');
  await intercepted.locator('.chat-answer').last().getByRole('link', { name: 'Cadastro da equipe' }).click();
  await intercepted.getByRole('heading', { name: 'Uma equipe, várias obras.', level: 1 }).waitFor();
  await intercepted.locator('.team-card').first().getByRole('link', { name: 'Apartamento · Manhattan', exact: true }).click();
  await intercepted.getByRole('heading', { name: 'Apartamento · Manhattan', exact: true, level: 1 }).waitFor();
  await intercepted.locator('.room-card').filter({ hasText: 'Sala principal' }).click();
  await intercepted.getByRole('heading', { name: 'Sala principal', exact: true, level: 1 }).waitFor();
  assert.equal(await intercepted.locator('.entry-card').count(), 1);
  await intercepted.getByRole('button', { name: 'Registrar avanço' }).click();
  await intercepted.locator('[name=note]').fill('Evidência registrada no ambiente com navegação interceptada.');
  await intercepted.getByRole('button', { name: 'Salvar registro' }).click();
  await intercepted.locator('.entry-card').filter({ hasText: 'Evidência registrada no ambiente' }).waitFor();
  await intercepted.getByRole('heading', { name: 'Sala principal', exact: true, level: 1 }).waitFor();
  await intercepted.getByRole('link', { name: 'Todos os ambientes' }).click();
  await intercepted.getByRole('heading', { name: 'Apartamento · Manhattan', exact: true, level: 1 }).waitFor();
  await intercepted.getByRole('link', { name: 'Todas as obras' }).click();
  await intercepted.getByRole('heading', { name: 'Cada obra, um passo à frente.', level: 1 }).waitFor();
  await intercepted.getByRole('button', { name: 'Nova obra', exact: true }).click();
  await intercepted.locator('[name=name]').fill('Obra com links interceptados'); await intercepted.locator('[name=address]').fill('Newark, NJ');
  await intercepted.getByRole('button', { name: 'Criar obra' }).click();
  await intercepted.getByRole('heading', { name: 'Obra com links interceptados', exact: true, level: 1 }).waitFor();
  await intercepted.setViewportSize({ width: 390, height: 844 });
  await intercepted.locator('.mobile-nav').getByRole('link', { name: 'Equipe', exact: true }).click();
  await intercepted.getByRole('heading', { name: 'Uma equipe, várias obras.', level: 1 }).waitFor();
  assert.equal(await intercepted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS intercepted links and read-only URL: team, job, room evidence, save/refresh, create job, back links, citation and mobile navigation.');
  // Normal browser history continues to work when the environment permits it.
  await page.locator('.sidebar').getByRole('link', { name: 'Obras', exact: true }).click();
  await page.locator('.sidebar').getByRole('link', { name: 'Equipe diária' }).click();
  await page.goBack(); await page.getByRole('heading', { name: 'Cada obra, um passo à frente.', level: 1 }).waitFor();
  await page.goForward(); await page.getByRole('heading', { name: 'Uma equipe, várias obras.', level: 1 }).waitFor();
  console.log('PASS browser back and forward restore the correct screen.');
  const disabled = await browser.newContext({ javaScriptEnabled: false }); const staticPage = await disabled.newPage();
  await staticPage.goto(base); assert.match(await staticPage.locator('#preview-status').innerText(), /Modo visual/);
  assert.equal(await staticPage.locator('#preview-snapshot').getAttribute('inert'), '');
  assert.equal(await staticPage.locator('#preview-status[data-mode=interactive]').count(), 0);
  console.log('PASS scripts blocked: explicit visual-mode notice; snapshot is inert.');
  const blocked = await context.newPage(); await blocked.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: { open() { const request = {}; setTimeout(() => request.onblocked?.(), 0); return request; } } });
  });
  await blocked.goto(base); await interact(blocked); await blocked.goto(base + '/#jobs');
  await blocked.locator('#preview-status[data-mode=interactive]').waitFor(); assert.match(await blocked.locator('.demo-banner').innerText(), /enquanto esta prévia estiver aberta/);
  console.log('PASS IndexedDB blocked event: interface and queries remain usable in memory.');
  const stalled = await context.newPage(); await stalled.addInitScript(() => {
    window.lateConnectionClosed = 0; window.lateConnectionRead = 0;
    Object.defineProperty(window, 'indexedDB', { value: { open() {
      const request = {}; setTimeout(() => {
        request.result = { close() { window.lateConnectionClosed++; }, transaction() { window.lateConnectionRead++; throw new Error('Late read must not happen'); } };
        request.onsuccess?.();
      }, 6000); return request;
    } } });
  });
  await stalled.goto(base); await stalled.locator('#preview-status[data-mode=interactive]').waitFor({ timeout: 10000 });
  await stalled.getByRole('button', { name: 'Nova obra', exact: true }).click(); await stalled.locator('[name=name]').fill('Obra com armazenamento indisponível');
  await stalled.locator('[name=address]').fill('Newark, NJ'); await stalled.getByRole('button', { name: 'Criar obra' }).click();
  await stalled.getByRole('heading', { name: 'Obra com armazenamento indisponível', exact: true }).waitFor();
  await stalled.waitForFunction(() => window.lateConnectionClosed === 1, { timeout: 10000 }); assert.equal(await stalled.evaluate(() => window.lateConnectionRead), 0);
  await stalled.getByRole('link', { name: 'Todas as obras' }).click(); await stalled.locator('.job-card').filter({ hasText: 'Obra com armazenamento indisponível' }).waitFor();
  console.log('PASS stalled IndexedDB: startup recovers; late connection cannot overwrite new records.');
  const parent = await context.newPage(); await parent.setContent(`<iframe title="isolated preview" sandbox="allow-scripts" src="${base}" style="width:1440px;height:1000px"></iframe>`);
  const frame = parent.frameLocator('iframe'); await frame.locator('#preview-status[data-mode=interactive]').waitFor();
  await frame.getByRole('button', { name: 'Nova obra', exact: true }).click(); await frame.locator('#new-job-form').waitFor(); await frame.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await frame.locator('.job-card').filter({ hasText: 'Apartamento · Manhattan' }).click(); await frame.getByRole('heading', { name: 'Apartamento · Manhattan', exact: true, level: 1 }).waitFor();
  console.log('PASS isolated iframe with scripts allowed: form buttons and job navigation work.');
} finally { await browser.close(); await new Promise(r => server.close(r)); }
