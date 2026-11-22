import { Agora, EstadoDaRegra, LinhaDaFonte, Regra, avaliarRegra, linhasDaRegra, olhaAgora } from './mister-regra';

// A CONFERÊNCIA DO DIA DE UMA REGRA (versão 7, V7c; protótipo `mockups/regem-mister-v7.html`, "Não está funcionando"). Conta
// pura, sem banco: refaz o dia minuto a minuto com os horários que cada pedido gravou, monta a MESMA linha que o motor veria
// naquele minuto e passa pelo MESMO `avaliarRegra`. Assim "hoje o máximo foi 2 às 20:48" e "teria avisado às 20:52" saem da
// regra de verdade, sem uma segunda conta que possa discordar do motor.

/** O canal e o tipo como a regra os enxerga (a leitura do motor usa estas mesmas funções). */
export const canalDoPedido = (c: unknown): string => {
  const v = String(c ?? '').toLowerCase();
  if (v === '99food' || v === 'food99' || v === '99') return '99';
  return ['cardapio', 'ifood', 'whatsapp'].includes(v) ? v : 'outro';
};
export const tipoDoPedido = (t: unknown): string => (['entrega', 'retirada'].includes(String(t ?? '')) ? String(t) : 'outro');

/** O pedido com os horários em milissegundos, já sem buraco (ver `pedidoDoDia`). */
export interface PedidoDoDia {
  id: string;
  rotulo: string;
  unidadeId: string | null;
  numero: number | null;
  canal: string;
  tipo: string;
  agendado: boolean;
  valor: number | null;
  criadoEm: number;
  confirmadoEm: number | null;
  prontoEm: number | null;
  despachadoEm: number | null;
  /** Entregue ou concluído. */
  fimEm: number | null;
  canceladoEm: number | null;
}

export interface PedidoLido {
  id: string;
  rotulo: string;
  unidadeId?: string | null;
  numero?: unknown;
  canal?: unknown;
  tipo?: unknown;
  agendado?: unknown;
  valor?: unknown;
  status?: unknown;
  criadoEm: string | Date;
  confirmadoEm?: string | Date | null;
  prontoEm?: string | Date | null;
  despachadoEm?: string | Date | null;
  entregueEm?: string | Date | null;
  concluidoEm?: string | Date | null;
  canceladoEm?: string | Date | null;
}

const ms = (v: string | Date | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : null;
};

/**
 * Os horários do pedido, fechando o buraco de quem chegou à situação sem carimbar a etapa (pedido antigo, canal que pula
 * etapa): a etapa sem hora dura zero, na hora mais próxima que se conhece. Sem isso, um pedido já entregue e sem `pronto_em`
 * contaria como "em preparo" até o fim do dia e a conferência diria um máximo que nunca existiu.
 */
export function pedidoDoDia(p: PedidoLido): PedidoDoDia {
  const status = String(p.status ?? '');
  const criadoEm = ms(p.criadoEm) ?? 0;
  let confirmadoEm = ms(p.confirmadoEm);
  let prontoEm = ms(p.prontoEm);
  let despachadoEm = ms(p.despachadoEm);
  let fimEm = ms(p.entregueEm) ?? ms(p.concluidoEm);
  let canceladoEm = status === 'cancelado' ? ms(p.canceladoEm) : null;
  const ultimaConhecida = () => Math.max(criadoEm, confirmadoEm ?? 0, prontoEm ?? 0, despachadoEm ?? 0);
  if (status === 'cancelado') canceladoEm ??= ultimaConhecida();
  if (status === 'entregue' || status === 'concluido') fimEm ??= ultimaConhecida();
  if (status !== 'cancelado' && status !== 'entregue' && status !== 'concluido') fimEm = null;
  const seguinte = (...v: Array<number | null>) => v.find((x): x is number => x !== null) ?? criadoEm;
  if (status === 'despachado') despachadoEm ??= seguinte(prontoEm, confirmadoEm);
  if (status === 'pronto') prontoEm ??= seguinte(confirmadoEm);
  if (['confirmado', 'pronto', 'despachado', 'entregue', 'concluido'].includes(status)) confirmadoEm ??= seguinte(prontoEm, despachadoEm, fimEm);
  const n = p.numero === null || p.numero === undefined || p.numero === '' ? null : Number(p.numero);
  const v = p.valor === null || p.valor === undefined || p.valor === '' ? null : Math.round(Number(p.valor) * 100) / 100;
  return {
    id: p.id,
    rotulo: p.rotulo,
    unidadeId: p.unidadeId ?? null,
    numero: n,
    canal: canalDoPedido(p.canal),
    tipo: tipoDoPedido(p.tipo),
    agendado: p.agendado === true,
    valor: v,
    criadoEm,
    confirmadoEm,
    prontoEm,
    despachadoEm,
    fimEm,
    canceladoEm,
  };
}

