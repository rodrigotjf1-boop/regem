// KDS — regras PURAS da fila (sem React, sem navegador): cor do tempo, etapas, soma por item e a
// decisão do teclado. A tela (`app/kds/page.tsx`) e os cartões (`components/kds/*`) só desenham o
// que sai daqui. Conferido por `scripts/check-kds.mjs` (npm run check:kds).

import { rotuloSenha } from './senha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Cor: a ÚNICA cor da tela é o status do tempo (decisão do dono, 02/10/2026) ──────────────
// Verde, amarelo e vermelho; cancelado é cinza (o vermelho fica só para atraso). Cada cor já
// vem com o texto que se lê em cima dela (contraste AA medido no protótipo). Nas cores do Regem (dono, 21/10/2026):
// verde do Regem 5,13:1 (era #08853A, 4,74), amarelo com tinta navy 10,2:1 (era #FFD60A com #111111, 13,4), vermelho
// 4,83:1 (era #E60000, 4,81) — o check:kds confere ≥ 4,5 em todas.
export type FaixaTempo = 'ok' | 'atencao' | 'atrasado';
export type CorStatus = { fundo: string; texto: string };
export const COR_STATUS: Record<FaixaTempo | 'cancelado', CorStatus> = {
  ok: { fundo: '#0E7C66', texto: '#FFFFFF' },
  atencao: { fundo: '#F5C842', texto: '#0F2230' },
  atrasado: { fundo: '#D92D20', texto: '#FFFFFF' },
  cancelado: { fundo: '#5F6B76', texto: '#FFFFFF' },
};

export type LimitesTempo = { verdeAteMin: number; amareloAteMin: number };

export function minutosDesde(criadoEm: string | number | Date, agoraMs: number): number {
  return Math.max(0, Math.floor((agoraMs - new Date(criadoEm).getTime()) / 60000));
}

// Limiares do gerente (Configurações do KDS): até X verde, até Y amarelo, depois vermelho.
export function faixaTempo(min: number, limites: LimitesTempo): FaixaTempo {
  if (min <= limites.verdeAteMin) return 'ok';
  if (min <= limites.amareloAteMin) return 'atencao';
  return 'atrasado';
}

export function corDoPedido(p: any, min: number, limites: LimitesTempo): CorStatus {
  return p?.status === 'cancelado' ? COR_STATUS.cancelado : COR_STATUS[faixaTempo(min, limites)];
}

// Atrasado = passou do tempo de preparo do próprio pedido OU já entrou no vermelho. Cancelado nunca.
export function estaAtrasado(p: any, min: number, limites: LimitesTempo): boolean {
  if (p?.status === 'cancelado') return false;
  const preparo = Number(p?.tempoPreparoMin);
  if (preparo > 0 && min > preparo) return true;
  return faixaTempo(min, limites) === 'atrasado';
}

// ── Encomenda (auditoria do KDS, 11/11/2026, O10; decisão do dono: visível desde o aceite) ────────────────────────────
// O pedido marcado para depois (encomenda, agendado do canal: `encomendaPara`, que o servidor manda) entra na tela no
// aceite, mas o tempo dele só começa PREPARO_DA_ENCOMENDA_MIN antes do horário. Antes disso o cartão é neutro, diz
// "começa 21:00" e não entra em "Atrasados" — antes ele chegava dias antes já "atrasado", sem o horário.
export const PREPARO_DA_ENCOMENDA_MIN = 30;

/** Quando o tempo do cartão começa a contar (ms): o começo do preparo da encomenda, ou a entrada do cartão. */
export function inicioDoTempo(p: any): number {
  const criado = new Date(p?.criadoEm).getTime();
  const para = p?.encomendaPara ? new Date(p.encomendaPara).getTime() : NaN;
  if (!Number.isFinite(para)) return criado;
  // O pedido feito em cima da hora (às 20:10 para as 20:30) conta da entrada, não de antes dela.
  return Math.max(criado, para - PREPARO_DA_ENCOMENDA_MIN * 60000);
}

/** A encomenda ainda não chegou na hora de começar: cartão neutro, fora de "Atrasados" e do que falta produzir. */
export function encomendaAguarda(p: any, agoraMs: number): boolean {
  if (!p?.encomendaPara || p?.status === 'cancelado') return false;
  return agoraMs < inicioDoTempo(p);
}

