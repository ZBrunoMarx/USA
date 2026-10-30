# Publicação contínua do Field Report

O fluxo de produção é `main → validação → migrações pendentes → GitHub Pages`. O endereço do app permanece https://zbrunomarx.github.io/USA/relatorio/. O telefone continua usando o navegador; atualizações não exigem outro download.

## Configuração única do proprietário

1. No Supabase, abra **Connect → Session pooler**. Use a URI PostgreSQL na porta **5432**, banco `postgres`, usuário `postgres.rzmhubdajnblxgwcoolt`. O pooler permite conexão IPv4 pelos runners gratuitos do GitHub. Substitua o marcador de senha por sua senha do banco, com os caracteres especiais codificados para URI. A senha do banco não é a senha do login no aplicativo.
2. No GitHub, abra **Settings → Secrets and variables → Actions → New repository secret**: https://github.com/ZBrunoMarx/USA/settings/secrets/actions/new . Nome: **SUPABASE_DB_URL**. Valor: a URI completa. Alternativamente, guarde o mesmo segredo no environment **production**. Nunca cole a URI no chat, no código ou em um arquivo versionado. O public/relatorio/cloud-config.js continua contendo somente a Publishable key pública.
3. Em **Settings → Pages → Build and deployment → Source**, selecione **GitHub Actions**: https://github.com/ZBrunoMarx/USA/settings/pages . O workflow publica um artefato estático; o banco é atualizado antes da publicação. Isso substitui a publicação antiga pela branch skytile-demo.
4. Defina **main** como Default branch em Settings → General → Default branch: https://github.com/ZBrunoMarx/USA/settings . O repositório anterior usava skytile-demo como padrão. Em **Actions → Validate and deploy Field Report → Run workflow**, selecione main e execute a primeira publicação.

Sem o segredo, a validação pode rodar, mas o workflow registra **Deploy pendente** e não altera o banco ou site. Enquanto a configuração não for feita, a publicação existente permanece na branch skytile-demo. A conexão limita-se ao projeto esperado e exige validação TLS do certificado; a chave administrativa do Supabase não vai para o navegador. Este fluxo não requer um token pessoal da API do Supabase.

## Trabalho cotidiano

- Desenvolver em uma branch e abrir PR para main. PR executa testes sem secrets e sem alterar produção.
- Para mudanças no banco, criar um arquivo com timestamp novo em `supabase/migrations/`. Não editar nem apagar migrações publicadas. O CI verifica essa regra com o histórico Git.
- Fazer merge em main. O GitHub instala dependências fixadas no lockfile, verifica regras/API/RLS, roda o CLI real em PostgreSQL descartável e testa o fluxo de obras em dois navegadores com SDK real e transportes externos simulados.
- Só depois das verificações, o job production executa `supabase db push --db-url ... --skip-vault --yes`. O CLI consulta seu histórico e aplica apenas arquivos pendentes. Nenhum seed, bootstrap de conta, `db reset`, repair ou alteração no Vault faz parte do deploy.
- Apenas se as migrações terminarem com sucesso, GitHub Pages recebe o artefato do mesmo commit. A concorrência é serializada e um deploy em execução não é cancelado por outro push.
- Consultar a execução no Actions para saber o commit publicado e o resultado. Falha de testes/migração impede a publicação. Uma falha do Pages posterior à migração pode ser reexecutada; o CLI não reaplica a versão já registrada.

## Adoção do projeto que já existe

A migração `20261026000000_field_report_baseline.sql` reúne o esquema v2 e a evolução v3. É compatível com banco vazio, v2 manual e v3 manual. Foi testada preservando registros existentes e as políticas de acesso. O primeiro deploy registra a versão sem exigir recriar projeto, usuários, obras ou fotos. Os arquivos antigos de deploy/supabase são referência histórica; novas alterações pertencem às migrações com novo timestamp.

O código-fonte e o artefato são separados: main contém fontes/testes; `.local/pages` contém somente arquivos estáticos aprovados. O artefato nunca inclui banco, uploads, .env, API privada ou entrevistas do produto. A aplicação Node de finanças/IA permanece disponível para desenvolvimento local; este workflow publica somente o módulo gratuito com Supabase, sem contratar hospedagem para esse backend.

## Comandos de desenvolvimento

```sh
git clone --branch main https://github.com/ZBrunoMarx/USA.git
cd USA
npm ci
npm test
npm run check:migrations
npm run build:pages
```

`npm run db:plan` exibe migrações pendentes e `npm run db:deploy` aplica; ambos exigem SUPABASE_DB_URL no ambiente seguro e SUPABASE_PROJECT_REF=rzmhubdajnblxgwcoolt. Não é necessário usá-los no Mac do usuário para operar o aplicativo. A rotina fica no Actions.

Reverter a interface pode usar um commit de correção/revert. Mudanças do banco são corrigidas por **nova migração**, sem apagar histórico ou restaurar automaticamente dados antigos. Remoções de colunas/dados exigem planejamento separado, depois de versões compatíveis da aplicação; não fazem parte desta adoção.

Referências: https://supabase.com/docs/guides/deployment/managing-environments e https://supabase.com/docs/reference/cli/supabase-db-push .

## TLS do banco

O deploy usa o certificado público oficial Supabase Root 2021 CA, versionado em deploy/certs, por meio de `sslrootcert` e `PGSSLROOTCERT`. A validação continua em `verify-full`, incluindo nome do servidor. Isso permite validar a cadeia do pooler sem desativar TLS ou pedir ao usuário que edite novamente o segredo. O certificado é público e não contém senha nem chave privada.
