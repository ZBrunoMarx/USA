# Compartilhamento gratuito — Field Report

Decisão de Bruno: manter custo zero nesta etapa. O site continua no GitHub Pages e usa um projeto **Supabase Free** para autenticação, registros, fotos privadas e atualizações entre aparelhos. Não é necessário contratar o Render.

## O que está pronto e o que falta

O código da integração, esquema do banco, políticas de acesso, configuração pública e cadastro básico de obras estão preparados. Os testes locais cobrem as regras reais de PostgreSQL e o SDK do navegador com respostas de rede simuladas. **Ainda não existe um projeto Supabase conectado e validado neste aplicativo.**

A página permanece no modo local enquanto cloud-config.js estiver null. Publicar o código não cria a conta, não cria o projeto e não sincroniza registros por si só. O backend Node/SQLite continua disponível como alternativa; este caminho gratuito conecta o módulo /relatorio/ diretamente ao Supabase, sem executar aquele servidor.

## 1. Entrar e criar o projeto gratuito

1. Abra https://supabase.com/dashboard e entre usando GitHub.
2. Crie uma organização no plano **Free**. Não selecione Pro nem habilite complementos pagos.
3. Crie um projeto novo, por exemplo field-report, numa região dos EUA próxima à operação. Guarde a senha do banco no seu gerenciador; ela não deve ser enviada nesta conversa ou colocada no aplicativo.
4. Aguarde o projeto ficar disponível. Use um projeto novo para evitar políticas de outros aplicativos no mesmo banco/bucket.

## 2. Preparar login e permissões

1. Abra https://zbrunomarx.github.io/USA/relatorio/configurar.html e toque em Copiar código completo. O botão Abrir SQL Editor leva ao projeto informado por Bruno. Cole com Command + V no Mac e execute Run. O código corresponde ao arquivo 01-schema.sql. Ele cria tabelas fr_, um bucket privado field-report-photos e políticas para membros da companhia. O script pode ser repetido sem apagar os relatórios.
2. Em Authentication → Users → Add user, crie seu acesso com seu e-mail, uma senha exclusiva e confirmação do e-mail. Defina o tamanho mínimo de senha como 12 nas opções de autenticação. Não compartilhe senha com outros profissionais.
3. Em Authentication, mantenha o cadastro público desativado (Allow new users to sign up). O piloto usa usuários criados pelo administrador no painel, sem depender de envios de e-mail do provedor.
4. Abra https://zbrunomarx.github.io/USA/relatorio/acesso.html, informe seu e-mail, nome e companhia e copie o código do administrador. Ele é gerado a partir de 02-first-admin.sql e deve ser executado numa nova consulta do SQL Editor. Os valores do formulário ficam somente na página até serem copiados. Isso vincula o usuário já criado como administrador da companhia; ninguém recebe esse papel pelo formulário público.
5. Para adicionar outro profissional: crie o usuário dele em Authentication, ajuste os valores de 03-add-member.sql e execute. Use worker para colaboradores e admin somente para quem administra a companhia. O ID de autenticação é automático; o nome exibido vem desse cadastro.

As políticas permitem que membros ativos vejam as obras e fotos da própria companhia. Colaboradores editam os próprios relatórios; administradores podem editar os demais e cadastrar obras. O cliente não pode alterar papel, companhia ou habilitar seu próprio acesso.

## 3. Conectar o mesmo link do aplicativo

Em Connect/Project Settings → API Keys, copie apenas:

- **Project URL**, no formato https://PROJETO.supabase.co.
- **Publishable key**, começando com sb_publishable_. Essa chave é pública e foi feita para aplicativos de navegador; as políticas do banco/storage protegem os dados.

Nunca use chave Secret, service_role, senha do banco ou chave da OpenAI neste frontend. O configurador recusa esses formatos. As duas informações públicas podem ser fornecidas para configuração assistida, sem compartilhar credenciais privadas.

No workspace de desenvolvimento, o comando abaixo prepara somente o arquivo público; depois é necessário publicar os arquivos e conferir a versão no site:

    node scripts/configure-free-cloud.mjs --url https://PROJETO.supabase.co --publishable-key sb_publishable_VALOR_PUBLICO

A configuração é vinculada por padrão à origem https://zbrunomarx.github.io. O aplicativo Node local mantém sua própria autenticação. Para outro domínio HTTPS, use --site-origin no configurador.

O SDK vem incluído nos arquivos do site, com versão fixada no package-lock. O navegador não depende de um CDN para carregar a biblioteca. Para reconstruí-la: node scripts/build-supabase-browser.mjs.

## 4. Teste real obrigatório após conectar

1. Abra https://zbrunomarx.github.io/USA/relatorio/ e entre com seu e-mail/senha.
2. Como administrador, toque em Nova obra e informe nome/endereço. O endereço é opcional neste catálogo inicial.
3. Entre no segundo aparelho com o acesso do colaborador. Abra ou crie um serviço, escolha a obra, adicione uma foto e publique. O status precisa confirmar Salvo no servidor.
4. Abra o mesmo relatório no aparelho do dono. Confira a foto e altere o percentual no aparelho do colaborador; o outro deve atualizar. Realtime é usado quando conectado, com consulta de reconexão a cada 20 segundos.
5. Edite sem internet, troque de serviço e reconecte. Confirme o envio pendente antes de remover a cópia local.
6. Remova uma cópia já enviada do aparelho e abra novamente pela lista da companhia. A foto deve voltar do bucket privado.
7. Gere e assista ao MP4 no Safari; verifique o compartilhamento. Faça também uma cópia JSON de um serviço para testar restauração.

