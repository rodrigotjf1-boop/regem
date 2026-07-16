-- Formas de pagamento ricas (tela nova em Financeiro) + 2 permissões novas.
-- (1) forma_pagamento ganha os campos do modelo: aparece no cardápio, tipos de
--     pedido aceitos, taxa extra, observação e bandeiras de cartão.
alter table forma_pagamento add column if not exists cardapio boolean not null default false;
alter table forma_pagamento add column if not exists tipos_pedido jsonb not null default '["delivery","retirada","balcao"]';
alter table forma_pagamento add column if not exists taxa_extra numeric;
alter table forma_pagamento add column if not exists obs text;
alter table forma_pagamento add column if not exists bandeiras jsonb not null default '[]';

-- (2) Permissões novas do catálogo: `loja` (Configurações → Loja) e
--     `formas_pagamento` (Financeiro → Formas de pagamento). Default P+G
--     (presidente/gerência), como as demais telas de gestão da loja.
update perfil_acesso set permissoes = permissoes
  || case when nivel in ('presidente','gerente')
          then '{"loja":true,"formas_pagamento":true}'::jsonb
          else '{"loja":false,"formas_pagamento":false}'::jsonb end;
