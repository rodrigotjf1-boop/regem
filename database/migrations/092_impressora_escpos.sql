-- Upgrade da impressora ESC/POS (Etapa 1 · impressão automática na cozinha).
-- NÃO remove nada: acrescenta a largura do papel e a lista de setores atendidos
-- (uma impressora pode servir vários setores). O `setor_id` único continua válido
-- como fallback quando `setores_atendidos` estiver vazio.
alter table equipamento add column if not exists largura integer not null default 80;          -- 58 | 80 (mm)
alter table equipamento add column if not exists setores_atendidos jsonb not null default '[]'; -- [setor_id, ...]

-- Gatilho LISTEN/NOTIFY: avisa o worker do edge no instante em que um job entra na
-- fila (impressao imediata, sem socket/HTTP). O poll de 3s do worker e a rede de
-- seguranca caso uma notificacao se perca (worker reiniciando, etc.).
create or replace function notify_impressao_nova() returns trigger as $$
begin
  if new.status = 'pendente' then
    perform pg_notify('impressao_nova', new.id::text);
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_impressao_nova on impressao_job;
create trigger trg_impressao_nova after insert on impressao_job
  for each row execute function notify_impressao_nova();
