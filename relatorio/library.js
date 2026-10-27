'use strict';
// Photos are records, never CacheStorage entries. Migration commits before removing v1.
globalThis.FieldReportLibrary = class {
  constructor(db) { this.db = db; }
  static async open() {
    const db = await new Promise((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => { finished = true; reject(new Error('storage timeout')); }, 2500);
      const request = indexedDB.open('field-report-v1', 2);
      request.onupgradeneeded = () => { for (const name of ['draft', 'reports', 'index', 'settings']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else resolve(request.result); };
      request.onblocked = () => { /* Timeout leaves old data intact and asks for a backup. */ };
    });
    const library = new FieldReportLibrary(db);
    await library.migrate(); return library;
  }
  transaction(names, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(names, mode); let result, problem;
      const done = value => { result = value; }, fail = error => { problem = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(problem || tx.error || new Error('storage aborted'));
      try { action(tx, done, fail); } catch (error) { fail(error); }
    });
  }
  get(id) { return this.transaction(['reports'], 'readonly', (tx, done) => { tx.objectStore('reports').get(id).onsuccess = event => done(event.target.result); }); }
  list() { return this.transaction(['index'], 'readonly', (tx, done) => { tx.objectStore('index').getAll().onsuccess = event => done(event.target.result.sort((a, b) => b.savedAt - a.savedAt)); }); }
  current() { return this.transaction(['settings'], 'readonly', (tx, done) => { tx.objectStore('settings').get('current').onsuccess = event => done(event.target.result); }); }
  select(id) { return this.transaction(['settings'], 'readwrite', tx => tx.objectStore('settings').put(id, 'current')); }
  summary(data) { return { id: data.id, title: data.fields.title, date: data.fields.date, scope: data.fields.scope, percent: data.fields.percent, status: data.status, savedAt: data.savedAt, hasContent: !!(data.fields.title || data.fields.completed || data.fields.remaining || Object.values(data.photos).some(items => items.length)), photoCount: Object.values(data.photos).reduce((n, list) => n + list.length, 0), cloud: data.cloud || null }; }
  save(data, expected) {
    return this.transaction(['reports', 'index', 'settings'], 'readwrite', (tx, done, fail) => {
      tx.objectStore('reports').get(data.id).onsuccess = event => {
        const previous = event.target.result;
        if ((previous?.localRevision || 0) !== expected) return fail(new Error('Este serviço mudou em outra aba. Salve uma cópia do registro e reabra a página para não sobrescrever as alterações.'));
        const next = { ...data, localRevision: expected + 1 };
        tx.objectStore('reports').put(next, next.id); tx.objectStore('index').put(this.summary(next), next.id); tx.objectStore('settings').put(next.id, 'current'); done(next);
      };
    });
  }
  synced(id, sentRevision, cloud) {
    return this.transaction(['reports', 'index'], 'readwrite', (tx, done) => {
      tx.objectStore('reports').get(id).onsuccess = event => {
        const current = event.target.result; if (!current) return;
        current.cloud = { ...cloud, ...(current.localRevision !== sentRevision ? { taskId: current.cloud?.taskId, taskCycle: current.cloud?.taskCycle, complete: current.cloud?.complete } : {}), dirty: current.localRevision !== sentRevision };
        tx.objectStore('reports').put(current, id); tx.objectStore('index').put(this.summary(current), id); done(current);
      };
    });
  }
  remove(id) { return this.transaction(['reports', 'index', 'settings'], 'readwrite', tx => { tx.objectStore('reports').delete(id); tx.objectStore('index').delete(id); tx.objectStore('settings').get('current').onsuccess = event => { if (event.target.result === id) tx.objectStore('settings').delete('current'); }; }); }
  async migrate() {
    return this.transaction(['draft', 'reports', 'index', 'settings'], 'readwrite', (tx, done) => {
      tx.objectStore('draft').get('current').onsuccess = event => {
        const old = event.target.result;
        if (!old?.fields || !old.photos) return;
        const next = { ...old, id: crypto.randomUUID(), localRevision: 1, status: 'active', savedAt: old.savedAt || Date.now() };
        tx.objectStore('reports').put(next, next.id); tx.objectStore('index').put(this.summary(next), next.id); tx.objectStore('settings').put(next.id, 'current');
        tx.objectStore('draft').delete('current'); done(next.id);
      };
    });
  }
};
