(function () {
  const stages = Object.freeze({ not_started: 0, started: 20, ongoing: 50, almost: 80, done: 100 });
  const completionScope = job => job.rooms.flatMap(room => room.services.map(service => ({ roomId: room.id, service })));
  function serviceProgress(job, roomId, service) {
    const entries = job.entries.filter(e => e.roomId === roomId && e.service === service);
    const latest = entries.at(-1);
    const delivery = [...(job.events || [])].reverse().find(e => e.type === 'delivered' && e.scope?.some(s => s.roomId === roomId && s.service === service));
    const applicable = delivery ? entries.filter(e => e.at > delivery.at) : entries;
    const estimate = [...applicable].reverse().find(e => Object.hasOwn(stages, e.progress));
    return { percent: estimate ? stages[estimate.progress] : delivery ? 100 : 0, known: !!estimate || !!delivery, review: latest?.progress === 'review', source: estimate || null, delivery: delivery || null };
  }
  function jobProgress(job, roomId = null) {
    const services = job.rooms.filter(r => !roomId || r.id === roomId).flatMap(r => r.services.map(s => serviceProgress(job, r.id, s)));
    const mean = services.length ? services.reduce((n, s) => n + s.percent, 0) / services.length : 0;
    let percent = Math.round(mean / 5) * 5;
    if (mean > 0 && percent === 0) percent = 5;
    if (mean < 100 && percent === 100) percent = 95;
    if (job.status === 'delivered') percent = 100;
    return { percent, total: services.length, known: services.filter(s => s.known).length, unestimated: services.filter(s => !s.known).length, review: services.filter(s => s.review).length, confirmed: job.status === 'delivered', services };
  }
  globalThis.SkytileProgress = Object.freeze({ stages, serviceProgress, jobProgress, completionScope });
})();
