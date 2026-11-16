# Entrada e encerramento de sessão

A página publicada de obras e relatórios mostra apenas o acesso antes de validar a sessão e o vínculo do usuário com a companhia. Editor, biblioteca, navegação e dados de obras permanecem ocultos e inertes desde o HTML inicial, inclusive enquanto o SDK verifica uma sessão persistida.

O armazenamento local pode preservar rascunhos; recuperá-los não libera sua visualização antes da autenticação no módulo compartilhado. Uma senha inválida mantém a tela de acesso. Depois do login validado, o usuário entra nas obras. Ao sair, a página retorna ao acesso e não abre a biblioteca local. Perda de sessão ou de acesso à companhia durante a atualização também bloqueia a interface; o evento de logout do Supabase bloqueia outras abas com a mesma sessão.

Isso complementa as políticas existentes do banco e da API, que continuam exigindo autenticação e autorização para registros e fotos. O modo local independente de desenvolvimento continua disponível quando nenhum backend de autenticação está ativo fora do host publicado GitHub Pages.

Validação: scripts/test-job-workspace-browser.mjs cobre HTML bloqueado inicialmente, rascunho local existente, senha inválida, fluxo autenticado, logout, recarga sem sessão e logout entre abas. Usa SDK real e Postgres/PGlite com transportes externos simulados. A suíte de API/RLS continua verificando acesso anônimo e isolamento. A mudança não cria migração de banco.
