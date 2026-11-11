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

// ── Rodapé de alertas ─────────────────────────────────────────────────────────────────────────
// O de maior prioridade aparece; empate = o mais recente. Prioridade desconhecida vale como ALTA: antes o rank ficava
// indefinido, a conta dava NaN e a "Compra recebida" ('baixa') passava na frente do "❌ CANCELADO" (auditoria do KDS,
// 11/11/2026). O servidor também normaliza (`prioridadeDoKds`).
const RANK_ALERTA: Record<string, number> = { danger: 3, alta: 2, info: 1, ok: 0 };
export const rankDoAlerta = (p: unknown): number => RANK_ALERTA[String(p)] ?? RANK_ALERTA.alta;
/** O texto do letreiro: título e, quando há, o detalhe. */
export const textoDoAlerta = (a: { titulo?: string | null; detalhe?: string | null }): string =>
  `${a.titulo ?? ''}${a.detalhe ? ` — ${a.detalhe}` : ''}`;

/**
 * Quantos segundos o letreiro leva para passar inteiro: velocidade constante (~90 px/s, ~15 px por letra a 26 px, mais
 * a largura da faixa que o texto atravessa ao entrar), nunca menos de 10 s. Antes era 16 s para qualquer texto: o curto
 * passava lento e o longo, rápido demais (e cortado — auditoria do KDS, 11/11/2026).
 */
export function duracaoDoLetreiro(texto: string, larguraDaFaixa = 1100): number {
  const percurso = String(texto ?? '').length * 15 + larguraDaFaixa;
  return Math.max(10, Math.round(percurso / 90));
}

export function escolherAlertaDoRodape<T extends { prioridade: unknown; em: string }>(as: T[]): T | null {
  if (!as.length) return null;
  return [...as].sort(
    (a, b) => rankDoAlerta(b.prioridade) - rankDoAlerta(a.prioridade) || new Date(b.em).getTime() - new Date(a.em).getTime(),
  )[0];
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
  if (etapa === 'atrasados') return estaAtrasado(p, minutosDesde(p.criadoEm, agoraMs), limites);
  return p.status === etapa; // cancelado não entra em nenhuma etapa
}

export function filtrarEtapa(pedidos: any[], etapa: FiltroEtapa, agoraMs: number, limites: LimitesTempo): any[] {
  return etapa === 'todos' ? pedidos : pedidos.filter((p) => naEtapa(p, etapa, agoraMs, limites));
}

export function contarEtapas(pedidos: any[], agoraMs: number, limites: LimitesTempo): Record<FiltroEtapa, number> {
  const n: Record<FiltroEtapa, number> = { todos: pedidos.length, recebido: 0, preparo: 0, pronto: 0, atrasados: 0 };
  for (const p of pedidos) {
    if (p.status === 'recebido' || p.status === 'preparo' || p.status === 'pronto') n[p.status as 'recebido' | 'preparo' | 'pronto'] += 1;
    if (estaAtrasado(p, minutosDesde(p.criadoEm, agoraMs), limites)) n.atrasados += 1;
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

// O que ainda se PRODUZ: pedido cancelado ou já pronto não entra na soma.
const aProduzir = (p: any) => p.status === 'recebido' || p.status === 'preparo';

export type LinhaDoItem = { pedido: any; item: any; min: number };
export type GrupoDeItem = { descricao: string; quantidade: number; minMaisAntigo: number; linhas: LinhaDoItem[] };

// ENTRE pedidos: um grupo por item (pela descrição), com a soma e os pedidos que o levam.
// Ordem: o item cujo pedido espera há mais tempo vem primeiro; depois a maior quantidade.
export function agruparPorItem(pedidos: any[], agoraMs: number): GrupoDeItem[] {
  const mapa = new Map<string, GrupoDeItem>();
  for (const p of pedidos ?? []) {
    if (!aProduzir(p)) continue;
    const min = minutosDesde(p.criadoEm, agoraMs);
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

// Resumo lateral: a mesma soma, da maior quantidade para a menor.
export function somarItens(pedidos: any[]): ItemDoResumo[] {
  return agruparPorItem(pedidos, 0)
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
