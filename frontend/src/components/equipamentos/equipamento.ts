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
  { value: 'servidor_local', label: 'Servidor local (edge)' },
];
const TIPO_LABEL: Record<string, string> = {
  pdv: 'Terminal de PDV',
  salao: 'Sub-PDV Salão',
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  impressora: 'Impressora',
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
/** Só as impressoras desta loja (ou sem loja) — o servidor recusa a de outra loja. */
export const daLoja = (unidadeId: string | null | undefined) => (e: any) => !unidadeId || !e.unidadeId || e.unidadeId === unidadeId;

export type SituacaoEq = 'ativo' | 'nunca' | 'mudo' | 'revogado';
export const SITUACAO: Record<SituacaoEq, { tom: Tom; rotulo: string }> = {
  ativo: { tom: 'ok', rotulo: 'ativo' },
  nunca: { tom: 'aviso', rotulo: 'nunca conectou' },
  mudo: { tom: 'critico', rotulo: 'sem responder' },
  revogado: { tom: 'neutro', rotulo: 'revogado' },
};
/**
 * A situação do equipamento. A impressora não "conecta" (quem fala com ela é o servidor): vale o
 * estado da última impressão — `estado` vem de `/impressao/impressoras/estado`, por id.
 */
export function situacaoDe(e: any, estado: Record<string, any>): SituacaoEq {
  if (!e.ativo) return 'revogado';
  if (e.tipo === 'impressora') return estado[e.id]?.semResponder ? 'mudo' : 'ativo';
  return e.ultimoPing || e.integradorVistoEm ? 'ativo' : 'nunca';
}

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const minutosDesde = (iso?: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);

/** A coluna "Último acesso": para a impressora, a última impressão ou a fila parada. */
export function vistoDe(e: any, estado: Record<string, any>): string {
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
    case 'impressora':
      return [
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
