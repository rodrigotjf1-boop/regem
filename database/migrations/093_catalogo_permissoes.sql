-- Catálogo COMPLETO de permissões (RBAC configurável, perfil_acesso).
-- Backfill dos perfis existentes por nível: as chaves NOVAS entram com o default
-- do nível; as que o presidente já editou PERMANECEM — em jsonb, `default || existente`
-- faz o lado DIREITO vencer no conflito, então preserva a edição e só preenche o que falta.
-- NÃO altera schema (perfil_acesso.permissoes já é jsonb).

-- Presidente: tudo liberado.
update perfil_acesso set permissoes =
  '{"dashboard":true,"pdv":true,"mesas":true,"cupons":true,"delivery":true,"pedidos":true,"fidelidade":true,"cashback":true,"meu_dia":true,"escalas":true,"checklist":true,"mural":true,"fiscal":true,"tef":true,"fiscal_config":true,"financeiro":true,"cadastros":true,"ponto_gerencial":true,"producao_kds":true,"config_ramo":true,"planos":true,"acessos":true,"servidor":true,"turnos":true,"relatorios_vendas":true,"cancelamentos":true,"auditoria":true,"visao_co":true,"ver_financeiro":true}'::jsonb
  || permissoes
  where nivel = 'presidente';

-- Gerência/ADM: operação + gestão da loja; SEM financeiro/fiscal/relatórios/C&O; dashboard sem R$ (ver_financeiro=false).
update perfil_acesso set permissoes =
  '{"dashboard":true,"pdv":true,"mesas":true,"cupons":true,"delivery":true,"pedidos":true,"fidelidade":true,"cashback":true,"meu_dia":true,"escalas":true,"checklist":true,"mural":true,"fiscal":false,"tef":false,"fiscal_config":false,"financeiro":false,"cadastros":true,"ponto_gerencial":true,"producao_kds":true,"config_ramo":false,"planos":false,"acessos":true,"servidor":true,"turnos":false,"relatorios_vendas":false,"cancelamentos":false,"auditoria":false,"visao_co":false,"ver_financeiro":false}'::jsonb
  || permissoes
  where nivel = 'gerente';

-- Supervisão: operação do setor; sem dashboard/meu_dia/gestão.
update perfil_acesso set permissoes =
  '{"dashboard":false,"pdv":true,"mesas":true,"cupons":true,"delivery":true,"pedidos":true,"fidelidade":true,"cashback":true,"meu_dia":false,"escalas":true,"checklist":true,"mural":true,"fiscal":false,"tef":false,"fiscal_config":false,"financeiro":false,"cadastros":false,"ponto_gerencial":false,"producao_kds":false,"config_ramo":false,"planos":false,"acessos":false,"servidor":false,"turnos":false,"relatorios_vendas":false,"cancelamentos":false,"auditoria":false,"visao_co":false,"ver_financeiro":false}'::jsonb
  || permissoes
  where nivel = 'supervisao';

-- Execução: PDV/mesas/cupons/pedidos + mural; escala só visual; conclui checklists; meu_dia NÃO (ponto é à parte).
update perfil_acesso set permissoes =
  '{"dashboard":false,"pdv":true,"mesas":true,"cupons":true,"delivery":false,"pedidos":true,"fidelidade":false,"cashback":false,"meu_dia":false,"escalas":true,"checklist":true,"mural":true,"fiscal":false,"tef":false,"fiscal_config":false,"financeiro":false,"cadastros":false,"ponto_gerencial":false,"producao_kds":false,"config_ramo":false,"planos":false,"acessos":false,"servidor":false,"turnos":false,"relatorios_vendas":false,"cancelamentos":false,"auditoria":false,"visao_co":false,"ver_financeiro":false}'::jsonb
  || permissoes
  where nivel = 'execucao';
