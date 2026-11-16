# Regra de experiência — a companhia configura, a equipe executa

Definições recebidas em 16/11/2026. O profissional não configura a apresentação do produto nem a saída dos vídeos durante o trabalho. A companhia prepara os padrões; a obra fornece o contexto; o usuário registra o que executou.

## Regras para toda tela

1. Uma ação principal por etapa. Pedir somente informações que ainda não existem no contexto.
2. Nenhum registro ou parte da aplicação antes de autenticar.
3. Padrões de marca e vídeo pertencem à companhia e só administradores os alteram.
4. Identificação, data e contexto conhecidos são preenchidos automaticamente. Não pedir ao trabalhador que redigite obra, serviço, autor ou companhia.
5. Fotos e informações de execução são salvas automaticamente, com indicação compreensível de envio ou pendência.
6. Operações de manutenção, cópia, arquivamento e configuração ficam fora do fluxo normal do profissional.
7. Idioma da interface é uma preferência individual; idiomas dos vídeos são uma política da companhia. Não confundir as duas configurações.

## Fluxo final definido para o profissional

Entrar → obras vinculadas (em andamento em destaque) → cômodo → serviço → superfície → foto de início ou foto de fim. Pode registrar observação, impedimento ou falta de material, além de percentual manual opcional. Voltar ao mesmo contexto ao encerrar o dia. A foto de fim do dia não significa conclusão automática do serviço.

A estrutura física continua por superfícies/elementos agrupados. O caminho de navegação pode apresentar serviço antes da superfície: não é necessário inverter as relações dos dados para oferecer esse caminho.

O profissional não gera vídeos individuais. A análise de fotos por IA é uma evolução prevista; o app não deve inventar uma análise quando ela não estiver disponível.

## Fluxo do vídeo da obra

O administrador abre a obra e toca em Gerar vídeo da obra. O app busca o estado atual e reúne progresso, ambientes, serviços e fotos mais recentes do ciclo atual de cada serviço, provenientes das atualizações da equipe. Os vídeos não exibem autores individuais. Serviços sem foto continuam no cálculo e no resumo, sem inventar evidência visual.

A companhia define uma ou mais saídas: inglês, português e espanhol. Um clique gera as versões definidas, com legendas fixas localizadas. Nomes de cômodos, serviços e demais textos cadastrados aparecem como foram escritos; não há tradução automática desses dados nesta entrega.

O formato é vertical e a montagem é automática, com até seis páginas de serviços e oito fotos, mantendo um resumo curto. Obras maiores continuam com o total completo no resumo, com indicação de que há mais serviços no app. Um arquivo é gerado por idioma, com opção de salvar e compartilhar. A geração ocorre no navegador e requer suporte a MP4 e a página aberta.

As configurações se aplicam a cada nova geração. Arquivos já baixados não são alterados. Fotos/relatos e a identidade histórica dos registros continuam preservados. A metragem e as novas definições de superfícies permanecem em documentos próprios.

## Implementado nesta entrega

- Idiomas de vídeo persistidos na companhia, com padrão inglês preservado para as companhias existentes, permissões administrativas, isolamento e controle de revisão.
- Botão de geração no nível da obra, exclusivo do administrador na interface atual.
- Resumo por ambientes e serviços com progresso e evidências da equipe; versões automáticas nos idiomas definidos.
- Retirada da geração individual e da escolha de idioma do fluxo compartilhado de registros.
- Dados já conhecidos apresentados como contexto, campos redundantes ocultos, envio automático e funções de manutenção fora da tela normal do profissional.

## Evoluções ainda necessárias para o fluxo final completo

A seleção estruturada de superfícies/agrupamentos, o planejamento de equipe por obra/dia e a restrição das obras por designação ainda precisam de evolução de dados e permissões. O piloto atual não deve ser apresentado como se já tivesse essas regras. A análise de fotos por IA, preferência individual de idioma da interface e PDF/3D também continuam pendentes. Esta entrega simplifica o fluxo existente e implementa a saída de vídeo por obra, sem afirmar que essas evoluções estejam prontas.

## Validação

Testes SQL verificam preservação dos dados, padrão inicial, permissões, isolamento, idiomas inválidos e conflitos de revisão. Testes de navegador verificam que o profissional não recebe opções de vídeo, que configurações da companhia são salvas e que a geração da obra entrega as versões definidas sem seletores no fluxo. Testes de snapshot verificam união de profissionais, separação entre obras, exclusão de ciclos anteriores e avanço agregado.

## Revisão de navegação e momentos do dia — 16/11/2026

O menu fica em uma sidebar à esquerda no computador; no celular, o botão Menu abre a mesma navegação em painel lateral. Toda seção, incluindo Registros, indica a seleção em verde e com aria-current. As opções administrativas continuam restritas ao papel existente.

Cada serviço oferece Informar início do dia e Informar final do dia. No início aparecem somente as fotos iniciais; percentual, conclusão, relato final e fotos finais ficam fora desse momento. Após salvar uma foto inicial, o profissional retorna ao serviço e informa o final, com foto do resultado, percentual e observações opcionais. As duas etapas reutilizam o mesmo registro do profissional naquele dia. A data pode avançar para outro dia sem alterar o registro anterior. Não há bloqueio por horário do relógio: a pessoa escolhe o momento real do trabalho. Consultas históricas preservam todas as fotos. Registros antigos que já têm fotos finais continuam acessíveis, sem inventar fotos iniciais.

A saída do dia continua independente da conclusão total do serviço. Esta revisão separa os momentos no fluxo atual, sem afirmar que o cadastro estruturado de superfícies esteja implementado.
