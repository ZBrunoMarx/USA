const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="m12 19-7-7 7-7M5 12h14"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  camera: '<path d="M14.5 4h-5L7 7H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-4z"/><circle cx="12" cy="13" r="4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  alert: '<path d="m12 3 10 18H2zM12 9v4M12 17h.01"/>',
  archive: '<rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v14h14V7M10 11h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.file}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabels = { planned: 'Planejada', active: 'Em andamento', delivered: 'Entregue' };
const progressLabels = { not_started: 'Não iniciado', started: 'Iniciado', ongoing: 'Em andamento', almost: 'Quase concluído', review: 'Aguardando avaliação', done: 'Conclusão relatada' };
const serviceOptions = ['Self-level', 'Tile no piso', 'Tile na parede', 'Rejunte', 'Preparação da base', 'Demolição', 'Serviço geral'];
const { jobProgress, serviceProgress, stages } = globalThis.SkytileProgress;
const { positions, skills: professionalSkills } = globalThis.SkytileTeam;
const activeUsers = () => state.users.filter(u => u.active !== false);
function progressBar(j, roomId = null, compact = false) {
  const p = jobProgress(j, roomId);
  const label = p.confirmed ? 'Entrega confirmada' : 'Avanço estimado';
  const meta = p.confirmed ? 'Obra entregue pelo administrador' : p.known === 0 ? 'Aguardando estimativa dos serviços' : `${p.known} de ${p.total} serviços com estimativa${p.review ? ' · avaliação pendente' : ''}`;
  return `<div class="completion ${compact ? 'compact' : ''} ${p.confirmed ? 'confirmed' : ''}"><div class="completion-heading"><span>${label}</span><strong>${p.confirmed ? '' : '≈ '}${p.percent}%</strong></div><div class="completion-track" role="progressbar" aria-label="${label} de ${esc(roomId ? j.rooms.find(r => r.id === roomId).name : j.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}" aria-valuetext="${p.percent}%${p.confirmed ? ', entrega confirmada' : ', estimativa'}"><span style="width:${p.percent}%"></span></div><div class="completion-caption">${meta}</div></div>`;
}
let state, view = 'jobs', filter = 'open', search = '', currentJob = null, currentRoom = null, currentRoute = location.hash || '#jobs', chatJob = '', sourceEntry = null;
const profileStorage = {
  get() { try { return localStorage.getItem('skytile-profile'); } catch { return null; } },
  set(value) { try { localStorage.setItem('skytile-profile', value); } catch { /* A sandboxed preview can deny browser storage. */ } },
};
let profile = profileStorage.get() || 'thiago';
let authenticatedMode = false;
let photoCapture = null;
let busy = false, recording = null, recordedAudio = null, audioPreview = null, modalReturnFocus = null, mapController = null;
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const user = () => state.users.find(u => u.id === profile);
const isAdmin = () => user()?.role === 'admin';
const initials = name => name.split(/[ ·]+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
const dateLabel = (value, time = false) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/New_York', day: '2-digit', month: 'short', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(value.includes('T') ? value : value + 'T12:00:00Z'));
const toast = (message, error = false) => { const t = document.querySelector('#toast'); t.textContent = message; t.className = `show ${error ? 'error' : ''}`; clearTimeout(t.timer); t.timer = setTimeout(() => t.className = '', 4500); };
async function api(path, options = {}) {
  if (window.SkytileLocal) return window.SkytileLocal.request(path, options, profile);
  const r = await fetch(new URL('./api' + path, document.baseURI), { method: options.method || 'GET', signal: AbortSignal.timeout(options.timeout || 10000), headers: { 'Content-Type': 'application/json', 'X-Skytile-User': profile }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
  const data = await r.json();
  if (r.status === 401 && authenticatedMode && path !== '/auth/login') { state = null; renderLogin(); }
  if (!r.ok) { const error = new Error(data.error || 'Falha ao comunicar com o servidor.'); error.status=r.status; throw error; } return data;
}
async function refresh() { state = await api('/state'); route(); }
// Render from application state; a preview may intercept native fragment links.
function navigate(path) {
  const target = /^#(jobs|team|chat)(\/[^#?]+)*$/.test(path) ? path : '#jobs';
  if (currentRoute !== target) {
    try { history.pushState(null, '', target); } catch { /* URL history is optional in an embedded preview. */ }
  }
  window.scrollTo(0, 0);
  route(target);
}
function route(path = currentRoute) {
  currentRoute = path;
  const [section, jobId, roomId] = path.slice(1).split('/');
  view = ['jobs', 'team', 'chat'].includes(section) ? section : 'jobs';
  currentJob = state?.jobs.find(j => j.id === jobId) || null;
  currentRoom = currentJob?.rooms.find(r => r.id === roomId) || null;
  if (view === 'chat' && !isAdmin()) { navigate('#jobs'); return; }
  render();
  if (sourceEntry) {
    const entry = document.getElementById('entry-' + sourceEntry);
    if (entry) { entry.classList.add('cited-entry'); entry.tabIndex = -1; entry.focus({ preventScroll: true }); entry.scrollIntoView({ block: 'center' }); }
    sourceEntry = null;
  }
}
const nav = (id, symbol, title) => `<a href="#${id}" class="nav-item ${view === id ? 'selected' : ''}">${icon(symbol)}<span>${title}</span>${view === id ? '<span class="nav-dot"></span>' : ''}</a>`;
function render() {
  if (!state) return;
  app.innerHTML = `<aside class="sidebar"><a class="brand" href="#jobs" aria-label="Skytile, início"><span class="brand-word">SKY<span class="brand-star">✦</span>TILE</span><span class="brand-sub">FIELD OPERATIONS</span></a>
    <div class="workspace-label">SEU ESPAÇO DE TRABALHO</div><nav>${nav('jobs', 'grid', 'Obras')}${nav('team', 'people', 'Equipe diária')}${isAdmin() ? nav('chat', 'spark', 'Assistente') : ''}</nav>
    <div class="sidebar-bottom"><div class="local-indicator"><span></span> ${window.SkytileLocal ? 'Prévia no navegador' : authenticatedMode ? 'Espaço da equipe' : 'Ambiente local'}</div><p>Seu trabalho, organizado.<br>Um registro de cada vez.</p><div class="sidebar-version">SKYTILE · PROTÓTIPO 01</div></div></aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumbs">Skytile <span>/</span> ${view === 'team' ? 'Equipe diária' : view === 'chat' ? 'Assistente' : currentJob ? 'Obras / ' + esc(currentJob.name) : 'Visão geral'}</div><div class="profile-control"><span class="avatar">${initials(user().name)}</span>${authenticatedMode ? `<span>${esc(user().name)}</span><button class="button ghost" id="logout">Sair</button>` : `<span class="demo-label">Perfil de demonstração</span><select aria-label="Perfil de demonstração" id="profile">${activeUsers().map(u => `<option value="${u.id}" ${u.id === profile ? 'selected' : ''}>${esc(u.name)}${u.role === 'admin' ? ' · admin' : ''}</option>`).join('')}</select>`}</div></header>
    <main>${view === 'chat' ? chatPage() : view === 'team' ? teamPage() : currentJob ? jobPage() : jobsPage()}</main>
    <footer class="footer"><span>Skytile · Feito para o dia a dia da obra</span><span>${window.SkytileLocal ? 'Dados neste navegador' : 'Dados no servidor da equipe'}</span></footer></div>
    <nav class="mobile-nav">${nav('jobs', 'grid', 'Obras')}${nav('team', 'people', 'Equipe')}${isAdmin() ? nav('chat', 'spark', 'Assistente') : ''}</nav>`;
  const profileSelect = document.querySelector('#profile');
  if (profileSelect) profileSelect.onchange = async e => { closeModal(); profile = e.target.value; profileStorage.set(profile); try { state = await api('/state'); route(); } catch (e) { toast(e.message, true); } };
  const logout = document.querySelector('#logout');
  if (logout) logout.onclick = async () => {
    if (busy) return;
    try { await api('/auth/logout', { method:'POST', body:{} }); closeModal(); state=null; currentJob=null; currentRoom=null; renderLogin(); } catch(e) { toast(e.message,true); }
  };
  bindPage();
  syncChatBusy();
  const previewStatus = document.querySelector('#preview-status');
  if (previewStatus) {
    previewStatus.dataset.mode = 'interactive';
    previewStatus.innerHTML = '<strong>Interativo · v0.3.2</strong> — obras, equipe e consultas disponíveis.';
  }
}
function jobsPage() {
  const open = state.jobs.filter(j => j.status !== 'delivered');
  const updated = open.filter(j => j.entries.some(e => e.date === state.today)).length;
  const pending = open.reduce((count,j)=>count+j.rooms.reduce((n,r)=>n+r.services.filter(s=>{const e=[...j.entries].reverse().find(e=>e.roomId===r.id&&e.service===s);return e?.progress==='review'||needsVisualReview(e);}).length,0),0);
  const jobs = state.jobs.filter(j => (filter === 'open' ? j.status !== 'delivered' : j.status === 'delivered') && (j.name + j.address).toLowerCase().includes(search.toLowerCase()));
  return `<section class="page-heading"><div><div class="eyebrow">ACOMPANHAMENTO DE CAMPO</div><h1>Cada obra, um passo à frente.</h1><p>Acompanhe os ambientes, registre o avanço e mantenha a equipe conectada.</p></div>${isAdmin() ? `<button class="button primary" data-action="new-job">${icon('plus')} Nova obra</button>` : ''}</section>
    <div class="demo-banner">${icon('file')}<span>Explore com dados de exemplo. As obras marcadas como <strong>DEMO</strong> são fictícias. ${window.SkytileLocal ? window.SkytileLocal.persistent ? 'Seus registros ficam neste navegador, separados do servidor.' : 'Este visualizador não permite armazenamento; os registros duram enquanto esta prévia estiver aberta.' : 'Seus novos registros são salvos neste ambiente.'}</span></div>
    <section class="stats"><div class="stat"><div class="stat-top">Obras abertas ${icon('grid')}</div><div class="stat-value">${String(open.length).padStart(2, '0')}<span>planejadas e em execução</span></div></div><div class="stat"><div class="stat-top">Atualizadas hoje ${icon('camera')}</div><div class="stat-value">${String(updated).padStart(2, '0')}<span>com registros do dia</span></div></div><div class="stat"><div class="stat-top">Aguardando avaliação ${icon('clock')}</div><div class="stat-value">${String(pending).padStart(2, '0')}<span>serviços para revisar</span></div></div></section>
    <div class="list-toolbar"><div class="tabs"><button class="tab ${filter === 'open' ? 'active' : ''}" data-filter="open">Obras abertas <span>${open.length}</span></button><button class="tab ${filter === 'delivered' ? 'active' : ''}" data-filter="delivered">${icon('archive')} Finalizadas</button></div><label class="search">${icon('search')}<input id="job-search" placeholder="Buscar obra ou endereço" value="${esc(search)}" aria-label="Buscar obra ou endereço"></label></div>
    <section class="jobs-grid" id="jobs-grid">${jobs.length ? jobs.map(jobCard).join('') : `<div class="empty">${icon('grid')}<h3>Nenhuma obra por aqui.</h3><p>${search ? 'Tente outro nome ou endereço.' : filter === 'open' ? 'Cadastre uma obra para começar a registrar o avanço.' : 'As obras entregues aparecerão aqui, com todo o histórico.'}</p></div>`}</section>
    <section class="workflow-note"><span class="note-icon">${icon('people')}</span><div><strong>A equipe muda. O histórico fica.</strong><p>Todos podem acessar as obras abertas. A escala diária organiza quem vai a cada obra, sem bloquear o acesso.</p></div><a href="#team">Ver equipe diária ${icon('arrow')}</a></section>`;
}
function jobCard(j) {
  const assignment = j.assignments.find(a => a.date === state.today);
  const entry = j.entries.at(-1);
  return `<a class="job-card" href="#jobs/${j.id}"><div class="job-cover ${j.cover ? 'with-photo' : ''}">${j.cover ? `<img src="${esc(j.cover.url)}" alt="Foto inicial de ${esc(j.name)}">` : `<div class="tile-grid tile-${j.id === 'demo-newark' ? 'warm' : 'blue'}"><span></span><span></span><span></span><span></span><span></span><span></span></div><span class="cover-caption">${j.rooms.length > 1 ? 'MULTI-AMBIENTE' : 'AMBIENTE ÚNICO'}</span>`}<span class="badge status-${j.status}"><i></i>${statusLabels[j.status]}</span>${j.demo ? '<span class="demo-chip">DEMO</span>' : ''}</div><div class="job-card-content"><div class="card-title"><h3>${esc(j.name)}</h3>${icon('arrow')}</div><div class="address">${icon('pin')} ${esc(j.address)}</div><div class="card-meta"><span>${icon('grid')} ${j.rooms.length} ${j.rooms.length === 1 ? 'ambiente' : 'ambientes'}</span><span>${icon('camera')} ${j.entries.length} registros</span></div>${progressBar(j, null, true)}${financeCard(j)}<div class="card-bottom"><span class="small-avatar">${assignment?.userIds.length ? initials(state.users.find(u => u.id === assignment.userIds[0]).name) : icon('people')}</span><span>${assignment?.userIds.length ? assignment.userIds.map(id => esc(state.users.find(u => u.id === id).name)).join(', ') : 'Equipe do dia a definir'}</span></div><div class="last-update">${entry ? `Último registro · ${dateLabel(entry.at)}` : 'Pronta para o primeiro registro'}</div></div></a>`;
}
function jobPage() {
  const j = currentJob, r = currentRoom;
  return `<a class="back-link" href="${r ? '#jobs/' + j.id : '#jobs'}">${icon('back')} ${r ? 'Todos os ambientes' : 'Todas as obras'}</a>
    <section class="page-heading detail-heading"><div><div class="eyebrow">${r ? esc(j.name).toUpperCase() : 'VISÃO DA OBRA'} ${j.demo ? '<span class="inline-demo">DEMO</span>' : ''}</div><h1>${esc(r ? r.name : j.name)}</h1><p class="address">${icon('pin')} ${esc(j.address)}</p></div><div class="heading-actions">${r ? '' : `<span class="badge status-${j.status}"><i></i>${statusLabels[j.status]}</span>`}${state.auth?.enabled ? `<a class="button secondary" href="/relatorio/?job=${encodeURIComponent(j.id)}">Relatórios em vídeo</a>` : ''}${j.status !== 'delivered' ? `<button class="button primary" data-action="new-entry">${icon('camera')} Registrar avanço</button>` : ''}</div></section>
    ${j.status === 'delivered' ? `<div class="notice success">${icon('check')}<div><strong>Obra entregue. Histórico preservado.</strong><p>Um ajuste necessário pode ser registrado após a reabertura.</p></div>${isAdmin() ? '<button class="button secondary" data-action="reopen">Reabrir para ajuste</button>' : ''}</div>` : ''}
    <section class="completion-panel">${progressBar(j, r?.id)}<button class="button ghost" data-action="progress-info">Como calculamos?</button></section>
    ${!r && isAdmin() ? financePanel(j) : ''}
    ${r ? roomDetail(j, r) : jobOverview(j)}
    ${!r && !isAdmin() ? financePanel(j) : ''}
    <section class="section timeline-section"><div class="section-heading"><div><h2>${r ? 'Registros deste ambiente' : 'Linha do tempo da obra'}</h2><p>Fotos, relatos e decisões, preservados em sequência.</p></div><span class="count">${r ? j.entries.filter(e => e.roomId === r.id).length : j.entries.length} registros</span></div>${timeline(j, r)}</section>`;
}
function jobOverview(j) {
  const a = j.assignments.find(a => a.date === state.today);
  const regions = j.rooms.filter(r => r.region);
  return `<div class="job-summary"><div class="scope-summary"><span class="eyebrow">ESCOPO INICIAL</span><p>${esc(j.description || 'Ainda sem descrição do serviço.')}</p></div><div class="daily-team"><div><span class="eyebrow">EQUIPE DE HOJE · ${dateLabel(state.today)}</span><p>${a?.userIds.length ? a.userIds.map(id => `<span class="person-chip">${esc(state.users.find(u => u.id === id).name)}</span>`).join('') : 'Nenhuma equipe anotada.'}</p></div>${isAdmin() && j.status !== 'delivered' ? '<button class="button ghost" data-action="assignment">Definir equipe</button>' : ''}</div></div>
    <section class="section"><div class="section-heading"><div><h2>Ambientes e serviços</h2><p>Escolha onde você trabalhou para ver ou registrar o avanço.</p></div>${isAdmin() && j.status !== 'delivered' ? `<button class="button secondary" data-action="new-room">${icon('plus')} Ambiente</button>` : ''}</div>
    <div class="rooms-grid">${j.rooms.map(r => roomCard(j, r)).join('')}</div></section>
    ${j.plan ? `<section class="section plan-section"><div class="section-heading"><div><h2>Planta da obra</h2><p>${j.plan.type === 'application/pdf' ? 'PDF anexado. Para marcar áreas, envie uma versão em imagem.' : 'Toque em uma área marcada para abrir o ambiente.'}</p></div>${isAdmin() && j.plan.type !== 'application/pdf' && j.status !== 'delivered' ? '<button class="button secondary" data-action="map-room">Marcar ambiente</button>' : ''}</div>${j.plan.type === 'application/pdf' ? `<a class="file-link" href="${esc(j.plan.url)}" target="_blank" rel="noopener">${icon('file')} ${esc(j.plan.name)} ${icon('arrow')}</a>` : `<div class="plan-canvas"><img src="${esc(j.plan.url)}" alt="Planta de ${esc(j.name)}">${regions.map(r => `<a class="plan-region" href="#jobs/${j.id}/${r.id}" style="left:${r.region[0]*100}%;top:${r.region[1]*100}%;width:${r.region[2]*100}%;height:${r.region[3]*100}%"><span>${esc(r.name)}</span></a>`).join('')}</div>`}</section>` : `<div class="plan-placeholder">${icon('file')}<div><strong>Planta opcional</strong><p>Os cartões de ambientes já organizam a obra. Se houver planta, você pode anexá-la e marcar as áreas.</p></div>${isAdmin() && j.status !== 'delivered' ? '<button class="button secondary" data-action="upload-plan">Anexar planta</button>' : ''}</div>`}
    ${j.initialPhotos?.length ? `<section class="section"><div class="section-heading"><div><h2>Fotos iniciais</h2><p>Referência da obra no momento do cadastro.</p></div></div><div class="photo-gallery">${j.initialPhotos.map(p => photo(p)).join('')}</div></section>` : ''}
    ${isAdmin() && j.status !== 'delivered' ? `<div class="admin-actions"><span>Gestão da obra</span>${j.status === 'planned' ? '<button class="button secondary" data-action="start-job">Iniciar execução</button>' : ''}<button class="button secondary" data-action="deliver">${icon('check')} Marcar como entregue</button></div>` : ''}`;
}
function roomCard(j, r) {
  const last = [...j.entries].reverse().find(e => e.roomId === r.id);
  return `<a class="room-card" href="#jobs/${j.id}/${r.id}"><div class="room-card-top"><span class="room-icon">${icon('grid')}</span>${icon('arrow')}</div><h3>${esc(r.name)}</h3><div class="service-tags">${r.services.map(s => `<span>${esc(s)}</span>`).join('')}</div>${progressBar(j, r.id, true)}<div class="room-bottom">${last ? `<span class="progress-badge progress-${last.progress}">${progressLabels[last.progress]}</span><span>${dateLabel(last.at)}</span>` : '<span class="progress-badge">Sem registro</span><span>Registrar o início</span>'}</div>${last ? `<p class="room-last-service">Último relato: ${esc(last.service)}</p>` : ''}</a>`;
}
function roomDetail(j, r) {
  return `<div class="service-status-grid">${r.services.map(s => { const e = [...j.entries].reverse().find(e => e.roomId === r.id && e.service === s); return `<div class="service-status"><span class="eyebrow">SERVIÇO</span><h3>${esc(s)}</h3><span class="progress-badge progress-${e?.progress || 'not_started'}">${e ? progressLabels[e.progress] : 'Sem registro'}</span><p>${e ? `Relatado por ${esc(e.author)} · ${dateLabel(e.at)}` : 'O primeiro registro cria a referência.'}</p></div>`; }).join('')}</div><div class="info-strip">${icon('clock')} O último registro pode servir como referência para o início do próximo dia. Registre uma nova condição quando necessário.</div>`;
}
function photo(p) { return `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="photo-item">${p.url.endsWith('.heic') || /image\/hei[cf]/.test(p.type) ? `<span>${icon('file')} Foto HEIC · abrir arquivo</span>` : `<img loading="lazy" src="${esc(p.url)}" alt="${esc(p.name || 'Foto do registro')}">`}</a>`; }
function timeline(j, r) {
  const items = [...j.entries.filter(e => !r || e.roomId === r.id).map(e => ({ ...e, kind: 'entry' })), ...(!r ? j.events.map(e => ({ ...e, kind: 'event' })) : [])].sort((a, b) => b.at.localeCompare(a.at));
  if (!items.length) return `<div class="empty compact">${icon('camera')}<h3>O histórico começa com o primeiro registro.</h3><p>Uma foto e um relato já ajudam a contar o que aconteceu.</p></div>`;
  return `<div class="timeline">${items.map(e => e.kind === 'event' ? `<div class="timeline-event"><span class="event-dot"></span><p><strong>${esc(e.author)}</strong> · ${esc(e.note)}</p><time>${dateLabel(e.at, true)}</time></div>` : `<article class="entry-card" id="entry-${e.id}"><div class="entry-header"><span class="avatar small">${initials(e.author)}</span><div><strong>${esc(e.author)}</strong><span>${dateLabel(e.at, true)} · ${e.phase === 'start' ? 'Início do dia' : e.phase === 'end' ? 'Fim do dia' : 'Atualização'}</span></div>${e.demo ? '<span class="inline-demo">DEMO</span>' : ''}<span class="progress-badge progress-${e.progress}">${progressLabels[e.progress]}</span></div><div class="entry-location">${icon('grid')} ${esc(j.rooms.find(r => r.id === e.roomId)?.name)} <span>/</span> ${esc(e.service)}</div>${e.note ? `<p class="entry-note">${esc(e.note)}</p>` : ''}${e.photos.length ? `<div class="photo-gallery">${e.photos.map(photo).join('')}</div>` : ''}${e.audio ? `<audio controls preload="none" src="${esc(e.audio.url)}"></audio><p class="audio-note">Áudio original · sem transcrição automática no modo local</p>` : ''}${analysisPanel(j,e)}<div class="entry-foot">${icon('file')} Informação relatada pela equipe. Não representa avaliação técnica automática.</div></article>`).join('')}</div>`;
}
function teamPage() {
  const open = state.jobs.filter(j => j.status !== 'delivered');
  return `<section class="page-heading"><div><div class="eyebrow">PESSOAS E ORGANIZAÇÃO DO DIA</div><h1>Uma equipe, várias obras.</h1><p>Cadastre os profissionais e organize a escala. Todas as obras abertas continuam acessíveis.</p></div><div class="heading-actions"><div class="date-pill">${icon('sun')} ${dateLabel(state.today)}</div>${isAdmin() ? `<button class="button primary" data-action="new-person">${icon('plus')} Novo profissional</button>` : ''}</div></section>
    <section class="section"><div class="section-heading"><div><h2>Profissionais cadastrados</h2><p>Nome, ID e função. As habilidades podem ser informadas quando você souber.</p></div><span class="count">${activeUsers().length} cadastros</span></div><div class="people-list">${activeUsers().map(u => `<div class="person-row"><span class="avatar">${initials(u.name)}</span><div><strong>${esc(u.name)} <span class="person-id">${esc(u.code)}</span></strong><span>${esc(positions[u.position] || u.specialty)}</span><div class="person-skills">${u.skills?.length ? u.skills.map(s => `<span>${esc(s)}</span>`).join('') : `<small>${u.position === 'management' ? 'Gestão da companhia' : 'Etapas ainda não informadas'}</small>`}</div></div><span class="role-chip">${u.role === 'admin' ? 'Administrador' : 'Colaborador'}</span>${isAdmin() ? `<button class="button ghost person-edit" data-action="edit-person" data-job="${u.id}" aria-label="Editar ${esc(u.name)}">Editar</button>${authenticatedMode ? `<button class="button ghost person-access" data-action="person-access" data-job="${u.id}" aria-label="Definir acesso de ${esc(u.name)}">Acesso</button>` : ''}` : ''}</div>`).join('')}</div></section>
    <div class="info-strip">${icon('people')} A função profissional e o acesso ao sistema são independentes. Flavio é instalador e administrador; Thiago está cadastrado na gestão.</div>
    <section class="section"><div class="section-heading"><div><h2>Equipe por obra · hoje</h2><p>A escala muda por dia. O autor de cada registro é salvo separadamente.</p></div></div><div class="team-grid">${open.map(j => { const a = j.assignments.find(a => a.date === state.today); return `<article class="team-card"><span class="badge status-${j.status}"><i></i>${statusLabels[j.status]}</span><h3><a href="#jobs/${j.id}">${esc(j.name)}</a></h3><p class="address">${icon('pin')} ${esc(j.address)}</p><div class="assigned-people">${a?.userIds.length ? a.userIds.map(id => { const u = state.users.find(u => u.id === id); return `<div class="assigned-person"><span class="avatar small">${initials(u.name)}</span><div><strong>${esc(u.name)}</strong><span>${esc(u.code)} · ${esc(positions[u.position] || u.specialty)}</span></div></div>`; }).join('') : '<div class="unassigned">Equipe ainda não anotada para hoje.</div>'}</div>${isAdmin() ? `<button class="button secondary full" data-action="assignment" data-job="${j.id}">${icon('people')} Definir equipe / consultar dia</button>` : ''}</article>`; }).join('') || '<div class="empty">Não há obras abertas para organizar.</div>'}</div></section>`;
}
function chatPage() {
  return `<section class="page-heading"><div><div class="eyebrow">CONSULTA DOS REGISTROS</div><h1>Uma conversa sobre suas obras.</h1><p>Consulte o avanço, as pendências e a equipe com base no que foi registrado.</p></div><span class="local-pill"><span></span> Consulta local</span></section><div class="notice"><span class="note-icon">${icon('spark')}</span><div><strong>Chat de consultas locais</strong><p>Este chat usa consultas predefinidas, com links para as fontes. A análise de fotos acontece nos registros, quando ativada. Áudios ainda não são transcritos.</p></div></div><section class="chat-layout"><div class="chat-main"><div class="chat-thread" id="chat-thread">${state.chat.length ? state.chat.map(chatMessage).join('') : `<div class="chat-welcome"><span class="assistant-orb">✦</span><h2>O que vamos acompanhar hoje?</h2><p>Comece pelos registros da equipe.<br>As respostas mostram de onde veio cada informação.</p><div class="prompt-grid">${['Resuma o avanço das obras', 'Quais são as pendências?', 'Quem está na equipe de hoje?', 'Quais obras estão abertas?'].map(p => `<button data-prompt="${esc(p)}">${esc(p)} ${icon('arrow')}</button>`).join('')}</div></div>`}</div><form id="chat-form" class="chat-composer"><div class="chat-shortcuts" aria-label="Sugestões de consulta">${['Como estão os custos das obras?', 'Como estão os prazos?', 'Percentual de conclusão', 'Quais são as pendências?', 'Quem está na equipe de hoje?', 'Quais profissionais estão cadastrados?'].map(p => `<button type="button" data-prompt="${esc(p)}">${esc(p)}</button>`).join('')}</div><label class="chat-scope">Consultar <select id="chat-job"><option value="">Todas as obras abertas</option>${state.jobs.map(j => `<option value="${j.id}" ${j.id === chatJob ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select></label><div class="composer-row"><textarea id="chat-question" rows="2" maxlength="2000" placeholder="Ex.: quais serviços aguardam avaliação?" aria-label="Pergunta sobre as obras"></textarea><button type="button" class="icon-button" data-action="chat-audio" aria-label="Gravar mensagem de áudio">${icon('mic')}</button><button class="button primary send-button" aria-label="Enviar pergunta">${icon('arrow')}</button></div><span class="composer-note">Consulta disponível para administradores · sem análise técnica automática</span></form></div><aside class="chat-guide"><div class="eyebrow">DISPONÍVEL AGORA</div><h3>O histórico dá contexto.</h3><ul><li>${icon('check')} Obras e ambientes</li><li>${icon('check')} Relatos e etapas</li><li>${icon('check')} Pendências registradas</li><li>${icon('check')} Equipes por dia</li></ul><div class="guide-divider"></div><div class="eyebrow">PRÓXIMAS POSSIBILIDADES</div><p>Análise de fotos nos registros quando a IA estiver ativada. Transcrição de voz, materiais e ferramentas dependem de novas integrações e dados.</p></aside></section>`;
}
function chatMessage(m) { return `<div class="chat-question"><span class="message-author">${esc(m.author)}</span><p>${esc(m.question)}</p>${m.audio ? `<audio controls src="${esc(m.audio.url)}"></audio>` : ''}</div><div class="chat-answer"><span class="assistant-mini">✦</span><div><span class="message-author">Skytile · consulta local</span><p>${esc(m.answer)}</p>${m.sources.length ? `<div class="source-links">${m.sources.map(s => `<a href="${s.kind === 'team' ? '#team' : '#jobs/' + s.jobId + (s.roomId ? '/' + s.roomId : '')}" data-entry="${s.entryId || ''}">${icon('file')}${esc(s.label)}</a>`).join('')}</div>` : ''}</div></div>`; }
function bindPage() {
  document.querySelectorAll('[data-action]').forEach(b => b.onclick = () => b.dataset.action === 'analyze-entry' ? analyzeEntry(currentJob.id,b.dataset.entryId) : b.dataset.action === 'review-analysis' ? analysisReviewModal(currentJob,b.dataset.entryId) : b.dataset.action === 'analysis-refresh' ? refresh().catch(e=>toast(e.message,true)) : b.dataset.action === 'expense-review' ? expenseReviewModal(currentJob, b.dataset.expense, b.dataset.decision) : runAction(b.dataset.action, b.dataset.job));
  document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
  const s = document.querySelector('#job-search');
  if (s) s.oninput = e => { search = e.target.value; const start = s.selectionStart; render(); const n = document.querySelector('#job-search'); n.focus(); n.setSelectionRange(start, start); };
  document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = () => { document.querySelector('#chat-question').value = b.dataset.prompt; document.querySelector('#chat-form').requestSubmit(); });
  const scope = document.querySelector('#chat-job');
  if (scope) scope.onchange = () => { chatJob = scope.value; };
  app.querySelectorAll('a[href^="#"]').forEach(a => {
    a.dataset.route = a.getAttribute('href');
    a.onclick = e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault(); e.stopPropagation();
      sourceEntry = a.dataset.entry || null;
      navigate(a.dataset.route);
    };
  });
  const form = document.querySelector('#chat-form');
  if (form) form.onsubmit = async e => {
    e.preventDefault(); if (busy) return; const question = document.querySelector('#chat-question').value.trim(); if (!question) { toast('Digite uma pergunta para consultar os registros.', true); document.querySelector('#chat-question').focus(); return; }
    await submit(form, async () => { await api('/chat', { method: 'POST', body: { question, jobId: document.querySelector('#chat-job').value || null } }); await refresh(); const t = document.querySelector('#chat-thread'); t.scrollTop = t.scrollHeight; document.querySelector('#chat-question').focus(); });
  };
}
function syncChatBusy() {
  document.querySelectorAll('[data-prompt], #chat-form button, #chat-job, #chat-question').forEach(el => el.disabled = busy);
  document.querySelector('#chat-form')?.setAttribute('aria-busy', String(busy));
}
async function submit(form, fn) {
  const submitButton = form.querySelector('[type=submit]'), submitLabel = submitButton?.innerHTML;
  if (busy) return; busy = true; syncChatBusy(); const buttons = [...form.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); form.setAttribute('aria-busy', 'true');
  try { await fn(); } catch (e) { toast(e.message, true); const msg = form.querySelector('.form-error'); if (msg) { msg.textContent = e.message; msg.hidden = false; } }
  finally { busy = false; syncChatBusy(); buttons.forEach(b => b.disabled = false); if (submitButton) submitButton.innerHTML = submitLabel; form.removeAttribute('aria-busy'); }
}
function runAction(action, jobId) {
  const job = jobId ? state.jobs.find(j => j.id === jobId) : currentJob;
  if (action === 'finance-settings') financeSettingsModal(job);
  else if (action === 'new-expense') expenseModal(job);
  else if (action === 'labor') laborModal(job);
  else if (action === 'new-job') newJobModal();
  else if (action === 'new-entry') entryModal(job);
  else if (action === 'assignment') assignmentModal(job);
  else if (action === 'new-room') roomModal(job);
  else if (action === 'upload-plan') planModal(job);
  else if (action === 'map-room') mapModal(job);
  else if (action === 'chat-audio') chatAudioModal();
  else if (action === 'deliver') statusModal(job, 'delivered');
  else if (action === 'reopen') statusModal(job, 'active');
  else if (action === 'start-job') statusModal(job, 'active');
  else if (action === 'progress-info') {
    modal('Como estimamos o avanço', 'Uma referência simples para acompanhar a execução.', `<div class="form-body"><p class="field-hint">Cada serviço de cada ambiente tem o mesmo peso nesta versão. Consideramos o último avanço informado e arredondamos a média para intervalos de 5 pontos.</p><div class="progress-legend">${Object.entries(stages).map(([key, value]) => `<div><span>${progressLabels[key]}</span><strong>${value}%</strong></div>`).join('')}</div><p class="field-hint">Sem estimativa, o serviço contribui com 0%; isso não comprova que ele não começou. “Aguardando avaliação” mantém a última estimativa, sem acrescentar avanço. A contagem informa quantos serviços têm estimativa.</p><p class="field-hint">O percentual não considera metragem ou duração e não é medição técnica. 100% relatado não confirma entrega: Thiago ou Flavio precisam entregar a obra. Ao reabrir, os serviços entregues mantêm a referência até um novo relato; ajustes podem atualizar o avanço.</p></div><div class="modal-foot"><button class="button primary" data-cancel>Entendi</button></div>`);
    attachCancel();
  }
  else if (action === 'new-person') personModal();
  else if (action === 'edit-person') personModal(state.users.find(u => u.id === jobId));
  else if (action === 'person-access') accessModal(state.users.find(u => u.id === jobId));
}
function modal(title, subtitle, contents, wide = false) {
  closeModal(); modalReturnFocus = document.activeElement;
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" id="close-modal" aria-label="Fechar">${icon('close')}</button></div>${contents}</section></div>`;
  document.body.classList.add('modal-open');
  document.querySelector('#close-modal').onclick = closeModal;
  document.querySelector('.modal-backdrop').onclick = e => { if (e.target.classList.contains('modal-backdrop')) closeModal(); };
  setTimeout(() => modalRoot.querySelector('input:not([type=hidden]),textarea,select,button')?.focus(), 20);
}
function closeModal() {
  if (busy) return;
  if (recording) { recording.cancelled = true; recording.recorder.stop(); recording.stream.getTracks().forEach(t => t.stop()); recording = null; }
  photoCapture?.dispose(); photoCapture=null;
  if (audioPreview) URL.revokeObjectURL(audioPreview);
  recordedAudio = null; audioPreview = null; mapController?.abort(); mapController = null;
  modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); modalReturnFocus?.focus(); modalReturnFocus = null;
}
function closeAfterSave() { const was = busy; busy = false; closeModal(); busy = was; }
document.addEventListener('keydown', e => {
  if (!modalRoot.children.length) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab') { const f = [...modalRoot.querySelectorAll('button,input,select,textarea,a')].filter(el => !el.disabled && el.getClientRects().length); if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0]?.focus(); } }
});
const formFoot = (label = 'Salvar') => `<p class="form-error" hidden role="alert"></p><div class="modal-foot"><button type="button" class="button secondary" data-cancel>Cancelar</button><button class="button primary" type="submit">${esc(label)} ${icon('arrow')}</button></div>`;
const servicesChecks = (prefix, selected = ['Tile no piso']) => `<div class="checkbox-grid">${serviceOptions.map(s => `<label><input type="checkbox" name="${prefix}" value="${esc(s)}" ${selected.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}</div>`;
function attachCancel() { modalRoot.querySelectorAll('[data-cancel]').forEach(b => b.onclick = closeModal); }
async function upload(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error(`${file.name}: limite de 12 MB por arquivo.`);
  const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result.split(',')[1]); r.onerror = () => reject(new Error('Não foi possível ler o arquivo.')); r.readAsDataURL(file); });
  const type = file.type || (/\.heic$/i.test(file.name) ? 'image/heic' : /\.heif$/i.test(file.name) ? 'image/heif' : '');
  return api('/upload', { method: 'POST', body: { name: file.name, type, data }, timeout: 60000 });
}
function uploadPreview(input, container) {
  input.onchange = () => { container.innerHTML = ''; for (const f of input.files) { const line = document.createElement('div'); line.className = 'selected-file'; line.textContent = f.name + ' · ' + (f.size / 1024 / 1024).toFixed(1) + ' MB'; container.append(line); } };
}
function newJobModal() {
  modal('Uma nova obra começa aqui.', 'Só as informações que ajudam a organizar o trabalho.', `<form id="new-job-form"><div class="form-body"><div class="form-row"><label>Nome da obra <input name="name" required maxlength="160" placeholder="Ex.: Apartamento · Manhattan"></label><label>Endereço <input name="address" required maxlength="300" placeholder="Rua, cidade e estado"></label></div><label>O que será feito? <span class="optional">opcional</span><textarea name="description" rows="2" maxlength="5000" placeholder="Pode ser o combinado inicial com o cliente."></textarea></label><fieldset><legend>Como vamos organizar?</legend><div class="choice-row"><label><input type="radio" name="layout" value="single" checked> Um ambiente</label><label><input type="radio" name="layout" value="multiple"> Vários ambientes</label></div></fieldset><div id="room-fields"></div><button type="button" class="button ghost" id="add-room" hidden>${icon('plus')} Adicionar ambiente</button><div class="form-row"><label class="upload-label">${icon('camera')} Fotos iniciais <span class="optional">opcional</span><input id="initial-photos" type="file" accept="image/*,.heic,.heif" multiple><span class="field-hint">Até 12 fotos · 12 MB por arquivo</span><div id="initial-file-list"></div></label><label class="upload-label">${icon('file')} Planta <span class="optional">opcional</span><input id="initial-plan" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"><span class="field-hint">Imagem ou PDF · 12 MB</span><div id="plan-file-list"></div></label></div></div>${formFoot('Criar obra')}</form>`, true);
  let count = 0;
  const addRoom = () => { const key = ++count; const wrapper = document.createElement('div'); wrapper.className = 'room-field'; wrapper.dataset.key = key; wrapper.innerHTML = `<div class="room-field-head"><label>Nome do ambiente <input name="room-${key}" required maxlength="120" placeholder="Ex.: Banheiro" value="${count === 1 ? 'Ambiente principal' : ''}"></label><button type="button" class="icon-button remove-room" aria-label="Remover ambiente">${icon('close')}</button></div><span class="field-title">Serviços previstos</span>${servicesChecks('services-' + key)}`; wrapper.querySelector('.remove-room').onclick = () => { if (document.querySelectorAll('.room-field').length > 1) wrapper.remove(); else toast('Mantenha pelo menos um ambiente.'); }; document.querySelector('#room-fields').append(wrapper); };
  addRoom();
  document.querySelector('#add-room').onclick = addRoom;
  modalRoot.querySelectorAll('[name=layout]').forEach(i => i.onchange = () => { const multi = i.value === 'multiple'; document.querySelector('#add-room').hidden = !multi; if (multi && document.querySelectorAll('.room-field').length === 1) addRoom(); if (!multi) { document.querySelectorAll('.room-field').forEach((r, n) => { if (n > 0) r.remove(); }); } });
  uploadPreview(document.querySelector('#initial-photos'), document.querySelector('#initial-file-list'));
  uploadPreview(document.querySelector('#initial-plan'), document.querySelector('#plan-file-list'));
  attachCancel();
  document.querySelector('#new-job-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const photos = [...document.querySelector('#initial-photos').files]; if (photos.length > 12) throw new Error('Selecione até 12 fotos iniciais.');
    const rooms = [...document.querySelectorAll('.room-field')].map(r => ({ name: r.querySelector('input[name^=room-]').value, services: [...r.querySelectorAll('input[type=checkbox]:checked')].map(i => i.value) }));
    const initialPhotos = []; for (const photo of photos) initialPhotos.push(await upload(photo));
    const p = document.querySelector('#initial-plan').files[0]; const plan = p ? await upload(p) : null;
    const j = await api('/jobs', { method: 'POST', body: { name: f.elements.name.value, address: f.elements.address.value, description: f.elements.description.value, rooms, cover: initialPhotos[0] || null, initialPhotos, plan } });
    closeAfterSave(); state = await api('/state'); navigate('#jobs/' + j.id); toast('Obra criada. Vamos acompanhar o primeiro passo.');
  }); };
}
function entryModal(j) {
  modal('Registrar avanço', 'Registre o que foi feito hoje, mesmo que o serviço ainda esteja no começo.', `<form id="entry-form"><div class="form-body"><div class="form-row"><label>Ambiente <select name="roomId" id="entry-room">${j.rooms.map(r => `<option value="${r.id}" ${currentRoom?.id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></label><label>Serviço <select name="service" id="entry-service"></select></label></div><div class="form-row"><label>Momento <select name="phase"><option value="end">Fim do dia</option><option value="start">Início do dia / referência</option><option value="update">Atualização durante o dia</option></select></label><label>Como está este serviço? <select name="progress">${Object.entries(progressLabels).map(([key, label]) => `<option value="${key}" ${key === 'ongoing' ? 'selected' : ''}>${label}${Object.hasOwn(stages, key) ? " · " + stages[key] + "%" : " · manter estimativa"}</option>`).join('')}</select></label></div><div class="camera-actions"><button type="button" class="button secondary" id="take-photo">${icon('camera')} Tirar foto</button><input id="entry-camera" type="file" accept="image/*" capture="environment" hidden><span>Foto geral e detalhe; repita o ângulo da referência quando possível.</span></div><label class="upload-label">${icon('camera')} Escolher fotos da galeria <input id="entry-photos" type="file" accept="image/*,.heic,.heif" multiple><span class="field-hint">Tire uma foto ou escolha da galeria · até 12 imagens</span><div id="entry-file-list"></div><span id="photo-preparation" class="field-hint" role="status"></span></label><div id="entry-reference" class="entry-reference"></div><div class="analysis-choice"><div id="analysis-evidence-hint" role="status" aria-live="polite"></div>${state.ai?.available ? '<label><input type="checkbox" id="request-analysis" checked> Conferir fotos com IA após salvar</label><p>A análise envia até 4 fotos deste registro e até 2 anteriores do mesmo serviço à OpenAI e pode gerar cobrança. As demais continuam no histórico. Você também pode salvar agora e analisar depois.</p>' : '<strong>Análise visual ainda não ativada</strong><p>Você pode salvar fotos normalmente. A conferência real precisa do servidor com a chave de IA configurada.</p>'}</div><label>O que aconteceu? <textarea name="note" rows="3" maxlength="5000" placeholder="O que avançou? Faltou algo? Tem alguma decisão para Thiago?"></textarea></label>${audioRecorderUI()}<div class="info-strip">${icon('file')} A data e o autor (${esc(user().name)}) são registrados automaticamente. A conclusão é um relato; a entrega da obra é confirmada pelo administrador.</div></div>${formFoot('Salvar registro')}</form>`);
  let selection = { files: [], preparing: false };
  const updateAnalysisHint = (next = selection) => {
    selection = next;
    const count = selection.files.length;
    const hint = document.querySelector('#analysis-evidence-hint');
    if (!hint) return;
    const previous = [...j.entries].reverse().find(e => e.roomId === document.querySelector('#entry-room').value && e.service === document.querySelector('#entry-service').value && e.photos.some(p => /\.(jpg|png|webp|gif)$/.test(p.url)));
    hint.innerHTML = `<strong>${previous ? 'Observação com referência anterior' : 'Primeira observação deste serviço'}</strong><p>${previous ? 'A IA poderá comparar as fotos; ângulos diferentes podem limitar a leitura.' : 'Não precisa ter fotos de antes nem concluir o serviço. A IA descreverá o que estiver visível, sem medir o avanço entre dias.'}</p><p>${selection.preparing ? 'Preparando fotos…' : count ? `${count} foto(s) selecionada(s).` : 'Adicione uma foto para habilitar a conferência. Relato e áudio também podem ser salvos sozinhos.'}</p>`;
    const choice = document.querySelector('#request-analysis');
    if (choice) choice.disabled = !count || selection.preparing;
  };
  const updateReference = () => {
    const previous=[...j.entries].reverse().find(e=>e.roomId===document.querySelector('#entry-room').value&&e.service===document.querySelector('#entry-service').value&&e.photos.length);
    document.querySelector('#entry-reference').innerHTML=previous?`<strong>Referência anterior · ${dateLabel(previous.at)}</strong><p>Mesmo ambiente e serviço. Tente repetir o ângulo para facilitar a comparação.</p><div class="photo-gallery">${previous.photos.slice(0,2).map(photo).join('')}</div>`:'<p>Primeiro registro com fotos deste serviço: inclua uma visão geral do ambiente.</p>';
    updateAnalysisHint();
  };
  const updateServices = () => { const room = j.rooms.find(r => r.id === document.querySelector('#entry-room').value); document.querySelector('#entry-service').innerHTML = room.services.map(s => `<option>${esc(s)}</option>`).join(''); updateReference(); };
  updateServices(); document.querySelector('#entry-room').onchange = updateServices;
  document.querySelector('#entry-service').onchange=updateReference;
  photoCapture=SkytilePhotos.bind(document.querySelector('#entry-form'),{onError:message=>toast(message,true),onChange:updateAnalysisHint}); bindRecorder(); attachCancel();
  document.querySelector('#entry-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    if (recording) throw new Error('Pare a gravação antes de salvar.');
    if(photoCapture.preparing())throw new Error('Aguarde a preparação das fotos.');
    const files = photoCapture.files(); const shouldAnalyze=!!f.querySelector('#request-analysis')?.checked; if (files.length > 12) throw new Error('Selecione até 12 fotos.');
    if (!files.length && !f.elements.note.value.trim() && !recordedAudio) throw new Error('Adicione uma foto, um relato ou um áudio.');
    const saveButton = f.querySelector('[type=submit]');
    const photos = []; for (const [index, photo] of files.entries()) {
      saveButton.textContent = `Enviando foto ${index + 1} de ${files.length}…`;
      photos.push(await upload(photo));
    }
    saveButton.textContent = 'Salvando registro…';
    const audio = recordedAudio ? await upload(recordedAudio) : null;
    const savedEntry = await api(`/jobs/${j.id}/entries`, { method: 'POST', body: { roomId: f.elements.roomId.value, service: f.elements.service.value, phase: f.elements.phase.value, progress: f.elements.progress.value, note: f.elements.note.value, photos, audio } });
    closeAfterSave();
    try { state = await api('/state'); route(); toast('Registro salvo no histórico.'); }
    catch { toast('Registro salvo. Atualize a página para carregar o histórico; não precisa enviar novamente.'); }
    if(shouldAnalyze&&photos.length&&savedEntry.createdEntryId) void analyzeEntry(j.id,savedEntry.createdEntryId);
  }); };
}
function audioRecorderUI() { return `<div class="audio-recorder"><div><strong>Prefere contar por áudio?</strong><p>Gravação salva localmente, sem transcrição automática.</p></div><button type="button" class="button secondary" id="record-audio">${icon('mic')} Gravar</button><div id="audio-preview"></div></div>`; }
function bindRecorder() {
  const b = document.querySelector('#record-audio');
  b.onclick = async () => {
    if (recording) { recording.recorder.stop(); recording.stream.getTracks().forEach(t => t.stop()); recording = null; b.innerHTML = icon('mic') + ' Gravar novamente'; b.classList.remove('recording'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Gravação não disponível. Use um navegador compatível em localhost ou HTTPS.', true); return; }
    b.disabled = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!b.isConnected) { stream.getTracks().forEach(t => t.stop()); return; }
      const supported = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, supported ? { mimeType: supported } : {}); const chunks = [];
      const session = { recorder, stream, cancelled: false }; recording = session;
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); if (session.cancelled || !b.isConnected) return;
        const type = recorder.mimeType.split(';')[0], extension = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
        recordedAudio = new File(chunks, 'relato.' + extension, { type }); if (audioPreview) URL.revokeObjectURL(audioPreview); audioPreview = URL.createObjectURL(recordedAudio);
        document.querySelector('#audio-preview').innerHTML = `<audio controls src="${audioPreview}"></audio><button type="button" class="button ghost" id="remove-audio">Remover áudio</button>`;
        document.querySelector('#remove-audio').onclick = () => { URL.revokeObjectURL(audioPreview); audioPreview = null; recordedAudio = null; document.querySelector('#audio-preview').innerHTML = ''; };
      };
      recorder.start(); b.innerHTML = '<span class="record-dot"></span> Parar gravação'; b.classList.add('recording');
    } catch { toast('Não foi possível acessar o microfone. Verifique a permissão do navegador.', true); }
    finally { b.disabled = false; }
  };
}
function assignmentModal(j) {
  modal('Equipe do dia', 'Anote a distribuição. Isso não restringe o acesso às obras.', `<form id="assignment-form"><div class="form-body"><div class="mini-job-title">${esc(j.name)}</div><label>Dia <input type="date" name="date" id="assignment-date" value="${state.today}" required></label><div id="assignment-people"></div><p class="field-hint" id="assignment-by"></p></div>${formFoot('Salvar equipe')}</form>`);
  const update = () => { const date = document.querySelector('#assignment-date').value; const a = j.assignments.find(a => a.date === date); document.querySelector('#assignment-people').innerHTML = state.users.filter(u => u.active !== false || a?.userIds.includes(u.id)).map(u => `<label class="person-choice"><input type="checkbox" name="userIds" value="${u.id}" ${a?.userIds.includes(u.id) ? 'checked' : ''}><span class="avatar small">${initials(u.name)}</span><span><strong>${esc(u.name)}</strong><small>${esc(u.specialty)}</small></span></label>`).join(''); document.querySelector('#assignment-by').textContent = a ? `Última edição por ${a.by} · ${dateLabel(a.at, true)}` : 'Ainda sem equipe registrada neste dia.'; };
  update(); document.querySelector('#assignment-date').onchange = update; attachCancel();
  document.querySelector('#assignment-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => { await api(`/jobs/${j.id}/assignments`, { method: 'POST', body: { date: f.elements.date.value, userIds: [...f.querySelectorAll('[name=userIds]:checked')].map(i => i.value) } }); closeAfterSave(); await refresh(); toast('Equipe registrada para o dia selecionado.'); }); };
}
function personModal(person = null) {
  const editing = !!person;
  modal(editing ? 'Editar profissional' : 'Cadastrar profissional', 'Nome e função são suficientes para começar. O ID é gerado automaticamente.', `<form id="person-form"><div class="form-body">${person ? `<div class="mini-job-title">${esc(person.code)} · ${person.role === 'admin' ? 'Acesso de administrador' : 'Acesso de colaborador'}</div>` : `<div class="info-strip">O novo cadastro terá acesso de colaborador às obras abertas.${authenticatedMode ? ' Depois, use Acesso na equipe para definir uma senha.' : ''}</div>`}<label>Nome <input name="name" required maxlength="120" value="${esc(person?.name || '')}" placeholder="Nome do profissional"></label><label>Função profissional <select name="position">${Object.entries(positions).map(([key, label]) => `<option value="${key}" ${(person?.position || 'installer') === key ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>${moneyField('dailyRateCents','Diária de referência',person ? state.finance.rates[person.id] : null)}<details class="skills-details"><summary>Etapas que realiza <span class="optional">opcional</span></summary><p class="field-hint">Marque somente habilidades conhecidas. Ser instalador não significa fazer todas as etapas.</p><label class="all-skills-choice"><input type="checkbox" id="all-skills" ${person?.skills?.length === professionalSkills.length ? 'checked' : ''}> Realiza todas as etapas abaixo</label><div class="checkbox-grid">${professionalSkills.map(s => `<label><input type="checkbox" name="skills" value="${esc(s)}" ${person?.skills?.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}</div></details></div>${formFoot(editing ? 'Salvar profissional' : 'Cadastrar')}</form>`);
  const all = document.querySelector('#all-skills');
  all.onchange = () => modalRoot.querySelectorAll('[name=skills]').forEach(i => i.checked = all.checked);
  modalRoot.querySelectorAll('[name=skills]').forEach(i => i.onchange = () => all.checked = [...modalRoot.querySelectorAll('[name=skills]')].every(i => i.checked));
  attachCancel();
  document.querySelector('#person-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    await api(editing ? '/users/' + person.id : '/users', { method: editing ? 'PATCH' : 'POST', body: { name: f.elements.name.value, position: f.elements.position.value, dailyRateCents: SkytileFinance.parseMoney(f.elements.dailyRateCents.value), skills: [...f.querySelectorAll('[name=skills]:checked')].map(i => i.value) } });
    state = await api('/state'); route(); closeAfterSave(); toast(editing ? 'Cadastro atualizado. ID e histórico preservados.' : 'Profissional cadastrado com ID automático.');
  }); };
}
function statusModal(j, status) {
  const reopen = j.status === 'delivered';
  modal(reopen ? 'Reabrir para um ajuste' : status === 'delivered' ? 'Confirmar entrega da obra' : 'Iniciar execução', reopen ? 'O histórico original permanece. O motivo ficará registrado.' : status === 'delivered' ? 'A obra sai da lista de abertas e fica em Finalizadas.' : 'A obra continua visível para toda a equipe.', `<form id="status-form"><div class="form-body"><div class="mini-job-title">${esc(j.name)}</div>${reopen ? '<label>Qual ajuste é necessário? <textarea name="reason" required maxlength="1000" rows="3" placeholder="Ex.: revisar o rejunte solicitado pelo cliente."></textarea></label>' : '<p class="field-hint">Esta decisão fica no histórico com data e responsável.</p>'}</div>${formFoot(reopen ? 'Reabrir obra' : status === 'delivered' ? 'Confirmar entrega' : 'Iniciar')}</form>`);
  attachCancel(); document.querySelector('#status-form').onsubmit = e => { e.preventDefault(); submit(e.target, async () => { await api(`/jobs/${j.id}/status`, { method: 'POST', body: { status, reason: e.target.elements.reason?.value } }); closeAfterSave(); state = await api('/state'); route(); toast(reopen ? 'Obra reaberta. O histórico foi preservado.' : status === 'delivered' ? 'Obra entregue e arquivada.' : 'Execução iniciada.'); }); };
}
function roomModal(j) {
  modal('Adicionar ambiente', 'Um local claro para organizar fotos e serviços.', `<form id="room-form"><div class="form-body"><label>Nome do ambiente <input name="name" required maxlength="120" placeholder="Ex.: Banheiro 03"></label><span class="field-title">Serviços previstos</span>${servicesChecks('services')}</div>${formFoot('Adicionar')}</form>`);
  attachCancel(); document.querySelector('#room-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => { await api(`/jobs/${j.id}/rooms`, { method: 'POST', body: { name: f.elements.name.value, services: [...f.querySelectorAll('[name=services]:checked')].map(i => i.value) } }); closeAfterSave(); state = await api('/state'); route(); toast('Ambiente adicionado.'); }); };
}
function planModal(j) {
  modal('Anexar planta', 'Imagem para marcar áreas; PDF para consulta.', `<form id="plan-form"><div class="form-body"><label class="upload-label">${icon('file')} Planta da obra <input type="file" id="plan-file" accept="image/jpeg,image/png,image/webp,application/pdf" required><div id="plan-files"></div></label></div>${formFoot('Salvar planta')}</form>`);
  uploadPreview(document.querySelector('#plan-file'), document.querySelector('#plan-files')); attachCancel(); document.querySelector('#plan-form').onsubmit = e => { e.preventDefault(); submit(e.target, async () => { const p = document.querySelector('#plan-file').files[0]; if (!p) throw new Error('Selecione a planta.'); const plan = await upload(p); await api(`/jobs/${j.id}/plan`, { method: 'POST', body: { plan } }); closeAfterSave(); state = await api('/state'); route(); toast('Planta anexada.'); }); };
}
function mapModal(j) {
  modal('Marcar um ambiente na planta', 'Selecione o ambiente e arraste sobre a imagem para desenhar sua área.', `<form id="map-form"><div class="form-body"><label>Ambiente <select name="roomId">${j.rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select></label><div class="map-editor" id="map-editor"><img src="${esc(j.plan.url)}" alt="Planta para marcar um ambiente" draggable="false"><div id="map-selection" hidden></div></div><p class="field-hint">A marcação substitui a área anterior deste ambiente. No celular, arraste com o dedo.</p></div>${formFoot('Salvar área')}</form>`, true);
  let start, region; const editor = document.querySelector('#map-editor'), selection = document.querySelector('#map-selection');
  mapController = new AbortController();
  const position = e => { const rect = editor.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))]; };
  editor.onpointerdown = e => { e.preventDefault(); start = position(e); region = null; selection.hidden = true; editor.setPointerCapture(e.pointerId); };
  editor.onpointermove = e => { if (!start) return; const p = position(e); region = [Math.min(start[0], p[0]), Math.min(start[1], p[1]), Math.abs(start[0] - p[0]), Math.abs(start[1] - p[1])]; selection.hidden = false; Object.assign(selection.style, { left: region[0]*100+'%', top: region[1]*100+'%', width: region[2]*100+'%', height: region[3]*100+'%' }); };
  editor.onpointerup = () => { start = null; }; editor.onpointercancel = () => { start = null; };
  attachCancel(); document.querySelector('#map-form').onsubmit = e => { e.preventDefault(); submit(e.target, async () => { if (!region || region[2] < .01 || region[3] < .01) throw new Error('Desenhe uma área na planta antes de salvar.'); await api(`/jobs/${j.id}/regions`, { method: 'POST', body: { roomId: e.target.elements.roomId.value, region } }); closeAfterSave(); state = await api('/state'); route(); toast('Área associada ao ambiente.'); }); };
}
function chatAudioModal() {
  modal('Mensagem de áudio', 'O áudio fica no histórico. Para obter uma resposta, digite a pergunta enquanto a transcrição não estiver conectada.', `<form id="chat-audio-form"><div class="form-body">${audioRecorderUI()}</div>${formFoot('Salvar áudio')}</form>`); bindRecorder(); attachCancel();
  document.querySelector('#chat-audio-form').onsubmit = e => { e.preventDefault(); submit(e.target, async () => { if (recording) throw new Error('Pare a gravação antes de salvar.'); if (!recordedAudio) throw new Error('Grave uma mensagem primeiro.'); const audio = await upload(recordedAudio); await api('/chat/audio', { method: 'POST', body: { audio } }); closeAfterSave(); await refresh(); const t = document.querySelector('#chat-thread'); t.scrollTop = t.scrollHeight; toast('Áudio salvo localmente.'); }); };
}
const restoreLocation = () => { const path = location.hash || '#jobs'; if (path !== currentRoute) route(path); };
window.addEventListener('hashchange', restoreLocation);
window.addEventListener('popstate', restoreLocation);
async function initialize() {
  try {
    if (!window.SkytileLocal) {
      const session = await api('/auth/session'); authenticatedMode = session.enabled;
      if (authenticatedMode && !session.userId) { renderLogin(); return; }
      if (authenticatedMode) profile = session.userId;
    }
    try { state = await api('/state'); } catch (e) {
      if (!/perfil|usu.rio/i.test(e.message)) throw e;
      profile = 'thiago'; profileStorage.set(profile); state = await api('/state');
    }
    if (!state.users.some(u => u.id === profile && u.active !== false)) { profile = 'thiago'; profileStorage.set(profile); state = await api('/state'); }
    route();
  } catch (e) {
    if (authenticatedMode && e.status === 401) { renderLogin(); return; }
    const previewStatus = document.querySelector('#preview-status');
    if (previewStatus) { previewStatus.dataset.mode = 'error'; previewStatus.textContent = 'Não foi possível ativar a prévia: ' + e.message; }
    app.innerHTML = `<div class="boot"><h1>Não foi possível abrir a Skytile.</h1><p>${esc(e.message)}</p><button class="button primary" id="retry-start">Tentar novamente</button></div>`;
    document.querySelector('#retry-start').onclick = () => location.reload();
  }
}
initialize();

function renderLogin() {
  // Remove private content and active recording when a session ends.
  if (recording) { recording.cancelled=true; recording.recorder.stop(); recording.stream.getTracks().forEach(t=>t.stop()); recording=null; }
  photoCapture?.dispose(); photoCapture=null; modalRoot.innerHTML=''; document.body.classList.remove('modal-open');
  app.innerHTML=`<main class="login-shell"><section class="login-card"><div class="brand-word">SKY<span class="brand-star">✦</span>TILE</div><div class="eyebrow">SEU ESPAÇO DE TRABALHO</div><h1>Entre para acompanhar as obras.</h1><p>Use o ID e a senha recebidos do administrador.</p><form id="login-form"><label>ID de acesso <input name="login" required maxlength="120" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Ex.: thiago ou SK-001"></label><label>Senha <input name="password" type="password" required maxlength="128" autocomplete="current-password"></label><p class="form-error" hidden role="alert"></p><button class="button primary full" type="submit">Entrar</button></form><p class="field-hint">Esqueceu a senha? Peça a Thiago ou Flavio para definir uma nova.</p></section></main>`;
  const form=document.querySelector('#login-form');
  form.onsubmit=e=>{e.preventDefault();submit(form,async()=>{
    const result=await api('/auth/login',{method:'POST',body:{login:form.elements.login.value,password:form.elements.password.value}});
    form.elements.password.value='';profile=result.userId;state=await api('/state');navigate('#jobs');
  });};
}

function accessModal(person) {
  modal('Acesso de '+person.name,'Defina uma senha e entregue diretamente à pessoa.',`<form id="access-form"><div class="form-body"><p>ID para entrar: <strong>${esc(person.code)}</strong></p><label>Nova senha <input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="field-hint">Use pelo menos 12 caracteres. Definir uma senha encerra os acessos anteriores dessa pessoa.</p></div>${formFoot('Definir senha')}</form>`);
  attachCancel();const form=document.querySelector('#access-form');
  form.onsubmit=e=>{e.preventDefault();submit(form,async()=>{
    await api('/auth/access',{method:'POST',body:{userId:person.id,password:form.elements.password.value}});
    form.elements.password.value='';closeAfterSave();
    if(person.id===profile){state=null;renderLogin();}else toast('Senha definida. Entregue o ID e a senha à pessoa.');
  });};
}

function financeCard(j) {
  if (!isAdmin()) return '';
  const s = SkytileFinance.summary(j, state.today);
  const label = { unknown: 'Orçamento não informado', exceeded: 'Orçamento excedido', risk: 'Previsão acima do orçamento', review: 'Revisar previsão', within: 'Gasto confirmado dentro do orçamento' }[s.budgetStatus];
  return `<div class="finance-card-mini"><span>Gasto confirmado <strong>${SkytileFinance.money(s.confirmed)}</strong></span><small class="cost-${s.budgetStatus}">${label}${s.pendingCount ? ` · ${s.pendingCount} para conferir` : ''}</small></div>`;
}
function financePanel(j) {
  const F = SkytileFinance;
  if (!isAdmin()) {
    const mine = j.myExpenses || [];
    return `<section class="section finance-panel"><div class="section-heading"><div><h2>Gastos que você enviou</h2><p>Envie um gasto desta obra para conferência do administrador.</p></div>${j.status !== 'delivered' ? '<button class="button secondary" data-action="new-expense">Registrar gasto</button>' : ''}</div>${mine.length ? mine.map(e => expenseRow(e, false)).join('') : '<p class="field-hint">Nenhum gasto enviado por este perfil.</p>'}</section>`;
  }
  const s = F.summary(j, state.today), f = j.finance;
  const status = { unknown: 'Defina um orçamento para comparar os custos.', exceeded: 'O gasto confirmado já excedeu o orçamento.', risk: 'A previsão de custo final excede o orçamento.', review: 'Novos gastos chegaram. Revise a estimativa do que falta gastar.', within: 'O gasto confirmado está dentro do orçamento.' }[s.budgetStatus];
  const schedule = { unknown: 'Prazo não informado', unestimated: 'Informe a previsão de término', late: 'Data combinada ultrapassada', risk: 'Risco de atraso', ahead: 'Previsão de entrega antecipada', on_time: 'Previsão dentro do prazo', delivered_late: 'Entregue após a data combinada', delivered_on_time: 'Entregue dentro do prazo' }[s.schedule];
  const metric = (title, value, caption = '') => `<div class="cost-metric"><span>${title}</span><strong>${F.money(value)}</strong><small>${caption}</small></div>`;
  const history = f.history.slice(-12).reverse();
  return `<section class="section finance-panel" id="finance-panel"><div class="section-heading"><div><h2>Custos e prazo da obra</h2><p>Valores em dólares · acompanhamento disponível aos administradores.</p></div><button class="button secondary" data-action="finance-settings">Valores e prazo</button></div><div class="cost-status cost-${s.budgetStatus}">${icon(s.budgetStatus === 'exceeded' || s.budgetStatus === 'risk' ? 'alert' : 'file')}${status}</div>
    <div class="cost-metrics">${metric('Valor contratado', s.contractCents, 'Valor combinado; não indica recebimento.')}${metric('Orçamento de custos', s.budgetCents)}${metric('Gasto confirmado', s.confirmed, `Diárias: ${F.money(s.labor)} · outros: ${F.money(s.approved)}`)}${metric('Aguardando conferência', s.pending, `${s.pendingCount} gasto(s) enviado(s)`)}${metric('Estimativa adicional', s.remainingCents, 'Além dos gastos já registrados.')}${metric('Custo final previsto', s.projected, s.stale ? 'Revise a estimativa após os novos gastos.' : 'Inclui os gastos aguardando conferência.')}</div>
    <div class="cost-footnote"><span>Resultado estimado antes de despesas gerais: <strong>${F.money(s.projectedResult)}</strong>${s.stale ? ' · previsão a revisar' : ''}</span><span>Orçamento menos gasto confirmado: <strong>${s.budgetCents === null ? 'Não informado' : F.money(s.budgetCents - s.confirmed)}</strong></span></div>
    <div class="schedule-strip"><div><strong>${schedule}</strong><p>Entrega combinada: ${s.deadline ? dateLabel(s.deadline) : 'não informada'} · previsão de término: ${s.expectedFinish ? dateLabel(s.expectedFinish) : 'não informada'}</p></div><small>Previsão informada pelo administrador; o percentual não calcula prazo automaticamente.</small></div>
    ${s.unconfirmedDays ? `<p class="cost-warning">${s.unconfirmedDays} dia(s) com escala ou relatos até hoje ainda sem diárias confirmadas. O gasto registrado pode estar incompleto.</p>` : ''}<p class="field-hint">Valores ausentes não são tratados como zero. Gastos confirmados não indicam pagamento; recebimentos e despesas gerais da companhia não são controlados aqui.</p>
    <div class="finance-actions"><button class="button primary" data-action="new-expense">Registrar gasto</button><button class="button secondary" data-action="labor">Confirmar diárias</button></div>
    <details class="finance-details"><summary>Gastos e comprovantes · ${f.expenses.length}</summary><div>${f.expenses.length ? [...f.expenses].reverse().map(e => expenseRow(e, true)).join('') : '<p class="field-hint">Ainda sem gastos registrados.</p>'}</div></details>
    <details class="finance-details"><summary>Diárias confirmadas · ${f.labor.length} dia(s)</summary>${[...f.labor].sort((a,b) => b.date.localeCompare(a.date)).map(d => `<div class="expense-row"><div><strong>${dateLabel(d.date)} · ${d.people.map(p => esc(p.name) + (p.fraction === .5 ? ' (meia diária)' : '')).join(', ') || 'Nenhum profissional confirmado'}</strong><p>Confirmado por ${esc(d.confirmedBy)}. ${d.people.map(p => esc(p.name) + ': ' + F.money(p.amountCents)).join(' · ')}</p></div><strong>${F.money(d.people.reduce((n,p) => n+p.amountCents,0))}</strong></div>`).join('') || '<p class="field-hint">A escala, sozinha, não gera custo.</p>'}</details>
    <details class="finance-details"><summary>Histórico de alterações · ${f.history.length}</summary>${history.map(h => `<div class="expense-row"><div><strong>${esc(h.action)}</strong><p>${esc(h.author)} · ${dateLabel(h.at, true)}</p><details><summary>Ver registro</summary><pre>${esc('Antes: ' + financeAuditValue(h.before) + '\nDepois: ' + financeAuditValue(h.after))}</pre></details></div></div>`).join('') || '<p class="field-hint">As alterações serão preservadas aqui.</p>'}${f.history.length > 12 ? '<p class="field-hint">Exibindo as 12 últimas alterações; o histórico completo permanece salvo.</p>' : ''}</details></section>`;
}
function expenseRow(e, admin) {
  const label = { pending: 'Aguardando conferência', approved: 'Confirmado', rejected: 'Recusado', voided: 'Anulado' }[e.status];
  return `<div class="expense-row"><div><strong>${SkytileFinance.categories[e.category]} · ${dateLabel(e.date)}</strong><p>${esc(e.note || 'Sem descrição')} · ${esc(e.author)}</p><span class="progress-badge expense-${e.status}">${label}</span>${e.reason ? `<p>Motivo: ${esc(e.reason)}</p>` : ''}${e.receipt ? `<a class="file-link" href="${esc(e.receipt.url)}" target="_blank" rel="noopener">${icon('file')} Abrir comprovante</a>` : ''}</div><div class="expense-side"><strong>${SkytileFinance.money(e.amountCents)}</strong>${admin && e.status === 'pending' ? `<button class="button ghost" data-action="expense-review" data-expense="${e.id}" data-decision="approved">Confirmar gasto</button><button class="button ghost" data-action="expense-review" data-expense="${e.id}" data-decision="rejected">Recusar</button>` : admin && e.status === 'approved' ? `<button class="button ghost" data-action="expense-review" data-expense="${e.id}" data-decision="voided">Anular</button>` : ''}</div></div>`;
}
const moneyValue = cents => cents === null || cents === undefined ? '' : (cents / 100).toFixed(2);
const moneyField = (name, label, value = null, required = false) => `<label>${label} <span class="optional">${required ? 'US$' : 'US$ · opcional'}</span><input name="${name}" inputmode="decimal" placeholder="0,00" value="${moneyValue(value)}" ${required ? 'required' : ''}><span class="field-hint">Ex.: 250,00 · sem separador de milhares</span></label>`;
function financeSettingsModal(j) {
  const s = j.finance.settings;
  modal('Valores e prazo da obra', 'Informe somente o que já foi combinado ou estimado.', `<form id="finance-settings-form"><div class="form-body"><div class="form-row">${moneyField('contractCents','Valor contratado',s.contractCents)}${moneyField('budgetCents','Orçamento de custos',s.budgetCents)}</div>${moneyField('remainingCents','Quanto ainda falta gastar além do já registrado?',s.remainingCents)}<p class="field-hint">A estimativa adicional não deve repetir gastos confirmados nem os enviados para conferência. Zero significa que você estima não haver mais gastos. Deixe em branco se ainda não souber.</p><div class="form-row"><label>Entrega combinada <input type="date" name="deadline" value="${s.deadline || ''}"></label><label>Previsão de término <input type="date" name="expectedFinish" value="${s.expectedFinish || ''}"></label></div></div>${formFoot('Salvar valores e prazo')}</form>`);
  attachCancel(); document.querySelector('#finance-settings-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const body = Object.fromEntries(['contractCents','budgetCents','remainingCents'].map(k => [k, SkytileFinance.parseMoney(f.elements[k].value)]));
    body.deadline = f.elements.deadline.value || null; body.expectedFinish = f.elements.expectedFinish.value || null;
    await api(`/jobs/${j.id}/finance`, { method: 'POST', body }); await refresh(); closeAfterSave(); toast('Referências de custo e prazo salvas.');
  }); };
}
function expenseModal(j) {
  modal('Registrar gasto da obra', isAdmin() ? 'O lançamento será confirmado com seu perfil de administrador.' : 'Thiago ou Flavio vão conferir este lançamento.', `<form id="expense-form"><div class="form-body"><div class="mini-job-title">${esc(j.name)}</div><div class="form-row">${moneyField('amountCents','Valor do gasto',null,true)}<label>Categoria <select name="category">${Object.entries(SkytileFinance.categories).map(([key,label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div><label>Data do gasto <input type="date" name="date" value="${state.today}" max="${state.today}" required></label><label>Descrição <span class="optional">opcional</span><input name="note" maxlength="1000" placeholder="Ex.: estacionamento da viagem de hoje"></label><label class="upload-label">Comprovante <span class="optional">opcional</span><input type="file" id="expense-receipt" accept="image/*,.heic,.heif"><div id="expense-files"></div></label><p class="field-hint">Registre cada gasto uma vez. Estacionamento e pedágio são por ocorrência, não por pessoa.</p></div>${formFoot(isAdmin() ? 'Salvar gasto' : 'Enviar gasto')}</form>`);
  uploadPreview(document.querySelector('#expense-receipt'),document.querySelector('#expense-files')); attachCancel();
  document.querySelector('#expense-form').onsubmit = e => { e.preventDefault(); const f = e.target; submit(f, async () => {
    const amountCents = SkytileFinance.parseMoney(f.elements.amountCents.value); if (!amountCents) throw new Error('Informe um gasto maior que zero.');
    const file = document.querySelector('#expense-receipt').files[0]; const receipt = file ? await upload(file) : null;
    await api(`/jobs/${j.id}/expenses`, { method: 'POST', body: { amountCents, category:f.elements.category.value, date:f.elements.date.value, note:f.elements.note.value, receipt } });
    await refresh(); closeAfterSave(); toast(isAdmin() ? 'Gasto confirmado e registrado.' : 'Gasto enviado para conferência.');
  }); };
}
function expenseReviewModal(j, expenseId, status) {
  const e = j.finance.expenses.find(e => e.id === expenseId);
  const label = { approved:'Confirmar gasto', rejected:'Recusar gasto', voided:'Anular gasto' }[status];
  modal(label,'O lançamento e a decisão permanecerão no histórico.',`<form id="expense-review-form"><div class="form-body"><div class="mini-job-title">${SkytileFinance.money(e.amountCents)} · ${esc(e.note || SkytileFinance.categories[e.category])}</div>${status === 'approved' ? '<p>Confirme que este gasto pertence à obra e está correto.</p>' : '<label>Motivo <textarea name="reason" required maxlength="1000" rows="2"></textarea></label>'}</div>${formFoot(label)}</form>`); attachCancel();
  document.querySelector('#expense-review-form').onsubmit = ev => { ev.preventDefault(); submit(ev.target,async()=>{
    await api(`/jobs/${j.id}/expenses/${expenseId}/review`,{method:'POST',body:{status,reason:ev.target.elements.reason?.value || ''}}); await refresh(); closeAfterSave(); toast('Decisão registrada.');
  }); };
}
function laborModal(j) {
  modal('Confirmar diárias da obra','Confirme quem trabalhou e o custo daquele dia. A escala é apenas uma referência.',`<form id="labor-form"><div class="form-body"><label>Dia trabalhado <input type="date" id="labor-date" name="date" value="${state.today}" max="${state.today}" required></label><div id="labor-people"></div><p class="field-hint">Se o profissional dividir o dia entre duas obras, use meia diária em cada uma. Alterar a diária de referência depois não muda os dias já confirmados.</p><p class="field-hint">Salvar sem profissionais confirma que não houve diárias nesta obra no dia selecionado.</p></div>${formFoot('Salvar diárias')}</form>`,true);
  const update = () => {
    const date = document.querySelector('#labor-date').value;
    const record = j.finance.labor.find(d=>d.date===date); const a = j.assignments.find(a=>a.date===date);
    document.querySelector('#labor-people').innerHTML = state.users.filter(u=>u.active!==false || record?.people.some(p=>p.userId===u.id)).map(u=>{
      const p = record?.people.find(p=>p.userId===u.id); const selected = record ? !!p : a?.userIds.includes(u.id);
      return `<div class="labor-person" data-user="${u.id}"><label class="labor-check"><input type="checkbox" class="labor-selected" ${selected?'checked':''}>${esc(u.name)}</label><label>Diária integral (US$)<input class="labor-rate" inputmode="decimal" value="${moneyValue(p?.rateCents ?? state.finance.rates[u.id])}" placeholder="Não informada"></label><label>Fração trabalhada<select class="labor-fraction"><option value="1">Uma diária</option><option value="0.5" ${p?.fraction===.5?'selected':''}>Meia diária</option></select></label></div>`;
    }).join('');
  };
  update(); document.querySelector('#labor-date').onchange=update; attachCancel();
  document.querySelector('#labor-form').onsubmit=e=>{e.preventDefault();submit(e.target,async()=>{
    const people=[...document.querySelectorAll('.labor-person')].filter(r=>r.querySelector('.labor-selected').checked).map(r=>{
      const rateCents=SkytileFinance.parseMoney(r.querySelector('.labor-rate').value); if(rateCents===null)throw new Error('Informe a diária de '+state.users.find(u=>u.id===r.dataset.user).name+'.');
      return {userId:r.dataset.user,rateCents,fraction:Number(r.querySelector('.labor-fraction').value)};
    });
    await api(`/jobs/${j.id}/labor`,{method:'POST',body:{date:e.target.elements.date.value,people}}); await refresh();closeAfterSave();toast('Diárias confirmadas e custo atualizado.');
  });};
}

function financeAuditValue(value) {
  if (!value) return 'Sem registro';
  if (value.people) return value.date + ' · ' + (value.people.map(p => p.name + ': ' + SkytileFinance.money(p.amountCents) + (p.fraction === .5 ? ' (meia diária)' : '')).join('; ') || 'Nenhum profissional confirmado');
  if (Object.hasOwn(value, 'amountCents')) return SkytileFinance.money(value.amountCents) + ' · ' + SkytileFinance.categories[value.category] + ' · ' + ({ pending:'aguardando conferência', approved:'confirmado', rejected:'recusado', voided:'anulado' }[value.status]) + (value.reason ? ' · ' + value.reason : '');
  return 'Contratado: ' + SkytileFinance.money(value.contractCents) + '; orçamento: ' + SkytileFinance.money(value.budgetCents) + '; restante estimado: ' + SkytileFinance.money(value.remainingCents) + '; entrega combinada: ' + (value.deadline || 'não informada') + '; previsão de término: ' + (value.expectedFinish || 'não informada');
}

const analysisLabels = { compatible:'Compatível com as fotos disponíveis', possible_difference:'Possível divergência: revisar', insufficient_evidence:'Observação parcial · não confirma o avanço' };
const analyzingEntries = new Set();
function needsVisualReview(e) { return e?.analysis?.status==='complete'&&e.analysis.verdict!=='compatible'&&(!e.analysis.review||e.analysis.review.decision==='needs_check'); }
function analysisPanel(j,e) {
  const a=e.analysis;
  if(!e.photos.length && !a)return '';
  const canAnalyze=isAdmin() || e.authorId===profile;
  if(analyzingEntries.has(e.id)||a?.status==='running')return `<div class="analysis-card"><strong>Lendo as fotos deste serviço…</strong><p>Seu registro já está salvo. Você pode continuar usando a aplicação.</p><button class="button ghost" data-action="analysis-refresh">Atualizar análise</button></div>`;
  if(a?.status==='complete') {
    const stage=a.visibleStage==='unclear'?'Não identificável':progressLabels[a.visibleStage];
    const hasReference = a.referencePhotos.length > 0;
    const basis = `<p class="analysis-basis"><strong>${hasReference ? 'Leitura com referência anterior' : 'Observação deste registro'}</strong> · ${a.currentPhotos.length} foto(s) atual(is)${hasReference ? ` e ${a.referencePhotos.length} anterior(es)` : '. Sem antes/depois: não mede o avanço entre dias'}.</p>`;
    const bullets=(label,items)=>items?.length?`<div class="analysis-list"><strong>${label}</strong><ul>${items.map(v=>`<li>${esc(v)}</li>`).join('')}</ul></div>`:'';
    return `<section class="analysis-card verdict-${a.verdict}"><div class="analysis-heading">${icon('spark')}<strong>${analysisLabels[a.verdict]}</strong><span>Confiança ${esc({low:'baixa',medium:'moderada',high:'alta'}[a.confidence])}</span></div>${basis}<p>${esc(a.summary)}</p><div class="analysis-comparison"><span>Relatado: <strong>${progressLabels[e.progress]}</strong></span><span>Visível: <strong>${esc(stage)}</strong></span></div>${bullets('Observações visuais',a.observations)}${bullets('Limitações',a.limitations)}${bullets('Fotos que ajudariam',a.requestedPhotos)}<details><summary>Fotos usadas na análise</summary><p>Registro atual</p><div class="photo-gallery">${a.currentPhotos.map(url=>photo({url,name:'Foto atual usada na análise'})).join('')}</div>${a.referencePhotos.length?`<p>Referência do mesmo ambiente e serviço</p><div class="photo-gallery">${a.referencePhotos.map(url=>photo({url,name:'Foto anterior de referência'})).join('')}</div>`:'<p>Sem foto anterior comparável neste serviço.</p>'}${a.photosOmitted?`<p>${a.photosOmitted} foto(s) do registro não foram enviadas nesta análise e continuam salvas no histórico.</p>`:''}</details><p class="analysis-note">Análise visual de IA · não mede a obra inteira nem confirma qualidade técnica. O avanço informado permanece ${progressLabels[e.progress].toLowerCase()}.</p>${a.review?`<div class="analysis-review"><strong>Revisão de ${esc(a.review.by)}</strong><p>${esc({agree:'Concorda com a observação visual',needs_check:'Vai conferir no local',disagree:'Discorda da análise'}[a.review.decision])}${a.review.note?' · '+esc(a.review.note):''}</p></div>`:''}${isAdmin()?`<button class="button secondary" data-action="review-analysis" data-entry-id="${e.id}">${a.review?'Atualizar revisão':'Registrar revisão'}</button>`:'<p class="field-hint">Thiago ou Flavio podem registrar a conferência desta análise.</p>'}</section>`;
  }
  return `<div class="analysis-card"><strong>${a?.status==='error'?'Análise não concluída':'Conferência por fotos'}</strong><p>${esc(a?.message || (state.ai?.available?'Uma foto parcial já permite observar o serviço. Sem referência anterior, a IA não mede avanço entre dias. A análise envia fotos à OpenAI e pode gerar cobrança.':window.SkytileLocal?'Esta prévia salva fotos no navegador. A análise real precisa da versão com servidor e IA ativada.':'As fotos estão salvas. A análise real ainda não está ativada no servidor.'))}</p>${state.ai?.available&&canAnalyze?`<button class="button secondary" data-action="analyze-entry" data-entry-id="${e.id}">${icon('spark')}${a?.status==='error'?'Tentar análise novamente':'Analisar fotos'}</button>`:''}</div>`;
}
async function analyzeEntry(jobId,entryId) {
  if(analyzingEntries.has(entryId))return;analyzingEntries.add(entryId);if(view==='jobs'&&currentJob?.id===jobId&&!modalRoot.children.length)render();
  try{await api(`/jobs/${jobId}/entries/${entryId}/analyze`,{method:'POST',body:{},timeout:75000});toast('Conferência das fotos atualizada.');}
  catch(e){toast(e.message,true);}
  finally{analyzingEntries.delete(entryId);try{state=await api('/state');if(view==='jobs'&&currentJob?.id===jobId&&!modalRoot.children.length)route();}catch(e){toast(e.message,true);}}
}
function analysisReviewModal(j,entryId) {
  const a=j.entries.find(e=>e.id===entryId).analysis;
  modal('Revisar análise das fotos','Registre sua decisão. Para corrigir o avanço, envie um novo registro do serviço.',`<form id="analysis-review-form"><div class="form-body"><p>${esc(a.summary)}</p><label>Sua avaliação <select name="decision"><option value="agree">Concordo com a observação visual</option><option value="needs_check">Preciso conferir no local</option><option value="disagree">Discordo da análise</option></select></label><label>Observação <span class="optional">opcional</span><textarea name="note" maxlength="1500" rows="3"></textarea></label></div>${formFoot('Salvar revisão')}</form>`);
  attachCancel();document.querySelector('#analysis-review-form').onsubmit=e=>{e.preventDefault();const f=e.target;submit(f,async()=>{await api(`/jobs/${j.id}/entries/${entryId}/analysis-review`,{method:'POST',body:{decision:f.elements.decision.value,note:f.elements.note.value}});await refresh();closeAfterSave();toast('Revisão registrada. O avanço relatado foi preservado.');});};
}
