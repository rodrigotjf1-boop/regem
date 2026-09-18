// SQL da fila de impressão do SERVIDOR LOCAL, fora do daemon para o CI conseguir rodar
// a consulta contra um Postgres de verdade (test/impressao-fila.spec.ts).
//
// Por que existe: a 1.29.0 saiu com a reserva quebrada — o `order by c.criado_em` de fora
// lia uma coluna que o `returning` do CTE não devolvia, e o Postgres recusava a consulta
// INTEIRA em todo ciclo (`coluna c.criado_em não existe`). Nas lojas com servidor local nada
// da fila saía no papel. Erro de SQL dentro de string só aparece rodando no banco.

// Tempo que a reserva segura o job. Renovada job a job antes de enviar (ver `SQL_RENOVAR`),
// então vale por JOB, não pelo lote inteiro.
export const LEASE_SEG = 120;

// Reserva atômica (claim/lease, mig 221) de até 20 jobs.
//  $1 = id deste worker; $2 = unidade deste servidor (ou null = sem filtro de loja).
//
// Filtro por loja nas DUAS pontas:
//  • a loja do JOB (j.unidade_id) — como antes;
//  • a loja da IMPRESSORA (e.unidade_id). As impressoras de todas as lojas descem para todos
//    os servidores (config da rede), e um job "da rede" (sem loja) apontando para a impressora
//    da loja B era impresso pelo servidor da loja A — no IP da B, que na rede da A é outro
//    aparelho ou nada (reproduzido). Esses jobs NÃO entram aqui: `SQL_OUTRA_LOJA` os encerra
//    com erro visível, em vez de ficarem pendentes para sempre.
// Impressora sem loja (unidade_id null) continua valendo — é o cadastro de empresa de uma loja.
//
// $3 = impressoras que NÃO entram nesta reserva (uuid[]): as que já estão imprimindo (cada
// impressora tem a sua fila, uma de cada vez) e as "fora do ar" (disjuntor aberto). Assim uma
// impressora desligada não segura as outras — medido antes: via da cozinha 77 s atrás de três
// cupons de um caixa desligado.
export const SQL_RESERVAR = `
  with alvo as (
    select j.id from impressao_job j
    left join equipamento e on e.id = j.equipamento_id
    where ((j.status = 'pendente' and (j.claim_ate is null or j.claim_ate < now()))
           or (j.status = 'enviando' and j.claim_ate < now()))
      and ($2::uuid is null or j.unidade_id = $2::uuid or j.unidade_id is null)
      and ($2::uuid is null or e.unidade_id is null or e.unidade_id = $2::uuid)
      and (j.equipamento_id is null or not (j.equipamento_id = any($3::uuid[])))
    order by j.criado_em asc
    limit 20
    for update of j skip locked
  ),
  claimed as (
    update impressao_job
    set status = 'enviando', claim_por = $1, claim_ate = now() + interval '${LEASE_SEG} seconds'
    where id in (select id from alvo)
    returning id, conteudo, via, tentativas, equipamento_id, criado_em
  )
  select c.id, c.conteudo, c.via, c.tentativas, c.equipamento_id,
         e.conexao, e.host, e.porta, e.dispositivo, e.largura, e.codepage,
         e.nome as impressora, e.linguagem_etiqueta as linguagem,
         -- Vias: cupom do cliente e produção têm número próprio; DANFE, etiqueta e página de
         -- teste saem UMA vez (medido: numa impressora de 3 vias, a DANFE saía 3 vezes).
         case
           when c.via = 'cliente' then coalesce(e.vias_cliente, e.vias)
           when c.via = 'producao' then coalesce(e.vias_producao, e.vias)
           when c.via in ('fiscal', 'etiqueta', 'teste') then 1
           else e.vias end as vias,
         e.ativo
  from claimed c
  left join equipamento e on e.id = c.equipamento_id
  order by c.criado_em asc`;