/** Os minutos que o cartão mostra (e que decidem a cor): desde a entrada, ou desde o começo do preparo da encomenda. */
export function minutosDoCartao(p: any, agoraMs: number): number {
  return Math.max(0, Math.floor((agoraMs - inicioDoTempo(p)) / 60000));
}

/** Atrasado agora, pelo tempo do cartão: a encomenda que ainda aguarda tem 0 min e nunca está. */
export function atrasadoAgora(p: any, agoraMs: number, limites: LimitesTempo): boolean {
  return estaAtrasado(p, minutosDoCartao(p, agoraMs), limites);
}

// ── Rodapé de avisos ─────────────────────────────────────────────────────────────────────────
// O de maior prioridade aparece; empate = o mais recente. Prioridade desconhecida vale como ALTA: antes o rank ficava
// indefinido, a conta dava NaN e a "Compra recebida" ('baixa') passava na frente do "❌ CANCELADO" (auditoria do KDS,
// 11/11/2026). O servidor também normaliza (`prioridadeDoKds`).
const RANK_ALERTA: Record<string, number> = { danger: 3, alta: 2, info: 1, ok: 0 };
export const rankDoAlerta = (p: unknown): number => RANK_ALERTA[String(p)] ?? RANK_ALERTA.alta;
/** O texto do aviso: título e, quando há, o detalhe. */
export const textoDoAlerta = (a: { titulo?: string | null; detalhe?: string | null }): string =>
  `${a.titulo ?? ''}${a.detalhe ? ` — ${a.detalhe}` : ''}`;

// A versão 2 (aprovada pelo dono em 11/11/2026): o aviso fica PARADO; a prioridade se lê pelo ícone e pela palavra, na cor
// da prioridade sobre o claro — nunca por um fundo pintado. Desconhecida = atenção (a mesma regra do rank).
export type PrioridadeKds = 'danger' | 'alta' | 'info' | 'ok';
export const prioridadeDoRodape = (p: unknown): PrioridadeKds =>
  p === 'danger' || p === 'alta' || p === 'info' || p === 'ok' ? p : 'alta';
const ROTULO_PRIORIDADE: Record<PrioridadeKds, string> = { danger: '⚠ Urgente', alta: '▲ Atenção', info: '● Aviso', ok: '✓ Positivo' };
export const rotuloDaPrioridade = (p: unknown): string => ROTULO_PRIORIDADE[prioridadeDoRodape(p)];

/** Os avisos na ordem do rodapé e da lista "N avisos": o mais urgente primeiro; empate, o mais recente. */
export function ordenarAlertas<T extends { prioridade: unknown; em: string }>(as: T[]): T[] {
  return [...as].sort(
    (a, b) => rankDoAlerta(b.prioridade) - rankDoAlerta(a.prioridade) || new Date(b.em).getTime() - new Date(a.em).getTime(),
  );
}

export function escolherAlertaDoRodape<T extends { prioridade: unknown; em: string }>(as: T[]): T | null {
  return as.length ? ordenarAlertas(as)[0] : null;
}

/**
 * Um segundo do rodapé. Só o aviso MOSTRADO conta o tempo (o urgente que entra por cima "congela" o outro, que volta a
 * contar de onde parou); o que FICA até o "Ciente" (cancelado, alterado, urgente do Farol) não conta e não sai sozinho —
 * enquanto ele está na faixa, nenhum outro anda. Antes, sem "Ciente", um urgente de 1 h ocupava o rodapé por 1 h (A7).
 */
export function passarUmSegundo<T extends { prioridade: unknown; em: string; restanteSeg: number; fica?: boolean }>(as: T[]): T[] {
  const mostrado = escolherAlertaDoRodape(as);
  if (!mostrado || mostrado.fica) return as;
  return as
    .map((a) => (a === mostrado ? { ...a, restanteSeg: a.restanteSeg - 1 } : a))
    .filter((a) => a.fica || a.restanteSeg > 0);
}

/**
 * O aviso curto depois de cada toque (L13): "Senha B-12 → Em preparo", "Senha B-12 → Montagem" (passou para outro KDS),
 * "Senha B-12 entregue". Pela RESPOSTA do servidor (o que ele fez), não pelo que a tela supunha.
 */
