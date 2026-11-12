// AS REGRAS DOS AVISOS GUARDADOS DO KDS (auditoria do KDS de 11/11/2026, onda 3 — mig 412), sem banco: o que a tela recebe
// de uma linha da `alerta_kds`, e como um envio do transporte do Farol vira um aviso da cozinha (contrato
// `contratos/transporte-dos-alertas.json` do Farol). O serviço (`alerta-kds.service`) e o transporte
// (`farol-alertas.service`) usam estas funções; o spec confere caso a caso.
import { ehTipoDeAviso, prioridadeDoKds, type TipoDeAviso } from '../../common/avisos-do-kds';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O aviso como a tela do KDS o recebe (`kds:alerta`): o mesmo formato ao vivo, na recuperação e no histórico. */
export type AvisoDaTela = {
  id: string;
  titulo: string;
  detalhe: string;
  prioridade: 'danger' | 'alta' | 'info' | 'ok';
  duracaoSeg: number;
  som: boolean;
  tipo: TipoDeAviso;
  kds: string[] | null;
  fica: boolean;
  em: string;
  origem: string | null;
};

/** Os KDS de um aviso: só ids válidos, no máximo 50; vazio = todos (nulo). */
export function kdsDoAviso(kds: unknown): string[] | null {
  const ids = Array.isArray(kds) ? [...new Set(kds.map(String).filter((id) => UUID_RE.test(id)))].slice(0, 50) : [];
  return ids.length ? ids : null;
}

/** Quanto tempo fica no rodapé: de 3 s a 1 h (60 s sem número). */
export const duracaoDoAviso = (s: unknown): number => Math.max(3, Math.min(3600, Number(s) || 60));

/** A linha guardada (`alerta_kds`, como o drizzle devolve ou em snake_case do SQL cru) → o aviso da tela. */
export function avisoDaLinha(r: any): AvisoDaTela {
  const em = r.criadoEm ?? r.criado_em;
  return {
    id: String(r.id),
    titulo: String(r.titulo ?? 'Alerta'),
    detalhe: String(r.detalhe ?? ''),
    prioridade: prioridadeDoKds(r.prioridade),
    duracaoSeg: duracaoDoAviso(r.duracaoSeg ?? r.duracao_seg),
    som: true,
    tipo: ehTipoDeAviso(r.tipo) ? r.tipo : 'loja',
    kds: kdsDoAviso(r.kdsIds ?? r.kds_ids),
    fica: (r.fica ?? false) === true,
    em: em instanceof Date ? em.toISOString() : new Date(em ?? Date.now()).toISOString(),
    origem: r.origem ?? null,
  };
}

// ───────────────────────────── o Farol (transporte dos alertas) ─────────────────────────────

const SEVERIDADES = ['emergencia', 'critico', 'atencao', 'info'] as const;
const PRIORIDADES = ['urgente', 'intermediaria', 'leve'] as const;
const NOME_DA_SEVERIDADE: Record<string, string> = { emergencia: 'emergência', critico: 'crítico', atencao: 'atenção', info: 'informação' };

/** O aviso que um envio do Farol vira na cozinha, ou o motivo de não entregar (vai ao Farol no `resultado`). */
export type AvisoDoFarol =
  | {
      ok: true;
      regemLojaId: string;
      titulo: string;
      detalhe: string;
      prioridade: 'danger' | 'alta' | 'info';
      fica: boolean;
      duracaoSeg: number;
      origem: string;
      ref: string;
      ocorridoEm: string | null;
    }
  | { ok: false; erro: string };

/**
 * Um envio de `POST /v1/envios/reivindicar` → o aviso da cozinha. Decisões (protótipo aprovado, aba 1: "Emergência e
 * urgente ficam até o Ciente; os outros correm na faixa"):
 *  • a cor vem da SEVERIDADE: emergência e crítico = urgente (vermelho, bipe forte); atenção = alta; informação = info;
 *  • fica até o "Ciente" a emergência e o que o Farol marcou como prioridade urgente; o resto corre 2 min na faixa;
 *  • o título é o do Farol com o lugar (`onde`: canal › quadro) entre parênteses; o detalhe, o do Farol.
 * Sem o `alerta` (Farol antigo) ou sem a loja do Regem: não entrega, com o motivo — o Farol deixa o envio na fila dele.
 */
export function avisoDoFarol(envio: any): AvisoDoFarol {
  const id = String(envio?.id ?? '');
  if (!UUID_RE.test(id)) return { ok: false, erro: 'envio sem id' };
  const a = envio?.alerta;
  if (!a || typeof a !== 'object') return { ok: false, erro: 'o envio veio sem o alerta montado (Farol desatualizado?)' };
  const loja = String(a?.loja?.regem_loja_id ?? '');
  if (!UUID_RE.test(loja)) return { ok: false, erro: 'o alerta veio sem a loja do Regem ligada (Conexões)' };
  const titulo = String(a.titulo ?? '').trim() || 'Aviso do Farol';
  const onde = String(a.onde ?? '').trim();
  const severidade = (SEVERIDADES as readonly string[]).includes(a.severidade) ? a.severidade : 'atencao';
  const prioridadeFarol = (PRIORIDADES as readonly string[]).includes(a.prioridade) ? a.prioridade : 'intermediaria';
  const prioridade = severidade === 'emergencia' || severidade === 'critico' ? 'danger' : severidade === 'atencao' ? 'alta' : 'info';
  const ocorrido = a.ocorrido_em && !Number.isNaN(Date.parse(a.ocorrido_em)) ? new Date(a.ocorrido_em).toISOString() : null;
  return {
    ok: true,
    regemLojaId: loja,
    titulo: `Farol — ${titulo}${onde ? ` (${onde})` : ''}`.slice(0, 200),
    detalhe: String(a.detalhe ?? '').trim().slice(0, 500),
    prioridade,
    fica: severidade === 'emergencia' || prioridadeFarol === 'urgente',
    duracaoSeg: 120,
    origem: `Farol · ${NOME_DA_SEVERIDADE[severidade]}`,
    ref: `farol:${id}`,
    ocorridoEm: ocorrido,
  };
}
