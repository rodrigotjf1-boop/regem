-- 259_updated_at_nao_carimba_no_sync.sql — O gatilho de updated_at não carimba a linha que o SYNC aplica.
--
-- ⚠️ NÃO é @cloud-only: as duas funções existem na nuvem e no edge. Aplicar nos dois.
-- Pode ser aplicada a qualquer momento (antes ou depois do código): sem a marca de sessão,
-- o gatilho se comporta exatamente como antes.
--
-- O DEFEITO (reproduzido no banco local com uma loja 1.29.0 e a nuvem local)
-- `bump_updated_at()` (mig 095, 20 tabelas) e `set_updated_at()` (mig 001, 31 tabelas)
-- gravam `updated_at = now()` em TODO update — inclusive quando quem atualiza é o sync,
-- aplicando a linha que veio do outro lado com o `updated_at` dela. O gatilho troca esse
-- valor pela hora local, e:
--   1. PINGUE-PONGUE: a linha aplicada fica "mais nova" que a origem e volta; a origem a
--      aplica, carimba e devolve — a cada ciclo, para sempre (no teste: 7 linhas descendo
--      e 14 subindo em todo ciclo sem ninguém mexer em nada);
--   2. EDIÇÃO PERDIDA: o carimbo falso é posterior à edição real feita do outro lado entre
--      dois ciclos, e a regra "a mais nova vence" descarta a edição real.
--
-- A CORREÇÃO
-- Quem aplica sync marca a sessão/transação com `regem.sync = on` (o daemon do edge em toda
-- conexão dele; a nuvem na transação do push). Com a marca, o gatilho mantém o updated_at
-- que veio na linha. Sem a marca — todo o resto do sistema — nada muda.

create or replace function bump_updated_at() returns trigger as $$
begin
  if coalesce(current_setting('regem.sync', true), '') = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('regem.sync', true), '') = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
