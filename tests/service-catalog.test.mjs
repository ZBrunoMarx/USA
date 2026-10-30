import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { managedSchemas } from './helpers/supabase-fixture.mjs';
const db=new PGlite(),company=randomUUID(),outside=randomUUID(),admin=randomUUID(),worker=randomUUID(),other=randomUUID(),legacyJob=randomUUID();
let service, job;
const migration=readFileSync(new URL('../supabase/migrations/20261029000000_service_catalog.sql',import.meta.url),'utf8');
async function actor(id,fn,role='authenticated'){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');}}
async function rpc(name,args){return(await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;}
const denied=(fn,code='42501')=>assert.rejects(fn,error=>error.code===code);
const save=(id=null,revision=0,name='Grout',instructions='Standard instructions',active=true)=>rpc('fr_save_service',[id,revision,name,instructions,active]);
const plan=(id=service.id,rev=service.revision)=>JSON.stringify([{serviceId:id,serviceRevision:rev,room:'Bathroom'}]);
before(async()=>{
 await db.exec(managedSchemas);
 await db.exec(readFileSync(new URL('../supabase/migrations/20261026000000_field_report_baseline.sql',import.meta.url),'utf8'));
 await db.query('insert into public.fr_companies(id,name) values($1,$2),($3,$4)',[company,'Company',outside,'Other']);
 for(const[id,tenant,role]of[[admin,company,'admin'],[worker,company,'worker'],[other,outside,'admin']]){
  await db.query('insert into auth.users values($1,$2,now())',[id,id+'@example.test']);
  await db.query('insert into public.fr_members(id,company_id,display_name,role) values($1,$2,$3,$4)',[id,tenant,'Test',role]);
 }
 await db.query("insert into public.fr_jobs(id,company_id,name) values($1,$2,'Legacy job')",[legacyJob,company]);
 await db.query("insert into public.fr_tasks(company_id,job_id,name,instructions,percent) values($1,$2,'Old grout','Original scope',60)",[company,legacyJob]);
 await db.exec(migration);
});
after(()=>db.close());
test('migration preserves legacy scope without creating or guessing catalog entries',async()=>{
 const old=(await db.query('select * from public.fr_tasks')).rows[0];assert.equal(old.name,'Old grout');assert.equal(old.percent,60);assert.equal(old.service_id,null);
 assert.equal((await db.query('select count(*)::int as n from public.fr_service_catalog')).rows[0].n,0);
});
test('only admins can create services; anonymous and other companies cannot read them',async()=>{
 await actor(null,()=>denied(()=>db.query('select * from public.fr_service_catalog')),'anon');
 await actor(worker,()=>denied(()=>save()));
 service=await actor(admin,()=>save());assert.equal(service.created_by,admin);assert.equal(service.revision,1);
 await actor(other,async()=>{assert.equal((await db.query('select * from public.fr_service_catalog')).rows.length,0);await denied(()=>save(service.id,1));});
 await actor(worker,async()=>{assert.equal((await db.query('select * from public.fr_service_catalog')).rows.length,1);await denied(()=>db.query("update public.fr_service_catalog set active=false"));assert.equal((await db.query('select * from public.fr_service_events')).rows.length,0);});
});
test('names are unique within company ignoring casing/whitespace, invalid fields roll back',async()=>{
 await actor(admin,async()=>{
  await denied(()=>save(null,0,'  gRoUt  '),'23505');
  await denied(()=>save(null,0,''),'23514');
  await denied(()=>save(null,0,'Other','x'.repeat(601)),'23514');
  assert.equal((await db.query('select count(*)::int as n from public.fr_service_events')).rows[0].n,1);
 });
 await actor(other,async()=>{assert.equal((await save()).name,'Grout');});
});
test('job creation uses company catalog IDs and snapshots the selected revision/default instructions',async()=>{
 await actor(worker,()=>denied(()=>rpc('fr_create_catalog_job',['Forbidden','','installation',plan()])));
 await actor(admin,async()=>{
  job=await rpc('fr_create_catalog_job',['New job','','installation',plan()]);
  const task=(await db.query('select * from public.fr_tasks where job_id=$1',[job.id])).rows[0];
  assert.equal(task.service_id,service.id);assert.equal(task.service_revision,1);assert.equal(task.name,'Grout');assert.equal(task.instructions,'Standard instructions');
  await denied(()=>db.query("insert into public.fr_jobs(company_id,name) values($1,'Bypass')",[company]));
 });
});
test('unregistered, foreign, stale or invalid selections leave no partial job',async()=>{
 await actor(admin,async()=>{
  for(const[id,revision,code]of[[randomUUID(),1,'22023'],[service.id,99,'40001']])await denied(()=>rpc('fr_create_catalog_job',['Invalid job','','repair',plan(id,revision)]),code);
  await denied(()=>rpc('fr_create_catalog_job',['Invalid job','','installation',JSON.stringify([{serviceId:service.id,serviceRevision:1},{serviceId:randomUUID(),serviceRevision:1}])]),'22023');
  assert.equal((await db.query("select count(*)::int as n from public.fr_jobs where name='Invalid job'")).rows[0].n,0);
 });
 await actor(other,()=>denied(()=>rpc('fr_create_catalog_job',['Foreign','','installation',plan()]),'22023'));
});
test('renaming the catalog leaves past job scope unchanged and records immutable actor/version audit',async()=>{
 await actor(admin,async()=>{
  service=await save(service.id,1,'Grouting','New standard',true);
  await denied(()=>save(service.id,1,'Stale'),'40001');
  const task=(await db.query('select * from public.fr_tasks where job_id=$1',[job.id])).rows[0];assert.equal(task.name,'Grout');assert.equal(task.instructions,'Standard instructions');assert.equal(task.service_revision,1);
  const event=(await db.query('select * from public.fr_service_events where service_id=$1 order by revision desc',[service.id])).rows[0];assert.equal(event.actor_id,admin);assert.equal(event.before_data.name,'Grout');assert.equal(event.after_data.name,'Grouting');assert.ok(event.at);
  await denied(()=>db.query('delete from public.fr_service_events'));
  const added=await rpc('fr_add_catalog_task',[job.id,service.id,'Kitchen','Job-specific guidance',service.revision]);assert.equal(added.name,'Grouting');assert.equal(added.instructions,'Job-specific guidance');assert.equal(added.service_revision,2);
 });
});
test('deactivation removes future selection without changing current tasks; reactivation keeps ID',async()=>{
 await actor(admin,async()=>{service=await save(service.id,2,'Grouting','New standard',false);await denied(()=>rpc('fr_add_catalog_task',[job.id,service.id,'','',service.revision]),'22023');assert.equal((await db.query('select * from public.fr_tasks where job_id=$1',[job.id])).rows.length,2);});
 await actor(worker,async()=>{assert.equal((await db.query('select * from public.fr_service_catalog')).rows.length,0);assert.equal((await db.query('select * from public.fr_tasks where job_id=$1',[job.id])).rows.length,2);});
 await actor(admin,async()=>{const activated=await save(service.id,3,'Grouting','New standard',true);assert.equal(activated.id,service.id);assert.equal(activated.revision,4);service=activated;});
});
test('older clients cannot create arbitrary services through the legacy RPCs',async()=>{
 await actor(admin,async()=>{
  await denied(()=>rpc('fr_add_task',[job.id,'Room','Not in catalog','']),'22023');
  await denied(()=>rpc('fr_create_job',['No catalog','','repair',JSON.stringify([{name:'Not in catalog'}])]),'22023');
  const added=await rpc('fr_add_task',[job.id,'Room',' grouting ','Legacy override']);assert.equal(added.service_id,service.id);assert.equal(added.service_revision,4);
 });
});