export function textoDoToque(
  ident: string,
  resposta: { status?: string | null; passouPara?: string | null } | null | undefined,
  nomeDoKds: (id: string) => string | null | undefined,
): string {
  if (resposta?.passouPara) return `${ident} → ${nomeDoKds(resposta.passouPara) ?? 'próximo KDS'}`;
  if (resposta?.status === 'entregue') return `${ident} entregue`;
  if (resposta?.status) return `${ident} → ${rotuloEtapa(resposta.status)}`;
  return `${ident} avançou`;
}

// ── Os avisos que cada KDS recebe (onda 2, A13; mig 408) ─────────────────────────────────────────
// A MESMA regra do servidor (`backend/src/common/avisos-do-kds.ts` — o check:kds compara as duas): cada tela liga e desliga
// os tipos; cancelado e alterado não desligam. Decisão do dono (a recomendada): os de gestão nascem desligados nas telas
// de preparo e ligados no despacho; o "cliente chegou" é do despacho e do balcão. Loja com um KDS só: só sem os de gestão.
export const TIPOS_DE_AVISO = ['loja', 'farol', 'pausa', 'estoque', 'chegou', 'gestao'] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];
export type AvisosDoKds = Record<TipoDeAviso, boolean>;

export function avisosPadrao(escopo: string | null | undefined): AvisosDoKds {
  const tudo: AvisosDoKds = { loja: true, farol: true, pausa: true, estoque: true, chegou: true, gestao: true };
  if (escopo == null || escopo === '') return { ...tudo, gestao: false };
  if (escopo === 'producao') return { ...tudo, gestao: false, chegou: false };
  return tudo;
}

export function avisosDoKds(escopo: string | null | undefined, salvo: unknown): AvisosDoKds {
  const r = avisosPadrao(escopo);
  if (salvo && typeof salvo === 'object' && !Array.isArray(salvo)) {
    for (const t of TIPOS_DE_AVISO) {
      const v = (salvo as Record<string, unknown>)[t];
      if (v === true || v === false) r[t] = v;
    }
  }
  return r;
}

/** Esta tela recebe o aviso? Cancelado e alterado sempre; tipo desconhecido (servidor mais novo) vale como alerta da loja. */
export function recebeAviso(avisos: AvisosDoKds, tipo: unknown): boolean {
  if (tipo === 'cancelado' || tipo === 'alterado') return true;
  const t = (TIPOS_DE_AVISO as readonly string[]).includes(tipo as string) ? (tipo as TipoDeAviso) : 'loja';
  return avisos[t] !== false;
}

/**
 * O alerta cadastrado é para ESTA tela? (mig 409, A9: "a Fritadeira recebe só o da troca do óleo".) Sem lista de KDS =
 * todos da loja; o aparelho que não escolheu qual KDS é (loja de um KDS só) recebe todos.
 */
export function alertaParaEstaTela(a: { kds?: unknown }, kdsSel: string | null | undefined): boolean {
  if (!Array.isArray(a?.kds) || !a.kds.length || !kdsSel) return true;
  return a.kds.includes(kdsSel);
}

/** A aba "Avisos" da gaveta ⚙: o que cada tipo traz e como aparece (protótipo, aba 3). */
export const AVISOS_DA_TELA: { k: TipoDeAviso | 'cancelado' | 'alterado'; ic: string; nome: string; det: string; pri: string; trava?: boolean }[] = [
  { k: 'cancelado', ic: '❌', nome: 'Pedido cancelado', det: 'Não preparar; descartar o que já saiu. Bipe forte.', pri: 'Urgente · fica até o Ciente', trava: true },
  { k: 'alterado', ic: '!', nome: 'Pedido alterado', det: 'O cartão mostra o que mudou até alguém tocar em "Visto".', pri: 'Urgente · fica até o Visto', trava: true },
  { k: 'loja', ic: '🔔', nome: 'Alertas da loja', det: 'Os cadastrados em Configurações › Alertas do KDS.', pri: 'Pela prioridade de cada um' },
  { k: 'farol', ic: '📹', nome: 'Alertas do Farol (câmeras)', det: 'Emergência e urgente ficam até o Ciente; os outros saem no tempo deles.', pri: 'Pela severidade do Farol' },
  { k: 'pausa', ic: '⏸', nome: 'Pausa dos canais', det: 'Faixa fixa enquanto o iFood, a 99 ou o cardápio digital estão pausados; aviso antes e ao reabrir.', pri: 'Faixa · informativo' },
  { k: 'estoque', ic: '🧊', nome: 'Estoque da cozinha', det: 'Produto esgotado, validade vencendo, ponto de pedido.', pri: 'Atenção' },
  { k: 'chegou', ic: '🙋', nome: 'Cliente chegou (retirada)', det: 'O "Cheguei" do cardápio e do WhatsApp. Útil no despacho e no balcão.', pri: 'Atenção' },
  { k: 'gestao', ic: '📦', nome: 'Avisos de gestão', det: 'Compra recebida, contagem, fechamento do ponto.', pri: 'Informativo' },
];

