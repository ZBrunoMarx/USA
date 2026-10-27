// Execute actual Postgres RLS/RPC logic locally. Supabase Auth/Storage schemas
// below are fixtures, not a live provider; physical devices and hosted setup are separate checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const schema = readFileSync(new URL('../deploy/supabase/01-schema.sql', import.meta.url), 'utf8');
const company = randomUUID(), outside = randomUUID(), admin = randomUUID(), worker = randomUUID(), colleague = randomUUID(), outsider = randomUUID(), unlisted = randomUUID();
const job = randomUUID(), otherJob = randomUUID(), report = randomUUID();
const fields = { title: 'Bathroom grout', date: '2026-10-24', author: 'Bruno', scope: 'Grouting', language: 'en', percent: '80', company: '', completed: '', remaining: 'Doorway' };
const emptyPhotos = { before: [], after: [], pending: [] };
async function actor(id, action, role = 'authenticated') {
  await db.exec('set role ' + role);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  try { return await action(); } finally { await db.exec('reset role'); }
}
async function denied(action, code = '42501') { await assert.rejects(action, error => error.code === code, 'expected SQLSTATE ' + code); }
async function save(id = report, expected = 0, options = {}) {
  return (await db.query('select public.fr_save_report($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as saved', [id, options.job || job, expected, options.status || 'active', JSON.stringify(options.fields || fields), JSON.stringify(options.photos || emptyPhotos), options.logo ? JSON.stringify(options.logo) : null])).rows[0].saved;
}
before(async () => {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon,authenticated;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,unique(bucket_id,name));
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated,anon;`);
  await db.exec(schema);
  await db.query('insert into public.fr_companies values($1,$2),($3,$4)', [company, 'Example company', outside, 'Other company']);
  for (const [id, tenant, role] of [[admin, company, 'admin'], [worker, company, 'worker'], [colleague, company, 'worker'], [outsider, outside, 'admin'], [unlisted, null, null]]) {
    await db.query('insert into auth.users values($1,$2)', [id, id + '@example.test']);
    if (tenant) await db.query('insert into public.fr_members(id,company_id,display_name,role) values($1,$2,$3,$4)', [id, tenant, id === worker ? 'Bruno' : 'Test person', role]);
  }
  await db.query('insert into public.fr_jobs(id,company_id,name) values($1,$2,$3),($4,$5,$6)', [job, company, 'Bathroom', otherJob, outside, 'Outside job']);
});
after(() => db.close());

test('anonymous visitors cannot read private records or invoke the save RPC', async () => {
  await actor(null, async () => {
    await denied(() => db.query('select * from public.fr_members'));
    await denied(() => save());
    assert.deepEqual((await db.query('select * from storage.objects')).rows, []);
  }, 'anon');
});
test('members see only their company; unaffiliated users cannot create an organization or elevate themselves', async () => {
  await actor(worker, async () => {
    assert.equal((await db.query('select * from public.fr_jobs')).rows.length, 1);
    assert.equal((await db.query('select * from public.fr_members')).rows.length, 3);
    await denied(() => db.query("update public.fr_members set role='admin' where id=$1", [worker]));
    await denied(() => db.query('insert into public.fr_companies(name) values($1)', ['Forged company']));
  });
  await actor(unlisted, async () => { assert.deepEqual((await db.query('select * from public.fr_jobs')).rows, []); await denied(() => save()); });
});
test('only an administrator can create a job, and cannot create it in another company', async () => {
  await actor(worker, async () => { await denied(() => db.query('insert into public.fr_jobs(company_id,name) values($1,$2)', [company, 'Forbidden'])); });
  await actor(admin, async () => {
    await denied(() => db.query('insert into public.fr_jobs(company_id,name) values($1,$2)', [outside, 'Forbidden outside']));
    assert.equal((await db.query('insert into public.fr_jobs(company_id,name) values($1,$2) returning name', [company, 'Kitchen'])).rows[0].name, 'Kitchen');
  });
});
test('save RPC records the authenticated owner, blocks direct writes and prevents silent stale overwrites', async () => {
  await actor(worker, async () => {
    const created = await save(); assert.equal(created.owner_id, worker); assert.equal(created.revision, 1);
    await denied(() => db.query("update public.fr_reports set revision=99 where id=$1", [report]));
    assert.equal((await save(report, 1, { fields: { ...fields, percent: '90' } })).revision, 2);
    await denied(() => save(report, 1, { fields: { ...fields, percent: '100' } }), '40001');
  });
  await actor(colleague, async () => { assert.equal((await db.query('select * from public.fr_reports')).rows[0].fields.percent, '90'); await denied(() => save(report, 2)); });
  await actor(outsider, async () => { assert.deepEqual((await db.query('select * from public.fr_reports')).rows, []); await denied(() => save(report, 2, { job: otherJob })); });
});
test('invalid fields, job reassignment, nonexistent images and invalid dates are rejected', async () => {
  await actor(worker, async () => {
    for (const invalid of [{ percent: '101' }, { date: '2026-02-31' }, { title: '' }, { remaining: 'x'.repeat(221) }]) await denied(() => save(report, 2, { fields: { ...fields, ...invalid } }), '22023');
    await denied(() => save(report, 2, { job: otherJob }), '22023');
    await denied(() => save(report, 2, { photos: { ...emptyPhotos, before: [{ id: randomUUID(), name: 'missing.jpg', imageId: company + '/' + worker + '/' + 'a'.repeat(64) + '.jpg' }] } }), '22023');
  });
});
test('photo policies isolate companies, restrict uploads to the uploader and deny destructive overwrites', async () => {
  const ownPath = company + '/' + worker + '/' + 'a'.repeat(64) + '.jpg';
  const foreignPath = outside + '/' + outsider + '/' + 'b'.repeat(64) + '.jpg';
  await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['field-report-photos', foreignPath, outsider]);
  await actor(worker, async () => {
    await db.query('insert into storage.objects(bucket_id,name,owner_id) values($1,$2,$3)', ['field-report-photos', ownPath, worker]);
    await denied(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['field-report-photos', company + '/' + colleague + '/' + 'b'.repeat(64) + '.jpg']));
    await denied(() => db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['field-report-photos', outside + '/' + worker + '/' + 'c'.repeat(64) + '.jpg']));
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
    assert.equal((await db.query('delete from storage.objects returning name')).rows.length, 0);
  });
  const photo = { id: randomUUID(), name: 'before.jpg', imageId: ownPath };
  await actor(worker, async () => { assert.equal((await save(report, 2, { photos: { ...emptyPhotos, before: [photo] } })).revision, 3); });
  await actor(colleague, async () => {
    assert.equal((await db.query('select * from storage.objects')).rows.length, 1);
    await denied(() => save(randomUUID(), 0, { photos: { ...emptyPhotos, before: [photo] } }));
  });
  assert.equal((await db.query("select public from storage.buckets where id='field-report-photos'")).rows[0].public, false);
});
test('administrator edits retain the creator; archiving retains photos and does not force 100 percent', async () => {
  await actor(admin, async () => {
    const current = (await db.query('select * from public.fr_reports where id=$1', [report])).rows[0];
    const result = await save(report, 3, { status: 'archived', photos: current.photos });
    assert.equal(result.owner_id, worker); assert.equal(result.updated_by, admin); assert.equal(result.photos.before.length, 1); assert.equal(result.fields.percent, '80');
  });
});
test('deactivating a member removes database, RPC and storage access even with a previously issued JWT', async () => {
  await db.query('update public.fr_members set active=false where id=$1', [colleague]);
  await actor(colleague, async () => {
    assert.deepEqual((await db.query('select * from public.fr_reports')).rows, []);
    assert.deepEqual((await db.query('select * from storage.objects')).rows, []);
    await denied(() => save(randomUUID()));
  });
});
test('schema setup can be rerun without clearing reports or reopening anonymous access', async () => {
  await db.exec(schema);
  assert.equal((await db.query('select count(*)::integer as count from public.fr_reports')).rows[0].count, 1);
  await actor(null, async () => { await denied(() => db.query('select * from public.fr_reports')); }, 'anon');
});
