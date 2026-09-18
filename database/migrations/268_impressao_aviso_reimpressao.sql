-- 268_impressao_aviso_reimpressao.sql — O aviso "entrou job" (pg_notify) também na REIMPRESSÃO.
--
-- ⚠️ NÃO é @cloud-only (o gatilho existe nos dois bancos: o worker do servidor local e a
--    espera longa da nuvem escutam o mesmo canal).
-- ⚠️ Independente do código: pode ir para a nuvem a qualquer momento. Rodar de novo é inofensivo.
--
-- POR QUÊ
-- O gatilho da mig 092 só avisava no INSERT. A reimpressão (botão do painel) e o
-- "Imprimir em…" voltam o job para 'pendente' com UPDATE — sem aviso, o job esperava a
-- próxima verificação periódica: até 3 s no servidor local e até 5 s na espera longa da nuvem,
-- com o operador olhando para a impressora.
--
-- Agora avisa também quando um UPDATE devolve o job para 'pendente' pronto para sair
-- (`claim_ate` vazio ou já vencido). A volta automática depois de uma falha (espera de 30 s,
-- 60 s…) NÃO avisa: o job ainda não pode ser pego, e acordar o worker ali seria à toa.

create or replace function notify_impressao_nova() returns trigger as $$
begin
  if new.status = 'pendente'
     and (tg_op = 'INSERT'
          or (old.status is distinct from 'pendente'
              and (new.claim_ate is null or new.claim_ate <= now()))) then
    perform pg_notify('impressao_nova', new.id::text);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_impressao_nova on impressao_job;
create trigger trg_impressao_nova after insert or update of status on impressao_job
  for each row execute function notify_impressao_nova();
