import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { managedSchemas } from './helpers/supabase-fixture.mjs';
import { databaseTarget, redact, providerCertificatePath } from '../scripts/deploy-database.mjs';
import { checkMigrations } from '../scripts/check-migrations.mjs';
const sql = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const baseline = sql('supabase/migrations/20261026000000_field_report_baseline.sql');
const v2 = sql('deploy/supabase/01-schema.sql'), v3 = sql('deploy/supabase/04-job-workspace.sql');
const company='11111111-1111-4111-8111-111111111111', owner='22222222-2222-4222-8222-222222222222';
for (const version of ['empty','v2','v3']) test('migration baseline adopts '+version+' database without losing existing records',async()=>{
 const db=new PGlite();
 try {
  await db.exec(managedSchemas);
  if(version!=='empty'){
   await db.exec(v2);
   await db.query('insert into public.fr_companies values($1,$2)',[company,'Existing company']);
   await db.query('insert into auth.users values($1,$2,now())',[owner,'owner@example.test']);
   await db.query("insert into public.fr_members(id,company_id,display_name,role) values($1,$2,'Owner','admin')",[owner,company]);
   await db.query("insert into public.fr_jobs(company_id,name) values($1,'Existing job')",[company]);
   await db.query("insert into storage.objects(bucket_id,name) values('field-report-photos','retained-object')");
   if(version==='v3'){
    await db.exec(v3);
    await db.query("insert into public.fr_tasks(company_id,job_id,name,percent) select $1,id,'Existing task',60 from public.fr_jobs",[company]);
    await db.query("update public.fr_staff set position='installer',code='ORIGINAL-ID',email='owner@example.test' where user_id=$1",[owner]);
   }
  }
  await db.transaction(tx=>tx.exec(baseline));
  assert.equal((await db.query("select count(*)::int as n from information_schema.tables where table_schema='public' and table_name in ('fr_jobs','fr_reports','fr_tasks','fr_staff')")).rows[0].n,4);
  if(version!=='empty'){
   assert.equal((await db.query('select name from public.fr_companies')).rows[0].name,'Existing company');
   assert.equal((await db.query('select count(*)::int as n from public.fr_jobs')).rows[0].n,1);
   assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n,1);
   if(version==='v3'){
    assert.equal((await db.query('select percent from public.fr_tasks')).rows[0].percent,60);
    assert.equal((await db.query('select code from public.fr_staff')).rows[0].code,'ORIGINAL-ID');
   }
  }
  await db.exec('set role anon');await assert.rejects(()=>db.query('select * from public.fr_tasks'),e=>e.code==='42501');await db.exec('reset role');
  const privileges=(await db.query("select has_function_privilege('authenticated','field_report_private.save_report_v2(uuid,uuid,integer,text,jsonb,jsonb,jsonb)','execute') as allowed")).rows[0];assert.equal(privileges.allowed,false);
 }finally{await db.close();}
});
test('deployment only targets the intended project, enforces TLS and redacts credentials',()=>{
 const ref='rzmhubdajnblxgwcoolt',raw='postgresql://postgres.'+ref+':Test%40password@aws-0-us-east-1.pooler.supabase.com:5432/postgres';
 const target = new URL(databaseTarget(raw,ref));
 assert.equal(target.searchParams.get('sslmode'),'verify-full');
 assert.equal(target.searchParams.get('sslrootcert'),providerCertificatePath);
 const certificate = new X509Certificate(readFileSync(target.searchParams.get('sslrootcert')));
 assert.equal(certificate.ca,true); assert.equal(certificate.verify(certificate.publicKey),true);
 assert.match(certificate.subject,/Supabase Root 2021 CA/);
 assert.ok(Date.parse(certificate.validTo)>Date.now());
 assert.equal(new URL(databaseTarget(raw+'?sslmode=no-verify&sslrootcert=untrusted',ref)).searchParams.get('sslrootcert'),providerCertificatePath);
 assert.throws(()=>databaseTarget(raw,'aaaaaaaaaaaaaaaaaaaa'));
 assert.throws(()=>databaseTarget(raw.replace(':5432',':6543'),ref));
 assert.throws(()=>databaseTarget('postgresql://postgres:pass@unknown.example/postgres',ref));
 assert.throws(()=>databaseTarget('postgresql://postgres:pass@127.0.0.1/postgres',ref));
 assert.match(databaseTarget('postgresql://postgres:pass@127.0.0.1/postgres',ref,true),/127\.0\.0\.1/);
 assert.equal(redact(raw+' Test@password Test%40password',raw),'[redacted] [redacted] [redacted]');
});
test('migration validation blocks edits/deletions and duplicate versions, permits new files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'migration-check-')),url=pathToFileURL(dir+'/').href;
 try{
  writeFileSync(join(dir,'20261026000000_baseline.sql'),'select 1;');
  assert.equal(checkMigrations(url,'A\tsupabase/migrations/20261026000000_baseline.sql').length,1);
  for(const status of ['M','D'])assert.throws(()=>checkMigrations(url,status+'\tsupabase/migrations/20261026000000_baseline.sql'));
  writeFileSync(join(dir,'20261026000000_duplicate.sql'),'select 2;');assert.throws(()=>checkMigrations(url));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
