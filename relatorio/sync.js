'use strict';
globalThis.FieldReportSync = class {
  constructor(onChange, onStatus) { this.onChange = onChange; this.onStatus = onStatus; this.images = new Map(); this.enabled = false; this.user = null; this.events = null; this.timer = null; this.kind = 'node'; this.backendId = location.origin; }
  async request(path, options = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/' + path, { ...options, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', ...options.headers } });
      if (options.blob && response.ok) return response.blob();
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'Não foi possível acessar o servidor.'), { status: response.status });
      return data;
    } finally { clearTimeout(timer); }
  }
  async detect() {
    if (location.hostname.endsWith('.github.io')) return false;
    try { const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2500); let response;
      try { response = await fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal }); } finally { clearTimeout(timer); }
      const data = await response.json(); this.enabled = data.enabled === true; return this.enabled;
    } catch { return false; }
  }
  async login(login, password) { await this.request('auth/login', { method: 'POST', body: JSON.stringify({ login, password }) }); return this.list(); }
  async logout() { await this.request('auth/logout', { method: 'POST', body: '{}' }); this.stop(); this.user = null; this.images.clear(); }
  async list() { const data = await this.request('field-reports'); this.user = data.user; return data; }
  watch() {
    this.stop();
    this.events = new EventSource('/api/field-reports/events');
    this.events.addEventListener('connected', () => { this.onStatus('Atualizações conectadas'); void this.onChange(); });
    this.events.addEventListener('change', event => void this.onChange(JSON.parse(event.data)));
    this.events.onerror = () => this.onStatus('Reconectando · conferência a cada 20 segundos');
    this.timer = setInterval(() => { if (!document.hidden && navigator.onLine) void this.onChange(); }, 20000);
  }
  stop() { this.events?.close(); this.events = null; clearInterval(this.timer); this.timer = null; }
  async upload(item) {
    if (this.images.has(item.id)) return this.images.get(item.id);
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(item.blob); });
    const result = await this.request('field-report-images', { method: 'POST', body: JSON.stringify({ type: item.blob.type, data }) });
    this.images.set(item.id, result.imageId); return result.imageId;
  }
  async publish(record, jobId) {
    const encode = async item => ({ id: item.id, name: item.name, imageId: await this.upload(item) });
    const photos = {}; for (const key of ['before', 'after', 'pending']) { photos[key] = []; for (const item of record.photos[key]) photos[key].push(await encode(item)); }
    return this.request('field-reports/' + record.id, { method: 'PUT', body: JSON.stringify({ expectedRevision: record.cloud?.revision || 0, jobId, status: record.status, fields: record.fields, photos, logo: record.logo ? await encode(record.logo) : null }) });
  }
  async download(id) {
    const record = await this.request('field-reports/' + id);
    const decode = async item => { const blob = await this.request('field-report-images/' + item.imageId, { blob: true }); this.images.set(item.id, item.imageId); return { id: item.id, name: item.name, blob }; };
    const photos = {}; for (const key of ['before', 'after', 'pending']) photos[key] = await Promise.all(record.photos[key].map(decode));
    return { id: record.id, version: 1, fields: record.fields, photos, logo: record.logo ? await decode(record.logo) : null, status: record.status, savedAt: Date.parse(record.updatedAt), cloud: { jobId: record.jobId, ownerId: record.ownerId, revision: record.revision, syncedAt: record.updatedAt, dirty: false, canEdit: record.canEdit } };
  }
};
