import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const directory = mkdtempSync(join(tmpdir(), 'skytile-test-'));
let processHandle, base, jobId, roomId;
async function launch() {
  processHandle = spawn(process.execPath, ['server.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, NODE_ENV:'test', SKYTILE_AUTH:'demo', SKYTILE_PUBLIC_ORIGIN:'', SKYTILE_BOOTSTRAP_PASSWORD:'', SKYTILE_AI_KEY:'',OPENAI_API_KEY:'',PORT: '0', SKYTILE_DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    processHandle.stdout.on('data', b => { const match = b.toString().match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    processHandle.once('error', reject);
    processHandle.stderr.on('data', b => { clearTimeout(timeout); reject(new Error(b.toString())); });
  });
}
async function stop() { const exited = once(processHandle, 'exit'); processHandle.kill('SIGTERM'); await exited; }
async function request(path, method = 'GET', body, profile = 'thiago') {
  const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Skytile-User': profile }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, data: await r.json() };
}
before(launch);
after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });

test('create a job with two rooms; every worker sees it without assignment', async () => {
  const r = await request('/jobs', 'POST', { name: 'Teste de campo', address: 'Newark, NJ', description: 'Escopo de teste', rooms: [{ name: 'Sala', services: ['Self-level', 'Tile no piso'] }, { name: 'Banheiro', services: ['Rejunte'] }] });
  assert.equal(r.status, 201); jobId = r.data.id; roomId = r.data.rooms[0].id;
  assert.equal(r.data.status, 'planned');
  const worker = await request('/state', 'GET', null, 'johnny');
  assert.ok(worker.data.jobs.some(j => j.id === jobId));
  assert.equal((await request('/jobs', 'POST', { name: 'Forbidden' }, 'johnny')).status, 403);
});
test('daily teams change without removing access, previous days remain', async () => {
  for (const [date, userIds] of [['2026-10-10', ['johnny']], ['2026-10-11', ['marlo']]]) {
    assert.equal((await request(`/jobs/${jobId}/assignments`, 'POST', { date, userIds })).status, 200);
  }
  const s = (await request('/state', 'GET', null, 'johnny')).data;
  const j = s.jobs.find(j => j.id === jobId);
  assert.equal(j.assignments.length, 2); assert.deepEqual(j.assignments[0].userIds, ['johnny']);
  assert.equal((await request(`/jobs/${jobId}/assignments`, 'POST', { date: '2026-02-30', userIds: [] })).status, 400);
});
test('upload and concurrent entries preserve both submissions and authors', async () => {
  const image = await request('/upload', 'POST', { name: 'foto.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=' }, 'johnny');
  assert.equal(image.status, 201);
  const input = { roomId, service: 'Self-level', progress: 'review', phase: 'end', note: 'Aguardar avaliação da base', photos: [image.data] };
  const results = await Promise.all([request(`/jobs/${jobId}/entries`, 'POST', input, 'johnny'), request(`/jobs/${jobId}/entries`, 'POST', { ...input, service: 'Tile no piso', progress: 'started', note: 'Preparação iniciada.' }, 'marlo')]);
  assert.ok(results.every(r => r.status === 200));
  const j = (await request('/state')).data.jobs.find(j => j.id === jobId);
  assert.equal(j.entries.length, 2); assert.equal(j.status, 'active');
  assert.deepEqual(j.entries.map(e => e.author).sort(), ['Jonny', 'Marlo']);
  const imageResponse = await fetch(base + image.data.url);
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get('content-type'), 'image/png');
});
test('delivery blocks new records, reopening requires reason and preserves history', async () => {
  const entries = (await request('/state')).data.jobs.find(j => j.id === jobId).entries;
  assert.equal((await request(`/jobs/${jobId}/status`, 'POST', { status: 'delivered' })).status, 200);
  assert.equal((await request(`/jobs/${jobId}/entries`, 'POST', {}, 'johnny')).status, 400);
  assert.equal((await request(`/jobs/${jobId}/status`, 'POST', { status: 'active' })).status, 400);
  const r = await request(`/jobs/${jobId}/status`, 'POST', { status: 'active', reason: 'Ajuste solicitado pelo cliente' });
  assert.equal(r.status, 200); assert.deepEqual(r.data.entries, entries);
  assert.ok(r.data.events.some(e => e.type === 'delivered')); assert.ok(r.data.events.some(e => e.type === 'reopened' && e.note.includes('cliente')));
  assert.equal(r.data.events.find(e => e.type === 'delivered').scope.length, 3);
  const progress = await request('/chat', 'POST', { question: 'Qual o percentual de conclusão?', jobId });
  assert.match(progress.data.answer, /100% — estimativa/);
  assert.ok(progress.data.sources.some(s => s.jobId === jobId));
});
test('admin chat cites records, distinguishes missing data, hides chat from workers', async () => {
  const result = await request('/chat', 'POST', { question: 'Quais são as pendências?', jobId });
  assert.equal(result.status, 200); assert.match(result.data.answer, /Aguardar avaliação/);
  assert.ok(result.data.sources.some(s => s.entryId && s.jobId === jobId));
  const team = await request('/chat', 'POST', { question: 'Qual equipe em 2026-10-10?', jobId });
  assert.match(team.data.answer, /Jonny/); assert.doesNotMatch(team.data.answer, /Marlo/);
  const unavailable = await request('/chat', 'POST', { question: 'Quanto material está no estoque?' });
  assert.match(unavailable.data.answer, /ainda não registra/);
  assert.equal((await request('/chat', 'POST', { question: 'Resumo' }, 'johnny')).status, 403);
  assert.deepEqual((await request('/state', 'GET', null, 'johnny')).data.chat, []);
});
test('invalid media, blank records, and outside regions are rejected', async () => {
  assert.equal((await request('/upload', 'POST', { type: 'text/html', data: 'YWJj' })).status, 400);
  assert.equal((await request(`/jobs/${jobId}/entries`, 'POST', { roomId, service: 'Self-level', progress: 'ongoing', phase: 'end', photos: [], note: '' })).status, 400);
  assert.equal((await request(`/jobs/${jobId}/entries`, 'POST', { roomId, service: 'Unknown', progress: 'ongoing', phase: 'end', photos: [], note: 'Hello' })).status, 400);
  assert.equal((await request(`/jobs/${jobId}/entries`, 'POST', { roomId, service: 'Self-level', progress: 'ongoing', phase: 'end', photos: [{ url: '/uploads/../../server.mjs' }], note: 'Hello' })).status, 400);
});
test('data survives server restart', async () => {
  const before = (await request('/state')).data.jobs.find(j => j.id === jobId);
  await stop(); await launch();
  const restored = (await request('/state')).data.jobs.find(j => j.id === jobId);
  assert.deepEqual(restored, before);
});
test('admin creates and edits professionals with stable IDs; worker cannot manage staff', async () => {
  const person = await request('/users', 'POST', { name: 'Especialista teste', position: 'grout', skills: ['Rejunte'], role: 'admin' });
  assert.equal(person.status, 201); assert.equal(person.data.role, 'worker'); assert.match(person.data.code, /^SK-\d+$/);
  const updated = await request('/users/' + person.data.id, 'PATCH', { name: 'Especialista atualizado', position: 'installer', skills: ['Self-level', 'Rejunte'] });
  assert.equal(updated.status, 200); assert.equal(updated.data.code, person.data.code); assert.equal(updated.data.id, person.data.id);
  assert.equal((await request('/users', 'POST', { name: 'Novo', position: 'helper' }, 'johnny')).status, 403);
  assert.equal((await request('/users/' + person.data.id, 'PATCH', { name: 'Novo', position: 'helper' }, 'johnny')).status, 403);
  assert.equal((await request('/users', 'POST', { name: 'Novo', position: 'unknown' })).status, 400);
  assert.equal((await request(`/jobs/${jobId}/assignments`, 'POST', { date: '2026-10-12', userIds: [person.data.id, 'bruno'] })).status, 200);
  const admin = await request('/users/flavio', 'PATCH', { name: 'Flavio', position: 'installer', skills: [] });
  assert.equal(admin.data.role, 'admin');
  await stop(); await launch();
  const saved = (await request('/state')).data.users.find(u => u.id === person.data.id);
  assert.equal(saved.name, 'Especialista atualizado'); assert.equal(saved.code, person.data.code);
});