const ja = (v: number | null, t: number) => v !== null && v <= t;

/** A situação do pedido naquele instante, na ordem de quem pesa mais. */
export function situacaoNoInstante(p: PedidoDoDia, t: number): string {
  if (ja(p.canceladoEm, t)) return 'cancelado';
  if (ja(p.fimEm, t)) return 'entregue';
  if (ja(p.despachadoEm, t)) return 'a_caminho';
  if (ja(p.prontoEm, t)) return 'pronto';
  if (ja(p.confirmadoEm, t)) return 'em_preparo';
  return 'aguardando_aceite';
}

const inteiros = (de: number, ate: number) => Math.max(0, Math.floor((ate - de) / 60_000));

/** A linha que a leitura do motor (`mister-regras.service`, fonte `pedidos`) montaria naquele instante. */
export function linhaNoInstante(p: PedidoDoDia, t: number): LinhaDaFonte {
  const situacao = situacaoNoInstante(p, t);
  const aceito = ja(p.confirmadoEm, t);
  const ateProntoMin = !aceito ? null : ja(p.prontoEm, t) ? inteiros(p.confirmadoEm!, p.prontoEm!) : situacao === 'em_preparo' ? inteiros(p.confirmadoEm!, t) : null;
  const ateSaidaMin = !aceito
    ? null
    : ja(p.despachadoEm, t)
      ? inteiros(p.confirmadoEm!, p.despachadoEm!)
      : situacao === 'em_preparo' || situacao === 'pronto'
        ? inteiros(p.confirmadoEm!, t)
        : null;
  return {
    id: p.id,
    alvoId: p.id,
    rotulo: p.rotulo,
    unidadeId: p.unidadeId,
    campos: {
      numero: p.numero,
      canal: p.canal,
      situacao,
      tipo: p.tipo,
      min_desde_chegada: inteiros(p.criadoEm, t),
      min_desde_aceite: aceito ? inteiros(p.confirmadoEm!, t) : null,
      min_aceite_ate_pronto: ateProntoMin,
      min_aceite_ate_saida: p.tipo === 'entrega' || ateSaidaMin === null ? ateSaidaMin : null,
      agendado: p.agendado,
      valor: p.valor,
    },
  };
}

export interface ResumoDoDia {
  /** O máximo de pedidos que a regra pegaria ao mesmo tempo, nas horas em que ela olha. */
  maximo: number;
  maximoEm: number | null;
  /** Quantas mensagens a regra teria mandado desde que foi ligada. */
  avisos: number;
  primeiroAvisoEm: number | null;
  /** De quantos em quantos minutos a conta olhou (1, salvo em dia com pedidos demais). */
  passoMin: number;
}

/** A leitura do motor olha as últimas 12 horas: a conta do dia enxerga o mesmo. */
const JANELA_DA_FONTE_MS = 12 * 3_600_000;
/** O teto de linhas montadas numa conferência: em dia enorme, a conta olha de 2 em 2 minutos e não segura o processo. */
const TETO_DE_LINHAS = 120_000;

/**
 * Refaz o dia da regra, de `de` até `ate`. `ligadaEm`: antes disso a regra não existia, então conta para o máximo, mas não
 * para "teria avisado". `agoraDe` é o relógio da loja (entra por fora: a conta segue pura).
 */
