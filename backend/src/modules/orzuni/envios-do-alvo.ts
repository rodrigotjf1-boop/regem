import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "ÚLTIMO ENVIO AO iFOOD" de um produto ou opção (R2b; mig 370): uma linha por loja e tipo (preço, pausa), com a
// situação dita para o LOJISTA — o que aconteceu, sem detalhe técnico da integração (código de protocolo, nome de
// problema, erro de rede ficam no console da distribuição). A frase da recusa é a do Orzuni (pt-BR, Padrão §6).
// Lê `orzuni_envio`, que só existe na NUVEM: no servidor da loja, quem chama pede à nuvem (V37).

export type AlvoIfood = 'produto' | 'opcao';

export type EnvioDoAlvo = {
  unidadeId: string;
  loja: string | null;
  /** preco | pausa | cadastro (nome e descrição) | codigo (a troca do código PDV) — os dois últimos desde a mig 400 */
  oQue: 'preco' | 'pausa' | 'cadastro' | 'codigo';
  /** na_fila | enviando | aplicado | sem_mudanca | nao_encontrado | parcial | recusado | nao_enviado | desistiu */
  situacao: string;
  /** A frase para a tela (o motivo do "não enviado", a recusa do Orzuni, o "tentando de novo"). */
  frase: string | null;
  antes: number | null;
  depois: number | null;
  quando: string;
};

const TIPOS: Record<AlvoIfood, readonly string[]> = {
  produto: ['preco_item', 'status_item', 'cadastro_item', 'codigo_item'],
  opcao: ['preco_opcao', 'status_opcao'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ehAlvoIfood = (v: unknown): v is AlvoIfood => v === 'produto' || v === 'opcao';
export const ehIdDoAlvo = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A linha da fila como a tela mostra. */
export function envioParaTela(r: any): EnvioDoAlvo {
  const resp = r.resposta && typeof r.resposta === 'object' ? r.resposta : {};
  let situacao: string;
  let frase: string | null = null;
  if (r.situacao === 'pendente') {
    situacao = 'na_fila';
    if (Number(r.tentativas) > 0) frase = 'O iFood não respondeu na última tentativa; o Regem tenta de novo sozinho.';
  } else if (r.situacao === 'enviando') {
    situacao = 'enviando';
  } else if (r.situacao === 'desistiu') {
    situacao = 'desistiu';
    frase = 'O iFood não respondeu por 24 horas; o Regem parou de tentar. Salve de novo para mandar outra vez.';
  } else if (r.resultado === 'dispensado') {
    situacao = 'nao_enviado';
    const motivo = typeof resp.motivo === 'string' ? resp.motivo : '';
    // A ligação da loja é coisa da distribuição (o console): para o lojista, o que fazer é chamar o suporte.
    frase = /ligação|segredo/i.test(motivo)
      ? 'A ligação desta loja com o iFood precisa ser refeita pelo suporte do Regem.'
      : motivo || null;
  } else {
    situacao = String(r.resultado ?? 'aplicado');
    if (typeof resp.frase === 'string' && resp.frase.trim()) frase = resp.frase.trim().slice(0, 300);
    // O código novo já é de um item do iFood: pelo código é que o Regem liga, então o produto passa a ligar a ele.
    if (resp.codigo === 'codigo_ja_existe')
      frase = 'O iFood já tem um item com o código novo: a partir de agora o preço e a pausa deste produto vão para ele. Se não for o mesmo produto, troque o código.';
  }
  const tipo = String(r.tipo);
  return {
    unidadeId: String(r.unidade_id),
    loja: r.loja ?? null,
    oQue: tipo.startsWith('preco') ? 'preco' : tipo === 'cadastro_item' ? 'cadastro' : tipo === 'codigo_item' ? 'codigo' : 'pausa',
    situacao,
    frase,
    antes: numero(resp.antes),
    depois: numero(resp.depois),
    quando: new Date(r.quando).toISOString(),
  };
}

export type RespostaEnvios = { envios: EnvioDoAlvo[]; semConexao: boolean };

const log = new Logger('OrzuniEnvios');

/**
 * No SERVIDOR DA LOJA: pede à nuvem (`GET /orzuni/loja/envios`, token de sync deste servidor). A nuvem responde pela
 * empresa do TOKEN; se não for a do usuário da tela (servidor reaproveitado de outra loja), não mostra nada. Falha
 * (sem internet, nuvem fora) vira `semConexao` — a tela diz "sem conexão", nunca "nenhum envio" (V37). Nunca rejeita.
 */
export async function enviosDoAlvoPelaNuvem(
  tenantId: string,
  alvo: AlvoIfood,
  refId: string,
  buscar: typeof fetch = fetch,
): Promise<RespostaEnvios> {
  const sem = (motivo: string): RespostaEnvios => {
    log.warn(`último envio ao iFood sem a nuvem (${motivo}) — a tela mostra "sem conexão".`);
    return { envios: [], semConexao: true };
  };
  const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
  const token = process.env.SYNC_TOKEN ?? '';
  if (!nuvem || !token) return sem('sem CLOUD_API/SYNC_TOKEN no servidor da loja');
  try {
    const res = await buscar(`${nuvem}/orzuni/loja/envios?alvo=${alvo}&ref=${refId}`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return sem(`HTTP ${res.status}`);
    const j: any = await res.json();
    if (j?.tenantId !== tenantId) return sem('a nuvem respondeu por outra empresa');
    if (!Array.isArray(j?.envios)) return sem('a nuvem respondeu sem a lista');
    return { envios: j.envios as EnvioDoAlvo[], semConexao: false };
  } catch (e: any) {
    return sem(e?.cause?.code ?? e?.name ?? e?.message ?? String(e));
  }
}

/** Os envios do item, por loja (nome) e tipo (preço antes da pausa). Só nuvem. */
export async function enviosDoAlvo(db: any, tenantId: string, alvo: AlvoIfood, refId: string): Promise<EnvioDoAlvo[]> {
  if (!ehAlvoIfood(alvo) || !ehIdDoAlvo(refId)) return [];
  const tipos = TIPOS[alvo];
  const r: any = await db.execute(sql`
    select e.unidade_id, u.nome as loja, e.tipo, e.situacao, e.resultado, e.resposta, e.tentativas,
           coalesce(e.enviado_em, e.marcado_em) as quando
      from orzuni_envio e
      left join unidade u on u.id = e.unidade_id
     where e.tenant_id = ${tenantId} and e.ref_id = ${refId}
       and e.tipo in (${sql.join(tipos.map((t) => sql`${t}`), sql`, `)})
     order by u.nome nulls last, e.tipo`);
  return ((r.rows ?? r) as any[]).map(envioParaTela);
}
