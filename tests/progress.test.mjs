import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/progress.js';
const { jobProgress, serviceProgress, completionScope } = globalThis.SkytileProgress;
const job = () => ({ status: 'active', rooms: [{ id: 'a', services: ['Tile', 'Rejunte'] }, { id: 'b', services: ['Tile'] }], entries: [], events: [] });
const entry = (service, progress, roomId = 'a', at = '2026-10-11T12:00:00Z') => ({ roomId, service, progress, at });
test('unreported work stays visible in the denominator; latest report controls each service', () => {
  const j = job(); assert.equal(jobProgress(j).percent, 0); assert.equal(jobProgress(j).known, 0);
  j.entries.push(entry('Tile', 'done'), entry('Tile', 'ongoing'));
  const p = jobProgress(j); assert.equal(p.percent, 15); assert.equal(p.total, 3); assert.equal(p.known, 1);
  assert.equal(jobProgress(j, 'a').percent, 25);
});
test('waiting for review adds no invented progress and keeps prior estimate', () => {
  const j = job(); j.entries.push(entry('Tile', 'almost'), entry('Tile', 'review'), entry('Rejunte', 'review'));
  assert.equal(serviceProgress(j, 'a', 'Tile').percent, 80);
  assert.equal(serviceProgress(j, 'a', 'Rejunte').known, false);
  assert.equal(jobProgress(j).review, 2); assert.equal(jobProgress(j).percent, 25);
});
test('each planned service has equal weight, even in rooms with different service counts', () => {
  const j = job(); j.entries.push(entry('Tile', 'done', 'b'));
  assert.equal(jobProgress(j).percent, 35);
});
test('rounding never displays 100 for unfinished work', () => {
  const j = { ...job(), rooms: [{ id: 'a', services: Array.from({ length: 20 }, (_, i) => 's' + i) }] };
  j.entries = j.rooms[0].services.map((s, i) => entry(s, i === 0 ? 'almost' : 'done'));
  assert.equal(jobProgress(j).percent, 95);
  j.entries.push(entry('s0', 'done')); assert.equal(jobProgress(j).percent, 100); assert.equal(jobProgress(j).confirmed, false);
});
test('confirmed delivery and reopening preserve scope, while new adjustments update estimates', () => {
  const j = job(); j.status = 'delivered'; assert.equal(jobProgress(j).percent, 100); assert.equal(jobProgress(j).confirmed, true);
  j.events.push({ type: 'delivered', at: '2026-10-11T13:00:00Z', scope: completionScope(j) });
  j.status = 'active'; assert.equal(jobProgress(j).percent, 100); assert.equal(jobProgress(j).confirmed, false);
  j.rooms.push({ id: 'new', services: ['Ajuste'] }); assert.equal(jobProgress(j).percent, 75);
  j.entries.push(entry('Tile', 'ongoing', 'a', '2026-10-11T14:00:00Z')); assert.equal(jobProgress(j).percent, 65);
  assert.equal(serviceProgress(j, 'a', 'Rejunte').percent, 100);
});
