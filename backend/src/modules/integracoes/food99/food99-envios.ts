import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "ÚLTIMO ENVIO À 99" de um produto (R3 da Gestão do catálogo, fase F2; mig 402): uma linha por loja na 99 e tipo
// (preço, pausa, nome e descrição), com a situação dita para o LOJISTA — o que aconteceu, sem detalhe técnico (o errno
// e a mensagem crua ficam no registro da empresa). Mesmo formato do "último envio ao iFood" (`orzuni/envios-do-alvo.ts`),
// para a mesma tela. Lê `food99_envio`, que só existe na NUVEM: no servidor da loja, quem chama pede à nuvem (V37).

export type EnvioDa99 = {
  /** A chave da linha na tela: a integração da 99 (= a loja na 99). */
  unidadeId: string;
  loja: string | null;
  oQue: 'preco' | 'pausa' | 'cadastro';
  /** na_fila | enviando | aplicado | nao_encontrado | recusado | nao_enviado | desistiu */
  situacao: string;
  frase: string | null;
  antes: number | null;
  depois: number | null;
  quando: string;
};

export type RespostaEnviosDa99 = { envios: EnvioDa99[]; semConexao: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehIdDoProduto99 = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A linha da fila como a tela mostra. */
export function envioDa99ParaTela(r: any): EnvioDa99 {
  const resp = r.resposta && typeof r.resposta === 'object' ? r.resposta : {};
  let situacao: string;
  let frase: string | null = null;
  if (r.situacao === 'pendente') {
    situacao = 'na_fila';
    if (Number(r.tentativas) > 0) frase = 'A 99 não respondeu na última tentativa; o Regem tenta de novo sozinho.';
  } else if (r.situacao === 'enviando') {
    situacao = 'enviando';
  } else if (r.situacao === 'desistiu') {
    situacao = 'desistiu';
    frase = 'A 99 não respondeu por 24 horas; o Regem parou de tentar. Salve de novo para mandar outra vez.';
  } else if (r.resultado === 'dispensado') {
    situacao = 'nao_enviado';
    frase = typeof resp.motivo === 'string' && resp.motivo.trim() ? resp.motivo.trim() : null;
  } else {
    situacao = String(r.resultado ?? 'aplicado');
    if (typeof resp.frase === 'string' && resp.frase.trim()) frase = resp.frase.trim().slice(0, 300);
  }
  const tipo = String(r.tipo);
  return {
    unidadeId: String(r.integracao_id),
    loja: r.loja ?? null,
    oQue: tipo === 'preco_item' ? 'preco' : tipo === 'cadastro_item' ? 'cadastro' : 'pausa',
    situacao,
    frase,
    antes: numero(resp.antes),
    depois: numero(resp.depois),
    quando: new Date(r.quando).toISOString(),
  };
}

const log = new Logger('Food99Envios');

/**
 * No SERVIDOR DA LOJA: pede à nuvem (`GET /food99/loja/envios`, token de sync deste servidor). A nuvem responde pela
 * empresa do TOKEN; se não for a do usuário da tela, não mostra nada. Falha (sem internet, nuvem fora) vira `semConexao`
 * — a tela diz "sem conexão", nunca "nenhum envio" (V37). Nunca rejeita.
 */
export async function enviosDa99PelaNuvem(tenantId: string, refId: string, buscar: typeof fetch = fetch): Promise<RespostaEnviosDa99> {
  const sem = (motivo: string): RespostaEnviosDa99 => {
    log.warn(`último envio à 99 sem a nuvem (${motivo}) — a tela mostra "sem conexão".`);
    return { envios: [], semConexao: true };
  };
  const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
  const token = process.env.SYNC_TOKEN ?? '';
  if (!nuvem || !token) return sem('sem CLOUD_API/SYNC_TOKEN no servidor da loja');
  try {
    const res = await buscar(`${nuvem}/food99/loja/envios?ref=${refId}`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return sem(`HTTP ${res.status}`);
    const j: any = await res.json();
    if (j?.tenantId !== tenantId) return sem('a nuvem respondeu por outra empresa');
    if (!Array.isArray(j?.envios)) return sem('a nuvem respondeu sem a lista');
    return { envios: j.envios as EnvioDa99[], semConexao: false };
  } catch (e: any) {
    return sem(e?.cause?.code ?? e?.name ?? e?.message ?? String(e));
  }
}

/** Os envios do produto à 99, por loja (o nome da loja do Regem; sem loja, o nome da loja na 99) e tipo. Só nuvem. */
export async function enviosDa99(db: any, tenantId: string, refId: string): Promise<EnvioDa99[]> {
  if (!ehIdDoProduto99(refId)) return [];
  const r: any = await db.execute(sql`
    select e.integracao_id, coalesce(u.nome, nullif(i.config ->> 'shopName', ''), '99') as loja, e.tipo, e.situacao,
           e.resultado, e.resposta, e.tentativas, coalesce(e.enviado_em, e.marcado_em) as quando
      from food99_envio e
      join integracao i on i.id = e.integracao_id
      left join unidade u on u.id = i.unidade_id
     where e.tenant_id = ${tenantId} and e.ref_id = ${refId}
     order by 2, e.tipo`);
  return ((r.rows ?? r) as any[]).map(envioDa99ParaTela);
}
