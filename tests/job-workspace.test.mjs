import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite(), company = randomUUID(), other = randomUUID(), admin = randomUUID(), worker = randomUUID(), outsider = randomUUID(), newcomer = randomUUID(), unconfirmed = randomUUID();
const oldJob = randomUUID(), oldReport = randomUUID(); let job, task, second, report = randomUUID(), photo;
const base = readFileSync(new URL('../deploy/supabase/01-schema.sql',import.meta.url),'utf8');
const migration = readFileSync(new URL('../deploy/supabase/04-job-workspace.sql',import.meta.url),'utf8');
const fields = { title:'Bathroom', date:'2026-10-26',author:'Worker',scope:'Grout',language:'en',percent:'60',company:'Example',completed:'Work done',remaining:'' };
const empty = {before:[],after:[],pending:[]};
async function actor(id, fn, role='authenticated') { await db.exec('set role '+role); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']); try {return await fn();} finally {await db.exec('reset role');} }
async function rpc(name,args) { return (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result; }
async function denied(fn, code='42501') { await assert.rejects(fn,error=>error.code===code); }
async function save(expected=0, overrides={}) { return rpc('fr_save_task_report',[overrides.id||report,overrides.job||job.id,expected,'active',JSON.stringify({...fields,...overrides.fields}),JSON.stringify(overrides.photos||empty),null,overrides.task||task.id,overrides.complete||false,overrides.cycle||1]); }
before(async()=>{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 alter table storage.objects enable row level security;grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 await db.exec(base);
 await db.query('insert into public.fr_companies(id,name) values($1,$2),($3,$4)',[company,'Example',other,'Other']);
 for(const [id,tenant,role,email] of [[admin,company,'admin','owner@example.test'],[worker,company,'worker','worker@example.test'],[outsider,other,'admin','other@example.test'],[newcomer,null,null,'new@example.test'],[unconfirmed,null,null,'unconfirmed@example.test']]){
   await db.query('insert into auth.users values($1,$2,$3)',[id,email,id===unconfirmed?null:new Date()]);
   if(tenant) await db.query('insert into public.fr_members(id,company_id,display_name,role) values($1,$2,$3,$4)',[id,tenant,'Test',role]);
 }
 await db.query('insert into public.fr_jobs(id,company_id,name) values($1,$2,$3)',[oldJob,company,'Existing']);
 await actor(worker,()=>rpc('fr_save_report',[oldReport,oldJob,0,'active',JSON.stringify(fields),JSON.stringify(empty),null]));
 await db.exec(migration);
 photo={id:randomUUID(),name:'final.jpg',imageId:company+'/'+worker+'/'+'a'.repeat(64)+'.jpg'};
 await actor(worker,()=>db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)',['field-report-photos',photo.imageId,worker]));
});
after(()=>db.close());
test('migration preserves prior jobs/reports and does not guess service completion',async()=>{
 assert.equal((await db.query('select count(*)::int as n from public.fr_reports')).rows[0].n,1);
 assert.equal((await db.query('select task_id,fields from public.fr_reports where id=$1',[oldReport])).rows[0].task_id,null);
 assert.equal((await db.query('select count(*)::int as n from public.fr_tasks')).rows[0].n,0);
});
test('only admins create atomic plans; repair type and return status are independent',async()=>{
 const plan=JSON.stringify([{room:'Bathroom',name:'Self-level'},{room:'Bathroom',name:'Grout'}]);
 await actor(worker,()=>denied(()=>rpc('fr_create_job',['Repair','Address','repair',plan])));
 await actor(admin,async()=>{
  job=await rpc('fr_create_job',['Repair','Address','repair',plan]);
  const rows=(await db.query('select * from public.fr_tasks where job_id=$1 order by position',[job.id])).rows;[task,second]=rows;
  assert.equal(job.kind,'repair');assert.equal(job.status,'active');assert.equal(rows.length,2);
  await assert.rejects(()=>rpc('fr_create_job',['Invalid','Address','installation',JSON.stringify([{name:'Valid'},{name:''}])]));
  assert.equal((await db.query("select count(*)::int as n from public.fr_jobs where name='Invalid'")).rows[0].n,0);
 });
});
test('tenant isolation covers planned tasks and admin-only private roster',async()=>{
 await actor(null,()=>denied(()=>db.query('select * from public.fr_tasks')),'anon');
 await actor(worker,async()=>{assert.equal((await db.query('select * from public.fr_tasks')).rows.length,2);assert.equal((await db.query('select * from public.fr_staff')).rows.length,0);await denied(()=>db.query("update public.fr_tasks set status='completed'"));});
 await actor(outsider,async()=>{assert.equal((await db.query('select * from public.fr_tasks')).rows.length,0);await denied(()=>rpc('fr_add_task',[job.id,'','Forged','']));});
});
test('daily report updates service progress atomically, stale report CAS cannot overwrite',async()=>{
 await actor(worker,async()=>{
  const result=await save();assert.equal(result.task_id,task.id);assert.equal(result.task_cycle,1);
  const progress=(await db.query('select * from public.fr_tasks where id=$1',[task.id])).rows[0];assert.equal(progress.percent,60);assert.equal(progress.status,'active');
  await denied(()=>save(0,{fields:{percent:'20'}}),'40001');
  await denied(()=>rpc('fr_save_report',[report,job.id,1,'active',JSON.stringify({...fields,percent:'100'}),JSON.stringify(empty),null]),'22023');
  await denied(()=>db.query('select field_report_private.save_report_v2($1,$2,1,$3,$4,$5,null)',[report,job.id,'active',JSON.stringify(fields),JSON.stringify(empty)]));
 });
});
test('completion requires 100%, final photo, no pending work; failed completion retains previous state',async()=>{
 await actor(worker,async()=>{
  await denied(()=>save(1,{complete:true,fields:{percent:'100'}}),'22023');
  await denied(()=>save(1,{complete:true,fields:{percent:'100',remaining:'Doorway'},photos:{...empty,after:[photo]}}),'22023');
  await denied(()=>save(1,{complete:true,fields:{percent:'100'},photos:{...empty,after:[photo],pending:[{...photo,id:randomUUID()}]}}),'22023');
  assert.equal((await db.query('select percent from public.fr_tasks where id=$1',[task.id])).rows[0].percent,60);
  const result=await save(1,{complete:true,fields:{percent:'100'},photos:{...empty,after:[photo]}});assert.equal(result.task_complete,true);
  assert.equal((await db.query('select status from public.fr_tasks where id=$1',[task.id])).rows[0].status,'completed');
  await denied(()=>save(0,{id:randomUUID()}),'22023');
 });
});
test('delivering requires all services; reopening preserves original repair type and history',async()=>{
 await actor(admin,async()=>{
  await denied(()=>rpc('fr_change_job_status',[job.id,1,'delivered']),'22023');
  await denied(()=>rpc('fr_change_job_status',[job.id,99,'adjustment']),'40001');
  const result=await rpc('fr_change_job_status',[job.id,1,'adjustment']);assert.equal(result.kind,'repair');assert.equal(result.status,'adjustment');
  const current=(await db.query('select * from public.fr_tasks where id=$1',[task.id])).rows[0];
  await rpc('fr_reopen_task',[task.id,current.revision]);
  assert.equal((await db.query('select task_complete from public.fr_reports where id=$1',[report])).rows[0].task_complete,true);
 });
 await actor(worker,async()=>{
  await denied(()=>save(2,{complete:true,fields:{percent:'100'},photos:{...empty,after:[photo]}}),'22023');
  const result=await save(0,{id:randomUUID(),cycle:2,fields:{percent:'20'}});assert.equal(result.task_cycle,2);
 });
});
test('late historical reports do not regress service progress',async()=>{
 await actor(worker,async()=>{
  await save(0,{id:randomUUID(),cycle:2,fields:{date:'2026-10-25',percent:'5'}});
  assert.equal((await db.query('select percent from public.fr_tasks where id=$1',[task.id])).rows[0].percent,20);
 });
});
test('admin roster registration, verified email claim, role boundary and last-admin protection',async()=>{
 let staff;
 await actor(worker,()=>denied(()=>rpc('fr_save_staff',[null,0,'Forged','X','helper','new@example.test','admin',true])));
 await actor(admin,async()=>{
  staff=await rpc('fr_save_staff',[null,0,'New helper','H-1','helper','new@example.test','worker',true]);assert.equal(staff.user_id,null);
  await rpc('fr_save_staff',[null,0,'Unconfirmed','H-2','helper','unconfirmed@example.test','worker',true]);
  const owner=(await db.query('select * from public.fr_staff where user_id=$1',[admin])).rows[0];
  await denied(()=>rpc('fr_save_staff',[owner.id,owner.revision,'Owner',owner.code,'other','','worker',true]),'22023');
 });
 await actor(unconfirmed,()=>denied(()=>rpc('fr_claim_access',[])));
 await actor(newcomer,async()=>{
  await rpc('fr_claim_access',[]);await rpc('fr_claim_access',[]);
  const profile=(await db.query('select * from public.fr_members where id=$1',[newcomer])).rows[0];assert.equal(profile.company_id,company);assert.equal(profile.role,'worker');
  await denied(()=>rpc('fr_create_job',['Forged','','installation','[]']));
 });
 await actor(admin,async()=>{const current=(await db.query('select * from public.fr_staff where id=$1',[staff.id])).rows[0];await rpc('fr_save_staff',[staff.id,current.revision,'New helper','H-1','helper','new@example.test','worker',false]);});
 await actor(newcomer,async()=>{assert.equal((await db.query('select * from public.fr_jobs')).rows.length,0);});
});
test('company identity is admin-only with revision conflict protection',async()=>{
 await actor(worker,()=>denied(()=>rpc('fr_save_company',['Forged',null,1])));
 await actor(admin,async()=>{assert.equal((await rpc('fr_save_company',['Real company',null,1])).name,'Real company');await denied(()=>rpc('fr_save_company',['Stale',null,1]),'40001');});
});
test('additive migration is idempotent without losing reports or reopening access to the private writer',async()=>{
 const n=(await db.query('select count(*)::int as n from public.fr_reports')).rows[0].n;await db.exec(migration);
 assert.equal((await db.query('select count(*)::int as n from public.fr_reports')).rows[0].n,n);
 await actor(worker,()=>denied(()=>db.query('select field_report_private.save_report_v2($1,$2,0,$3,$4,$5,null)',[randomUUID(),job.id,'active',JSON.stringify(fields),JSON.stringify(empty)])));
});
