import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { managedSchemas } from './helpers/supabase-fixture.mjs';
const db=new PGlite(),company=randomUUID(),outside=randomUUID(),admin=randomUUID(),worker=randomUUID(),other=randomUUID();
const migration=readFileSync(new URL('../supabase/migrations/20261116000000_company_video_settings.sql',import.meta.url),'utf8');
async function actor(id,fn,role='authenticated'){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);try{return await fn();}finally{await db.exec('reset role');}}
const save=(languages,revision=1,name='Company')=>db.query('select public.fr_save_company_settings($1,null,$2,$3) as result',[name,revision,JSON.stringify(languages)]).then(result=>result.rows[0].result);
before(async()=>{
 await db.exec(managedSchemas);await db.exec(readFileSync(new URL('../supabase/migrations/20261026000000_field_report_baseline.sql',import.meta.url),'utf8'));
 await db.query('insert into public.fr_companies(id,name) values($1,$2),($3,$4)',[company,'Company',outside,'Other']);
 for(const[id,tenant,role]of[[admin,company,'admin'],[worker,company,'worker'],[other,outside,'admin']]){await db.query('insert into auth.users values($1,$2,now())',[id,id+'@example.test']);await db.query('insert into public.fr_members(id,company_id,display_name,role) values($1,$2,$3,$4)',[id,tenant,'Test',role]);}
 await db.query("insert into public.fr_jobs(company_id,name) values($1,'Preserved job')",[company]);await db.exec(migration);
});
after(()=>db.close());
test('existing companies keep English output and all jobs survive the additive migration',async()=>{
 assert.deepEqual((await db.query('select video_languages from public.fr_companies where id=$1',[company])).rows[0].video_languages,['en']);assert.equal((await db.query('select name from public.fr_jobs')).rows[0].name,'Preserved job');
});
test('only an administrator changes shared output; authenticated workers read their company defaults',async()=>{
 await actor(null,()=>assert.rejects(()=>save(['pt']),e=>e.code==='42501'),'anon');await actor(worker,()=>assert.rejects(()=>save(['pt']),e=>e.code==='42501'));
 await actor(worker,async()=>{assert.equal((await db.query('select video_languages from public.fr_companies')).rows.length,1);await assert.rejects(()=>db.query("update public.fr_companies set video_languages=array['pt']"),e=>e.code==='42501');});
});
test('invalid or duplicate languages roll back branding and revision, preserving company isolation',async()=>{
 await actor(admin,async()=>{for(const value of [[],null,['fr'],['pt','pt'],['en',null],['en','pt','es','en'],{en:true},[7]])await assert.rejects(()=>save(value,1,'Must not change'),e=>e.code==='22023');});
 const before=(await db.query('select name,revision from public.fr_companies where id=$1',[company])).rows[0];assert.equal(before.name,'Company');assert.equal(before.revision,1);
 const settings=await actor(other,()=>save(['es'],1,'Other company'));assert.equal(settings.id,outside);
});
test('settings update is atomic and revision guarded; legacy branding updates preserve the video policy',async()=>{
 const result=await actor(admin,()=>save(['pt','es']));assert.deepEqual(result.video_languages,['pt','es']);assert.equal(result.revision,2);
 await actor(admin,()=>assert.rejects(()=>save(['en'],1),e=>e.code==='40001'));
 await actor(worker,async()=>{const row=(await db.query('select * from public.fr_companies')).rows[0];assert.equal(row.id,company);assert.deepEqual(row.video_languages,['pt','es']);});
 await actor(admin,async()=>{const row=(await db.query("select public.fr_save_company('Brand updated',null,2) as result")).rows[0].result;assert.deepEqual(row.video_languages,['pt','es']);assert.equal(row.revision,3);});
});
