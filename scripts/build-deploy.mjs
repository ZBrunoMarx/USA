// Allowlist only application source/configuration, never the workspace's data.
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
mkdirSync(join(root,'.local'),{recursive:true});
const dir=mkdtempSync(join(root,'.local/deploy-'));
try {
  for (const name of ['package.json','package-lock.json','server.mjs','auth.mjs','vision.mjs','reports.mjs','Dockerfile','.dockerignore','.gitignore']) copyFileSync(join(root,name),join(dir,name));
  mkdirSync(join(dir,'public'));
  for (const entry of readdirSync(join(root,'public'), { recursive: true, withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Revise o link no diretório público: '+entry.name);
    if (!entry.isFile()) continue;
    if (!/\.(js|css|html|svg|webmanifest)$/.test(entry.name)) throw new Error('Revise o novo arquivo público antes de incluí-lo na publicação: '+entry.name);
    const source = join(entry.parentPath, entry.name), targetFile = join(dir, 'public', relative(join(root, 'public'), source));
    mkdirSync(join(targetFile, '..'), { recursive: true });
    copyFileSync(source, targetFile);
  }
  mkdirSync(join(dir,'deploy'));copyFileSync(join(root,'deploy/LEIAME.md'),join(dir,'deploy/LEIAME.md'));
  copyFileSync(join(root,'deploy/LEIAME.md'),join(dir,'README.md'));
  mkdirSync(join(dir,'deploy/supabase'),{recursive:true});
  for (const name of ['01-schema.sql','02-first-admin.sql','03-add-member.sql','04-job-workspace.sql','LEIAME.md']) copyFileSync(join(root,'deploy/supabase',name),join(dir,'deploy/supabase',name));
  mkdirSync(join(dir,'supabase/migrations'),{recursive:true});
  copyFileSync(join(root,'supabase/config.toml'),join(dir,'supabase/config.toml'));
  for (const name of readdirSync(join(root,'supabase/migrations'))) {
    if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(name)) throw new Error('Migração inválida: '+name);
    copyFileSync(join(root,'supabase/migrations',name),join(dir,'supabase/migrations',name));
  }
  for (const folder of ['scripts','tests']) {
    for (const entry of readdirSync(join(root,folder),{recursive:true,withFileTypes:true})) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.mjs')) throw new Error('Revise o arquivo de desenvolvimento: '+entry.name);
      const relativeFile=relative(join(root,folder),join(entry.parentPath,entry.name));
      // Paths here come only from our own directory traversal.
      const targetFile=join(dir,folder,relativeFile);
      mkdirSync(join(targetFile,'..'),{recursive:true});copyFileSync(join(entry.parentPath,entry.name),targetFile);
    }
  }
  const pkg=JSON.parse(readFileSync(join(dir,'package.json')));
  if (!pkg.dependencies.undici) throw new Error('Dependência de runtime ausente.');
  const target=join(root,'.local/publication');rmSync(target,{recursive:true,force:true});renameSync(dir,target);
  console.log('Pacote preparado em .local/publication. Nenhum serviço foi criado ou publicado.');
} finally { rmSync(dir,{recursive:true,force:true}); }