/** A hora de um aviso no histórico: só a hora se for de hoje; senão o dia e a hora. */
export function horaDoAviso(iso: string): string {
  const d = new Date(iso);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Quanto tempo depois: "12 s depois", "3 min depois", "2 h depois". */
export function tempoDepois(de: string, ate: string): string {
  const s = Math.max(0, Math.round((Date.parse(ate) - Date.parse(de)) / 1000));
  return s < 60 ? `${s} s depois` : s < 3600 ? `${Math.round(s / 60)} min depois` : `${Math.round(s / 3600)} h depois`;
}

/**
 * O que aconteceu com um aviso GUARDADO nesta tela (histórico da gaveta — onda 3 da auditoria do KDS, mig 412; protótipo,
 * aba 1): não mostrado (o tipo que a tela não recebe, o alerta de outro KDS) — para ninguém achar que o aviso sumiu —,
 * o "Ciente" (quem, quando e quanto depois), o que ainda espera o "Ciente" ou o que saiu sozinho no tempo dele.
 */
export function situacaoDoAviso(
  a: { tipo?: unknown; kds?: unknown; fica?: boolean; duracaoSeg?: number; em: string; ciente?: { em: string; por?: string | null } | null },
  avisos: AvisosDoKds,
  kdsSel: string | null | undefined,
  hora: (iso: string) => string = horaDoAviso,
): { texto: string; mostrado: boolean; semCiente: boolean } {
  if (!recebeAviso(avisos, a.tipo ?? 'loja')) {
    const nome = AVISOS_DA_TELA.find((t) => t.k === a.tipo)?.nome ?? 'este tipo de aviso';
    return { texto: `Não mostrado: esta tela não recebe "${nome}"`, mostrado: false, semCiente: false };
  }
  if (!alertaParaEstaTela(a, kdsSel)) return { texto: 'Não mostrado: o aviso é para outro KDS', mostrado: false, semCiente: false };
  if (a.ciente) return { texto: `Ciente: ${a.ciente.por || 'alguém'} às ${hora(a.ciente.em)} (${tempoDepois(a.em, a.ciente.em)})`, mostrado: true, semCiente: false };
  if (a.fica) return { texto: 'Ainda sem ciente: fica no rodapé até alguém tocar', mostrado: true, semCiente: true };
  return { texto: `Saiu sozinho depois de ${Number(a.duracaoSeg) || 60} s`, mostrado: true, semCiente: false };
}

// ── A faixa da pausa dos canais (onda 2; "incluir o status das lojas de delivery pausadas nos alertas") ──────────────────
export type CanalPausadoNoKds = { canal: string; nome: string; ate: string; fimDoDia?: boolean; motivo?: string | null };
const PAUSADA: Record<string, string> = { food99: 'pausada' }; // "a 99"; "o iFood", "o cardápio digital"

/**
 * O texto de um canal na faixa: "iFood pausado até 20:30" com o contador "faltam 12:34"; nos minutos do aviso da loja,
 * "iFood reabre em 5 min · às 20:30" e o contador fica em âmbar (`logo`); a 99 "até o fim do dia" não conta. `null` =
 * já passou da hora (o canal reabriu).
 */
export function faixaDaPausa(
  c: CanalPausadoNoKds,
  agoraMs: number,
  avisoMinutos: number,
): { texto: string; detalhe: string; contador: string | null; logo: boolean } | null {
  const ate = new Date(c.ate).getTime();
  const resta = Math.ceil((ate - agoraMs) / 1000);
  if (!Number.isFinite(ate) || resta <= 0) return null;
  const hora = new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const motivo = c.motivo ? ` · ${c.motivo}` : '';
  if (c.fimDoDia) return { texto: `${c.nome} ${PAUSADA[c.canal] ?? 'pausado'} até o fim do dia`, detalhe: motivo, contador: null, logo: false };
  const logo = avisoMinutos > 0 && resta <= avisoMinutos * 60;
  const h = Math.floor(resta / 3600);
  const m = Math.floor((resta % 3600) / 60);
  const s = resta % 60;
  const dois = (n: number) => String(n).padStart(2, '0');
  const contador = h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${dois(m)}:${dois(s)}`;
  return logo
    ? { texto: `${c.nome} reabre em ${Math.ceil(resta / 60)} min`, detalhe: ` · às ${hora}${motivo}`, contador, logo }
    : { texto: `${c.nome} ${PAUSADA[c.canal] ?? 'pausado'} até ${hora}`, detalhe: motivo, contador, logo };
}

// ── Etapas ────────────────────────────────────────────────────────────────────────────────
const ETAPA: Record<string, string> = { recebido: 'A iniciar', preparo: 'Em preparo', pronto: 'Pronto', cancelado: 'Cancelado' };
export const rotuloEtapa = (status: string) => ETAPA[status] ?? status;
export const proximaAcao = (status: string) => (status === 'recebido' ? 'Iniciar' : status === 'preparo' ? 'Pronto' : 'Entregar');

/** As etapas que a loja usa (Configurações › Produção: "em preparo" e "entregue" podem estar desligadas). */
export type EtapasDaLoja = { usaPreparo?: boolean; usaEntregue?: boolean };

export type FiltroEtapa = 'todos' | 'recebido' | 'preparo' | 'pronto' | 'atrasados';
export const FILTROS_ETAPA: { key: FiltroEtapa; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'recebido', label: 'A iniciar' },
  { key: 'preparo', label: 'Em preparo' },
  { key: 'pronto', label: 'Pronto' },
  { key: 'atrasados', label: 'Atrasados' },
];

function naEtapa(p: any, etapa: FiltroEtapa, agoraMs: number, limites: LimitesTempo): boolean {
  if (etapa === 'todos') return true;
  if (etapa === 'atrasados') return atrasadoAgora(p, agoraMs, limites);
  return p.status === etapa; // cancelado não entra em nenhuma etapa
}

export function filtrarEtapa(pedidos: any[], etapa: FiltroEtapa, agoraMs: number, limites: LimitesTempo): any[] {
  return etapa === 'todos' ? pedidos : pedidos.filter((p) => naEtapa(p, etapa, agoraMs, limites));
}

export function contarEtapas(pedidos: any[], agoraMs: number, limites: LimitesTempo): Record<FiltroEtapa, number> {
  const n: Record<FiltroEtapa, number> = { todos: pedidos.length, recebido: 0, preparo: 0, pronto: 0, atrasados: 0 };
  for (const p of pedidos) {
    if (p.status === 'recebido' || p.status === 'preparo' || p.status === 'pronto') n[p.status as 'recebido' | 'preparo' | 'pronto'] += 1;
    if (atrasadoAgora(p, agoraMs, limites)) n.atrasados += 1;
  }
  return n;
}

// ── Identificação do pedido (a mesma regra de sempre) ────────────────────────────────────────
export function identPedido(p: any): string {
  if (p?.senha) return `Senha ${rotuloSenha(p.senha, p.senhaPrefixo)}`;
  if (p?.mesa) return `Mesa ${p.mesa}`;
  if (p?.numero) return `#${p.numero}`;
  return 'Balcão';
}

// ── Sub-filtro de origem e "o cartão é desta tela?" ───────────────────────────────────────────
// Delivery agrupa a plataforma (marketplace × cardápio digital); Balcão/Salão agrupa origem + plataforma (Totem).
export function grupoPedido(p: any, canal: 'delivery' | 'balcao'): string {
  const plat = String(p.plataforma ?? '').toLowerCase();
  if (canal === 'delivery') {
    if (/ifood|99\s*food|keeta|rappi|uber/.test(plat)) return 'marketplace';
    return 'digital'; // anota aí, cardápio web, cardápio (regem), outros
  }
  if (/totem|kiosk|quiosque/.test(plat)) return 'totem';
  const o = String(p.origem ?? 'balcao');
  if (o === 'mesa' || o === 'comanda') return 'mesa';
  if (o === 'garcom') return 'garcom';
  return 'pdv';
}

// O cartão é desta tela? Está na fila que o servidor devolveu para ESTE KDS (loja, canal, setor ou KDS da cadeia) e
// passa no sub-filtro de origem escolhido aqui. Só ele apita e alerta: antes, todo KDS da empresa apitava por todo pedido
// novo e mostrava "CANCELADO" de pedido que não era dele (auditoria do KDS, 20/10/2026). Devolve o cartão (ou nada).
export function cartaoNaTela(lista: any[], pedidoId: string, canal: string, sub: string): any | undefined {
  const p = (lista ?? []).find((x) => x.id === pedidoId);
  if (!p) return undefined;
  if (canal === 'todos' || sub === 'todos') return p;
  return grupoPedido(p, canal as 'delivery' | 'balcao') === sub ? p : undefined;
}

// ── Cozinha em estações, entrega 2: o "vai para" e o KDS de despacho ─────────────────────────────
// O botão de avanço numa estação que manda o pedido para outro KDS diz para onde: "Pronto → Montagem".
// O botão segue as ETAPAS DA LOJA, como o servidor (auditoria do KDS, 11/11/2026): com "em preparo" desligado, o toque em
// "A iniciar" já marca pronto — o botão diz "Pronto" (antes dizia "Iniciar" e o cartão sumia para o KDS seguinte); com
// "entregue" desligado, o pronto é a última etapa e não há botão (antes "Entregar" dava erro calado). null = sem botão.
export function proximaAcaoNaEstacao(status: string, proximoNome?: string | null, etapas: EtapasDaLoja = {}): string | null {
  const viraPronto = status === 'preparo' || (status === 'recebido' && etapas.usaPreparo === false);
  if (viraPronto) return proximoNome ? `Pronto → ${proximoNome}` : 'Pronto';
  if (status === 'pronto' && etapas.usaEntregue === false) return null;
  return proximaAcao(status);
}

// O pedido do despacho que tem este cartão (o evento do tempo real vem por cartão; o despacho mostra o pedido inteiro) e
// que passa no sub-filtro de origem escolhido aqui — só ele apita e alerta nesta tela.
export function pedidoDoDespachoNaTela(lista: any[], cartaoId: string, canal: string, sub: string): any | undefined {
  const p = (lista ?? []).find((x) => (x.cartoes ?? []).some((c: any) => c.id === cartaoId));
  if (!p) return undefined;
  if (canal === 'todos' || sub === 'todos') return p;
  return grupoPedido(p, canal as 'delivery' | 'balcao') === sub ? p : undefined;
}

// O delivery "despacha" (sai com o entregador); o balcão, a mesa e o totem chamam a senha.
const ehDelivery = (p: any) => p?.origem === 'delivery';
export type AcaoDoDespacho = { acao: 'pronto' | 'entregue'; rotulo: string; liberada: boolean };

// O que o cartão do despacho oferece agora, pela situação que o servidor calculou: "Despachar" / "Pronto: chamar a
// senha" só com todas as estações prontas (antes disso aparece travado, com o "Despachar assim mesmo" do gestor);
// depois do pronto, "Entregue".
export function acoesDoDespacho(p: any): { principal: AcaoDoDespacho | null; forcar: boolean } {
  const pronto = ehDelivery(p) ? 'Despachar' : 'Pronto: chamar a senha';
  switch (p?.situacao) {
    case 'preparando':
      return { principal: { acao: 'pronto', rotulo: pronto, liberada: false }, forcar: true };
    case 'pronto_para_despachar':
      return { principal: { acao: 'pronto', rotulo: pronto, liberada: true }, forcar: false };
    case 'pronto':
      return {
        principal: { acao: 'entregue', rotulo: ehDelivery(p) ? 'Entregue ao entregador' : 'Entregue (o cliente buscou)', liberada: true },
        forcar: false,
      };
    default:
      return { principal: null, forcar: false };
  }
}

// Uma estação no andamento do pedido: "Chapa ✓", "Montagem · 2 min" (fazendo) ou "Chapa · na fila".
export function rotuloDaEstacao(e: { nome: string; estado: string; desde?: string | null; forcado?: boolean }, agoraMs: number): string {
  if (e.estado === 'feito') return `${e.nome} ✓${e.forcado ? ' (liberado pelo gestor)' : ''}`;
  if (e.estado === 'na_fila') return `${e.nome} · na fila`;
  return `${e.nome} · ${e.desde ? minutosDesde(e.desde, agoraMs) : 0} min`;
}

// ── Itens ─────────────────────────────────────────────────────────────────────────────────
/**
 * Os complementos do item UM POR LINHA no cartão (L3: "sem cebola" e "+ bacon" cada um na sua linha, na cor da tinta). A
 * MESMA regra da via impressa (`linhasDasEscolhas`, em backend/src/common/adicionais.ts — o check:kds confere os mesmos
 * exemplos): o texto vem separado por " · "; o que chega sem sinal (canal) ganha o "+".
 */
export const SEPARADOR_ESCOLHAS = ' · ';
export function linhasDasEscolhas(texto: string | null | undefined): string[] {
  return String(texto ?? '')
    .split(SEPARADOR_ESCOLHAS)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^(\+|-|sem\b)/i.test(s) ? s : `+ ${s}`));
}