export function simularRegraNoDia(r: Regra, pedidos: PedidoDoDia[], o: { de: number; ate: number; ligadaEm?: number | null; agoraDe: (t: number) => Agora }): ResumoDoDia {
  const inicio = Math.ceil(o.de / 60_000) * 60_000;
  const minutos = Math.max(0, Math.floor((o.ate - inicio) / 60_000)) + 1;
  const passoMin = Math.max(1, Math.ceil((pedidos.length * minutos) / TETO_DE_LINHAS));
  const ordenados = [...pedidos].sort((a, b) => a.criadoEm - b.criadoEm);
  // A situação pedida corta a maior parte das linhas antes de montá-las.
  const filtroSituacao = r.filtros.find((f) => f.campo === 'situacao' && (f.op === '=' || f.op === 'em'));
  const situacoes = filtroSituacao ? new Set((Array.isArray(filtroSituacao.valor) ? filtroSituacao.valor : [filtroSituacao.valor]).map(String)) : null;
  let entrou = 0;
  let saiu = 0;
  let estado: EstadoDaRegra = {};
  const fora: ResumoDoDia = { maximo: 0, maximoEm: null, avisos: 0, primeiroAvisoEm: null, passoMin };
  for (let t = inicio; t <= o.ate; t += passoMin * 60_000) {
    while (entrou < ordenados.length && ordenados[entrou].criadoEm <= t) entrou++;
    while (saiu < entrou && t - ordenados[saiu].criadoEm >= JANELA_DA_FONTE_MS) saiu++;
    const linhas: LinhaDaFonte[] = [];
    for (let i = saiu; i < entrou; i++) {
      if (situacoes && !situacoes.has(situacaoNoInstante(ordenados[i], t))) continue;
      linhas.push(linhaNoInstante(ordenados[i], t));
    }
    const agora = o.agoraDe(t);
    if (olhaAgora(r, {}, agora)) {
      const pegas = linhasDaRegra(r, linhas).length;
      if (pegas > fora.maximo) {
        fora.maximo = pegas;
        fora.maximoEm = t;
      }
    }
    if (o.ligadaEm === null || o.ligadaEm === undefined || t >= o.ligadaEm) {
      const a = avaliarRegra(r, linhas, estado, agora);
      estado = a.estado;
      if (a.disparos.length) {
        fora.avisos += a.disparos.length;
        fora.primeiroAvisoEm ??= t;
      }
    }
  }
  return fora;
}

const CAMPOS_DE_TEMPO = ['min_desde_aceite', 'min_desde_chegada', 'min_aceite_ate_pronto', 'min_aceite_ate_saida'];

/** O tempo que a regra exige ("acima de 25 min"), quando ela tem um. */
export function limiteDeTempo(r: Regra): { campo: string; minutos: number } | null {
  const f = r.filtros.find((x) => CAMPOS_DE_TEMPO.includes(x.campo) && (x.op === '>' || x.op === '>=') && typeof x.valor === 'number');
  return f ? { campo: f.campo, minutos: f.valor as number } : null;
}

/** A mesma regra com outro tempo: para dizer o que aconteceria "com 20 min". */
export function comOutroLimite(r: Regra, minutos: number): Regra {
  const l = limiteDeTempo(r);
  if (!l) return r;
  return { ...r, filtros: r.filtros.map((f) => (f.campo === l.campo && (f.op === '>' || f.op === '>=') ? { ...f, valor: minutos } : f)) };
}

/** O tempo a menos que a conferência testa quando a regra não avisou. */
export const FOLGA_DA_SUGESTAO_MIN = 5;

/** O começo do dia de trabalho: as 06:00 de hoje, ou as de ontem na madrugada (a noite que passa da meia-noite é um dia só). */
export function inicioDoDiaDeTrabalho(a: Agora): number {
  const hm = Number(a.hora.slice(0, 2)) * 60 + Number(a.hora.slice(3, 5));
  const desde = hm >= 360 ? hm - 360 : hm + 1080;
  return Math.floor(a.instante.getTime() / 60_000) * 60_000 - desde * 60_000;
}
