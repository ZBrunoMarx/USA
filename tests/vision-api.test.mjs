import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {once} from 'node:events';
const dir=mkdtempSync(join(tmpdir(),'skytile-vision-api-'));let child,base,jobId,roomId,entryId;
const launch=async()=>{child=spawn(process.execPath,['--import','./tests/helpers/mock-vision.mjs','server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env, NODE_ENV:'test', SKYTILE_AUTH:'demo', SKYTILE_PUBLIC_ORIGIN:'', SKYTILE_BOOTSTRAP_PASSWORD:'',PORT:'0',SKYTILE_DATA_DIR:dir,SKYTILE_AI_KEY:'isolated-test-secret',SKYTILE_TEST_VISION_LOG:join(dir,'provider.log')}});base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0])}});child.once('error',reject)})};
const request=async(path,body,profile='thiago')=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Skytile-User':profile},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()}};
before(launch);after(async()=>{const exited=once(child,'exit');child.kill('SIGTERM');await exited;rmSync(dir,{recursive:true,force:true})});
test('analysis endpoint deduplicates concurrent requests, preserves new work during provider waits and never overwrites reported advance',async()=>{
 const job=await request('/jobs',{name:'Teste visual',address:'NJ',rooms:[{name:'Sala',services:['Tile no piso']}]});jobId=job.data.id;roomId=job.data.rooms[0].id;
 const image=await request('/upload',{name:'photo.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aI9sAAAAASUVORK5CYII='},'johnny');
 const input={roomId,service:'Tile no piso',progress:'done',phase:'end',note:'Relato do teste',photos:[image.data]};
 const entry=await request(`/jobs/${jobId}/entries`,input,'johnny');entryId=entry.data.createdEntryId;assert.ok(entryId);
 assert.equal((await request(`/jobs/${jobId}/entries/${entryId}/analyze`,{},'bruno')).status,403);
 const attempts=await Promise.all([request(`/jobs/${jobId}/entries/${entryId}/analyze`,{},'johnny'),request(`/jobs/${jobId}/entries/${entryId}/analyze`,{},'johnny'),request(`/jobs/${jobId}/entries`,{...input,progress:'ongoing',note:'Registro concorrente'},'bruno')]);
 assert.ok(attempts.slice(0,2).every(r=>[200,202].includes(r.status)));assert.equal(attempts[2].status,200);
 const saved=(await request('/state')).data.jobs.find(j=>j.id===jobId);assert.equal(saved.entries.length,2);const analyzed=saved.entries.find(e=>e.id===entryId);
 assert.equal(analyzed.progress,'done');assert.equal(analyzed.analysis.status,'complete');assert.equal(analyzed.analysis.verdict,'possible_difference');
 assert.equal(analyzed.analysis.basis,'current_only');
 assert.equal(readFileSync(join(dir,'provider.log'),'utf8').trim().split('\n').length,1);
 await request(`/jobs/${jobId}/entries/${entryId}/analyze`,{},'thiago');assert.equal(readFileSync(join(dir,'provider.log'),'utf8').trim().split('\n').length,1);
 const raw=JSON.stringify((await request('/state')).data);assert.ok(!raw.includes('isolated-test-secret'));assert.equal((await request('/state')).data.ai.available,true);
});
test('a provider failure preserves a partial-day record and retry reuses its saved photos',async()=>{
 const state=(await request('/state')).data;
 const photo=state.jobs.find(j=>j.id===jobId).entries.find(e=>e.id===entryId).photos[0];
 const saved=await request(`/jobs/${jobId}/entries`,{roomId,service:'Tile no piso',progress:'ongoing',phase:'end',note:'TEST_QUOTA_ONCE — relato parcial',photos:[photo]},'johnny');
 const id=saved.data.createdEntryId;const beforeCount=saved.data.entries.length;
 const failed=await request(`/jobs/${jobId}/entries/${id}/analyze`,{},'johnny');assert.equal(failed.status,502);assert.match(failed.data.error,/faturamento/);
 const jobAfterFailure=(await request('/state')).data.jobs.find(j=>j.id===jobId);
 const entry=jobAfterFailure.entries.find(e=>e.id===id);
 assert.equal(entry.analysis.status,'error');assert.equal(entry.progress,'ongoing');assert.deepEqual(entry.photos,[photo]);assert.equal(jobAfterFailure.entries.length,beforeCount);
 const retry=await request(`/jobs/${jobId}/entries/${id}/analyze`,{},'johnny');assert.equal(retry.status,200);assert.equal(retry.data.analysis.basis,'comparison');
 const final=(await request('/state')).data.jobs.find(j=>j.id===jobId);assert.equal(final.entries.length,beforeCount);assert.equal(final.entries.find(e=>e.id===id).progress,'ongoing');
});
test('only admins review an analysis; review history and reported progress remain intact',async()=>{
 const path=`/jobs/${jobId}/entries/${entryId}/analysis-review`;
 assert.equal((await request(path,{decision:'agree'},'johnny')).status,403);
 assert.equal((await request(path,{decision:'needs_check',note:'Conferir no local'})).status,200);
 const next=await request(path,{decision:'disagree',note:'Verificação feita no local'},'flavio');assert.equal(next.status,200);assert.equal(next.data.analysis.reviews.length,2);
 const job=(await request('/state')).data.jobs.find(j=>j.id===jobId);assert.equal(job.entries.find(e=>e.id===entryId).progress,'done');
});
