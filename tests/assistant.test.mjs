import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/progress.js';
import '../public/team.js';
import '../public/finance.js';
import '../public/assistant.js';
const today = '2026-10-11';
const state = () => ({ users: globalThis.SkytileTeam.defaultUsers(), jobs: [
  { id: 'a', name: 'Obra de Newark', status: 'active', rooms: [{ id: 'room', name: 'Sala', services: ['Tile no piso'] }], entries: [
    { id: 'entry', at: today + 'T12:00:00Z', date: today, author: 'Jonny', roomId: 'room', service: 'Tile no piso', progress: 'ongoing', note: 'Aguardar avaliação da base.' }
  ], assignments: [{ date: today, userIds: ['johnny'] }, { date: '2026-10-10', userIds: ['bruno'] }], events: [] },
  { id: 'b', name: 'Obra entregue', status: 'delivered', rooms: [], entries: [], assignments: [], events: [] },
] });
const ask = (question, jobId, s = state()) => globalThis.SkytileAssistant.respond(s, question, jobId, today);
test('assistant distinguishes registered professions from daily assignments without inventing skills', () => {
  const roster = ask('Quais profissionais estão cadastrados?');
  for (const name of ['Jonny', 'Flavio', 'Marlo', 'Willian', 'Bruno']) assert.ok(roster.answer.includes(name));
  assert.match(roster.answer, /Etapas ainda não informadas/); assert.equal(roster.sources[0].kind, 'team');
  const helper = ask('Quem é helper?'); assert.match(helper.answer, /Bruno/); assert.doesNotMatch(helper.answer, /Jonny/);
  const missing = ask('Quais grout specialists temos?'); assert.match(missing.answer, /Nenhum profissional/);
  const team = ask('Quem está na equipe de hoje?'); assert.match(team.answer, /Jonny/); assert.doesNotMatch(team.answer, /Bruno/);
});
test('assistant respects selected job, named job, dates and reports with source IDs', () => {
  assert.match(ask('Qual o percentual da Obra de Newark?').answer, /50%/);
  const pending = ask('Quais são as pendências?', 'a'); assert.equal(pending.sources[0].entryId, 'entry');
  assert.match(ask('Qual equipe de ontem?', 'a').answer, /Bruno/);
  assert.match(ask('Qual equipe em 2026-10-11?', 'a').answer, /Jonny/);
  assert.match(ask('Resuma o avanço', 'a').answer, /50%/);
  assert.throws(() => ask('Resumo', 'missing'), /Obra não encontrada/);
});
test('unsupported questions do not turn into fabricated answers even with a selected job', () => {
  assert.match(ask('Quanto gastamos?', 'a').answer, /Gasto confirmado/);
  assert.match(ask('Quanto gastamos?', 'a').answer, /Orçamento ainda não informado/);
  assert.match(ask('A mistura está tecnicamente correta?', 'a').answer, /modo local/);
  assert.match(ask('Quais obras foram entregues?').answer, /Obra entregue/);
  assert.doesNotMatch(ask('Quais obras estão abertas?').answer, /Obra entregue/);
});
test('missing reports and empty job lists provide useful responses', () => {
  const empty = state(); empty.jobs[0].entries = [];
  const summary = ask('Resumo', 'a', empty); assert.match(summary.answer, /sem registro de avanço/); assert.equal(summary.sources[0].jobId, 'a');
  empty.jobs = []; assert.match(ask('Resumo', null, empty).answer, /Não há obras abertas/);
  assert.match(ask('Quais profissionais estão cadastrados?', null, empty).answer, /Bruno/);
});
