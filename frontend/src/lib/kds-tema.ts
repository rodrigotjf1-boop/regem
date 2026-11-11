// KDS — os temas da tela da cozinha (claro, o padrão, e escuro, opção do aparelho). Só tinta e cinza: a cor fica para o
// status do tempo (`COR_STATUS`, em kds-fila). O claro nas cores do Regem (decisão do dono em 21/10/2026): fundo base,
// cartão branco, tinta navy, ação dourada.
// Toda cor de TEXTO da tela sai daqui, medida nos DOIS temas — `scripts/check-kds.mjs` confere ≥ 4,5:1 de cada par (texto
// normal, < 18,66 px em negrito). Cor fixa escolhida num tema reprova no outro: o "Marcar todos" dourado da gaveta dava
// 3,3:1 no claro e o "salvo" verde-escuro 2,4:1 no escuro (ERR-264).

export type TemaKds = {
  bg: string; // fundo da tela
  panel: string; // cartão, painel e gaveta
  panel2: string; // faixa (cabeçalho de grupo, campo)
  border: string;
  text: string;
  muted: string; // texto secundário
  erro: string; // texto de falha
  feito: string; // texto de "salvo" / "feito"
  link: string; // ação em texto ("Marcar todos")
  // Versão 2 da tela (onda 2 da auditoria, aprovada pelo dono em 11/11/2026 — "KDS com muita cor"): a cor da prioridade
  // do aviso vai só no TEXTO ("Urgente", "Atenção"…), sobre o claro do painel — nunca num fundo pintado.
  urg: string; // urgente, "Atrasado", "Sem conexão"
  aten: string; // atenção, o contador da pausa nos 5 min finais
  info: string; // aviso
  ok: string; // positivo
  invBg: string; // invertido (o aviso de cada toque)
  invFg: string;
};

export const TEMAS_KDS: Record<'escuro' | 'claro', TemaKds> = {
  escuro: {
    bg: '#0B1117',
    panel: '#151E27',
    panel2: '#1D2833',
    border: '#2C3A47',
    text: '#F1F5F8',
    muted: '#A3B1BD',
    erro: '#FF5A4E',
    feito: '#4CC9A0',
    link: '#E2A340',
    urg: '#FF5A4E',
    aten: '#F5C842',
    info: '#6BB4E8',
    ok: '#4CC9A0',
    invBg: '#F1F5F8',
    invFg: '#151E27',
  },
  claro: {
    bg: '#EDF0F4',
    panel: '#FFFFFF',
    panel2: '#F1F4F7',
    border: '#D5DCE4',
    text: '#0F2230',
    muted: '#4F6476',
    erro: '#B4231C', // o #D92D20 dava 4,23:1 no fundo e 4,38:1 na faixa (só passava no branco)
    feito: '#0B6654',
    link: '#8A5A00',
    urg: '#B4231C',
    aten: '#8A5A00',
    info: '#1F5F96',
    ok: '#0B6654',
    invBg: '#0F2230',
    invFg: '#FFFFFF',
  },
};

// A ação principal (botão cheio): o dourado do Regem com tinta navy, nos dois temas (7,4:1).
export const ACAO_KDS = { fundo: '#E2A340', texto: '#0F2230' };

/**
 * As variáveis CSS da tela do KDS (`app/kds/kds-tela.css`): o tema do aparelho e as cores do status do tempo, que o selo
 * do cartão usa. Ficam no elemento de fora da tela; a folha de estilo só lê `var(--k-…)`. As cores de status entram por
 * parâmetro (moram em `kds-fila`, que este arquivo não importa — o check:kds transpila cada um à parte).
 */
export function variaveisDoKds(
  t: TemaKds,
  status: Record<'ok' | 'atencao' | 'atrasado' | 'cancelado', { fundo: string; texto: string }>,
): Record<string, string> {
  return {
    '--k-bg': t.bg,
    '--k-panel': t.panel,
    '--k-panel-2': t.panel2,
    '--k-line': t.border,
    '--k-ink': t.text,
    '--k-muted': t.muted,
    '--k-erro': t.erro,
    '--k-feito': t.feito,
    '--k-link': t.link,
    '--k-urg': t.urg,
    '--k-aten': t.aten,
    '--k-info': t.info,
    '--k-ok': t.ok,
    '--k-inv-bg': t.invBg,
    '--k-inv-fg': t.invFg,
    '--s-ok': status.ok.fundo,
    '--on-ok': status.ok.texto,
    '--s-warn': status.atencao.fundo,
    '--on-warn': status.atencao.texto,
    '--s-late': status.atrasado.fundo,
    '--on-late': status.atrasado.texto,
    '--s-off': status.cancelado.fundo,
    '--on-off': status.cancelado.texto,
    '--acao': ACAO_KDS.fundo,
    '--on-acao': ACAO_KDS.texto,
  };
}