Dados locais anteriores não são enviados automaticamente ao fazer login. É preciso abrir o serviço, escolher a obra e publicar. O arquivo JSON continua permitindo recuperar o registro em outro aparelho/origem. Não apague dados locais ainda não enviados.

## Limites e operação sem mensalidade

Segundo a página oficial consultada em 24/10/2026, o plano Free oferece 500 MB de banco, 1 GB de arquivos, 5 GB de egress, 5 GB de cached egress, 50 mil usuários ativos mensais e até dois projetos ativos. Projetos gratuitos podem ser pausados após uma semana sem atividade; o administrador precisa retomá-los no painel. Limites/preços podem mudar: confira https://supabase.com/pricing antes de criar o projeto.

Não habilitamos upgrade ou cobrança automática. Ao chegar aos limites, manter o plano Free pode restringir a operação; não existe promessa de armazenamento ilimitado. As imagens são reduzidas no telefone, com até 4 por etapa e 3 MB por arquivo no bucket. O vídeo é gerado no próprio telefone e não ocupa o armazenamento do Supabase.

A remoção do aparelho e o logout eliminam cópias locais compartilhadas, preservando o que foi enviado. Arquivos MP4/JSON salvos em Fotos/Arquivos continuam sendo gerenciados pelo iPhone. No servidor, imagens removidas de um relatório continuam no bucket; a retenção e a limpeza central devem ser feitas com cuidado pelo administrador após backup. O plano gratuito não substitui backup exportado e testado pelo responsável.

Sair limpa a sessão local do SDK; tokens JWT já emitidos seguem a expiração do Supabase. Para cortar o acesso de um profissional, marque seu perfil fr_members como active=false: as políticas do banco e das fotos passam a negar o acesso mesmo com um token ainda válido. Cópias que ele já baixou para o aparelho não podem ser apagadas remotamente por este piloto.

## Escopo desta conexão

Este piloto compartilha catálogo básico de obras e relatórios com fotos/percentual informado, junto da geração de MP4. O aplicativo principal de custos, orçamento, escala e análise visual do backend Node não é migrado automaticamente. O percentual do relatório não modifica sozinho o percentual dos serviços do aplicativo principal.

A análise real com GPT é uma integração separada e pode gerar cobranças da API. Este caminho gratuito de armazenamento/vídeo não faz chamadas ao GPT.

## Evidências locais

- npm test: políticas reais PostgreSQL com PGlite, além da API Node existente; fixtures locais substituem os esquemas gerenciados de Auth/Storage.
- node scripts/test-free-cloud-browser.mjs: SDK Supabase real, HTTP/WebSocket explicitamente simulados; login, obra criada pelo admin, fotos privadas, duas sessões, Realtime, recuperação da sessão e logout.
- node scripts/test-report-workspace.mjs: biblioteca, migração e integração Node com SSE real local, incluindo reconexão e conflito.
- node scripts/test-daily-report.mjs: regressão MP4/H.264, cópia/restauração e exportação offline.

Esses testes não validam um projeto remoto, cotas reais, entrega de e-mails ou Safari físico com a nova conexão. A ativação só deve ser anunciada após o teste entre aparelhos no projeto do usuário.

## Atualização v3: obras, serviços previstos, equipe e companhia

Em um projeto já preparado com `01-schema.sql`, aplique `04-job-workspace.sql` uma vez no SQL Editor. É aditiva e pode ser repetida; não apaga obras, usuários, relatórios ou fotos. Não exige novo projeto nem novo plano. A página pública `https://zbrunomarx.github.io/USA/relatorio/atualizar.html` copia o código completo e abre uma consulta vazia do projeto existente. O código do aplicativo não tem credencial administrativa para aplicar migrações.

Após `Success. No rows returned`, recarregue o app. Obras passa a ser a entrada autenticada. Obras antigas sem tarefas continuam listadas; o admin adiciona as etapas e vincula os relatórios existentes conforme o escopo real. Não converter registros automaticamente em tarefas concluídas.

Admin: cria obras/serviços, gerencia Equipe, salva nome/logo em Companhia e entrega/reabre obras. Profissional: vê obras abertas e registra serviços previstos, sem acesso aos cadastros administrativos. Nome/ID/posição são independentes da permissão de acesso. Um profissional sem e-mail pode existir apenas como cadastro; com e-mail, precisa de conta Auth e endereço confirmado antes de vincular o acesso.

Para Criar meu acesso funcionar com confirmação de e-mail: deixe o signup por e-mail habilitado e, em Authentication → URL Configuration, configure Site URL e Redirect URLs para `https://zbrunomarx.github.io/USA/relatorio/`. Cadastros sem e-mail previamente aprovado pelo admin não recebem acesso a nenhuma companhia. Se preferir manter signup desabilitado, crie os usuários pelo painel Authentication → Users com o e-mail cadastrado em Equipe; não compartilhe senhas neste chat. O admin do app não recebe chaves de administração do Supabase.

Não reaplique somente o esquema v2 após atualizar para v3; em uma instalação nova, siga `01-schema.sql` → `04-job-workspace.sql` → habilitação do primeiro administrador. O modelo preserva compatibilidade com relatórios antigos sem etapa, mas relatórios vinculados usam o escritor novo com validação atômica de conclusão. O autor e o ciclo de execução são preservados em conflitos.