test('job finance endpoints store exact costs, protect admin values on every worker response, and preserve restart history', async () => {
  const today = (await request('/state')).data.today;
  assert.equal((await request(`/jobs/${jobId}/finance`, 'POST', { contractCents: 1000000, budgetCents: 700000, remainingCents: 340000, deadline: today, expectedFinish: today })).status, 200);
  const image = await request('/upload', 'POST', { name: 'parking.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII=' }, 'bruno');
  const expense = await request(`/jobs/${jobId}/expenses`, 'POST', { amountCents: 2500, category: 'parking', date: today, note: 'Parking do teste', receipt: image.data }, 'bruno');
  assert.equal(expense.status, 200); assert.equal(expense.data.finance, undefined); assert.equal(expense.data.myExpenses[0].status, 'pending');
  const ownId = expense.data.myExpenses[0].id;
  assert.equal((await request(`/jobs/${jobId}/expenses/${ownId}/review`, 'POST', { status: 'approved' }, 'bruno')).status, 403);
  assert.equal((await request(`/jobs/${jobId}/finance`, 'POST', { contractCents: 1 }, 'bruno')).status, 403);
  const approved = await request(`/jobs/${jobId}/expenses/${ownId}/review`, 'POST', { status: 'approved' });
  assert.equal(approved.status, 200); assert.equal(approved.data.finance.expenses[0].amountCents, 2500);
  const workerState = (await request('/state', 'GET', null, 'bruno')).data;
  assert.equal(workerState.finance, undefined); assert.equal(workerState.jobs.find(j => j.id === jobId).finance, undefined);
  const otherState = (await request('/state', 'GET', null, 'johnny')).data;
  assert.deepEqual(otherState.jobs.find(j => j.id === jobId).myExpenses, []);
  const response = await request(`/jobs/${jobId}/entries`, 'POST', { roomId, service: 'Self-level', progress: 'ongoing', phase: 'update', note: 'Progresso sem exposição dos valores.', photos: [] }, 'johnny');
  assert.equal(response.status, 200); assert.equal(response.data.finance, undefined);
  const chat = await request('/chat', 'POST', { question: 'Como estão os custos?', jobId });
  assert.match(chat.data.answer, /Gasto confirmado/); assert.match(chat.data.answer, /25,00/); assert.ok(chat.data.sources.some(s => s.jobId === jobId));
  const before = approved.data.finance;
  await stop(); await launch();
  assert.deepEqual((await request('/state')).data.jobs.find(j => j.id === jobId).finance, before);
  assert.equal((await request(`/jobs/${jobId}/expenses`, 'POST', { amountCents: 1.5, category: 'parking', date: today }, 'bruno')).status, 400);
  assert.equal((await request(`/jobs/${jobId}/expenses`, 'POST', { amountCents: 0, category: 'parking', date: today }, 'bruno')).status, 400);
});
test('daily-rate edits are admin-only, labor has historical snapshots and double charging is rejected', async () => {
  const today = (await request('/state')).data.today;
  const person = (await request('/state')).data.users.find(u => u.id === 'bruno');
  const payload = { name: person.name, position: person.position, skills: person.skills, dailyRateCents: 20000 };
  assert.equal((await request('/users/bruno', 'PATCH', payload)).status, 200);
  assert.equal((await request('/users/bruno', 'PATCH', payload, 'bruno')).status, 403);
  assert.equal((await request(`/jobs/${jobId}/labor`, 'POST', { date: today, people: [{ userId: 'bruno', rateCents: 20000, fraction: 1 }] })).status, 200);
  assert.equal((await request('/users/bruno', 'PATCH', { ...payload, dailyRateCents: 30000 })).status, 200);
  const saved = (await request('/state')).data.jobs.find(j => j.id === jobId).finance.labor;
  assert.equal(saved[0].people[0].amountCents, 20000);
  assert.equal((await request(`/jobs/${jobId}/labor`, 'POST', { date: today, people: [] }, 'bruno')).status, 403);
  const second = await request('/jobs', 'POST', { name: 'Segunda obra para diária', address: 'Newark', rooms: [{ name: 'Banheiro', services: ['Rejunte'] }] });
  const duplicate = await request(`/jobs/${second.data.id}/labor`, 'POST', { date: today, people: [{ userId: 'bruno', rateCents: 20000, fraction: 1 }] });
  assert.equal(duplicate.status, 400); assert.match(duplicate.data.error, /outra obra/);
  const before = (await request('/state')).data.users.find(u => u.id === 'bruno').name;
  assert.equal((await request('/users/bruno', 'PATCH', { ...payload, name: 'Não salvar', dailyRateCents: -1 })).status, 400);
  assert.equal((await request('/state')).data.users.find(u => u.id === 'bruno').name, before);
});
