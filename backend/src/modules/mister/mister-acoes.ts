import {
  CANAIS_DA_PAUSA,
  CanalDaPausa,
  MOTIVOS,
  MOTIVOS_DA_PAUSA,
  NOME_DO_CANAL,
  TEMPOS_DA_99,
  TEMPOS_DO_CARDAPIO,
  ateDa99,
  ateDoCardapio,
  lerMotivo,
  voltaDaPausa,
} from '../../common/pausa-do-canal';

// AS AÇÕES DO MISTER — a porta `propor_acao` (versão 6, M6j; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão
// 6", Frente C — "Uma porta só para as ações"; protótipo `mockups/regem-mister-v6.html`, "Fazer pelo WhatsApp, com
// segurança"). As consultas seguem como ferramentas; as AÇÕES passam por uma ferramenta só, com o catálogo e o formato de
// cada uma conferidos AQUI, pelo código. A ação só acontece no "Autorizar" de quem pediu (o tamanho do risco: botão), pelo
// MESMO serviço da tela, e o "feito" só sai com o efeito conferido. Lote 1: o Delivery (os canais e os pedidos).

/** O catálogo das ações. Ação nova entra aqui, com a execução pelo serviço da tela e a conferência do efeito. */
export const ACOES_DO_MISTER = ['pausar_canal', 'reabrir_canal', 'aceitar_pedido', 'pedido_pronto', 'despachar_pedido'] as const;
export type AcaoDoMister = (typeof ACOES_DO_MISTER)[number];
export const ehAcaoDoMister = (p: unknown): p is AcaoDoMister => (ACOES_DO_MISTER as readonly string[]).includes(String(p));

export interface DefinicaoDaAcao {
  id: AcaoDoMister;
  /** O tamanho do risco (decisão do plano): o botão de quem pediu. As de PIN (preço, horário, pagar) são os lotes seguintes. */
  nivel: 'botao';
  /** A permissão do perfil — a MESMA da rota da tela. O presidente pode tudo. */
  permissao: 'delivery';
  /** Por quanto tempo a pergunta vale. */
  prazoMin: number;
  /** O nome curto, para a auditoria e o histórico das propostas. */
  nome: string;
}

