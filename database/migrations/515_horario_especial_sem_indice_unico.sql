-- 515 — Os dias especiais (`horario_especial`, mig 512) SEM o índice único do dia (ERR-640; achado do vigia de código em
-- 27/11/2026, exceção da V24).
--
-- A tabela sincroniza nos DOIS sentidos (sync-config 'ambos' + PUSH_TABLES do daemon) e o id nasce em cada ponta
-- (`gen_random_uuid()`). Com o índice único `ux_horario_especial_dia` (empresa, loja, data, horário), o mesmo dia criado no
-- servidor da loja e na nuvem antes do sync bateria no 23505 e travaria o lote para sempre. A regra do projeto para
-- cadastro de dois sentidos (V24, ERR-159) é sem índice único: a conferência roda no serviço, dentro da transação, com a
-- trava da empresa — o `dias-especiais.service.ts` já faz assim (`travarEmpresa` + `cruzamento`). O par que nascer das duas
-- pontas aparece na lista (exclua um) e a leitura escolhe sempre o mesmo: o alterado por último (`lerDiasEspeciais`).
--
-- A 512 também deixou de criar o índice (o servidor da loja reaplica todas as migrations a cada atualização: senão o índice
-- voltaria — e, com um par na loja, o 23505 abortaria a atualização). Esta tira o índice de quem já tinha rodado a 512 (a
-- nuvem). Idempotente. NÃO é @cloud-only (vale igual no servidor da loja). ⚠️ Tem `drop`: na nuvem, pelo SQL Editor do
-- Supabase (o MCP recusa `drop` — V9).

drop index if exists ux_horario_especial_dia;

-- Conferência (no mesmo Run): o índice único saiu e os da leitura e do sync seguem.
select 'sem o índice único do dia' as conferencia, to_regclass(current_schema() || '.ux_horario_especial_dia') is null as ok
union all
select 'índices da loja e do sync',
       to_regclass(current_schema() || '.idx_horario_especial_loja') is not null
       and to_regclass(current_schema() || '.idx_horario_especial_sync') is not null;
