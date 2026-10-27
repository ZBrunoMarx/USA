import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'Skytile.html'), 'utf8');
if (!html.includes('window.SKYTILE_PREVIEW_SEED=') || /<script[^>]+src=/i.test(html)) {
  throw new Error('Gere a prévia independente com npm run preview antes de preparar o site.');
}
const output = join(root, '.local/site');
mkdirSync(output, { recursive: true });
const reportLink = '<nav aria-label="Relatório do dia" style="padding:14px 20px;background:#e7f5ed;border-bottom:1px solid #bedcca;font:600 14px -apple-system,sans-serif;text-align:center"><a href="./relatorio/" style="color:#194d3c">Novo: relatório do dia em vídeo MP4 · Abrir</a></nav>';
writeFileSync(join(output, 'index.html'), html.replace('<body>', '<body>' + reportLink));
writeFileSync(join(output, '.nojekyll'), '');
mkdirSync(join(output, 'relatorio'), { recursive: true });
for (const name of ['index.html', 'workspace.js', 'atualizar.html', 'report.js', 'report.css', 'library.js', 'sync.js', 'cloud-config.js', 'supabase-vendor.js', 'supabase-sync.js', 'configurar.html', 'acesso.html', 'admin-setup.js', 'setup-copy.js', 'sw.js']) copyFileSync(join(root, 'public/relatorio', name), join(output, 'relatorio', name));
writeFileSync(join(output, 'LEIAME.txt'), `Skytile — demonstração independente

Publique index.html em uma hospedagem estática com HTTPS para obter um link de teste.
O pacote não precisa de Node.js ou de uma API no servidor da hospedagem.
Contém as obras fictícias de demonstração; a entrevista não foi incluída no site.

Os cadastros, fotos e relatos ficam no navegador de quem acessa o link.
Não existe sincronização entre o navegador de Bruno e o de Flavio.
Os perfis são simulados. O assistente faz consultas locais; não usa um modelo de IA.
A análise visual de IA fica desativada neste HTML; ela exige a versão com servidor e chave.
O microfone e a câmera dependem do navegador e de sua permissão.
Apagar os dados do site no navegador apaga os registros desse navegador.

Para uso compartilhado com dados reais, será necessário hospedar o servidor,
adicionar autenticação e usar armazenamento compartilhado.
`);
console.log('Site pronto em .local/site/index.html. Este comando não publica nem cria uma URL.');
