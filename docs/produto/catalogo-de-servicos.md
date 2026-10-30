# Cadastros anteriores à obra

O módulo compartilhado tem dois cadastros da companhia: **Equipe** e **Serviços**. Administradores preparam esses cadastros antes de organizar a execução. A posição profissional e a permissão de acesso continuam separadas.

## Catálogo implementado

Em Serviços, o administrador cadastra nome e orientação padrão opcional. Pode editar, desativar e reativar mantendo o mesmo identificador. Não há serviços inseridos automaticamente: as sugestões de nomes no formulário só ajudam a preencher um cadastro feito pelo usuário.

Na criação da obra, seleciona serviços ativos do catálogo e informa o ambiente, quando necessário. A orientação padrão é reaproveitada e pode ser ajustada para aquele escopo. Também é possível adicionar um serviço cadastrado a uma obra aberta. Catálogo vazio encaminha o administrador à configuração antes de abrir o formulário de nova obra.

O profissional recebe o escopo planejado e registra sua execução. O acesso ao catálogo administrativo permanece exclusivo dos administradores; a consulta técnica permitida no banco segue as políticas de companhia e atividade. Não foram alteradas as regras de acesso às obras nesta etapa.

## Identidade, versões e histórico

- `fr_service_catalog`: definição da companhia com ID, nome, orientação, situação, revisão, datas e autores autenticados.
- `fr_service_events`: histórico imutável pelo cliente, contendo autor, horário do servidor, revisão e valores anteriores/novos. Consulta administrativa.
- `fr_tasks.service_id` / `service_revision`: referência ao catálogo selecionado. Nome e orientação do serviço contratado são preservados na própria tarefa.
- Uma mudança no catálogo não reescreve tarefas, percentuais, fotos ou relatórios anteriores.
- Serviços antigos sem vínculo continuam com seus nomes originais; não há classificação retroativa por IA ou semelhança de texto.
- Seleção de outra companhia, serviço inativo ou revisão desatualizada é recusada. Um erro em qualquer item impede salvar uma obra pela metade.

A migração é `supabase/migrations/20261029000000_service_catalog.sql`. Usa o pipeline normal de migrações; não exige repetir o procedimento de colar SQL. A publicação no projeto do proprietário depende da configuração única do deploy documentada em deploy/CI-CD.md.

## Próximas etapas já identificadas

1. Cômodos e superfícies com identidade própria, piso/parede e esquema visual simplificado. Serviços do catálogo serão selecionados nessas superfícies.
2. Proposta de cômodos a partir da planta, com confirmação do administrador; alternativa simples sem planta.
3. Registros contextualizados por superfície, consulta à planta e análise visual.

Atribuição de equipe por período, visibilidade após mudança de equipe, múltiplos executores por registro e medição de duração ainda precisam de definição. Os horários de salvamento não serão tratados como horas efetivamente trabalhadas.

## Evidência de testes

A suíte SQL verifica isolamento por companhia, permissões administrativas, nomes duplicados, revisão concorrente, desativação, preservação de escopo e auditoria. O navegador exercita a configuração, seleção em obra e adição posterior usando SDK real e PostgreSQL local; Auth/Storage/Reatime externos são simulados. O teste do CLI roda ambas as migrações em PostgreSQL 17 isolado, preserva uma obra anterior e confirma que o histórico impede reaplicação. Não equivale a deploy validado no projeto hospedado.
