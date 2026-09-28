// TOKEN DO IBPT DA LOJA (mig 292) — OPCIONAL. Fica em `fiscal_credencial`, cifrado como o CSC, e
// só na nuvem (a tabela não sincroniza; o servidor da loja recebe a tabela pronta, nunca o token).
//
// Regras deste arquivo:
//   • nenhuma função devolve o token nem a coluna cifrada para fora do processo — a tela vê só os
//     4 últimos caracteres e a situação da última verificação;
//   • vale para a LOJA ou para a REDE, como o certificado: o da loja, se existir, tem prioridade.
//
// SQL em string contra o banco de verdade (V6): coberto por `ibpt-token.spec.ts`.
import { sql } from 'drizzle-orm';
import { cifrar, decifrar } from '../../../common/cifra-segredo';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type StatusTokenIbpt = 'ok' | 'invalido' | 'erro';

/** O que a TELA pode ver do token. Nunca o token. */
export type TokenIbptResumo = {
  configurado: boolean;
  escopo: 'loja' | 'rede' | null; // onde está guardado
  final: string | null; // 4 últimos caracteres
  status: StatusTokenIbpt | null;
  mensagem: string | null;
  verificadoEm: string | null;
};

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];

/** NCM da linha da taxa de serviço na NFC-e (fiscal.service) — sempre entra na tabela própria. */
export const NCM_TAXA_SERVICO = '21069090';

/** A credencial cujo token vale para a loja: a da loja, senão a da rede. */
export async function credencialComTokenIbpt(db: any, tenantId: string, unidadeId: string | null) {
  const r = await db.execute(sql`
    select id, unidade_id, ibpt_token_cifrado, ibpt_token_final, ibpt_status, ibpt_mensagem, ibpt_verificado_em
      from fiscal_credencial
     where tenant_id = ${tenantId} and ibpt_token_cifrado is not null
       and (unidade_id is not distinct from ${unidadeId ?? null}::uuid or unidade_id is null)
     order by (unidade_id is null)
     limit 1`);
  return linhas(r)[0] as any | undefined;
}

export function resumoTokenIbpt(row: any | undefined): TokenIbptResumo {
  if (!row?.ibpt_token_cifrado)
    return { configurado: false, escopo: null, final: null, status: null, mensagem: null, verificadoEm: null };
  return {
    configurado: true,
    escopo: row.unidade_id ? 'loja' : 'rede',
    final: row.ibpt_token_final ?? null,
    status: (row.ibpt_status as StatusTokenIbpt) ?? null,
    mensagem: row.ibpt_mensagem ?? null,
    verificadoEm: row.ibpt_verificado_em ? new Date(row.ibpt_verificado_em).toISOString() : null,
  };
}

/** Decifra o token para chamar o IBPT. Fica em memória só durante a chamada. */
export const tokenIbptDecifrado = (row: any): string => decifrar(String(row?.ibpt_token_cifrado ?? ''));

/** Guarda (ou troca) o token da loja/rede, já com o resultado da verificação feita ao salvar. */
export async function gravarTokenIbpt(
  db: any,
  tenantId: string,
  unidadeId: string | null,
  token: string,
  verificacao: { status: StatusTokenIbpt; mensagem: string | null },
) {
  const cifrado = cifrar(token); // sem SEGREDOS_CHAVE, recusa — nunca guarda em texto puro
  await db.execute(sql`
    insert into fiscal_credencial (tenant_id, unidade_id, ibpt_token_cifrado, ibpt_token_final,
                                   ibpt_status, ibpt_mensagem, ibpt_verificado_em)
    values (${tenantId}, ${unidadeId ?? null}, ${cifrado}, ${token.slice(-4)},
            ${verificacao.status}, ${verificacao.mensagem}, now())
    on conflict (tenant_id, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
      ibpt_token_cifrado = excluded.ibpt_token_cifrado,
      ibpt_token_final   = excluded.ibpt_token_final,
      ibpt_status        = excluded.ibpt_status,
      ibpt_mensagem      = excluded.ibpt_mensagem,
      ibpt_verificado_em = excluded.ibpt_verificado_em,
      updated_at = now()`);
}

/** Tira o token da loja/rede (exatamente desse escopo). Devolve os 4 últimos do que saiu, ou null. */
export async function apagarTokenIbpt(db: any, tenantId: string, unidadeId: string | null) {
  const r = await db.execute(sql`
    update fiscal_credencial
       set ibpt_token_cifrado = null, ibpt_token_final = null, ibpt_status = null,
           ibpt_mensagem = null, ibpt_verificado_em = null, updated_at = now()
      from (select id, ibpt_token_final as final from fiscal_credencial
             where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}::uuid
               and ibpt_token_cifrado is not null) antes
     where fiscal_credencial.id = antes.id
    returning antes.final`);
  const row = linhas(r)[0];
  return row ? String(row.final ?? '') : null;
}

