import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'reports-api-')), password = 'Report-test-password-2026';
let child, base, admin, worker, other, image, report;
const fields = { title: 'Bathroom grout', date: '2026-10-24', author: 'Bruno', scope: 'Floor grout', language: 'en', percent: '80', company: '', completed: '', remaining: 'Doorway' };
async function start() {
  child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV: 'test', PORT: '0', SKYTILE_AUTH: 'required', SKYTILE_PUBLIC_ORIGIN: 'https://reports.test', SKYTILE_DATA_DIR: dir, SKYTILE_BOOTSTRAP_PASSWORD: password, SKYTILE_AI_KEY: '', OPENAI_API_KEY: '' } });
  base = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('startup timeout')), 10000); child.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); resolve(match[0]); } }); child.once('error', reject); });
}
async function stop() { const done = once(child, 'exit'); child.kill('SIGTERM'); await done; }
async function request(path, method = 'GET', body, session = admin) {
  const response = await fetch(base + '/api/' + path, { method, headers: { Origin: 'https://reports.test', 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(start); after(async () => { await stop(); rmSync(dir, { recursive: true, force: true }); });

test('shared reports require login and worker ownership, and broadcasts contain no photos', async () => {
  assert.equal((await request('field-reports', 'GET', null, '')).status, 401);
  admin = (await request('auth/login', 'POST', { login: 'thiago', password }, '')).cookie;
  for (const id of ['bruno', 'johnny']) assert.equal((await request('auth/access', 'POST', { userId: id, password })).status, 200);
  worker = (await request('auth/login', 'POST', { login: 'bruno', password }, '')).cookie;
  other = (await request('auth/login', 'POST', { login: 'johnny', password }, '')).cookie;
  const controller = new AbortController();
  const events = await fetch(base + '/api/field-reports/events', { headers: { Cookie: admin }, signal: controller.signal });
  assert.equal(events.status, 200); assert.equal(events.headers.get('content-type'), 'text/event-stream');
  const reader = events.body.getReader(); await reader.read();
  image = (await request('field-report-images', 'POST', { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=' }, worker)).data;
  report = { id: randomUUID(), jobId: 'demo-manhattan', expectedRevision: 0, status: 'active', fields, photos: { before: [{ id: randomUUID(), name: 'before.png', imageId: image.imageId }], after: [], pending: [] }, logo: null };
  const created = await request('field-reports/' + report.id, 'PUT', report, worker); assert.equal(created.status, 200); assert.equal(created.data.revision, 1);
  const broadcast = await Promise.race([reader.read(), new Promise((_, reject) => setTimeout(() => reject(new Error('broadcast timeout')), 3000).unref())]);
  const text = new TextDecoder().decode(broadcast.value); assert.match(text, /event: change/); assert.ok(!text.includes('imageId')); controller.abort(); await reader.cancel().catch(() => {});
  assert.equal((await request('field-reports/' + report.id, 'PUT', { ...report, expectedRevision: 1 }, other)).status, 403);
  assert.equal((await request('field-reports/' + report.id, 'GET', null, other)).data.canEdit, false);
});
test('conflicting writes preserve the first update and all authorized devices read the same result', async () => {
  const update = { ...report, expectedRevision: 1, fields: { ...fields, percent: '90' } };
  const attempts = await Promise.all([request('field-reports/' + report.id, 'PUT', update, worker), request('field-reports/' + report.id, 'PUT', { ...update, fields: { ...fields, percent: '100' } }, admin)]);
  assert.deepEqual(attempts.map(result => result.status).sort(), [200, 409]);
  const current = (await request('field-reports/' + report.id, 'GET', null, other)).data;
  assert.equal(current.revision, 2); assert.ok(['90', '100'].includes(current.fields.percent));
  const picture = await fetch(base + '/api/field-report-images/' + image.imageId, { headers: { Cookie: other } }); assert.equal(picture.status, 200); assert.equal(picture.headers.get('cache-control'), 'private, no-store');
  assert.equal((await fetch(base + '/api/field-report-images/' + image.imageId)).status, 401);
});
test('bad input, unrelated photos, changed job and cross-origin edits are rejected', async () => {
  const update = { ...report, expectedRevision: 2 };
  assert.equal((await request('field-reports/' + report.id, 'PUT', { ...update, fields: { ...fields, percent: '101' } }, worker)).status, 400);
  assert.equal((await request('field-reports/' + report.id, 'PUT', { ...update, fields: { ...fields, date: '2026-02-31' } }, worker)).status, 400);
  assert.equal((await request('field-reports/' + report.id, 'PUT', { ...update, jobId: 'demo-newark' }, worker)).status, 400);
  assert.equal((await request('field-report-images', 'POST', { type: 'image/png', data: Buffer.from('not a photo').toString('base64') }, worker)).status, 400);
  const foreign = await fetch(base + '/api/field-reports/' + report.id, { method: 'PUT', headers: { Cookie: worker, Origin: 'https://elsewhere.test', 'Content-Type': 'application/json' }, body: JSON.stringify(update) }); assert.equal(foreign.status, 403);
});
test('reports, photos and sessions survive restart; archive and reopen retain evidence', async () => {
  await stop(); await start();
  assert.equal((await request('field-reports/' + report.id, 'GET', null, worker)).data.revision, 2);
  const archived = await request('field-reports/' + report.id, 'PUT', { ...report, expectedRevision: 2, status: 'archived' }, worker); assert.equal(archived.status, 200); assert.equal(archived.data.photos.before.length, 1); assert.equal(archived.data.fields.percent, '80');
  const reopened = await request('field-reports/' + report.id, 'PUT', { ...report, expectedRevision: 3 }, worker); assert.equal(reopened.data.status, 'active'); assert.equal(reopened.data.revision, 4);
  assert.equal((await request('auth/logout', 'POST', {}, worker)).status, 200);
  assert.equal((await request('field-reports', 'GET', null, worker)).status, 401);
});
