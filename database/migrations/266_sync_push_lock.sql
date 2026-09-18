-- 266_sync_push_lock.sql — Trava de "um envio por servidor local por vez", com expiração.
--
-- ⚠️ NÃO é @cloud-only (o arquivo roda nos dois; no edge a tabela fica vazia).
-- ⚠️ ADITIVA e independente do código: pode ir para a nuvem antes.
--
-- POR QUÊ
-- O controle era um conjunto EM MEMÓRIA (valia só dentro de cada réplica da API) e, na
-- correção anterior, virou trava consultiva do Postgres (`pg_try_advisory_lock`). Testado com
-- 20 envios simultâneos do mesmo dispositivo: **todos passaram**. Trava consultiva é por
-- SESSÃO, e a sessão vem de um pool — duas requisições que pegam a mesma conexão conseguem
-- travar as duas (a trava é reentrante na mesma sessão), e o destravar pode cair numa conexão
-- diferente, deixando a trava presa até aquela conexão morrer (o dispositivo ficaria em 429
-- para sempre).
--
-- Uma LINHA por dispositivo resolve os dois lados: a disputa é resolvida pelo próprio banco,
-- não depende de qual conexão do pool atendeu, e `em` mais velho que a janela libera sozinho
-- (se a API morrer no meio de um envio, o dispositivo não fica travado para sempre).

create table if not exists sync_push_lock (
  equipamento_id uuid primary key,
  em timestamptz not null default now()
);