/** Resultado da última conversa com o IBPT — para a tela e para o job. */
export async function marcarVerificacaoIbpt(db: any, credencialId: string, status: StatusTokenIbpt, mensagem: string | null) {
  await db.execute(sql`
    update fiscal_credencial
       set ibpt_status = ${status}, ibpt_mensagem = ${mensagem}, ibpt_verificado_em = now()
     where id = ${credencialId}::uuid and ibpt_token_cifrado is not null`);
}

export type LojaComTokenIbpt = {
  tenantId: string;
  unidadeId: string | null;
  uf: string;
  cnpj: string;
  credencialId: string;
  tokenCifrado: string;
};

/**
 * Cada emitente configurado (fiscal_config com UF e CNPJ) que tem token valendo — o da loja, senão
 * o da rede. Ordenado por empresa e UF: o job diário precisa de UM token que funcione por par.
 * `tenantIds` limita (teste — LIC-084 — e o disparo logo depois de salvar).
 */
export async function lojasComTokenIbpt(db: any, tenantIds?: string[]): Promise<LojaComTokenIbpt[]> {
  const filtro = tenantIds?.length ? `{${tenantIds.map((t) => t.replace(/[^0-9a-f-]/gi, '')).join(',')}}` : null;
  const r = await db.execute(sql`
    select fc.tenant_id, fc.unidade_id, upper(fc.uf) as uf, regexp_replace(fc.cnpj, '\\D', '', 'g') as cnpj,
           cr.id as credencial_id, cr.ibpt_token_cifrado
      from fiscal_config fc
      join lateral (
        select c.id, c.ibpt_token_cifrado from fiscal_credencial c
         where c.tenant_id = fc.tenant_id and c.ibpt_token_cifrado is not null
           and (c.unidade_id is not distinct from fc.unidade_id or c.unidade_id is null)
         order by (c.unidade_id is null) limit 1) cr on true
     where coalesce(fc.uf, '') <> '' and coalesce(fc.cnpj, '') <> ''
       and (${filtro}::uuid[] is null or fc.tenant_id = any(${filtro}::uuid[]))
     order by fc.tenant_id, upper(fc.uf), (fc.unidade_id is null), fc.unidade_id`);
  return linhas(r).map((x: any) => ({
    tenantId: x.tenant_id,
    unidadeId: x.unidade_id ?? null,
    uf: x.uf,
    cnpj: x.cnpj,
    credencialId: x.credencial_id,
    tokenCifrado: x.ibpt_token_cifrado,
  }));
}

/**
 * NCMs que a empresa pode pôr numa nota: os dos produtos dela e o da linha da taxa de serviço.
 * É o que a tabela própria precisa ter — a API do IBPT é consultada NCM a NCM.
 */
export async function ncmsDaEmpresa(db: any, tenantId: string): Promise<string[]> {
  const r = await db.execute(sql`
    select distinct regexp_replace(ncm, '\\D', '', 'g') as ncm
      from produto where tenant_id = ${tenantId} and ncm is not null`);
  const lista = linhas(r)
    .map((x: any) => String(x.ncm ?? ''))
    .filter((n) => n.length === 8 && n !== '00000000');
  return [...new Set([...lista, NCM_TAXA_SERVICO])].sort();
}

/**
 * O emitente (UF e CNPJ) com que o token é testado: o da loja, senão o da rede. Token da REDE
 * (sem loja) numa empresa que só tem configuração por loja usa a primeira loja configurada.
 */
export async function emitenteDaLoja(db: any, tenantId: string, unidadeId: string | null) {
  const r = await db.execute(sql`
    select upper(uf) as uf, regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') as cnpj from fiscal_config
     where tenant_id = ${tenantId} and coalesce(uf, '') <> ''
       and (${unidadeId ?? null}::uuid is null or unidade_id = ${unidadeId ?? null}::uuid or unidade_id is null)
     order by (unidade_id is not distinct from ${unidadeId ?? null}::uuid) desc, (unidade_id is null) desc, unidade_id
     limit 1`);
  const row = linhas(r)[0];
  return { uf: row?.uf ? String(row.uf) : null, cnpj: row?.cnpj ? String(row.cnpj) : null };
}