export const ACOES: Record<AcaoDoMister, DefinicaoDaAcao> = {
  pausar_canal: { id: 'pausar_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'pausar canais de venda' },
  reabrir_canal: { id: 'reabrir_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'reabrir canais de venda' },
  aceitar_pedido: { id: 'aceitar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'aceitar um pedido' },
  pedido_pronto: { id: 'pedido_pronto', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'marcar um pedido como pronto' },
  despachar_pedido: { id: 'despachar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'despachar um pedido' },
};

/** O canal como a pessoa (ou a IA) diz: "cardapio", "ifood", "99" (ou o nome interno "food99"). */
export function lerCanal(v: unknown): CanalDaPausa | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === '99' || t === 'food99' || t === '99food') return 'food99';
  if (t === 'cardapio' || t === 'cardapio digital') return 'cardapio';
  if (t === 'ifood') return 'ifood';
  return null;
}

/** "o iFood", "o iFood e a 99", "o cardápio digital, o iFood e a 99". */
export function nomesDosCanais(canais: readonly CanalDaPausa[]): string {
  const um = (c: CanalDaPausa) => (c === 'food99' ? 'a 99' : c === 'ifood' ? 'o iFood' : 'o cardápio digital');
  const n = canais.map(um);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

/** O que a ação leva, já conferido (vai em `mister_proposta.parametros`, junto com quem pediu). */
export type ParametrosDaAcao =
  | { acao: 'pausar_canal'; canais: CanalDaPausa[]; motivo: string; motivoTexto: string | null; minutos: number | null; ate: string | null; fimDoDia: boolean }
  | { acao: 'reabrir_canal'; canais: CanalDaPausa[] }
  | { acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido'; numero: string };

const TEMPOS_TEXTO = `cardápio digital e iFood: ${TEMPOS_DO_CARDAPIO.join(', ')} min ou "até HH:MM"; 99: ${TEMPOS_DA_99.join(', ')} min ou até o fim do dia`;

/**
 * Confere o que a IA mandou para a ação — os MESMOS limites da tela (o motivo, os tempos de cada canal). Devolve os
 * parâmetros limpos e o "o que vou fazer" da pergunta, ou o erro em português (volta à IA, que pergunta à pessoa).
 */
export function conferirAcao(acao: unknown, en: Record<string, unknown>, agora: Date = new Date()): { parametros: ParametrosDaAcao; resumo: string } | { erro: string } {
  if (!ehAcaoDoMister(acao)) return { erro: `Essa ação não existe. As ações são: ${ACOES_DO_MISTER.join(', ')}.` };
  if (acao === 'pausar_canal' || acao === 'reabrir_canal') {
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const canais = [...new Set(brutos.map(lerCanal))];
    if (!canais.length || canais.some((c) => c === null)) return { erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' };
    const lista = (CANAIS_DA_PAUSA as readonly CanalDaPausa[]).filter((c) => canais.includes(c));
    if (acao === 'reabrir_canal') return { parametros: { acao, canais: lista }, resumo: `Reabrir ${nomesDosCanais(lista)} agora.` };
    const m = lerMotivo(en.motivo, en.motivoTexto);
    if (!m.ok) return { erro: `${m.erro} Os motivos: ${MOTIVOS.join(', ')} (outro pede o texto, até 80 letras).` };
    const minutos = en.minutos === undefined || en.minutos === null || en.minutos === '' ? null : Number(en.minutos);
    const ate = typeof en.ate === 'string' && en.ate.trim() ? en.ate.trim() : null;
    const fimDoDia = en.fimDoDia === true;
    const voltas: string[] = [];
    for (const c of lista) {
      const r = c === 'food99' ? ateDa99({ minutos, fimDoDia }, agora) : ateDoCardapio(minutos !== null ? { minutos } : { ate }, agora);
      if (!r.ok) return { erro: `${NOME_DO_CANAL[c]}: ${r.erro} Os tempos: ${TEMPOS_TEXTO}.` };
      voltas.push(`${nomesDosCanais([c])} ${voltaDaPausa(r.ate, agora).texto}`);
    }
    const motivo = m.motivo === 'outro' ? m.motivoTexto! : MOTIVOS_DA_PAUSA[m.motivo].rotulo;
    return {
      parametros: { acao, canais: lista, motivo: m.motivo, motivoTexto: m.motivoTexto, minutos, ate, fimDoDia },
      resumo: `Pausar ${nomesDosCanais(lista)} (motivo: ${motivo}). Volta: ${voltas.join('; ')}.`,
    };
  }
  const numero = String(en.numero ?? '').trim().replace(/^#/, '');
  if (!numero || numero.length > 40) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
  return { parametros: { acao, numero }, resumo: '' };
}

/** A situação que cada ação de pedido exige, e o que a pessoa vê quando o pedido está em outra. */
export function pedidoServe(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', p: { status: string; tipo: string | null }): string | null {
  if (p.status === 'cancelado') return 'Esse pedido está cancelado.';
  if (acao === 'aceitar_pedido') return p.status === 'novo' ? null : 'Esse pedido já foi aceito.';
  if (p.status === 'novo') return 'Esse pedido ainda não foi aceito: aceite antes.';
  if (acao === 'pedido_pronto') return p.status === 'confirmado' ? null : 'Esse pedido não está em preparo (já ficou pronto ou já saiu).';
  if (p.tipo === 'retirada') return 'Esse pedido é para retirar: ele não sai para entrega.';
  return p.status === 'confirmado' || p.status === 'pronto' ? null : 'Esse pedido já saiu para a entrega.';
}

/** O "o que vou fazer" das ações de pedido (o pedido como aparece no quadro do Delivery). */
export function resumoDoPedido(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string): string {
  if (acao === 'aceitar_pedido') return `Aceitar o pedido ${pedido}.`;
  if (acao === 'pedido_pronto') return `Marcar o pedido ${pedido} como pronto.`;
  return `Despachar o pedido ${pedido} (saiu para a entrega).`;
}

/** A situação esperada depois de cada ação de pedido (a conferência do efeito). */
export function pedidoAndou(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', status: string): boolean {
  const depois: Record<string, string[]> = {
    aceitar_pedido: ['confirmado', 'pronto', 'despachado', 'entregue', 'concluido'],
    pedido_pronto: ['pronto', 'despachado', 'entregue', 'concluido'],
    despachar_pedido: ['despachado', 'entregue', 'concluido'],
  };
  return depois[acao].includes(status);
}

export const TEXTOS_DAS_ACOES = {
  pergunta: (resumo: string, prazo: number) => `${resumo}\n\nAutorizo? A pergunta vale por ${prazo} minutos.`,
  autorizada: 'Autorizado. Fazendo agora…',
  semPermissao: 'O seu perfil no Regem não dá acesso ao Delivery: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  soGestor: 'Só o presidente e o gerente fazem ações pelo Mister.',
  semBotao: 'Pela conexão por QR Code a ação não tem o botão "Autorizar". Faça no Regem, no painel do Delivery.',
  naoAchado: 'Não achei esse pedido nas últimas 24 horas das suas lojas. Confira o número como aparece no painel do Delivery.',
  maisDeUm: 'Achei mais de um pedido com esse número. Diga o número como aparece no painel (com as letras, se tiver).',
  naoDisponivel: 'Esta pergunta não está mais disponível para você.',
  pausado: (canais: string) => `${canais} pausado(s) no Regem; o iFood e a 99 recebem a pausa em seguida.`,
  reaberto: (canais: string) => `${canais} reaberto(s).`,
  pedidoFeito: (acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string) =>
    acao === 'aceitar_pedido' ? `O pedido ${pedido} foi aceito.` : acao === 'pedido_pronto' ? `O pedido ${pedido} está pronto.` : `O pedido ${pedido} saiu para a entrega.`,
  naoAndou: (pedido: string, situacao: string) => `o pedido ${pedido} continua "${situacao}". Confira no painel do Delivery.`,
  recusado: (motivo: string) => `o Regem recusou: ${motivo.replace(/[.\s]+$/, '')}. Nada foi feito.`,
} as const;
