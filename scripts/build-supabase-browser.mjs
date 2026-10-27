import { build } from 'esbuild';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../node_modules/@supabase/supabase-js/package.json', import.meta.url)));
const license = readFileSync(new URL('../node_modules/@supabase/supabase-js/LICENSE', import.meta.url), 'utf8');
const output = fileURLToPath(new URL('../public/relatorio/supabase-vendor.js', import.meta.url));
const result = await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: root }, bundle: true, format: 'iife', globalName: 'FieldReportSupabase', platform: 'browser', target: ['safari15.4'], minify: true, legalComments: 'inline', metafile: true, write: false, banner: { js: '/* @supabase/supabase-js ' + pkg.version + '\n' + license + '*/' }, outfile: output });
const packages = new Set(Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/')).map(path => path.split('/').slice(0, path.split('/')[1].startsWith('@') ? 3 : 2).join('/')));
const notices = [];
for (const path of packages) {
  if (path === 'node_modules/@supabase/supabase-js') continue;
  const file = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-MIT.txt', 'license'].map(name => join(root, path, name)).find(name => existsSync(name));
  if (!file) throw new Error('Confira o aviso de licença do pacote: ' + path);
  notices.push('/* Bundled dependency: ' + path + '\n' + readFileSync(file, 'utf8').replaceAll('*/', '* /') + '\n*/');
}
writeFileSync(output, notices.join('\n') + '\n' + result.outputFiles[0].text);
console.log('Browser SDK built from pinned dependencies; no CDN or credentials.');