// Jobs vivos da loja deste servidor cuja impressora é de OUTRA loja: erro definitivo, com o
// motivo — aparece no painel e na saúde do servidor, e o gestor redireciona ("Imprimir em…").
//  $1 = unidade deste servidor.
export const SQL_OUTRA_LOJA = `
  update impressao_job j
     set status = 'erro', claim_por = null, claim_ate = null,
         erro = 'impressora cadastrada em outra loja — este servidor local não a alcança'
    from equipamento e
   where e.id = j.equipamento_id
     and j.status in ('pendente', 'enviando')
     and e.unidade_id is not null and e.unidade_id <> $1::uuid
     and (j.unidade_id = $1::uuid or j.unidade_id is null)
  returning j.id`;

// Renova a reserva de UM job imediatamente antes de enviá-lo. O lote é reservado de uma vez,
// e com a impressora fora do ar cada job leva até ~25 s (3 × 8 s de timeout + espera): sem
// renovar, do 5º job em diante a reserva já tinha vencido com o lote ainda em andamento.
// Devolve 0 linhas se o job não é mais deste worker — aí ele NÃO imprime.
//  $1 = job; $2 = id deste worker.
export const SQL_RENOVAR = `
  update impressao_job set claim_ate = now() + interval '${LEASE_SEG} seconds'
   where id = $1 and claim_por = $2 and status = 'enviando'
  returning id`;

export const SQL_IMPRESSO = `
  update impressao_job set status = 'impresso', impresso_em = now(), claim_por = null, claim_ate = null
   where id = $1`;

// Falha passageira (impressora desligada, rede): volta para 'pendente' com espera crescente
// (claim_ate = "não pegar antes de") até $3 rodadas; depois 'erro'.
//  $1 = job; $2 = motivo; $3 = teto de rodadas.
export const SQL_ERRO = `
  update impressao_job set
     tentativas = tentativas + 1,
     erro = $2,
     claim_por = null,
     status = case when tentativas + 1 < $3 then 'pendente' else 'erro' end,
     claim_ate = case when tentativas + 1 < $3 then now() + (interval '30 seconds' * (tentativas + 1)) else null end
   where id = $1`;

// Erro de CONFIGURAÇÃO (sem IP, sem nome no Windows, sem impressora): não adianta tentar de
// novo — antes eram 5 rodadas em ~5 min até cair em 'erro'. Vai direto, com o motivo.
export const SQL_ERRO_DEFINITIVO = `
  update impressao_job set tentativas = tentativas + 1, erro = $2, status = 'erro',
         claim_por = null, claim_ate = null
   where id = $1`;

// Devolve à fila SEM contar tentativa: jobs de uma impressora que acabou de cair (disjuntor
// aberto) e que estavam na fila dela esperando a vez. Voltam 'pendente' livres; a reserva não os
// pega enquanto o disjuntor estiver aberto ($3 do SQL_RESERVAR).
//  $1 = job; $2 = id deste worker.
export const SQL_DEVOLVER = `
  update impressao_job set status = 'pendente', claim_por = null, claim_ate = null
   where id = $1 and claim_por = $2 and status = 'enviando'`;

// Estado da impressora (mig 269): última impressão certa, última falha e falhas seguidas.
//  $1 = impressora; $2 = saiu? (boolean); $3 = motivo da falha (texto ou null).
export const SQL_STATUS = `
  insert into impressora_status as s
         (equipamento_id, tenant_id, unidade_id, ultimo_ok_em, ultima_falha_em, ultimo_erro, falhas_seguidas, atualizado_em)
  select e.id, e.tenant_id, e.unidade_id,
         case when $2::boolean then now() end,
         case when $2::boolean then null else now() end,
         case when $2::boolean then null else $3::text end,
         case when $2::boolean then 0 else 1 end,
         now()
    from equipamento e where e.id = $1::uuid
  on conflict (equipamento_id) do update set
     ultimo_ok_em    = coalesce(excluded.ultimo_ok_em, s.ultimo_ok_em),
     ultima_falha_em = coalesce(excluded.ultima_falha_em, s.ultima_falha_em),
     ultimo_erro     = case when $2::boolean then s.ultimo_erro else excluded.ultimo_erro end,
     falhas_seguidas = case when $2::boolean then 0 else s.falhas_seguidas + 1 end,
     atualizado_em   = now()`;

