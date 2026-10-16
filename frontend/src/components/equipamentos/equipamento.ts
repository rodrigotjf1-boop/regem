import type { Tom } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O que as partes da tela de Equipamentos têm em comum: os tipos, a situação de cada equipamento
// e como ele se apresenta numa linha.

export const TIPOS = [
  { value: 'pdv', label: 'Terminal de PDV (caixa)' },
  { value: 'salao', label: 'Sub-PDV Salão (garçom)' },
  { value: 'terminal_ponto', label: 'Terminal de Ponto' },
  { value: 'kds', label: 'KDS (cozinha)' },
  { value: 'impressora', label: 'Impressora térmica' },
  { value: 'estacao_impressao', label: 'Estação de impressão (PC com impressora)' },
  { value: 'servidor_local', label: 'Servidor local (edge)' },
];
const TIPO_LABEL: Record<string, string> = {
  pdv: 'Terminal de PDV',
  salao: 'Sub-PDV Salão',
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  impressora: 'Impressora',
  estacao_impressao: 'Estação de impressão',
  servidor_local: 'Servidor local',
  ponto_baixa: 'Ponto de baixa',
};
export const tipoDe = (e: any): string => TIPO_LABEL[e.tipo] ?? String(e.tipo);
export const ESCOPOS = [
  { v: 'producao', rotulo: 'Produção (pedidos)' },
  { v: 'entrega', rotulo: 'Entrega (retirada por senha)' },
  { v: 'avisos', rotulo: 'Só avisos (tarefas/picos)' },
];
export const ETAPAS = [
  { v: 'preparo', rotulo: 'ao iniciar preparo' },
  { v: 'pronto', rotulo: 'ao ficar pronto' },
  { v: 'entregue', rotulo: 'ao despachar/entregar' },
];
export const ehGogem = (e: any) => e.integrador === 'gogem';
/** Uma impressora só tem para onde imprimir se: rede → tem IP; local → tem nome no Windows. */
export const alvoValido = (e: any) => (e.conexao === 'local' ? !!e.dispositivo : !!e.host);
/**
 * Os KDS e impressoras para escolher como DESTINO DE PRODUÇÃO (setor, produto, opção,
 * direcionamento): só os em uso. Um destino já marcado que saiu de uso continua na lista para ser
 * desmarcado — o servidor recusa salvar com ele (`common/destino-producao.ts`).
 */
export const destinosParaEscolher = (todos: any[], marcados: string[] = []) =>
  todos.filter((e) => (e.tipo === 'kds' || e.tipo === 'impressora') && (e.ativo !== false || marcados.includes(e.id)));
/** Fora de uso = revogado (Equipamentos) ou desligado (Impressoras e cupons): os dois gravam `ativo = false`. */
export const foraDeUso = (e: any) => e?.ativo === false;
/** Só as impressoras desta loja (ou sem loja) — o servidor recusa a de outra loja. */
export const daLoja = (unidadeId: string | null | undefined) => (e: any) => !unidadeId || !e.unidadeId || e.unidadeId === unidadeId;

export type SituacaoEq = 'ativo' | 'atencao' | 'nunca' | 'mudo' | 'revogado';
export const SITUACAO: Record<SituacaoEq, { tom: Tom; rotulo: string }> = {
  ativo: { tom: 'ok', rotulo: 'ativo' },
  atencao: { tom: 'aviso', rotulo: 'precisa de atenção' },
  nunca: { tom: 'aviso', rotulo: 'nunca conectou' },
  mudo: { tom: 'critico', rotulo: 'sem responder' },
  revogado: { tom: 'neutro', rotulo: 'revogado' },
};

// O que a impressora RESPONDEU (mig 324; `ESTADOS_IMPRESSORA` do servidor). "pronta" não vira selo.
export const ESTADO_IMPRESSORA: Record<string, { tom: Tom; rotulo: string }> = {
  papel_acabando: { tom: 'aviso', rotulo: 'papel acabando' },
  sem_papel: { tom: 'critico', rotulo: 'sem papel' },
  tampa_aberta: { tom: 'critico', rotulo: 'tampa aberta' },
  erro: { tom: 'critico', rotulo: 'erro na impressora' },
  parada: { tom: 'critico', rotulo: 'parada' },
  sem_resposta: { tom: 'critico', rotulo: 'sem resposta' },
};

/** A estação bate a cada minuto (`ESTACAO_BATIDA_MS`); sem batida por 3 min, está fora. */
export const ESTACAO_FORA_MIN = 3;
const estacaoDe = (id: string | null | undefined, todos: any[]) => (id ? todos.find((x) => x.id === id) : undefined);
const estacaoNoAr = (s: any) => !!s?.ativo && !!s.estacao?.vistoEm && minutosDesde(s.estacao.vistoEm) < ESTACAO_FORA_MIN;

/**
 * A situação do equipamento. A impressora não "conecta" (quem fala com ela é o servidor ou a
 * estação): vale o estado da última impressão e o que ela respondeu — `estado` vem de
 * `/impressao/impressoras/estado`, por id. A estação, pela última batida (`e.estacao`).
 */
export function situacaoDe(e: any, estado: Record<string, any>, todos: any[] = []): SituacaoEq {
  if (!e.ativo) return 'revogado';
  if (e.tipo === 'estacao_impressao') {
    if (estacaoNoAr(e)) return 'ativo';
    return e.estacao?.vistoEm || e.pareado ? 'mudo' : 'nunca';
  }
  if (e.tipo === 'impressora') {
    const s = estado[e.id];
    if (s?.semResponder) return 'mudo';
    if (s?.estado && ESTADO_IMPRESSORA[s.estado]) return 'atencao';
    if (e.estacaoId && !estacaoNoAr(estacaoDe(e.estacaoId, todos))) return 'atencao';
    return 'ativo';
  }
  return e.ultimoPing || e.integradorVistoEm ? 'ativo' : 'nunca';
}

