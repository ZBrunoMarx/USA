// Actual SDK, browser and Postgres functions/RLS. Auth, Storage HTTP and Realtime
// delivery are test transports; this script never writes to a hosted project.
import { chromium, devices } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const db = new PGlite(), dir = mkdtempSync(join(tmpdir(),'job-workspace-'));
const company = randomUUID(), adminId = randomUUID(), workerId = randomUUID(), oldJob = randomUUID(), oldReport = randomUUID();
const host = 'https://field-report-test.supabase.co';
const images = new Map(), sockets = new Set(), errors = [], requests = [];
let child, browser, base, dbChain = Promise.resolve();
const token = id => [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),session_id:randomUUID()})).toString('base64url'),'mock'].join('.');
const user = id => ({id,aud:'authenticated',role:'authenticated',email:id===adminId?'owner@example.test':'worker@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString()});
const sqlActor = (id, fn) => {
 const task = dbChain.catch(()=>{}).then(async()=>{await db.exec('set role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);try{return await fn();}finally{await db.exec('reset role');}});dbChain=task.catch(()=>{});return task;
};
function broadcast(table,row) { for(const client of sockets) { const index=client.filters?.findIndex(filter=>filter.table===table);if(index>=0)client.ws.send(JSON.stringify([client.join,null,client.topic,'postgres_changes',{ids:[index+1],data:{schema:'public',table,type:'UPDATE',commit_timestamp:new Date().toISOString(),record:row,old_record:{},columns:[]}}])); } }
async function setup(page) {
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/relatorio/cloud-config.js',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.FIELD_REPORT_CLOUD='+JSON.stringify({provider:'supabase',url:host,publishableKey:'sb_publishable_test_only'})+';'}));
 await page.route(host+'/**',async route=>{
  const req=route.request(), url=new URL(req.url());requests.push(url.pathname);
  const headers={'access-control-allow-origin':new URL(base).origin,'access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-upsert,cache-control,x-supabase-api-version,prefer','access-control-allow-methods':'GET,POST,PUT,DELETE,OPTIONS'};
  const reply=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  let id;try{id=JSON.parse(Buffer.from((req.headers().authorization||'').slice(7).split('.')[1],'base64url')).sub;}catch{}
  if(url.pathname==='/auth/v1/token'){
   const input=req.postDataJSON(), target=input.email==='owner@example.test'?adminId:input.email==='worker@example.test'?workerId:null;
   if(!target||input.password!=='Only-a-browser-test-2026')return reply({code:'invalid_credentials',msg:'Invalid'},400);
   return reply({access_token:token(target),token_type:'bearer',expires_in:3600,refresh_token:'mock-'+target,user:user(target)});
  }
  if(![adminId,workerId].includes(id))return reply({message:'Unauthenticated'},401);
  if(url.pathname==='/auth/v1/user')return reply(user(id));
  if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204,headers});
  try {
   if(url.pathname.startsWith('/rest/v1/rpc/')){
    const name=url.pathname.split('/').pop(), input=req.postDataJSON(), entries=Object.entries(input||{});
    if(!/^fr_[a-z_]+$/.test(name)||entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw new Error('Unexpected RPC');
    const value=await sqlActor(id,async()=> (await db.query('select public.'+name+'('+entries.map(([key],i)=>key+'=>$'+(i+1)).join(',')+') as result',entries.map(([,v])=>typeof v==='object'&&v!==null?JSON.stringify(v):v))).rows[0].result);
    const response=await reply(value);
    if(value?.id)broadcast(name==='fr_create_job'||name==='fr_change_job_status'?'fr_jobs':name==='fr_save_company'?'fr_companies':name==='fr_save_staff'?'fr_staff':name==='fr_save_service'?'fr_service_catalog':'fr_reports',value);
    if(name==='fr_save_task_report'||name==='fr_reopen_task'||name==='fr_add_task')broadcast('fr_tasks',{company_id:company});
    return response;
   }
   const match=url.pathname.match(/^\/rest\/v1\/(fr_[a-z_]+)$/);
   if(match){
    const table=match[1];if(!['fr_members','fr_jobs','fr_reports','fr_tasks','fr_companies','fr_staff','fr_service_catalog','fr_service_events'].includes(table))throw new Error('Unexpected table');
    let query='select * from public.'+table, params=[];
    for(const [key,value]of url.searchParams)if(value.startsWith('eq.')&&['id','company_id'].includes(key)){params.push(value.slice(3));query+=(params.length===1?' where ':' and ')+key+'=$'+params.length;}
    const order=url.searchParams.get('order');if(order&&/^(created_at|updated_at|position|display_name|name)\.(asc|desc)$/.test(order))query+=' order by '+order.replace('.',' ');
    const rows=await sqlActor(id,async()=> (await db.query(query,params)).rows);
    return reply(req.headers().accept?.includes('vnd.pgrst.object')?rows[0]:rows);
   }
   if(url.pathname.startsWith('/storage/v1/object/field-report-photos/')){
    const path=decodeURIComponent(url.pathname.split('/field-report-photos/')[1]);
    if(req.method()==='POST'){
     if(images.has(path))return reply({statusCode:'409',message:'Duplicate'},400);
     const data=await new Response(req.postDataBuffer(),{headers:{'content-type':req.headers()['content-type']}}).formData(), file=data.get('');
     await sqlActor(id,()=>db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['field-report-photos',path,id]));
     images.set(path,{data:Buffer.from(await file.arrayBuffer()),type:file.type});return reply({Key:'field-report-photos/'+path,Id:randomUUID()});
    }
    const allowed=await sqlActor(id,async()=> (await db.query('select name from storage.objects where name=$1',[path])).rows.length);
    const image=images.get(path);if(!allowed||!image)return reply({message:'Not found'},404);
    return route.fulfill({headers,contentType:image.type,body:image.data});
   }
   return reply({message:'Unexpected request '+url.pathname},404);
  }catch(error){return reply({code:error.code||'TEST_ERROR',message:error.message},error.code==='42501'?403:error.code==='42P01'?404:400);}
 });
 await page.routeWebSocket('wss://field-report-test.supabase.co/**',ws=>{
  const client={ws};sockets.add(client);ws.onClose(()=>sockets.delete(client));
  ws.onMessage(message=>{const[join,ref,topic,event,payload]=JSON.parse(String(message));if(event==='phx_join'){Object.assign(client,{topic,join,filters:payload.config.postgres_changes});ws.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:client.filters.map((filter,index)=>({...filter,id:index+1}))}}]));}else if(event==='heartbeat'||event==='phx_leave')ws.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));});
 });
}
async function login(page,email){await page.locator('#cloud-login').waitFor({state:'visible'});await page.locator('#cloud-login [name=login]').fill(email);await page.locator('#cloud-login [name=password]').fill('Only-a-browser-test-2026');await page.locator('#cloud-login button').click();await page.locator('#job-workspace').waitFor({state:'visible'});}
const check=async(label,fn)=>{await fn();console.log('PASS '+label);};
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(readFileSync(new URL('../deploy/supabase/01-schema.sql',import.meta.url),'utf8'));
 await db.query('insert into public.fr_companies values($1,$2)',[company,'EXAMPLE COMPANY']);
 for(const[id,name,role]of[[adminId,'Owner','admin'],[workerId,'Worker','worker']]){await db.query('insert into auth.users values($1,$2,now())',[id,user(id).email]);await db.query('insert into public.fr_members(id,company_id,display_name,role) values($1,$2,$3,$4)',[id,company,name,role]);}
 await db.query('insert into public.fr_jobs(id,company_id,name) values($1,$2,$3)',[oldJob,company,'Earlier work']);
 await sqlActor(workerId,()=>db.query('select public.fr_save_report($1,$2,0,$3,$4,$5,null)',[oldReport,oldJob,'active',JSON.stringify({title:'Existing report',date:'2026-10-24',author:'Worker',scope:'Old grout',language:'en',percent:'80',company:'',completed:'',remaining:''}),JSON.stringify({before:[],after:[],pending:[]})]));
 child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:'0',SKYTILE_AUTH:'demo',SKYTILE_DATA_DIR:dir,SKYTILE_AI_KEY:'',OPENAI_API_KEY:''}});
 base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);child.stdout.on('data',chunk=>{const m=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0]);}});child.once('error',reject);});
 browser=await chromium.launch({executablePath:process.env.SKYTILE_CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
 const ownerContext=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'}),workerContext=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 const owner=await ownerContext.newPage(),worker=await workerContext.newPage();await setup(owner);await setup(worker);
 await check('before migration: jobs open with update guidance, earlier reports remain accessible',async()=>{
  await owner.goto(base+'/relatorio/');await login(owner,'owner@example.test');await owner.getByRole('link',{name:'Atualizar banco'}).waitFor();
  await owner.locator('#nav-reports').click();await owner.locator('.service-item').filter({hasText:'Existing report'}).waitFor();
 });
 await dbChain;await db.exec(readFileSync(new URL('../deploy/supabase/04-job-workspace.sql',import.meta.url),'utf8'));
 await owner.reload();await owner.locator('#workspace-new-job').waitFor();
 await check('catalog setup: old schema remains readable, empty catalog directs admin to services',async()=>{
  await owner.locator('#nav-catalog').click();await owner.getByText('O catálogo aguarda a atualização do sistema.',{exact:false}).waitFor();
  await dbChain;await db.exec(readFileSync(new URL('../supabase/migrations/20261029000000_service_catalog.sql',import.meta.url),'utf8'));
  await owner.reload();await owner.locator('#workspace-new-job').click();await owner.locator('#add-catalog-service').waitFor();assert.equal(await owner.locator('#job-dialog').isVisible(),false);
  for(const[name,instructions]of[['Self-level','Follow approved material instructions.'],['Grout','']]){
   await owner.locator('#add-catalog-service').click();await owner.locator('#workspace-form [name=name]').fill(name);await owner.locator('#workspace-form [name=instructions]').fill(instructions);await owner.locator('#workspace-form [type=submit]').click();await owner.locator('#workspace-dialog').waitFor({state:'hidden'});await owner.locator('.service-item').filter({hasText:name}).waitFor();
  }
  await owner.locator('#nav-jobs').click();
 });
 await check('admin creates repair with two planned room services atomically',async()=>{
  await owner.locator('#workspace-new-job').click();await owner.locator('#cloud-job-form [name=name]').fill('Bathroom repair');await owner.locator('#cloud-job-form [name=kind]').selectOption('repair');
  await owner.locator('[data-planned-room]').fill('Bathroom');await owner.locator('[data-planned-service]').selectOption({label:'Self-level'});assert.equal(await owner.locator('[data-planned-instructions]').inputValue(),'Follow approved material instructions.');await owner.locator('[data-planned-instructions]').fill('Follow approved material instructions.');
  await owner.locator('#add-planned-task').click();await owner.locator('[data-planned-room]').nth(1).fill('Bathroom');await owner.locator('[data-planned-service]').nth(1).selectOption({label:'Grout'});
  await owner.locator('#cloud-job-form [type=submit]').click();await owner.locator('#job-dialog').waitFor({state:'hidden'});await owner.locator('.planned-task').nth(1).waitFor();
  assert.equal(await owner.locator('.planned-task').count(),2);assert.match(await owner.locator('#job-workspace').innerText(),/Reparo contratado/);
 });
 await check('team and company settings persist; worker has no admin navigation',async()=>{
  await owner.locator('#nav-team').click();await owner.locator('#add-staff').click();await owner.locator('#workspace-form [name=name]').fill('Jonny');await owner.locator('#workspace-form [name=code]').fill('P-001');await owner.locator('#workspace-form [name=position]').selectOption('installer');await owner.locator('#workspace-form [name=email]').fill('jonny@example.test');await owner.locator('#workspace-form [type=submit]').click();await owner.locator('#workspace-dialog').waitFor({state:'hidden'});await owner.locator('.service-item').filter({hasText:'Jonny'}).waitFor();
  await owner.locator('#nav-settings').click();await owner.locator('#company-settings [name=name]').fill('REAL CONTRACTOR');
  const logo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=','base64');
  await owner.locator('#company-settings [name=logo]').setInputFiles({name:'logo.png',mimeType:'image/png',buffer:logo});await owner.locator('#company-settings [type=submit]').click();await owner.waitForFunction(()=>document.querySelector('#message').textContent.includes('Companhia atualizada'));
  await worker.goto(base+'/relatorio/');await login(worker,'worker@example.test');assert.equal(await worker.locator('#nav-catalog').isVisible(),false);assert.equal(await worker.locator('#nav-team').isVisible(),false);assert.equal(await worker.locator('#create-cloud-job').isVisible(),false);assert.equal(await worker.locator('#new-service').isVisible(),false);
 });
 await check('worker opens job, starts planned service, company branding inherited, incomplete day stays active',async()=>{
  await worker.locator('.job-card').filter({hasText:'Bathroom repair'}).getByRole('button',{name:'Abrir obra'}).click();await worker.locator('.planned-task').filter({hasText:'Self-level'}).getByRole('button',{name:'Registrar dia'}).click();
  await worker.locator('#editor').waitFor({state:'visible'});assert.equal(await worker.locator('[name=title]').inputValue(),'Bathroom repair');assert.equal(await worker.locator('[name=title]').getAttribute('readonly'),'');assert.equal(await worker.locator('[name=company]').inputValue(),'REAL CONTRACTOR');assert.equal(await worker.locator('#company-logo').isVisible(),false);
  await worker.locator('[name=percent]').fill('60');await worker.locator('[name=completed]').fill('Prepared half of the room.');
  const png=await worker.evaluate(()=>{const c=document.createElement('canvas');c.width=80;c.height=80;c.getContext('2d').fillRect(0,0,80,80);return c.toDataURL('image/png').split(',')[1];});
  await worker.locator('.gallery[data-group=after]').setInputFiles({name:'final.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await worker.waitForFunction(()=>!document.querySelector('#report-fields').disabled);
  await worker.waitForFunction(()=>document.querySelector('#sync-status').textContent.startsWith('Salvo no servidor'),{timeout:15000});
  await worker.locator('#save-service').click();await worker.locator('#job-workspace').waitFor({state:'visible'});assert.match(await worker.locator('.planned-task').filter({hasText:'Self-level'}).innerText(),/60%/);
 });
 await check('same-day return reuses the report; final completion reaches owner via Realtime',async()=>{
  await owner.locator('#nav-jobs').click();await owner.locator('.job-card').filter({hasText:'Bathroom repair'}).getByRole('button',{name:'Abrir obra'}).click();await owner.locator('.planned-task').filter({hasText:'Self-level'}).getByRole('button',{name:'Ver registros'}).click();await owner.locator('.task-history .daily-record').waitFor();
  await worker.locator('.planned-task').filter({hasText:'Self-level'}).getByRole('button',{name:'Registrar dia'}).click();await worker.locator('.photo-tile').waitFor();assert.equal(await worker.locator('[name=percent]').inputValue(),'60');
  await worker.locator('#complete-task').check();await worker.locator('[name=completed]').fill('Self-level finished.');await worker.waitForFunction(()=>document.querySelector('#sync-status').textContent.startsWith('Salvo no servidor'),{timeout:15000});
  await owner.locator('.planned-task').filter({hasText:'Self-level'}).getByText('Concluído ✓',{exact:true}).waitFor({timeout:15000});
  await worker.locator('#save-service').click();await worker.locator('.planned-task').filter({hasText:'Self-level'}).getByText('Concluído ✓',{exact:true}).waitFor();
  const counts=await sqlActor(adminId,async()=> (await db.query('select count(*)::int as n from public.fr_reports where task_id is not null')).rows[0]);assert.equal(counts.n,1);
  assert.match(await worker.locator('#job-workspace').innerText(),/50% de avanço informado/);
 });
 await check('next task is independent; authenticated reload returns to jobs, photos remain server-side',async()=>{
  await worker.locator('.planned-task').filter({hasText:'Grout'}).getByRole('button',{name:'Registrar dia'}).click();await worker.waitForFunction(()=>document.querySelector('[name=scope]').value==='Bathroom · Grout');assert.equal(await worker.locator('[name=scope]').inputValue(),'Bathroom · Grout');assert.equal(await worker.locator('.photo-tile').count(),0);
  await worker.waitForFunction(()=>document.querySelector('#sync-status').textContent.startsWith('Salvo no servidor'),{timeout:15000});
  await worker.reload();await worker.locator('.job-card').filter({hasText:'Bathroom repair'}).waitFor();
  assert.equal(await worker.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await worker.locator('.job-card').filter({hasText:'Bathroom repair'}).getByRole('button',{name:'Abrir obra'}).click();await worker.locator('.planned-task').filter({hasText:'Self-level'}).getByRole('button',{name:'Ver registros'}).click();await worker.locator('.task-history .daily-record').getByRole('button',{name:'Fotos e vídeo'}).click();await worker.locator('.photo-tile').waitFor();
  assert.equal(await worker.locator('[name=percent]').inputValue(),'100');assert.equal(await worker.locator('#complete-task').isChecked(),true);
 });
 await check('logout clears device shared copies and login recovers private photos',async()=>{
  assert.equal(await worker.evaluate(()=>JSON.stringify(localStorage).includes('Only-a-browser-test-2026')),false);
  const logout=worker.waitForEvent('dialog').then(dialog=>dialog.accept());await worker.locator('#cloud-logout').click();await logout;await worker.locator('#cloud-login').waitFor({state:'visible'});
  assert.equal(await worker.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('field-report-auth-'))),false);
  await login(worker,'worker@example.test');await worker.locator('.job-card').filter({hasText:'Bathroom repair'}).getByRole('button',{name:'Abrir obra'}).click();
  await worker.locator('.planned-task').filter({hasText:'Self-level'}).getByRole('button',{name:'Ver registros'}).click();await worker.locator('.task-history .daily-record').getByRole('button',{name:'Fotos e vídeo'}).click();await worker.locator('.photo-tile').waitFor();
  assert.equal(await worker.locator('[name=percent]').inputValue(),'100');assert.equal(await worker.locator('[name=company]').inputValue(),'REAL CONTRACTOR');
 });
 await check('catalog changes affect new selections while existing execution keeps its original scope',async()=>{
  await owner.locator('#nav-catalog').click();await owner.locator('.service-item').filter({hasText:'Grout'}).getByRole('button',{name:'Editar serviço'}).click();await owner.locator('#workspace-form [name=name]').fill('Grout revised');await owner.locator('#workspace-form [name=active]').selectOption('false');await owner.locator('#workspace-form [type=submit]').click();await owner.locator('#workspace-dialog').waitFor({state:'hidden'});
  await owner.locator('#catalog-filter').selectOption('inactive');await owner.locator('.service-item').filter({hasText:'Grout revised'}).waitFor();
  await owner.locator('#nav-jobs').click();await owner.locator('#workspace-new-job').click();assert.equal(await owner.locator('[data-planned-service] option').filter({hasText:'Grout revised'}).count(),0);await owner.locator('#cancel-cloud-job').click();
  await owner.locator('.job-card').filter({hasText:'Bathroom repair'}).getByRole('button',{name:'Abrir obra'}).click();assert.equal(await owner.locator('.planned-task h3').filter({hasText:'Grout revised'}).count(),0);await owner.locator('.planned-task h3').filter({hasText:'Grout'}).waitFor();
  await owner.locator('#detail-add-task').click();await owner.locator('#workspace-form [name=service]').selectOption({label:'Self-level'});await owner.locator('#workspace-form [name=room]').fill('Second room');await owner.locator('#workspace-form [type=submit]').click();await owner.locator('#workspace-dialog').waitFor({state:'hidden'});await owner.locator('.planned-task').filter({hasText:'Second room'}).waitFor();
 });
 assert.deepEqual(errors,[]);assert.ok(images.size>=3);assert.ok(!requests.some(path=>path.includes('/object/public/')));
 await owner.locator('#nav-jobs').click();await owner.locator('.job-card').first().waitFor();await owner.screenshot({path:new URL('../.local/jobs-workspace-mobile.png',import.meta.url).pathname,fullPage:true});await worker.locator('#save-service').click();await worker.locator('#job-workspace').waitFor({state:'visible'});await worker.screenshot({path:new URL('../.local/job-detail-mobile.png',import.meta.url).pathname,fullPage:true});
 console.log('PASS jobs-first browser cycle: real Postgres + real SDK; only external provider transports simulated.');
}finally{await browser?.close();await dbChain.catch(()=>{});await db.close();if(child&&child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}rmSync(dir,{recursive:true,force:true});}
