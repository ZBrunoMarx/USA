// Browser-only adapter used by Skytile.html. The server-backed application does not load this file.
(function () {
  const initial = window.SKYTILE_PREVIEW_SEED;
  let state = structuredClone(initial), database = null;
  const local = { persistent: false, request };
  window.SkytileLocal = local;
  const ready = new Promise(resolve => {
    // Restricted viewers may leave IndexedDB pending instead of raising an error.
    // A late connection must never replace records created after the memory fallback.
    let settled = false;
    const timeout = setTimeout(() => finish(), 5000);
    const finish = (connection = null, saved = null) => {
      if (settled) { connection?.close(); return; }
      settled = true; clearTimeout(timeout);
      if (connection) {
        database = connection;
        if (saved) state = saved;
        local.persistent = true;
        connection.onversionchange = () => { connection.close(); database = null; local.persistent = false; };
      }
      resolve();
    };
    try {
      const open = indexedDB.open('skytile-preview-v1', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('data')) open.result.createObjectStore('data'); };
      open.onerror = open.onblocked = () => finish();
      open.onsuccess = () => {
        const connection = open.result;
        if (settled) { connection.close(); return; }
        try {
          const tx = connection.transaction('data');
          const read = tx.objectStore('data').get('state');
          tx.onabort = tx.onerror = () => { connection.close(); finish(); };
          read.onsuccess = () => finish(connection, read.result);
          read.onerror = () => { connection.close(); finish(); };
        } catch { connection.close(); finish(); }
      };
    } catch { finish(); }
  });
  let queue = Promise.resolve();
  const now = () => new Date().toISOString();
  const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const id = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fail = message => { throw new Error(message); };
  const required = (value, label) => typeof value === 'string' && value.trim() ? value.trim() : fail(`Preencha ${label}.`);
  const progressLabels = { not_started: 'Não iniciado', started: 'Iniciado', ongoing: 'Em andamento', almost: 'Quase concluído', review: 'Aguardando avaliação', done: 'Conclusão relatada' };
  async function persist() {
    if (!database) return;
    await new Promise((resolve, reject) => {
      const tx = database.transaction('data', 'readwrite'); tx.objectStore('data').put(state, 'state');
      tx.oncomplete = resolve; tx.onerror = () => reject(new Error('Não foi possível salvar no navegador. O espaço pode estar cheio.')); tx.onabort = tx.onerror;
    });
  }
  async function request(path, options = {}, profile) {
    const operation = async () => {
      await ready;
      const previous = structuredClone(state);
      try {
        const teamChanged = globalThis.SkytileTeam.migrateTeam(state);
        if (globalThis.SkytileFinance.migrate(state) || teamChanged) await persist();
        const result = await handle(path, options, profile);
        if (options.method && options.method !== 'GET') await persist();
        return structuredClone(result);
      } catch (e) { state = previous; throw e; }
    };
    const result = queue.then(operation); queue = result.catch(() => {}); return result;
  }
  async function handle(path, options, profile) {
    const user = state.users.find(u => u.id === profile);
    if (!user) fail('Perfil inválido.');
    const admin = () => { if (user.role !== 'admin') fail('Esta ação está disponível para Thiago e Flavio.'); };
    const body = options.body || {};
    if (path === '/state') return { ...globalThis.SkytileFinance.stateView(state, user, day()), ai:{available:false,mode:'standalone',provider:'OpenAI'} };
    if (user.active === false) fail('Este perfil foi arquivado. Selecione um profissional ativo.');
    if (/\/(analyze|analysis-review)$/.test(path)) fail('A análise real precisa da versão com servidor e chave de IA. Esta prévia permite tirar e salvar fotos, mas não chama uma IA.');
    if (options.method === 'POST') {
      const result = globalThis.SkytileFinance.handle(state, path, body, user, { today: day(), now, id, receipt: p => {
        if (!p) return null;
        if (!/^data:image\/(jpeg|png|webp|gif|heic|heif);base64,/.test(p.url || '')) fail('Selecione uma imagem como comprovante.');
        return p;
      } });
      if (result) return result;
    }
    if (path === '/users' && options.method === 'POST') {
      admin(); const person = { id: id(), code: globalThis.SkytileTeam.nextCode(state.users), ...globalThis.SkytileTeam.validateProfile(body), role: 'worker', active: true, createdAt: now() }; if (Object.hasOwn(body, 'dailyRateCents')) globalThis.SkytileFinance.setRate(state, person.id, body.dailyRateCents); state.users.push(person); return person;
    }
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch && options.method === 'PATCH') {
      admin(); const person = state.users.find(u => u.id === userMatch[1] && u.active !== false); if (!person) fail('Profissional não encontrado.');
      const fields = globalThis.SkytileTeam.validateProfile(body, person);
      if (Object.hasOwn(body, 'dailyRateCents')) globalThis.SkytileFinance.setRate(state, person.id, body.dailyRateCents);
      Object.assign(person, fields); return person;
    }
    if (path === '/upload') {
      const type = String(body.type).split(';')[0];
      if (!/^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|audio\/(webm|mp4|ogg))$/.test(type)) fail('Formato de arquivo não suportado.');
      if (!body.data || body.data.length > 16 * 1024 * 1024) fail('Limite de 12 MB por arquivo.');
      return { name: body.name, type, url: `data:${type};base64,${body.data}` };
    }
    if (path === '/jobs') {
      admin(); const rooms = body.rooms.map(r => ({ id: id(), name: required(r.name, 'o ambiente'), services: r.services.length ? r.services : ['Serviço geral'], region: null }));
      const job = { id: id(), name: required(body.name, 'o nome'), address: required(body.address, 'o endereço'), description: body.description || '', status: 'planned', createdAt: now(), deliveredAt: null, cover: body.cover, initialPhotos: body.initialPhotos || [], plan: body.plan, demo: false, rooms, entries: [], assignments: [], events: [{ id: id(), type: 'created', at: now(), author: user.name, note: 'Obra cadastrada.' }] };
      state.jobs.unshift(job); globalThis.SkytileFinance.migrate(state); return job;
    }
    const match = path.match(/^\/jobs\/([^/]+)\/(status|entries|assignments|rooms|plan|regions)$/);
    if (match) {
      const job = state.jobs.find(j => j.id === match[1]); if (!job) fail('Obra não encontrada.');
      const action = match[2];let createdEntryId=null;
      if (action !== 'entries') admin();
      if (job.status === 'delivered' && !['status', 'plan', 'regions'].includes(action)) fail('Reabra a obra antes de continuar.');
      if (action === 'entries') {
        const room = job.rooms.find(r => r.id === body.roomId); if (!room || !room.services.includes(body.service)) fail('Selecione ambiente e serviço.');
        if (!body.note?.trim() && !body.photos?.length && !body.audio) fail('Adicione uma foto, um relato ou um áudio.');
        if (!Object.hasOwn(progressLabels, body.progress)) fail('Avanço inválido.');
        createdEntryId=id();job.entries.push({ id: createdEntryId, at: now(), date: day(), authorId: user.id, author: user.name, roomId: body.roomId, service: body.service, phase: body.phase, progress: body.progress, note: body.note.trim(), photos: body.photos, audio: body.audio || null });
        if (job.status === 'planned') { job.status = 'active'; job.events.push({ id: id(), type: 'status', at: now(), author: user.name, note: 'Execução iniciada com o primeiro registro.' }); }
      } else if (action === 'status') {
        if (!['planned', 'active', 'delivered'].includes(body.status)) fail('Status inválido.');
        const reopen = job.status === 'delivered' && body.status !== 'delivered'; if (reopen) required(body.reason, 'o motivo da reabertura');
        if (reopen) { const previous = [...job.events].reverse().find(e => e.type === 'delivered'); if (previous && !previous.scope) previous.scope = globalThis.SkytileProgress.completionScope(job); }
        if (job.status !== body.status) job.events.push({ id: id(), at: now(), type: reopen ? 'reopened' : body.status === 'delivered' ? 'delivered' : 'status', author: user.name, ...(body.status === 'delivered' ? { scope: globalThis.SkytileProgress.completionScope(job) } : {}), note: reopen ? body.reason : body.status === 'delivered' ? 'Obra entregue. Histórico preservado.' : 'Execução iniciada.' });
        job.status = body.status; job.deliveredAt = body.status === 'delivered' ? now() : null;
      } else if (action === 'assignments') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0, 10) !== body.date) fail('Data inválida.');
        const prior = job.assignments.find(a => a.date === body.date);
        body.userIds = globalThis.SkytileTeam.validateAssignment(state.users, body.userIds, prior);
        job.assignments = job.assignments.filter(a => a.date !== body.date);
        job.assignments.push({ date: body.date, userIds: body.userIds, by: user.name, at: now() });
        job.events.push({ id: id(), type: 'assignment', at: now(), author: user.name, previous: prior || null, note: `Equipe para ${body.date}: ${body.userIds.map(id => state.users.find(u => u.id === id).name).join(', ') || 'não definida'}.` });
      } else if (action === 'rooms') {
        job.rooms.push({ id: id(), name: required(body.name, 'o ambiente'), services: body.services.length ? body.services : ['Serviço geral'], region: null });
      } else if (action === 'plan') { job.plan = body.plan; job.rooms.forEach(r => r.region = null); }
      else if (action === 'regions') {
        const room = job.rooms.find(r => r.id === body.roomId); if (!room) fail('Ambiente inválido.');
        if (!job.plan || job.plan.type === 'application/pdf' || !Array.isArray(body.region) || body.region.length !== 4 || body.region.some(n => !Number.isFinite(n) || n < 0 || n > 1) || body.region[2] < .01 || body.region[3] < .01 || body.region[0] + body.region[2] > 1.001 || body.region[1] + body.region[3] > 1.001) fail('Área inválida.');
        room.region = body.region;
      }
      return { ...globalThis.SkytileFinance.jobView(job, user), ...(createdEntryId?{createdEntryId}:{}) };
    }
    if (path === '/chat/audio') {
      admin(); if (!body.audio) fail('Grave uma mensagem.');
      const message = { id: id(), at: now(), author: user.name, question: 'Mensagem de áudio', audio: body.audio, answer: 'Áudio salvo nesta prévia. Transcrição não está conectada. Digite sua pergunta para consultar os registros.', sources: [], mode: 'local' };
      state.chat.push(message); return message;
    }
    if (path === '/chat') {
      admin(); const question = required(body.question, 'a pergunta');
      const message = { id: id(), at: now(), author: user.name, question, ...globalThis.SkytileAssistant.respond(state, question, body.jobId, day()) }; state.chat.push(message); return message;
    }
    fail('Operação indisponível nesta prévia.');
  }
})();
