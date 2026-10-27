import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../public/team.js';
const { defaultUsers, migrateTeam, nextCode, validateProfile, validateAssignment } = globalThis.SkytileTeam;
test('initial roster matches actual names and separates professional function from system access', () => {
  const users = defaultUsers();
  assert.deepEqual(users.filter(u => u.position === 'installer').map(u => u.name), ['Jonny', 'Flavio', 'Marlo', 'Willian']);
  assert.equal(users.find(u => u.name === 'Bruno').position, 'helper');
  assert.equal(users.find(u => u.name === 'Flavio').role, 'admin');
  assert.equal(users.filter(u => u.position === 'grout').length, 0);
  assert.ok(users.every(u => u.skills.length === 0));
  assert.equal(new Set(users.map(u => u.code)).size, users.length);
  assert.equal(nextCode(users), 'SK-007');
});
test('legacy migration preserves IDs, real authored history and daily assignments', () => {
  const real = { id: 'real', authorId: 'johnny', author: 'Johnny', note: 'Registro real' };
  const legacy = { users: [{ id: 'johnny', name: 'Johnny', role: 'worker' }, { id: 'diego', name: 'Diego', role: 'worker' }], jobs: [{ entries: [real, { id: 'demo', authorId: 'diego', author: 'Diego', demo: true }], assignments: [{ date: '2026-10-10', userIds: ['diego', 'johnny'] }] }] };
  assert.equal(migrateTeam(legacy), true);
  assert.equal(legacy.users.find(u => u.id === 'johnny').name, 'Jonny');
  assert.equal(legacy.users.find(u => u.id === 'diego').active, false);
  assert.equal(legacy.jobs[0].entries[0].author, 'Johnny');
  assert.deepEqual(legacy.jobs[0].assignments[0].userIds, ['diego', 'johnny']);
  assert.equal(legacy.jobs[0].entries[1].author, 'Marlo');
  const before = structuredClone(legacy); assert.equal(migrateTeam(legacy), false); assert.deepEqual(legacy, before);
});
test('capabilities are explicit, optional and independent of installer/helper classification', () => {
  assert.deepEqual(validateProfile({ name: 'Novo', position: 'installer' }).skills, []);
  assert.deepEqual(validateProfile({ name: 'Novo', position: 'grout', skills: ['Rejunte', 'Rejunte'] }).skills, ['Rejunte']);
  assert.throws(() => validateProfile({ name: '', position: 'helper' }));
  assert.throws(() => validateProfile({ name: 'Novo', position: 'invalid' }));
  assert.throws(() => validateProfile({ name: 'Novo', position: 'installer', skills: ['Inventado'] }));
});
test('archived professionals can remain in an old team but cannot be assigned to a new day', () => {
  const users = [...defaultUsers(), { id: 'legacy', active: false }];
  assert.throws(() => validateAssignment(users, ['legacy']));
  assert.deepEqual(validateAssignment(users, ['legacy', 'bruno', 'bruno'], { userIds: ['legacy'] }), ['legacy', 'bruno']);
});
