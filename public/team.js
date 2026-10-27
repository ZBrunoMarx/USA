(function () {
  const positions = Object.freeze({ installer: 'Instalador', grout: 'Grout specialist · rejunte', helper: 'Helper · ajudante', management: 'Gestão' });
  const skills = Object.freeze(['Self-level', 'Tile no piso', 'Tile na parede', 'Rejunte', 'Preparação da base', 'Demolição']);
  const roster = [
    { id: 'thiago', code: 'SK-001', name: 'Thiago', role: 'admin', position: 'management' },
    { id: 'johnny', code: 'SK-002', name: 'Jonny', role: 'worker', position: 'installer' },
    { id: 'flavio', code: 'SK-003', name: 'Flavio', role: 'admin', position: 'installer' },
    { id: 'marlo', code: 'SK-004', name: 'Marlo', role: 'worker', position: 'installer' },
    { id: 'willian', code: 'SK-005', name: 'Willian', role: 'worker', position: 'installer' },
    { id: 'bruno', code: 'SK-006', name: 'Bruno', role: 'worker', position: 'helper' },
  ];
  const defaultUsers = () => roster.map(u => ({ ...u, skills: [], active: true, specialty: positions[u.position] }));
  function nextCode(users) {
    const max = Math.max(0, ...users.map(u => /^SK-\d+$/.test(u.code || '') ? Number(u.code.slice(3)) : 0));
    return 'SK-' + String(max + 1).padStart(3, '0');
  }
  function migrateTeam(state) {
    if (state.teamVersion === 1) return false;
    for (const base of defaultUsers()) {
      const existing = state.users.find(u => u.id === base.id);
      if (existing) Object.assign(existing, base); else state.users.push(base);
    }
    for (const u of state.users) {
      if (['diego', 'ajudante'].includes(u.id)) u.active = false;
      if (!u.code) u.code = nextCode(state.users);
      if (!u.position) u.position = 'installer';
      if (!u.skills) u.skills = [];
      if (u.active === undefined) u.active = true;
    }
    // Only fictional starter entries are renamed; real history and assignment IDs stay intact.
    for (const j of state.jobs) for (const e of j.entries) {
      if (e.demo && e.authorId === 'diego') { e.authorId = 'marlo'; e.author = 'Marlo'; }
      if (e.demo && e.authorId === 'johnny') e.author = 'Jonny';
    }
    state.teamVersion = 1; return true;
  }
  function validateProfile(body, previous = null) {
    const fail = message => { const e = new Error(message); e.status = 400; throw e; };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) fail('Informe um nome de até 120 caracteres.');
    if (!Object.hasOwn(positions, body.position)) fail('Selecione uma função profissional válida.');
    const selected = body.skills === undefined ? previous?.skills || [] : body.skills;
    if (!Array.isArray(selected) || selected.some(s => !skills.includes(s))) fail('Selecione habilidades válidas.');
    return { name: body.name.trim(), position: body.position, specialty: positions[body.position], skills: [...new Set(selected)] };
  }
  function validateAssignment(users, userIds, previous = null) {
    if (!Array.isArray(userIds) || userIds.some(id => { const u = users.find(u => u.id === id); return !u || (u.active === false && !previous?.userIds.includes(id)); })) {
      const e = new Error('Selecione profissionais ativos. Perfis antigos só podem ser mantidos na escala já registrada.'); e.status = 400; throw e;
    }
    return [...new Set(userIds)];
  }
  globalThis.SkytileTeam = Object.freeze({ positions, skills, defaultUsers, nextCode, migrateTeam, validateProfile, validateAssignment });
})();
