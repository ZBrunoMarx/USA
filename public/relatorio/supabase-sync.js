'use strict';
globalThis.FieldReportSupabaseSync = class extends FieldReportSync {
  constructor(config, onChange, onStatus) {
    super(onChange, onStatus);
    this.config = config; this.client = null; this.profile = null; this.channel = null;
    this.kind = 'supabase'; this.backendId = config.url;
  }
  clientInstance() {
    if (this.client) return this.client;
    const url = new URL(this.config.url);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.origin !== this.config.url || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(this.config.publishableKey || '')) throw new Error('A configuração pública do projeto gratuito precisa ser conferida.');
    this.client = FieldReportSupabase.createClient(url.origin, this.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'field-report-auth-' + url.hostname },
      global: { fetch: async (input, options = {}) => {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
        try { return await fetch(input, { ...options, cache: 'no-store', signal: controller.signal }); }
        finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
      } },
    });
    return this.client;
  }
  check(error) {
    if (!error) return;
    const status = error.code === '40001' ? 409 : error.code === '42501' ? 403 : /^(22|23)/.test(error.code || '') ? 400 : ['PGRST202','PGRST205','42P01'].includes(error.code) ? 404 : Number(error.status || error.statusCode) || 503;
    let message = error.message || 'Não foi possível acessar a companhia. Seu registro local foi preservado.';
    if (error.code === 'invalid_credentials' || error.code === 'invalid_login_credentials') message = 'E-mail ou senha inválidos.';
    if (error.code === '23505') message = 'Este nome, ID ou e-mail já está cadastrado. Confira os dados.';
    if (error.code === 'PGRST202') message = 'O banco precisa da atualização de gestão de obras. Peça ao administrador para abrir Atualizar banco.';
    if (error.code === 'PGRST205' || error.code === '42P01') message = 'O projeto precisa receber a configuração do banco antes do primeiro acesso.';
    if (status === 429) message = 'Limite temporário do serviço. Aguarde e tente novamente; seu registro está no aparelho.';
    if (status >= 500 || error.name === 'AbortError') message = 'Sem resposta da companhia. Confira a conexão ou se o projeto gratuito está ativo. Seu registro local foi preservado.';
    throw Object.assign(new Error(message), { status: error.code === 'invalid_credentials' || error.code === 'invalid_login_credentials' ? 401 : status });
  }
  async detect() { this.clientInstance(); this.enabled = true; return true; }
  async login(email, password) { const { error } = await this.clientInstance().auth.signInWithPassword({ email: email.trim(), password }); this.check(error); return this.list(); }
  async logout() {
    const { error } = await this.clientInstance().auth.signOut({ scope: 'local' }); this.check(error);
    this.stop(); this.user = null; this.profile = null; this.images.clear();
  }
  normalize(row) { return { id: row.id, jobId: row.job_id, ownerId: row.owner_id, revision: row.revision, updatedAt: row.updated_at, status: row.status, fields: row.fields, photos: row.photos, logo: row.logo, photoCount: Object.values(row.photos).reduce((sum, items) => sum + items.length, 0), canEdit: this.profile?.role === 'admin' || this.user?.id === row.owner_id, backendId: this.backendId, taskId: row.task_id || null, taskCycle: row.task_cycle || null, complete: row.task_complete === true }; }
  async list() {
    const client = this.clientInstance(), session = await client.auth.getSession(); this.check(session.error);
    if (!session.data.session) throw Object.assign(new Error('Entre com seu e-mail e senha.'), { status: 401 });
    const authenticated = await client.auth.getUser(); this.check(authenticated.error);
    const member = await client.from('fr_members').select('id,company_id,display_name,role,active').eq('id', authenticated.data.user.id).maybeSingle(); this.check(member.error);
    if (!member.data) { const claim = await client.rpc('fr_claim_access'); if (!claim.error) return this.list(); }
    if (!member.data?.active) throw Object.assign(new Error('Seu acesso à companhia ainda não foi habilitado pelo administrador.'), { status: 403 });
    this.profile = member.data; this.user = { id: member.data.id, name: member.data.display_name, role: member.data.role };
    const [jobs, reports] = await Promise.all([client.from('fr_jobs').select('*').order('created_at', { ascending: false }), client.from('fr_reports').select('*').order('updated_at', { ascending: false })]);
    this.check(jobs.error); this.check(reports.error);
    const tasks = await client.from('fr_tasks').select('*').order('position');
    const workspaceReady = !tasks.error;
    if (tasks.error && !['PGRST205','42P01'].includes(tasks.error.code)) this.check(tasks.error);
    let company = null, staff = [];
    if (workspaceReady) {
      const settings = await client.from('fr_companies').select('*').eq('id', this.profile.company_id).single(); this.check(settings.error); company = settings.data;
      if (this.profile.role === 'admin') { const team = await client.from('fr_staff').select('*').order('display_name'); this.check(team.error); staff = team.data; }
    }
    let catalog = [], catalogReady = false;
    if (workspaceReady) {
      const result = await client.from('fr_service_catalog').select('*').order('name');
      if (result.error && !['PGRST205','42P01'].includes(result.error.code)) this.check(result.error);
      catalogReady = !result.error; catalog = result.data || [];
    }
    this.catalogReady = catalogReady;
    return { user: this.user, jobs: jobs.data, reports: reports.data.map(row => this.normalize(row)), tasks: tasks.data || [], company, staff, workspaceReady, catalog, catalogReady };
  }
  async rpc(name, params) { const result = await this.clientInstance().rpc(name, params); this.check(result.error); return result.data; }
  async createJob(name, address, kind = 'installation', tasks) {
    if (tasks) return this.rpc(this.catalogReady ? 'fr_create_catalog_job' : 'fr_create_job', { p_name: name.trim(), p_address: address.trim(), p_kind: kind, p_tasks: tasks });
    if (!this.profile || this.profile.role !== 'admin') throw Object.assign(new Error('Somente administradores cadastram obras.'), { status: 403 });
    const result = await this.clientInstance().from('fr_jobs').insert({ company_id: this.profile.company_id, name: name.trim(), address: address.trim() }).select('*').single(); this.check(result.error); return result.data;
  }
  async addCatalogTask(jobId, service, room, instructions) { return this.rpc('fr_add_catalog_task', { p_job_id: jobId, p_service_id: service.id, p_service_revision: service.revision, p_room: room, p_instructions: instructions }); }
  async saveService(item) { return this.rpc('fr_save_service', { p_id: item.id || null, p_revision: item.revision || 0, p_name: item.name, p_instructions: item.instructions, p_active: item.active }); }
  async addTask(jobId, room, name, instructions) { return this.rpc('fr_add_task', { p_job_id: jobId, p_room: room, p_name: name, p_instructions: instructions }); }
  async changeJob(job, status) { return this.rpc('fr_change_job_status', { p_id: job.id, p_revision: job.revision, p_status: status }); }
  async reopenTask(task) { return this.rpc('fr_reopen_task', { p_id: task.id, p_revision: task.revision }); }
  async saveCompany(name, logo, revision) { return this.rpc('fr_save_company', { p_name: name, p_logo: logo ? { id: logo.id, name: logo.name, imageId: logo.imageId || await this.upload(logo) } : null, p_revision: revision }); }
  async companyLogo(company) {
    if (!company?.logo) return null;
    const item = company.logo;
    if (!item.imageId.startsWith(this.profile.company_id + '/')) throw new Error('Logo indisponível.');
    const { data, error } = await this.clientInstance().storage.from('field-report-photos').download(item.imageId); this.check(error);
    this.images.set(item.id, item.imageId); return { ...item, blob: data };
  }
  async saveStaff(item) { return this.rpc('fr_save_staff', { p_id: item.id || null, p_revision: item.revision || 0, p_name: item.name, p_code: item.code, p_position: item.position, p_email: item.email, p_role: item.role, p_active: item.active }); }
  async signup(email, password) {
    const { data, error } = await this.clientInstance().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: new URL('./',location.href).href } }); this.check(error);
    return !!data.session;
  }
  watch() {
    this.stop();
    this.channel = this.clientInstance().channel('field-reports-' + this.profile.company_id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_reports', filter: 'company_id=eq.' + this.profile.company_id }, event => void this.onChange({ id: event.new?.id, revision: event.new?.revision }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_jobs', filter: 'company_id=eq.' + this.profile.company_id }, () => void this.onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_tasks', filter: 'company_id=eq.' + this.profile.company_id }, () => void this.onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_companies', filter: 'id=eq.' + this.profile.company_id }, () => void this.onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_service_catalog', filter: 'company_id=eq.' + this.profile.company_id }, () => void this.onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_staff', filter: 'company_id=eq.' + this.profile.company_id }, () => void this.onChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fr_members', filter: 'company_id=eq.' + this.profile.company_id }, () => void this.onChange())
      .subscribe(status => { this.onStatus(status === 'SUBSCRIBED' ? 'Atualizações conectadas' : 'Conferindo atualizações a cada 20 segundos'); if (status === 'SUBSCRIBED') void this.onChange(); });
    this.timer = setInterval(() => { if (!document.hidden && navigator.onLine) void this.onChange(); }, 20000);
  }
  stop() { if (this.channel && this.client) void this.client.removeChannel(this.channel); this.channel = null; super.stop(); }
  async upload(item) {
    if (this.images.has(item.id)) return this.images.get(item.id);
    if (!this.profile || !['image/jpeg', 'image/png'].includes(item.blob.type) || item.blob.size > 3 * 1024 * 1024) throw new Error('Envie uma imagem JPG ou PNG de até 3 MB.');
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await item.blob.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const path = this.profile.company_id + '/' + this.user.id + '/' + digest + (item.blob.type === 'image/png' ? '.png' : '.jpg');
    const { error } = await this.clientInstance().storage.from('field-report-photos').upload(path, item.blob, { upsert: false, contentType: item.blob.type, cacheControl: '0' });
    if (Number(error?.statusCode) !== 409 && Number(error?.status) !== 409) this.check(error);
    this.images.set(item.id, path); return path;
  }
  async publish(record, jobId) {
    const encode = async item => ({ id: item.id, name: item.name, imageId: await this.upload(item) });
    const photos = {}; for (const key of ['before', 'after', 'pending']) { photos[key] = []; for (const item of record.photos[key]) photos[key].push(await encode(item)); }
    const params = { p_id: record.id, p_job_id: jobId, p_expected_revision: record.cloud?.revision || 0, p_status: record.status, p_fields: record.fields, p_photos: photos, p_logo: record.logo ? await encode(record.logo) : null };
    if (record.cloud?.taskId) Object.assign(params, { p_task_id: record.cloud.taskId, p_task_cycle: record.cloud.taskCycle, p_complete: record.cloud.complete === true });
    const { data, error } = await this.clientInstance().rpc(record.cloud?.taskId ? 'fr_save_task_report' : 'fr_save_report', params);
    this.check(error); return this.normalize(data);
  }
  async download(id) {
    const result = await this.clientInstance().from('fr_reports').select('*').eq('id', id).single(); this.check(result.error);
    const record = this.normalize(result.data);
    const decode = async item => {
      if (!item.imageId.startsWith(this.profile.company_id + '/')) throw new Error('Foto não disponível para a companhia.');
      const { data, error } = await this.clientInstance().storage.from('field-report-photos').download(item.imageId); this.check(error);
      this.images.set(item.id, item.imageId); return { id: item.id, name: item.name, blob: data };
    };
    const photos = {}; for (const key of ['before', 'after', 'pending']) photos[key] = await Promise.all(record.photos[key].map(decode));
    return { id: record.id, version: 1, fields: record.fields, photos, logo: record.logo ? await decode(record.logo) : null, status: record.status, savedAt: Date.parse(record.updatedAt), cloud: { jobId: record.jobId, ownerId: record.ownerId, revision: record.revision, syncedAt: record.updatedAt, dirty: false, taskId: record.taskId, taskCycle: record.taskCycle, complete: record.complete, canEdit: record.canEdit, backendId: this.backendId } };
  }
};
