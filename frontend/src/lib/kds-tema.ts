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
  },
};

// A ação principal (botão cheio): o dourado do Regem com tinta navy, nos dois temas (7,4:1).
export const ACAO_KDS = { fundo: '#E2A340', texto: '#0F2230' };
