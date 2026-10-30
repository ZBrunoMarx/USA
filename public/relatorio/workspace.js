'use strict';
globalThis.FieldReportWorkspace = class {
  constructor(hooks) { this.h = hooks; this.view = 'jobs'; this.jobId = null; this.filter = 'open'; this.search = ''; this.settingsRendered = false; this.expandedTasks = new Set(); this.catalogFilter = 'active'; }
  get data() { return this.h.state().data; }
  get admin() { return this.data?.user.role === 'admin'; }
  get enabled() { return this.h.state().provider === 'supabase' && !!this.data; }
  el(id) { return document.getElementById(id); }
  esc(value = '') { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  async act(fn) { try { await fn(); } catch (error) { this.h.message(error.message || 'Não foi possível concluir.', true); } }
  tasks(jobId) { return (this.data.tasks || []).filter(task => task.job_id === jobId); }
  jobsStatus(status) { return ({ planned: 'Iniciando', active: 'Em andamento', adjustment: 'Retorno para ajuste', delivered: 'Entregue' })[status] || status; }
  taskStatus(status) { return ({ planned: 'A fazer', active: 'Em execução', completed: 'Concluído ✓' })[status] || status; }
  progress(jobId) { const tasks = this.tasks(jobId); return tasks.length ? tasks.every(task => task.status === 'completed') ? 100 : Math.min(99,Math.round(tasks.reduce((sum, task) => sum + task.percent, 0) / tasks.length)) : null; }
  async show(view = 'jobs', jobId = null) {
    if (!this.enabled || this.h.busy()) return;
    if (!await this.h.leave()) return;
    this.view = view; this.jobId = jobId; this.settingsRendered = false;
    this.el('editor').hidden = true; this.el('service-library').hidden = true; this.el('job-workspace').hidden = false;
    this.render(); window.scrollTo(0, 0);
  }
  hide() { this.el('job-workspace').hidden = true; }
  setup() {
    this.el('nav-jobs').onclick = () => void this.act(() => this.show('jobs'));
    this.el('nav-reports').onclick = () => void this.act(async () => { await this.h.reports(); });
    this.el('nav-catalog').onclick = () => void this.act(() => this.show('catalog'));
    this.el('nav-team').onclick = () => void this.act(() => this.show('team'));
    this.el('nav-settings').onclick = () => void this.act(() => this.show('settings'));
    this.el('signup-access').onclick = () => this.signup();
    this.el('add-planned-task').onclick = () => this.addPlannedRow();
  }
  refresh() {
    document.body.classList.toggle('company-session', this.enabled);
    this.el('workspace-nav').hidden = !this.enabled;
    this.el('nav-catalog').hidden = this.el('nav-team').hidden = this.el('nav-settings').hidden = !this.admin;
    this.el('signup-access').hidden = this.h.state().provider !== 'supabase' || !!this.data;
    if (!this.enabled) { this.hide(); this.expandedTasks.clear(); this.view = 'jobs'; this.jobId = null; this.filter = 'open'; this.search = ''; this.catalogFilter = 'active'; return; }
    const management = this.data.workspaceReady;
    this.el('cloud-logout').textContent = 'Sair';
    this.el('connection-title').textContent = this.data.company?.name || 'Minha companhia';
    this.el('cloud-user').textContent = this.data.user.name + (this.admin ? ' · Admin' : ' · Profissional');
    this.el('create-cloud-job').hidden = !this.admin || !management;
    this.el('new-service').hidden = true;
    for (const element of document.querySelectorAll('[data-personal-branding]')) element.hidden = true;
    if (!this.el('job-workspace').hidden) this.render();
  }
  render() {
    if (!this.enabled) return;
    const root = this.el('job-workspace');
    for (const name of ['jobs','catalog','team','settings']) this.el('nav-' + name).className = this.view === name || (name === 'jobs' && this.view === 'job') ? 'primary' : 'secondary';
    if (!this.data.workspaceReady) {
      root.innerHTML = '<section class="card"><h2>Obras da companhia</h2><p>Seus relatórios e fotos continuam disponíveis em Registros. A nova organização precisa de uma atualização do banco.</p>' + (this.admin ? '<a class="button primary" href="./atualizar.html" target="_blank" rel="noopener">Atualizar banco</a>' : '<p>Peça ao administrador para atualizar o banco da companhia.</p>') + '</section>' + this.jobsHTML(false);
      this.wireJobs(); return;
    }
    if (this.view === 'catalog' && this.admin) { this.renderCatalog(); return; }
    if (this.view === 'team' && this.admin) { this.renderTeam(); return; }
    if (this.view === 'settings' && this.admin) { if (!this.settingsRendered) this.renderSettings(); return; }
    if (this.view === 'job') { this.renderJob(); return; }
    root.innerHTML = this.jobsHTML(true); this.wireJobs();
  }
  jobsHTML(ready) {
    const esc = v => this.esc(v);
    const jobs = this.data.jobs.filter(job => (this.filter === 'all' || (this.filter === 'delivered' ? job.status === 'delivered' : job.status !== 'delivered')) && (job.name + ' ' + (job.address || '')).toLocaleLowerCase().includes(this.search.toLocaleLowerCase()));
    return '<section class="card"><div class="section-title"><span class="step">↗</span><div><h2>Obras</h2><p>Todos da companhia veem as obras abertas.</p></div></div>' + (this.admin && ready ? '<button id="workspace-new-job" class="primary" type="button">+ Nova obra</button>' : '') + '<div class="row"><label>Buscar obra<input id="job-search" type="search" value="' + esc(this.search) + '" placeholder="Nome ou endereço"></label><label>Mostrar<select id="job-status-filter"><option value="open"' + (this.filter === 'open' ? ' selected' : '') + '>Abertas</option><option value="delivered"' + (this.filter === 'delivered' ? ' selected' : '') + '>Entregues</option><option value="all"' + (this.filter === 'all' ? ' selected' : '') + '>Todas</option></select></label></div><div class="job-grid">' + jobs.map(job => {
      const progress = this.progress(job.id), tasks = this.tasks(job.id), done = tasks.filter(task => task.status === 'completed').length;
      return '<article class="job-card"><div class="badges"><span class="badge">' + esc(this.jobsStatus(job.status)) + '</span><span class="badge kind">' + (job.kind === 'repair' ? 'Reparo contratado' : 'Instalação') + '</span></div><h3>' + esc(job.name) + '</h3>' + (job.address ? '<p>' + esc(job.address) + '</p>' : '') + '<div class="job-progress"><strong>' + (progress === null ? '—' : progress + '%') + '</strong><span>' + (tasks.length ? done + ' de ' + tasks.length + ' serviços concluídos' : 'Serviços a planejar') + '</span></div>' + (progress !== null ? '<progress value="' + progress + '" max="100" aria-label="Avanço informado dos serviços"></progress>' : '') + '<button class="primary" data-open-job="' + esc(job.id) + '" type="button">Abrir obra</button></article>';
    }).join('') + '</div>' + (!jobs.length ? '<p class="empty-state">Nenhuma obra nesta seleção.' + (this.admin ? ' Cadastre a primeira obra com os serviços previstos.' : ' O administrador cadastra as obras e os serviços.') + '</p>' : '') + '<p class="hint">Avanço: média simples dos percentuais informados para os serviços previstos, sem ponderação por área ou custo. Fotos e relatos ficam no histórico.</p></section>';
  }
  wireJobs() {
    this.el('workspace-new-job')?.addEventListener('click', () => this.el('create-cloud-job').click());
    this.el('job-search')?.addEventListener('input', event => { const position = event.target.selectionStart; this.search = event.target.value; this.render(); this.el('job-search').focus(); this.el('job-search').setSelectionRange(position, position); });
    this.el('job-status-filter')?.addEventListener('change', event => { this.filter = event.target.value; this.render(); });
    document.querySelectorAll('[data-open-job]').forEach(button => button.onclick = () => void this.act(() => this.show('job', button.dataset.openJob)));
  }
  reportHTML(report) {
    const fields = report.fields;
    return '<article class="daily-record"><div><strong>' + this.esc(fields.date) + ' · ' + this.esc(fields.author) + '</strong><p>' + this.esc(fields.scope || fields.title) + ' · ' + report.photoCount + ' foto(s)' + (fields.percent !== '' ? ' · ' + this.esc(fields.percent) + '%' : '') + '</p>' + (fields.completed ? '<p>' + this.esc(fields.completed) + '</p>' : '') + (fields.remaining ? '<p>Pendente: ' + this.esc(fields.remaining) + '</p>' : '') + '</div><button class="secondary" type="button" data-workspace-report="' + this.esc(report.id) + '">Fotos e vídeo</button></article>';
  }
  renderJob() {
    const job = this.data.jobs.find(item => item.id === this.jobId);
    if (!job) { this.view = 'jobs'; this.render(); return; }
    const tasks = this.tasks(job.id), progress = this.progress(job.id);
    const history = this.data.reports.filter(item => item.jobId === job.id).sort((a,b) => b.fields.date.localeCompare(a.fields.date) || b.updatedAt.localeCompare(a.updatedAt));
    const legacy = history.filter(item => !item.taskId);
    const esc = v => this.esc(v);
    this.el('job-workspace').innerHTML = '<button id="back-jobs" class="secondary" type="button">← Obras</button><section class="card"><span class="badge">' + esc(this.jobsStatus(job.status)) + '</span><h1 class="job-title">' + esc(job.name) + '</h1><p>' + esc(job.address || 'Endereço não informado') + '</p><p>' + (job.kind === 'repair' ? 'Reparo contratado' : 'Instalação') + ' · ' + (progress === null ? 'Planejamento pendente' : progress + '% de avanço informado') + '</p>' + (this.admin ? '<div class="row"><label>Situação da obra<select id="detail-job-status">' + ['planned','active','adjustment','delivered'].map(status => '<option value="' + status + '"' + (job.status === status ? ' selected' : '') + '>' + esc(this.jobsStatus(status)) + '</option>').join('') + '</select></label><button id="change-job-status" type="button" class="secondary">Salvar situação</button></div><p class="hint">Retorno para ajuste reabre uma entrega anterior. O tipo de contratação original é preservado.</p>' : '') + '</section><section class="card"><h2>Ambientes e serviços previstos</h2><p>Escolha o serviço que você executou hoje.</p>' + (this.admin && job.status !== 'delivered' ? '<button class="secondary" type="button" id="detail-add-task">+ Adicionar serviço</button>' : '') + tasks.map(task => '<article class="planned-task"><div class="badges"><span class="badge">' + esc(this.taskStatus(task.status)) + '</span><span>' + task.percent + '%</span></div><p class="room-label">' + esc(task.room || 'Área de serviço') + '</p><h3>' + esc(task.name) + '</h3>' + (task.instructions ? '<p>' + esc(task.instructions) + '</p>' : '') + '<div class="actions">' + (job.status !== 'delivered' && task.status !== 'completed' ? '<button class="primary" type="button" data-start-task="' + esc(task.id) + '">Registrar dia</button>' : '') + '<button class="secondary" type="button" data-task-history="' + esc(task.id) + '">Ver registros</button>' + (this.admin && task.status === 'completed' && job.status !== 'delivered' ? '<button class="secondary" type="button" data-reopen-task="' + esc(task.id) + '">Reabrir serviço</button>' : '') + '</div><div id="task-history-' + esc(task.id) + '" class="task-history"' + (this.expandedTasks.has(task.id) ? '' : ' hidden') + '>' + history.filter(item => item.taskId === task.id).map(item => this.reportHTML(item)).join('') + (!history.some(item => item.taskId === task.id) ? '<p>Ainda não há registros publicados.</p>' : '') + '</div></article>').join('') + (!tasks.length ? '<p>O administrador ainda não definiu os serviços desta obra.</p>' : '') + '</section>' + (legacy.length ? '<section class="card"><h2>Registros anteriores</h2><p>Estes registros ainda não estão vinculados a um serviço previsto. Abra um para fazer o vínculo, preservando as fotos.</p>' + legacy.map(item => this.reportHTML(item)).join('') + '</section>' : '') + '<section class="card"><h2>Histórico da obra</h2>' + history.map(item => this.reportHTML(item)).join('') + (!history.length ? '<p>O primeiro registro aparecerá aqui após o envio.</p>' : '') + '</section>';
    this.el('back-jobs').onclick = () => void this.act(() => this.show('jobs'));
    this.el('change-job-status')?.addEventListener('click', () => void this.act(async () => { const status = this.el('detail-job-status').value; if (status === 'delivered' && !confirm('Entregar esta obra? Ela sairá da lista de abertas. O histórico será mantido.')) return; await this.h.sync.changeJob(job,status); await this.h.refresh(); }));
    this.el('detail-add-task')?.addEventListener('click', () => this.taskDialog(job));
    document.querySelectorAll('[data-start-task]').forEach(button => button.onclick = () => void this.act(async () => { await this.h.start(job,tasks.find(task => task.id === button.dataset.startTask)); }));
    document.querySelectorAll('[data-task-history]').forEach(button => button.onclick = () => { const target = this.el('task-history-' + button.dataset.taskHistory); target.hidden = !target.hidden; if (target.hidden) this.expandedTasks.delete(button.dataset.taskHistory); else this.expandedTasks.add(button.dataset.taskHistory); });
    document.querySelectorAll('[data-reopen-task]').forEach(button => button.onclick = () => void this.act(async () => { if (!confirm('Reabrir o serviço para um novo ciclo? As fotos e registros anteriores serão mantidos.')) return; await this.h.sync.reopenTask(tasks.find(task => task.id === button.dataset.reopenTask)); await this.h.refresh(); }));
    this.wireReports();
  }
  wireReports() { document.querySelectorAll('[data-workspace-report]').forEach(button => button.onclick = () => void this.act(() => this.h.open(button.dataset.workspaceReport))); }
  catalogExamples() { return ['Preparação da base','Remoção do revestimento','Limpeza e preparação da superfície','Self-level','Impermeabilização','Instalação de piso','Instalação de parede','Rejunte / Grout','Soleira','Silicone e acabamento']; }
  activeServices() { return (this.data.catalog || []).filter(service => service.active); }
  serviceOptions(selected = '') {
    return '<option value="">Selecione um serviço cadastrado</option>' + this.activeServices().map(service => '<option value="' + this.esc(service.id) + '" data-revision="' + service.revision + '"' + (service.id === selected ? ' selected' : '') + '>' + this.esc(service.name) + '</option>').join('');
  }
  wireServiceSelection(select, instructions) {
    let lastDefault = '';
    select.onchange = () => {
      const service = this.activeServices().find(item => item.id === select.value);
      if (!instructions.value || instructions.value === lastDefault) instructions.value = service?.instructions || '';
      lastDefault = service?.instructions || '';
    };
  }
  addPlannedRow(task = {}) {
    const row = document.createElement('div'); row.className = 'planned-row';
    const picker = this.data.catalogReady ? '<select data-planned-service required>' + this.serviceOptions(task.serviceId) + '</select>' : '<input data-planned-name list="task-catalog" maxlength="100" required placeholder="Ex.: Rejunte / Grout" value="' + this.esc(task.name) + '">';
    row.innerHTML = '<label>Ambiente <span class="optional">opcional em serviço único</span><input data-planned-room maxlength="100" placeholder="Banheiro principal" value="' + this.esc(task.room) + '"></label><label>Serviço' + picker + '</label><label>Orientação para esta obra <span class="optional">opcional</span><textarea data-planned-instructions maxlength="600" rows="2" placeholder="Escopo, material ou detalhe combinado">' + this.esc(task.instructions) + '</textarea></label><button type="button" class="secondary danger">Remover da lista</button>';
    if (this.data.catalogReady) this.wireServiceSelection(row.querySelector('[data-planned-service]'),row.querySelector('[data-planned-instructions]'));
    row.querySelector('button').onclick = () => row.remove(); this.el('job-planned-tasks').append(row);
  }
  prepareJobForm() {
    this.el('job-planned-tasks').innerHTML = this.data.catalogReady ? '<p class="hint">Selecione os serviços do catálogo. Orientações específicas ficam apenas nesta obra.</p>' : '<datalist id="task-catalog">' + this.catalogExamples().map(name => '<option value="' + this.esc(name) + '"></option>').join('') + '</datalist>';
    this.addPlannedRow();
  }
  plannedValues() {
    return [...document.querySelectorAll('#job-planned-tasks .planned-row')].map(row => {
      const selection = row.querySelector('[data-planned-service]');
      return { room: row.querySelector('[data-planned-room]').value.trim(), instructions: row.querySelector('[data-planned-instructions]').value.trim(), ...(selection ? { serviceId: selection.value, serviceRevision: Number(selection.selectedOptions[0]?.dataset.revision) } : { name: row.querySelector('[data-planned-name]').value.trim() }) };
    });
  }
  openJobForm() {
    if (this.data.catalogReady && !this.activeServices().length) {
      this.h.message('Cadastre os serviços da companhia antes de criar a primeira obra.');
      void this.act(() => this.show('catalog')); return;
    }
    this.el('cloud-job-form').reset(); this.el('job-form-status').textContent = ''; this.prepareJobForm(); this.el('job-dialog').showModal();
  }
  renderCatalog() {
    if (!this.data.catalogReady) {
      this.el('job-workspace').innerHTML = '<section class="card"><h2>Catálogo de serviços</h2><p>O catálogo aguarda a atualização do sistema. As obras e os registros existentes continuam disponíveis.</p><p class="hint">A atualização será aplicada pela publicação automática.</p></section>'; return;
    }
    const list = (this.data.catalog || []).filter(service => this.catalogFilter === 'all' || (this.catalogFilter === 'inactive' ? !service.active : service.active));
    this.el('job-workspace').innerHTML = '<section class="card"><h2>Serviços da companhia</h2><p>Cadastre uma vez. Ao montar uma obra, selecione quais serviços serão executados em cada ambiente.</p><button id="add-catalog-service" type="button" class="primary">+ Cadastrar serviço</button><label>Mostrar<select id="catalog-filter"><option value="active">Ativos</option><option value="inactive">Inativos</option><option value="all">Todos</option></select></label>' + list.map(service => '<article class="service-item"><span class="badge">' + (service.active ? 'Ativo' : 'Inativo') + '</span><h3>' + this.esc(service.name) + '</h3>' + (service.instructions ? '<p>' + this.esc(service.instructions) + '</p>' : '') + '<button type="button" class="secondary" data-edit-service="' + this.esc(service.id) + '">Editar serviço</button></article>').join('') + (!list.length ? '<p class="empty-state">' + (!(this.data.catalog || []).length ? 'Comece cadastrando os serviços que a companhia oferece, como Self-level, Impermeabilização, Assentamento e Rejunte.' : 'Nenhum serviço nesta seleção.') + '</p>' : '') + '<p class="hint">Desativar retira o serviço das próximas seleções. Obras e registros anteriores mantêm o nome e as orientações usados no planejamento.</p></section>';
    this.el('catalog-filter').value = this.catalogFilter;
    this.el('catalog-filter').onchange = event => { this.catalogFilter = event.target.value; this.renderCatalog(); };
    this.el('add-catalog-service').onclick = () => this.serviceDialog();
    document.querySelectorAll('[data-edit-service]').forEach(button => button.onclick = () => this.serviceDialog(this.data.catalog.find(service => service.id === button.dataset.editService)));
  }
  serviceDialog(service = {}) {
    this.dialog('<h2>' + (service.id ? 'Editar serviço' : 'Cadastrar serviço') + '</h2><label>Nome do serviço<input name="name" list="service-examples" maxlength="100" required value="' + this.esc(service.name) + '" placeholder="Ex.: Rejunte / Grout"></label><datalist id="service-examples">' + this.catalogExamples().map(name => '<option value="' + this.esc(name) + '"></option>').join('') + '</datalist><label>Orientação padrão <span class="optional">opcional</span><textarea name="instructions" maxlength="600" rows="3" placeholder="Pode ser ajustada no planejamento de cada obra">' + this.esc(service.instructions) + '</textarea></label><label>Situação<select name="active"><option value="true">Ativo</option><option value="false"' + (service.active === false ? ' selected' : '') + '>Inativo</option></select></label>', form => this.h.sync.saveService({ id: service.id, revision: service.revision, name: form.elements.name.value, instructions: form.elements.instructions.value, active: form.elements.active.value === 'true' }));
  }
  dialog(html, save) {
    const form = this.el('workspace-form'); form.innerHTML = html + '<p id="workspace-form-status" class="hint" role="status"></p><div class="actions"><button id="workspace-cancel" type="button" class="secondary">Cancelar</button><button type="submit" class="primary">Salvar</button></div>';
    this.el('workspace-cancel').onclick = () => this.el('workspace-dialog').close();
    form.onsubmit = event => { event.preventDefault(); void this.act(async () => { const submit = form.querySelector('[type=submit]'); submit.disabled = true; try { await save(form); this.el('workspace-dialog').close(); await this.h.refresh(); } catch(error) { this.el('workspace-form-status').textContent = error.message; } finally { submit.disabled = false; } }); };
    this.el('workspace-dialog').showModal();
  }
  taskDialog(job) {
    if (this.data.catalogReady) {
      if (!this.activeServices().length) { this.h.message('Cadastre um serviço ativo antes de adicioná-lo à obra.'); void this.act(() => this.show('catalog')); return; }
      this.dialog('<h2>Adicionar serviço previsto</h2><label>Ambiente<input name="room" maxlength="100" placeholder="Opcional para um serviço único"></label><label>Serviço<select name="service" required>' + this.serviceOptions() + '</select></label><label>Orientação para esta obra<textarea name="instructions" maxlength="600" rows="3"></textarea></label>', form => this.h.sync.addCatalogTask(job.id,{ id: form.elements.service.value, revision: Number(form.elements.service.selectedOptions[0]?.dataset.revision) },form.elements.room.value,form.elements.instructions.value));
      this.wireServiceSelection(this.el('workspace-form').elements.service,this.el('workspace-form').elements.instructions); return;
    }
    this.dialog('<h2>Adicionar serviço previsto</h2><label>Ambiente<input name="room" maxlength="100" placeholder="Opcional para um serviço único"></label><label>Serviço<input name="name" maxlength="100" required placeholder="Ex.: Impermeabilização"></label><label>Orientação<textarea name="instructions" maxlength="600" rows="3"></textarea></label>', form => this.h.sync.addTask(job.id,form.elements.room.value,form.elements.name.value,form.elements.instructions.value));
  }
  renderTeam() {
    const positions = { installer: 'Instalador', grout: 'Grout specialist', helper: 'Helper', other: 'Outro / a definir' };
    this.el('job-workspace').innerHTML = '<section class="card"><h2>Equipe da companhia</h2><p>O cadastro é permanente. A equipe de cada dia pode mudar; todos com acesso veem as obras abertas.</p><button class="primary" id="add-staff" type="button">+ Cadastrar profissional</button>' + this.data.staff.map(person => '<article class="service-item"><span class="badge">' + (!person.active ? 'Inativo' : person.user_id ? 'Acesso habilitado' : person.email ? 'Aguardando primeiro acesso' : 'Cadastro sem acesso') + '</span><h3>' + this.esc(person.display_name) + '</h3><p>ID ' + this.esc(person.code) + ' · ' + positions[person.position] + ' · ' + (person.role === 'admin' ? 'Administrador' : 'Profissional') + '</p>' + (person.email ? '<p>' + this.esc(person.email) + '</p>' : '') + '<button class="secondary" type="button" data-edit-staff="' + this.esc(person.id) + '">Editar cadastro</button></article>').join('') + '<p class="hint">Para liberar acesso, cadastre o e-mail do profissional. Ele abre este mesmo link e usa Criar meu acesso para definir a própria senha; depois confirma o e-mail, se solicitado. Nenhuma senha é cadastrada pelo administrador.</p></section>';
    this.el('add-staff').onclick = () => this.staffDialog();
    document.querySelectorAll('[data-edit-staff]').forEach(button => button.onclick = () => this.staffDialog(this.data.staff.find(item => item.id === button.dataset.editStaff)));
  }
  staffDialog(person = {}) {
    const esc = value => this.esc(value);
    this.dialog('<h2>' + (person.id ? 'Editar profissional' : 'Cadastrar profissional') + '</h2><label>Nome<input name="name" maxlength="100" value="' + esc(person.display_name) + '" required></label><div class="row"><label>ID do profissional<input name="code" maxlength="40" value="' + esc(person.code) + '" required></label><label>Posição<select name="position">' + [['installer','Instalador'],['grout','Grout specialist'],['helper','Helper'],['other','Outro / a definir']].map(([id,label]) => '<option value="' + id + '"' + (person.position === id ? ' selected' : '') + '>' + label + '</option>').join('') + '</select></label></div><label>E-mail para acesso <span class="optional">opcional</span><input name="email" type="email" maxlength="254" value="' + esc(person.email) + '"></label><label>Permissão<select name="role"><option value="worker">Profissional: registra execução</option><option value="admin"' + (person.role === 'admin' ? ' selected' : '') + '>Administrador: obras, equipe e companhia</option></select></label><label>Situação<select name="active"><option value="true">Ativo</option><option value="false"' + (person.active === false ? ' selected' : '') + '>Inativo</option></select></label>', form => this.h.sync.saveStaff({ id: person.id, revision: person.revision, name: form.elements.name.value, code: form.elements.code.value, position: form.elements.position.value, email: form.elements.email.value, role: form.elements.role.value, active: form.elements.active.value === 'true' }));
  }
  renderSettings() {
    const company = this.data.company; this.settingsRendered = true;
    this.el('job-workspace').innerHTML = '<section class="card"><h2>Companhia</h2><p>Nome e logo são cadastrados uma vez e reutilizados nos próximos relatórios e vídeos. Vídeos e registros antigos preservam a identificação usada na época.</p><form id="company-settings"><label>Nome da companhia<input name="name" maxlength="55" required value="' + this.esc(company.name) + '"></label><label>Logo <span class="optional">opcional</span><input name="logo" type="file" accept="image/*,.heic,.heif"></label><p class="hint">' + (company.logo ? 'Uma logo já está salva na companhia.' : 'Sem logo, o vídeo usa apenas o nome da companhia.') + '</p><label class="check"><input name="removeLogo" type="checkbox">Remover a logo cadastrada</label><p id="company-settings-status" class="hint" role="status"></p><button class="primary" type="submit">Salvar companhia</button></form></section>';
    this.el('company-settings').onsubmit = event => { event.preventDefault(); void this.act(async () => { const form = event.target, button = form.querySelector('button'); button.disabled = true; try { const file = form.elements.logo.files[0]; const logo = form.elements.removeLogo.checked ? null : file ? await this.h.prepareImage(file,true) : company.logo; await this.h.sync.saveCompany(form.elements.name.value,logo,company.revision); this.settingsRendered = false; await this.h.refresh(); this.h.message('Companhia atualizada. Novos registros reutilizarão esta identidade.'); } catch(error) { this.el('company-settings-status').textContent = error.message; } finally { button.disabled = false; } }); };
  }
  signup() {
    this.dialog('<h2>Criar meu acesso</h2><p>Use o e-mail que o administrador cadastrou na equipe. Você define sua própria senha.</p><label>Seu e-mail<input name="email" type="email" required autocomplete="email"></label><label>Nova senha<input name="password" type="password" required minlength="12" autocomplete="new-password"></label>', async form => {
      const session = await this.h.sync.signup(form.elements.email.value,form.elements.password.value); form.elements.password.value = '';
      if (session) await this.h.enter();
      this.h.message(session ? 'Acesso criado. Sua companhia será aberta se o cadastro estiver habilitado.' : 'Se o cadastro estiver disponível, confira seu e-mail para confirmar o acesso. Depois volte e entre com sua senha.');
    });
  }
};