// Pedido ALTERADO (mig 362): o item tirado (riscado, "Tirar", até o "Visto") não se produz; o novo leva "Novo".
export const itemTirado = (it: any) => it?.status === 'removido';
const marcaDoItem = (it: any) => (it?.status === 'removido' ? 'tirar' : it?.status === 'novo' ? 'novo' : '');

// Dentro de UM pedido: agrega itens iguais (mesma descrição + complementos + obs) somando. O tirado e o novo ficam à parte
// (a Coca que saiu não soma com a que fica).
export function agregarItens(itens: any[]): any[] {
  const mapa = new Map<string, any>();
  for (const it of itens ?? []) {
    const chave = `${it.descricao}|${it.complementosTexto ?? ''}|${it.observacao ?? ''}|${marcaDoItem(it)}`;
    const ex = mapa.get(chave);
    if (ex) ex.quantidade = Number(ex.quantidade) + Number(it.quantidade);
    else mapa.set(chave, { ...it, quantidade: Number(it.quantidade) });
  }
  return [...mapa.values()];
}

// O que ainda se PRODUZ: pedido cancelado ou já pronto não entra na soma; nem a encomenda que ainda aguarda a hora de
// começar (com a hora: sem ela — `agoraMs` 0 — conta tudo, como antes).
const aProduzir = (p: any, agoraMs = 0) =>
  (p.status === 'recebido' || p.status === 'preparo') && !(agoraMs > 0 && encomendaAguarda(p, agoraMs));

