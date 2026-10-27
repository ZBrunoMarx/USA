# Field Report / Skytile

Sistema de obras e registros diários, com fotos, andamento por serviço, equipe e vídeo MP4 no próprio telefone.

Aplicativo gratuito publicado: https://zbrunomarx.github.io/USA/relatorio/ . O módulo usa GitHub Pages + Supabase Free. O backend Node de gestão, finanças e análise visual também está versionado para desenvolvimento local; esse backend não é executado pelo GitHub Pages.

## Desenvolvimento

```sh
npm ci
npm test
npm start
```

Node.js 24 é usado no CI. `npm start` abre o ambiente Node local; o frontend público de relatórios usa a configuração Supabase somente na origem configurada em public/relatorio/cloud-config.js. Chaves privadas pertencem ao ambiente seguro, nunca ao frontend ou Git.

## Publicação

`main → testes → migrações pendentes → site`. A configuração única, os links de secrets e as instruções de operação ficam em [deploy/CI-CD.md](deploy/CI-CD.md).

- Frontend: public/relatorio/.
- Banco: supabase/migrations/; cada nova alteração tem um novo timestamp, sem editar versões publicadas.
- Workflow: .github/workflows/deploy.yml.
- Testes: tests/ e scripts/test-*.mjs.
- Artefato público: `npm run build:pages`, em .local/pages; somente o módulo estático aprovado.
- SQL anterior/manual: deploy/supabase/, mantido como referência histórica.

A primeira migração automatizada adota o banco existente sem recriar contas, obras ou fotos. Secrets de produção são usados apenas no job de deploy; PRs testam sem esses acessos. Enquanto a configuração inicial não estiver concluída, o workflow registra o deploy pendente e preserva a publicação atual.

O percentual é informado pela equipe, sem certificação técnica por fotos. O MP4 é produzido pelo navegador, sem dependência de API de IA. A análise GPT do backend é uma integração separada e exige uma chave privada e conta de API configuradas.
