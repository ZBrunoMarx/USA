import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// These two values are public application configuration, never server secrets.
export function validateConfig(url, publishableKey, siteOrigin = 'https://zbrunomarx.github.io') {
  let parsed; try { parsed = new URL(url); } catch { throw new Error('Informe a Project URL HTTPS do Supabase.'); }
  if (parsed.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) || parsed.origin !== url) throw new Error('Use somente a origem HTTPS do projeto Supabase, sem barra final ou caminho.');
  if (typeof publishableKey !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error('Use a Publishable key do Supabase (sb_publishable_...). Chaves secret, service_role e OpenAI são recusadas.');
  let site; try { site = new URL(siteOrigin); } catch { throw new Error('Informe a origem HTTPS do site publicado.'); }
  if (site.protocol !== 'https:' || site.origin !== siteOrigin) throw new Error('Use somente a origem HTTPS do site publicado.');
  return { provider: 'supabase', url: parsed.origin, publishableKey, siteOrigin: site.origin };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const get = name => args[args.indexOf(name) + 1];
  if (!args.includes('--url') || !args.includes('--publishable-key')) { console.error('Uso: node scripts/configure-free-cloud.mjs --url https://PROJETO.supabase.co --publishable-key sb_publishable_VALOR_PUBLICO'); process.exitCode = 1; }
  else {
    try {
      const config = validateConfig(get('--url'), get('--publishable-key'), args.includes('--site-origin') ? get('--site-origin') : undefined);
      writeFileSync(new URL('../public/relatorio/cloud-config.js', import.meta.url), "'use strict';\n// Public Supabase configuration. Access is protected by authentication and database/storage policies.\nglobalThis.FIELD_REPORT_CLOUD = " + JSON.stringify(config, null, 2) + ';\n');
      console.log('Configuração pública preparada. Não publicou nem validou um projeto remoto.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