export type LinhaDoItem = { pedido: any; item: any; min: number };
export type GrupoDeItem = { descricao: string; quantidade: number; minMaisAntigo: number; linhas: LinhaDoItem[] };

// ENTRE pedidos: um grupo por item (pela descrição), com a soma e os pedidos que o levam.
// Ordem: o item cujo pedido espera há mais tempo vem primeiro; depois a maior quantidade.
export function agruparPorItem(pedidos: any[], agoraMs: number): GrupoDeItem[] {
  const mapa = new Map<string, GrupoDeItem>();
  for (const p of pedidos ?? []) {
    if (!aProduzir(p, agoraMs)) continue;
    const min = minutosDoCartao(p, agoraMs);
    for (const it of agregarItens(p.itens ?? [])) {
      const descricao = String(it.descricao ?? '').trim() || 'Item sem nome';
      const g = mapa.get(descricao) ?? { descricao, quantidade: 0, minMaisAntigo: 0, linhas: [] };
      // O tirado aparece (riscado) na visão por item, mas não soma o que se produz.
      if (!itemTirado(it)) g.quantidade += Number(it.quantidade) || 0;
      g.minMaisAntigo = Math.max(g.minMaisAntigo, min);
      g.linhas.push({ pedido: p, item: it, min });
      mapa.set(descricao, g);
    }
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) g.linhas.sort((a, b) => b.min - a.min);
  return grupos.sort((a, b) => b.minMaisAntigo - a.minMaisAntigo || b.quantidade - a.quantidade || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export type ItemDoResumo = { descricao: string; quantidade: number; pedidos: number };

// Resumo lateral: a mesma soma, da maior quantidade para a menor. Com a hora, a encomenda que ainda aguarda fica de fora.
export function somarItens(pedidos: any[], agoraMs = 0): ItemDoResumo[] {
  return agruparPorItem(pedidos, agoraMs)
    .filter((g) => g.quantidade > 0) // só o tirado: nada a produzir
    .map((g) => ({
      descricao: g.descricao,
      quantidade: g.quantidade,
      pedidos: new Set(g.linhas.filter((l) => !itemTirado(l.item)).map((l) => l.pedido.id)).size,
    }))
    .sort((a, b) => b.quantidade - a.quantidade || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

/**
 * O que mudou no cartão, para o rodapé do KDS (mig 362): "+ 1 Batata frita média", "troca de 1 Coca-Cola lata por 1
 * Guaraná Antarctica lata", "tirar 1 Coca-Cola lata". Só os itens da última alteração (`mudouEm` = `alteradoEm`).
 */
export function textoDaAlteracao(p: any): string {
  const ultima = p?.alteradoEm ? new Date(p.alteradoEm).getTime() : null;
  const daUltima = (it: any) => ultima == null || (it?.mudouEm != null && new Date(it.mudouEm).getTime() === ultima);
  const q = (it: any) => String(Number(it?.quantidade) || 1);
  const postos = (p?.itens ?? []).filter((it: any) => it?.status === 'novo' && daUltima(it));
  const tirados = (p?.itens ?? []).filter((it: any) => itemTirado(it) && daUltima(it));
  if (postos.length === 1 && tirados.length === 1) return `troca de ${q(tirados[0])} ${tirados[0].descricao} por ${q(postos[0])} ${postos[0].descricao}`;
  const partes = [...postos.map((it: any) => `+ ${q(it)} ${it.descricao}`), ...tirados.map((it: any) => `tirar ${q(it)} ${it.descricao}`)];
  return partes.join(' · ') || 'o pedido mudou';
}

// O pedido leva o item destacado no resumo? (só conta o que ainda se produz)
export function pedidoTemItem(p: any, descricao: string): boolean {
  return aProduzir(p) && (p.itens ?? []).some((it: any) => !itemTirado(it) && String(it.descricao ?? '').trim() === descricao);
}

// ── Forma de uso: toque × teclado ──────────────────────────────────────────────────────────
// TECLADO: o campo da senha é o dono do foco. Número digitado em qualquer lugar vai para ele;
// Enter fora do campo NUNCA aciona o botão que estava em foco — com número avança o pedido, sem
// número só leva o foco para o campo. TOQUE: nada depende do foco (Enter num botão é do botão).
export type FormaUso = 'toque' | 'teclado';
export type TeclaDoKds = { acao: 'ignorar' | 'digito' | 'enter' | 'apagar'; tomar: boolean };

export function decidirTecla(uso: FormaUso, tecla: string, alvo: { tag: string; ehCampoSenha: boolean }): TeclaDoKds {
  const nada: TeclaDoKds = { acao: 'ignorar', tomar: false };
  if (alvo.ehCampoSenha) return nada; // o próprio campo trata
  const acao = /^[0-9]$/.test(tecla) ? 'digito' : tecla === 'Enter' ? 'enter' : tecla === 'Backspace' ? 'apagar' : 'ignorar';
  if (acao === 'ignorar') return nada;
  const tag = alvo.tag.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return nada; // outro campo de texto: é dele
  if (uso === 'teclado') return { acao, tomar: true }; // toma a tecla (preventDefault) e foca o campo
  if (tag === 'SELECT') return nada;
  if (tag === 'BUTTON' && acao === 'enter') return nada;
  return { acao, tomar: false };
}

export function formaDeUso(escolhida: string | null | undefined, telaDeToque: boolean): FormaUso {
  if (escolhida === 'toque' || escolhida === 'teclado') return escolhida;
  return telaDeToque ? 'toque' : 'teclado'; // primeiro uso: adivinha pelo aparelho
}
