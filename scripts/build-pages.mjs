// GitHub Pages artifact only: no backend, databases, photos, keys or product interviews.
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
const output = new URL('../.local/pages/',import.meta.url);
rmSync(output,{recursive:true,force:true});mkdirSync(new URL('relatorio/',output),{recursive:true});
const files = ['index.html','workspace.js','atualizar.html','report.js','report.css','library.js','sync.js','cloud-config.js','supabase-vendor.js','supabase-sync.js','configurar.html','acesso.html','admin-setup.js','setup-copy.js','sw.js'];
for (const name of files) copyFileSync(new URL('../public/relatorio/'+name,import.meta.url),new URL('relatorio/'+name,output));
writeFileSync(new URL('.nojekyll',output),'');
writeFileSync(new URL('index.html',output),'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=./relatorio/"><title>Field Report</title></head><body><a href="./relatorio/">Abrir obras e relatórios</a></body></html>');
console.log('Artefato estático pronto em .local/pages; endereço /USA/relatorio/ preservado.');