/** O selo da coluna "Situação": o estado que a impressora respondeu, ou a estação no ar / fora. */
export function seloDe(e: any, estado: Record<string, any>, todos: any[] = []): { tom: Tom; rotulo: string } {
  const sit = situacaoDe(e, estado, todos);
  if (e.tipo === 'estacao_impressao') {
    if (sit === 'ativo') return { tom: 'ok', rotulo: 'no ar' };
    if (sit === 'mudo') return { tom: 'critico', rotulo: e.estacao?.vistoEm ? `fora · há ${tempoDesde(e.estacao.vistoEm)}` : 'fora' };
  }
  if (e.tipo === 'impressora' && sit === 'atencao') {
    const s = estado[e.id];
    if (s?.estado && ESTADO_IMPRESSORA[s.estado]) return ESTADO_IMPRESSORA[s.estado];
    return { tom: 'aviso', rotulo: 'esperando a estação' };
  }
  return SITUACAO[sit];
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const minutosDesde = (iso?: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
const tempoDesde = (iso: string) => {
  const m = minutosDesde(iso);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)} h` : `${Math.floor(m / 1440)} dias`;
};

/** A coluna "Último acesso": para a impressora, a última impressão ou a fila parada. */
export function vistoDe(e: any, estado: Record<string, any>): string {
  if (e.tipo === 'estacao_impressao') return e.estacao?.vistoEm ? dataHora(e.estacao.vistoEm) : '—';
  if (e.tipo === 'impressora') {
    const s = estado[e.id];
    if (!s) return '—';
    if (s.pendentes > 0) return `${s.pendentes} ${s.pendentes === 1 ? 'ticket esperando' : 'tickets esperando'}${s.maisAntigoEm ? ` há ${minutosDesde(s.maisAntigoEm)} min` : ''}`;
    if (s.semResponder && s.ultimaFalhaEm) return `sem responder desde ${dataHora(s.ultimaFalhaEm)}`;
    return s.ultimoOkEm ? `última impressão ${dataHora(s.ultimoOkEm)}` : '—';
  }
  const visto = e.ultimoPing ?? e.integradorVistoEm;
  return visto ? dataHora(visto) : '—';
}

/** A coluna "Ligação": a que o equipamento está preso (impressora do caixa, PDV principal, IP…). */
export function ligacaoDe(e: any, todos: any[]): string {
  const nome = (id?: string | null) => todos.find((x) => x.id === id)?.nome;
  switch (e.tipo) {
    case 'pdv':
      if (ehGogem(e)) return 'credencial do totem';
      return e.impressoraPadraoId ? `cupom: ${nome(e.impressoraPadraoId) ?? 'impressora fora da lista'}` : 'sem impressora de cupom';
    case 'salao':
      return e.pdvMainId ? `principal: ${nome(e.pdvMainId) ?? 'PDV fora da lista'}` : 'sem PDV principal';
    case 'terminal_ponto':
      return e.padrao ? 'REP-Software' : '—';
    case 'kds':
      return [
        e.escopo === 'avisos' ? 'só avisos' : e.escopo === 'entrega' ? 'entrega (retirada por senha)' : 'produção',
        e.imprimeAoAvancar ? `imprime ${ETAPAS.find((x) => x.v === (e.imprimeNoStatus ?? 'pronto'))?.rotulo ?? 'ao avançar'}` : '',
        e.proximoKdsId ? `próximo: ${nome(e.proximoKdsId) ?? 'KDS fora da lista'}` : '',
      ].filter(Boolean).join(' · ');
    case 'estacao_impressao': {
      const ligadas = todos.filter((x) => x.tipo === 'impressora' && x.ativo && x.estacaoId === e.id).length;
      return [
        e.estacao?.maquina ? `PC: ${e.estacao.maquina}` : e.pareado ? '' : 'falta parear',
        ligadas ? `${ligadas} ${ligadas === 1 ? 'impressora ligada' : 'impressoras ligadas'}` : 'nenhuma impressora ligada',
        e.estacao?.versao ? `versão ${e.estacao.versao}` : '',
      ].filter(Boolean).join(' · ');
    }
    case 'impressora':
      return [
        e.estacaoId ? `ligada em ${estacaoDe(e.estacaoId, todos)?.nome ?? 'estação fora da lista'}` : '',
        e.conexao === 'local' ? `USB: ${e.dispositivo || '(sem nome)'}` : e.host ? `${e.host}:${e.porta ?? 9100}` : 'sem destino',
        `${e.largura ?? 80} mm`,
        e.fazEtiqueta ? 'etiqueta' : [e.fazCupom ? 'cupom' : '', e.fazProducao ? 'produção' : ''].filter(Boolean).join(' + ') || 'não imprime nada',
        (e.setoresAtendidos?.length ?? 0) > 0 ? `${e.setoresAtendidos.length} ${e.setoresAtendidos.length === 1 ? 'setor' : 'setores'}` : '',
      ].filter(Boolean).join(' · ');
    case 'servidor_local':
      return ehGogem(e) ? 'credencial do totem' : 'servidor da loja';
    default:
      return '—';
  }
}
