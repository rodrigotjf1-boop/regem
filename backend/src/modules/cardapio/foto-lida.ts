/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';
import { chaveTelefone } from '../../common/telefone-chave';
import { hojeISO } from '../../common/data';
import {
  AnaliseDaFoto,
  DIAS_DA_LINHA_DA_FOTO,
  FotoNoCaso,
  JANELA_DA_FOTO_NO_CASO_MIN,
  LIMITE_DE_FOTOS_POR_DIA,
  fotoParaOCaso,
} from '../../common/foto-do-cliente';

// AS FOTOS DO CLIENTE LIDAS PELA IA (mig 442, @cloud-only — protótipo `mockups/regem-atendente-alergenos-agendado.html`,
// parte 3). As consultas da tabela `robo_foto_lida` e da chave da loja (`robo_config.fotos_ler`); as regras puras moram
// em `common/foto-do-cliente.ts`. Só a nuvem chama (o robô e a leitura da foto moram nela).

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/** A loja ligou "Ler as fotos que o cliente manda"? Sem linha ou sem a coluna (banco sem a 442): desligado. */
export async function lojaLeFotos(db: any, tenantId: string): Promise<boolean> {
  const r = await db.execute(sql`
    select coalesce((to_jsonb(rc) ->> 'fotos_ler')::boolean, false) as ler
      from robo_config rc where rc.tenant_id = ${tenantId}::uuid`);
  return linhasDe(r)[0]?.ler === true;
}

/**
 * RESERVA a leitura de uma foto deste cliente HOJE (dia da loja), na MESMA instrução que confere o teto (V98): duas fotos
 * ao mesmo tempo nunca passam das `LIMITE_DE_FOTOS_POR_DIA`. Devolve quantas já foram lidas contando esta, ou null quando
 * o limite do dia acabou. As linhas desta empresa com mais de `DIAS_DA_LINHA_DA_FOTO` dias saem junto.
 */
export async function reservarLeituraDaFoto(db: any, tenantId: string, telefone: unknown, dia: string = hojeISO()): Promise<number | null> {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  const r = await db.execute(sql`
    with velhas as (
      delete from robo_foto_lida
       where tenant_id = ${tenantId}::uuid and dia < ${dia}::date - ${DIAS_DA_LINHA_DA_FOTO}::int
    )
    insert into robo_foto_lida (tenant_id, telefone_chave, dia, lidas)
    values (${tenantId}::uuid, ${chave}, ${dia}::date, 1)
    on conflict (tenant_id, telefone_chave, dia) do update
       set lidas = robo_foto_lida.lidas + 1
     where robo_foto_lida.lidas < ${LIMITE_DE_FOTOS_POR_DIA}::int
    returning lidas`);
  const l = linhasDe(r)[0];
  return l ? Number(l.lidas) : null;
}

/** Guarda a ÚLTIMA descrição da foto deste cliente (para o caso que o atendente abrir em seguida). Só o texto (F1). */
export async function guardarDescricaoDaFoto(db: any, tenantId: string, telefone: unknown, a: AnaliseDaFoto, dia: string = hojeISO()): Promise<void> {
  const chave = chaveTelefone(telefone);
  if (!chave) return;
  await db.execute(sql`
    update robo_foto_lida
       set ultima_tipo = ${a.tipo}, ultima_descricao = ${a.descricao}, ultima_em = clock_timestamp()
     where tenant_id = ${tenantId}::uuid and telefone_chave = ${chave} and dia = ${dia}::date`);
}

/**
 * A última foto lida desta conversa, para o caso ("O que a foto mostra", F5): a de até `JANELA_DA_FOTO_NO_CASO_MIN`
 * minutos, que não é comprovante. A janela atravessa a meia-noite (o filtro é pela hora, não pelo dia). Lança na falha
 * do banco: quem chama segura e registra (o caso abre sem o bloco).
 */
export async function ultimaFotoParaOCaso(db: any, tenantId: string, telefone: unknown, agora: Date = new Date()): Promise<FotoNoCaso | null> {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  const r = await db.execute(sql`
    select ultima_tipo, ultima_descricao, ultima_em
      from robo_foto_lida
     where tenant_id = ${tenantId}::uuid and telefone_chave = ${chave}
       and ultima_em > ${agora.toISOString()}::timestamptz - make_interval(mins => ${JANELA_DA_FOTO_NO_CASO_MIN}::int)
     order by ultima_em desc
     limit 1`);
  return fotoParaOCaso(linhasDe(r)[0], agora);
}