// Impressoras que pararam de responder (para a saúde enviada à nuvem e o painel local).
export const SQL_SEM_RESPONDER = `
  select e.id, e.nome, s.ultima_falha_em as desde, s.ultimo_erro as erro, s.falhas_seguidas as falhas
    from impressora_status s join equipamento e on e.id = s.equipamento_id
   where s.falhas_seguidas > 0
     and (s.ultimo_ok_em is null or s.ultima_falha_em > s.ultimo_ok_em)
     and ($1::uuid is null or e.unidade_id is null or e.unidade_id = $1::uuid)
   order by s.ultima_falha_em desc
   limit 20`;

// DANFE mandada pela nuvem (comando 'imprimir_danfe', mig 269) — mesma regra da nuvem para a
// impressora: a que imprimiu o cupom desta venda; senão uma de cupom da loja (padrão primeiro).
export const SQL_DANFE_JA_NA_FILA = `
  select 1 from impressao_job where comanda_id = $1 and via = 'fiscal' limit 1`;
//  $1 = comanda (ou null); $2 = loja deste servidor (ou null).
export const SQL_DANFE_ALVO = `
  select coalesce(
    (select j.equipamento_id from impressao_job j
       join equipamento e on e.id = j.equipamento_id and e.ativo
      where j.comanda_id = $1::uuid and j.via = 'cliente'
      order by j.criado_em desc limit 1),
    (select e.id from equipamento e
      where e.tipo = 'impressora' and e.ativo and e.faz_cupom
        and ($2::uuid is null or e.unidade_id = $2::uuid or e.unidade_id is null)
      order by e.padrao desc, (e.unidade_id is null), e.created_at
      limit 1)) as id`;
//  $1 = impressora; $2 = loja; $3 = comanda; $4 = texto.
export const SQL_DANFE_INSERIR = `
  insert into impressao_job (tenant_id, unidade_id, equipamento_id, comanda_id, via, conteudo)
  select e.tenant_id, $2::uuid, e.id, $3::uuid, 'fiscal', $4 from equipamento e where e.id = $1::uuid`;

// Job mandado pela nuvem (comando 'imprimir'): a nuvem já escolheu a impressora (mesmo id nos dois
// bancos) e montou o texto. Não repete se o MESMO texto já entrou para a mesma impressora há pouco
// — o comando pode ser executado de novo se o servidor cair entre gravar e confirmar.
//  $1 = impressora; $2 = loja; $3 = pedido; $4 = comanda; $5 = via; $6 = texto.
export const SQL_JOB_DO_COMANDO = `
  insert into impressao_job (tenant_id, unidade_id, equipamento_id, pedido_id, comanda_id, via, conteudo)
  select e.tenant_id, $2::uuid, e.id, $3::uuid, $4::uuid, $5, $6
    from equipamento e
   where e.id = $1::uuid
     and not exists (select 1 from impressao_job j
                      where j.equipamento_id = e.id and j.conteudo = $6
                        and j.criado_em > now() - interval '10 minutes')
  returning id`;

// Fila parada por impressora (para a saúde enviada à nuvem): quantos tickets esperam e desde
// quando. Mostra o que o estado da impressora não mostra — ex.: disjuntor aberto há 20 min, ou a
// impressora que ninguém tentou (máquina desligada).  $1 = loja deste servidor (ou null).
export const SQL_FILA_POR_IMPRESSORA = `
  select j.equipamento_id as id, count(*)::int as pendentes, min(j.criado_em) as "maisAntigoEm"
    from impressao_job j
   where j.status in ('pendente', 'enviando') and j.equipamento_id is not null
     and ($1::uuid is null or j.unidade_id = $1::uuid or j.unidade_id is null)
   group by j.equipamento_id
   order by min(j.criado_em)
   limit 50`;
