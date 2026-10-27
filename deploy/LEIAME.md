# Publicar a Skytile para testar no iPhone

O pacote contém a versão com servidor, login individual, fotos compartilhadas e SQLite. Não contém fotos, registros reais, senhas reais, chave da OpenAI ou a entrevista de Flavio. Os testes incluídos usam somente credenciais fictícias. A publicação começa com os exemplos DEMO e um único acesso habilitado: `thiago`. Copiar o banco atual é uma migração separada, não executada por este pacote.

## Situação

Existe uma demonstração estática em https://skytile-demo.onrender.com, publicada anteriormente pelo usuário. Ela mantém dados por navegador, não executa a API de análise e não equivale ao servidor com login descrito aqui. Não foi publicada uma URL pública deste backend. A chave configurada no ambiente de desenvolvimento não é transferida automaticamente para o Render.

A versão 0.3.2 permite registros de um dia parcial, distingue primeira observação de comparação e preserva o registro quando a análise falha. O teste real de análise ainda depende de autenticação aceita no endpoint Responses. Este pacote não cria nem contrata serviço ou disco no Render.

## Caminho sugerido: Render com serviço Node e disco persistente

1. Use a conta do Render já criada e a conexão com o GitHub. Crie um serviço separado da demonstração estática.
2. Coloque os arquivos deste pacote num repositório **privado** de sua conta. O pacote não inclui `.local`, `.git`, `node_modules`, backups ou fotos. Nenhum conteúdo foi enviado ao GitHub por esta etapa.
3. No Render, crie um **Web Service** a partir desse repositório, com runtime Node. Use `npm ci --omit=dev --no-audit --no-fund` no build e `npm start` para iniciar. Use Node 24.19.0 via `NODE_VERSION`.
4. Antes de criar o serviço, confira o preço atual do plano e do disco. **Armazenamento persistente exige uma opção paga nesse caminho. Não foi contratado nenhum plano.** Um serviço com disco efêmero pode perder banco, senhas e fotos em reinícios ou novas publicações; não use essa opção para o teste com registros que pretende guardar.
5. Monte um disco persistente em `/var/data/skytile`, usado por uma única instância. Configure as variáveis abaixo no painel seguro do serviço.
6. Use `/api/health` como health check. Depois de receber o domínio HTTPS do serviço, configure `SKYTILE_PUBLIC_ORIGIN` com essa origem exata, sem barra final, e reinicie a aplicação. Se o domínio ainda não existir, a primeira inicialização falhará explicitamente até essa variável ser preenchida.

| Variável | Valor |
| --- | --- |
| `NODE_VERSION` | `24.19.0` |
| `NODE_ENV` | `production` |
| `SKYTILE_AUTH` | `required` |
| `SKYTILE_HOST` | `0.0.0.0` |
| `SKYTILE_DATA_DIR` | `/var/data/skytile` |
| `SKYTILE_PUBLIC_ORIGIN` | A origem HTTPS fornecida pela hospedagem |
| `SKYTILE_BOOTSTRAP_PASSWORD` | Crie uma senha exclusiva de 12 a 128 caracteres no painel seguro |

O provedor define `PORT`; não é necessário trocar a porta manualmente. Não envie senhas nesta conversa. A senha inicial é usada somente quando ainda não existem credenciais no banco. Depois do primeiro acesso, ela pode ser removida da configuração da hospedagem. Alterá-la no painel não redefine uma senha já salva; use o botão **Acesso** dentro da aplicação para isso.

Para ativar a IA futuramente, configure `SKYTILE_AI_KEY` no painel seguro da mesma hospedagem e, opcionalmente, `SKYTILE_VISION_MODEL=gpt-4.1-mini`. Os pedidos saem para `https://api.openai.com/v1/responses`. É necessário ter conta e créditos próprios da API. O aplicativo funciona sem isso.

## Primeiro acesso

1. Abra a URL HTTPS no Safari e entre com ID `thiago` e a senha inicial.
2. Acesse **Equipe → Acesso** ao lado de cada profissional. Defina a senha de Flavio e dos colaboradores que participarão do teste. Entregue o ID e a senha diretamente à pessoa.
3. Cada pessoa entra pelo próprio ID e senha. Só os administradores criam obras, veem os custos completos e habilitam acessos. Definir uma nova senha encerra as sessões anteriores dessa pessoa.
4. No iPhone: **obra → ambiente → Registrar avanço → Tirar foto → Salvar**. Abra a mesma obra em outro aparelho com login para conferir que a foto foi compartilhada.
5. Feche e abra o Safari, reinicie o serviço e confira se o registro e a foto continuam acessíveis. Encerre a sessão e confirme que a foto não abre mais sem login. Use **Compartilhar → Adicionar à Tela de Início**, se desejar.

## Operação deste piloto

As sessões duram até sete dias e são revogadas no logout ou redefinição de senha. O navegador recebe cookie HttpOnly, Secure e SameSite=Strict em HTTPS. Credenciais são armazenadas com salt e scrypt; senhas não são enviadas ao frontend nem guardadas em texto simples. O servidor ignora o cabeçalho de perfil quando o login está ativado. Há limite de tentativas de login e validação da origem de alterações. Esses controles foram testados localmente; o ambiente público ainda precisa da conferência após implantação.

Faça backup regular do volume inteiro, incluindo SQLite, WAL e uploads, com a aplicação parada, e teste a restauração num volume separado. Nunca apague o volume para atualizar o código. Mantenha uma única instância: este protótipo não distribui SQLite entre servidores. Não há recuperação automática de senha por email; habilite o acesso de um segundo administrador antes do teste de campo.

## Outros provedores / container

Pode usar outro serviço que ofereça Node 24, HTTPS, segredo de configuração e volume persistente gravável. Há um `Dockerfile` preparado, executando como usuário `node`; monte um volume em `/data`, gravável pelo UID 1000, e configure a origem HTTPS e a senha inicial. Não use um host de páginas estáticas ou uma função sem disco persistente para esta versão. O Dockerfile foi preparado, mas a imagem não foi construída neste ambiente.

Para validar localmente o código, use `npm ci`, `npm test` e `npm run test:auth`. Os testes usam diretórios isolados, senhas fictícias e IA desativada. O teste mobile emula tela de iPhone no Chromium; câmera física e Safari requerem o teste acima após publicação.


## Relatórios por serviço

A rota /relatorio/ inclui biblioteca de serviços e MP4. Neste servidor, exige login para publicar/acompanhar registros compartilhados, usando a mesma sessão do aplicativo. Relatórios são vinculados a uma obra existente. As fotos desse módulo ficam dentro do SQLite (field_report_images); inclua o banco e os uploads antigos no backup do volume. SSE exige permitir streaming sem buffer no proxy; há consulta periódica a cada 20 segundos como alternativa. Mantenha uma única instância. A publicação estática não executa essas rotas de API.

No piloto de uma única companhia, todos os usuários ativos veem todas as obras, como definido anteriormente. Cada colaborador edita seus próprios relatórios; administradores podem editar os demais. A integração ainda não converte percentuais dos vídeos em avanço dos ambientes da obra. Detalhes em docs/produto/servicos-compartilhados.md no workspace de desenvolvimento.
