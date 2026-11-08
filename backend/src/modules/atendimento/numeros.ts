/* eslint-disable @typescript-eslint/no-explicit-any */
import { valorDoAceite, type CasoDaDecisao } from './gestor-whatsapp-decisao';

// NÚMEROS DO ATENDIMENTO (item 8 do checkpoint da Central; protótipo `mockups/regem-central-atendimento.html`, versão 6):
// o PLACAR por canal (o que chegou, quanto foi respondido e o tempo médio da 1ª resposta), as RECLAMAÇÕES por motivo e por
// produto e QUANTO CUSTOU. Regra pura (os testes conferem cada caso sozinho); o serviço só lê as linhas e chama daqui.
//
// No chat do iFood, a mesma régua que o iFood mostra ao cliente — "tempo médio de resposta" e "taxa de resposta" (as
// mensagens respondidas), nos últimos 30 dias (blog de parceiros do iFood, conferido em 06/11/2026). A conta do chat é em
// SQL (numeros.service.ts, uma consulta por janela); a dos casos é aqui.

// ───────────────────────── período ─────────────────────────

export const PERIODOS = ['7', '30', 'mes', 'ant'] as const;
export type Periodo = (typeof PERIODOS)[number];
/** O período pedido; qualquer outra coisa = os últimos 30 dias (a régua do iFood). */
export function lerPeriodo(v: unknown): Periodo {
  return (PERIODOS as readonly string[]).includes(String(v)) ? (String(v) as Periodo) : '30';
}

// ───────────────────────── "o que aconteceu?" ─────────────────────────

/** A lista FIXA de motivos (a tela mostra o nome; o caso guarda a chave). "Não foi reclamação" tira o caso da conta. */
export const MOTIVOS = [
  { k: 'atraso', nome: 'Atraso', doProduto: false },
  { k: 'faltou', nome: 'Faltou item', doProduto: true },
  { k: 'errado', nome: 'Item errado ou trocado', doProduto: true },
  { k: 'frio', nome: 'Chegou frio', doProduto: true },
  { k: 'embalagem', nome: 'Embalagem ou derramou', doProduto: true },
  { k: 'qualidade', nome: 'Qualidade ou sabor', doProduto: true },
  { k: 'entregador', nome: 'Entregador', doProduto: false },
  { k: 'cobranca', nome: 'Cobrança ou valor', doProduto: false },
  { k: 'outro', nome: 'Outro problema', doProduto: false },
  { k: 'nao', nome: 'Não foi reclamação', doProduto: false },
] as const;
export type Motivo = (typeof MOTIVOS)[number]['k'];
const CHAVES = MOTIVOS.map((m) => m.k) as readonly string[];
export const ehMotivo = (v: unknown): v is Motivo => typeof v === 'string' && CHAVES.includes(v);
export const nomeDoMotivo = (k: string) => MOTIVOS.find((m) => m.k === k)?.nome ?? k;
export const motivoDoProduto = (k: string | null | undefined) => !!MOTIVOS.find((m) => m.k === k)?.doProduto;

export const MAX_PRODUTOS = 10;
const TAM_PRODUTO = 120;

export type OQueAconteceu = { motivo: Motivo; produtos: string[] };

/**
 * O que a equipe marcou (o passo opcional do "Resolver" e o "Marcar o motivo"). `motivo` vazio/nulo = limpar (volta a
 * valer o que a plataforma disse). Os produtos só valem nos motivos de produto (atraso é do pedido, não do produto).
 */
export function lerOQueAconteceu(dto: any): { ok: true; valor: OQueAconteceu | null } | { ok: false; erro: string } {
  const motivo = dto?.motivo;
  if (motivo === null || motivo === undefined || motivo === '') return { ok: true, valor: null };
  if (!ehMotivo(motivo)) return { ok: false, erro: 'Motivo inválido: escolha um da lista.' };
  const lista = dto?.produtos === undefined || dto?.produtos === null ? [] : dto.produtos;
  if (!Array.isArray(lista)) return { ok: false, erro: 'Os produtos vêm numa lista.' };
  if (!motivoDoProduto(motivo) && lista.length) return { ok: false, erro: `"${nomeDoMotivo(motivo)}" não pede o produto.` };
  const produtos: string[] = [];
  for (const p of lista) {
    if (typeof p !== 'string') return { ok: false, erro: 'Cada produto é um nome.' };
    const nome = p.replace(/\s+/g, ' ').trim();
    if (!nome) continue;
    if (nome.length > TAM_PRODUTO) return { ok: false, erro: 'Nome de produto longo demais.' };
    if (!produtos.some((x) => chaveDoProduto(x) === chaveDoProduto(nome))) produtos.push(nome);
  }
  if (produtos.length > MAX_PRODUTOS) return { ok: false, erro: `No máximo ${MAX_PRODUTOS} produtos.` };
  return { ok: true, valor: { motivo, produtos } };
}

/** O que fica gravado em `detalhe.classificacao` (quem marcou e quando vão junto). */
export function classificacaoGravada(v: OQueAconteceu, quem: { colaboradorId?: string | null; nome?: string | null }) {
  return { motivo: v.motivo, produtos: v.produtos, porId: quem.colaboradorId ?? null, por: quem.nome ?? null, em: new Date().toISOString() };
}

/** A chave que junta o mesmo produto escrito de jeitos diferentes ("X-Burguer  Duplo" = "x-burguer duplo"). */
export function chaveDoProduto(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * O motivo do ITEM na disputa do iFood (o `reason` de cada item, que o iFood manda como código ou texto). Pelo que o texto
 * diz; o que não se reconhece fica "Outro problema" (o item foi apontado — é reclamação, só não se sabe de quê).
 */
export function motivoDoItemIfood(t: unknown): Motivo | null {
  const s = chaveDoProduto(String(t ?? '')).replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (/missing|falt|nao veio|nao chegou|incomplet/.test(s)) return 'faltou';
  if (/wrong|errad|troc|diferente|incorret/.test(s)) return 'errado';
  if (/cold|fri[oa]|gelad/.test(s)) return 'frio';
  if (/spill|leak|derram|vaz|embalag|package|amass|violad/.test(s)) return 'embalagem';
  if (/quality|qualidade|sabor|taste|cru|queimad|estragad|ruim|spoil|burn/.test(s)) return 'qualidade';
  if (/late|delay|atras|demor/.test(s)) return 'atraso';
  return 'outro';
}

// ───────────────────────── a linha do caso ─────────────────────────

/** O que o serviço lê de cada caso do período (só as partes do `detalhe` que a conta usa — nada da conversa). */
export type LinhaDoCaso = {
  id: string;
  tipo: string;
  canal: string | null;
  status: string;
  decisao: string | null;
  criadoEm: string | Date;
  /** Desde quando o caso espera uma pessoa (mig 379): o recado da madrugada, desde a volta da equipe. Sem ele, `criadoEm`. */
  inicioEm?: string | Date | null;
  /** Recado para o responsável (mig 381 — fornecedor, vaga, parceria): fora do tempo de espera e das reclamações. */
  paraOResponsavel?: boolean | null;
  pegoEm: string | Date | null;
  resolvidoEm: string | Date | null;
  resolvidoPorId: string | null;
  prazoEm: string | Date | null;
  cliente: string | null;
  pedidoNumero: string | null;
  totalCentavos: number | null;
  disputa: { acao?: string; tipo?: string; acaoAutomatica?: string | null; itens?: any[] } | null;
  encerramento: { status?: string; proposta?: { tipo?: string; centavos?: number | null } | null } | null;
  resposta: { em?: string; automatico?: boolean } | null;
  valor99: number | null;
  classificacao: { motivo?: string; produtos?: unknown[] } | null;
};

const ms = (d: string | Date | null | undefined) => (d ? new Date(d).getTime() : NaN);

export type ProdutoApontado = { nome: string; motivo: Motivo | null };
export type ResultadoDoCaso = { motivo: Motivo | null; fonte: 'equipe' | 'plataforma' | null; produtos: ProdutoApontado[] };

/** Os tipos que PODEM ser reclamação: sem motivo marcado, entram em "Sem motivo marcado". A mudança de pedido não. */
const PODE_SER_RECLAMACAO = new Set(['disputa', 'cancelamento_99', 'reembolso_99', 'cancelamento', 'avaliacao', 'erro', 'chat', 'humano', 'outro', 'instagram']);

/**
 * O que aconteceu no caso: o que a EQUIPE marcou vence; senão o que a PLATAFORMA disse (disputa do iFood: atraso pelo tipo,
 * e os itens apontados com o motivo de cada um). A mudança de pedido não é reclamação. O resto: sem motivo.
 */
export function oQueAconteceuNoCaso(l: LinhaDoCaso): ResultadoDoCaso {
  const c = l.classificacao;
  if (c && ehMotivo(c.motivo)) {
    const produtos = motivoDoProduto(c.motivo) && Array.isArray(c.produtos) ? c.produtos.filter((p): p is string => typeof p === 'string' && !!p.trim()) : [];
    return { motivo: c.motivo, fonte: 'equipe', produtos: produtos.map((nome) => ({ nome, motivo: c.motivo as Motivo })) };
  }
  if (l.tipo === 'disputa' && l.disputa) {
    const d = l.disputa;
    const itens = (Array.isArray(d.itens) ? d.itens : [])
      .filter((i) => typeof i?.nome === 'string' && i.nome.trim())
      .map((i) => ({ nome: String(i.nome).trim(), motivo: motivoDoItemIfood(i.motivo) }));
    if (d.tipo === 'DELAY' || d.tipo === 'PREPARATION_TIME' || d.acao === 'PROPOSED_ADDITIONAL_TIME') return { motivo: 'atraso', fonte: 'plataforma', produtos: [] };
    // O motivo do caso = o mais apontado nos itens (empate: o do primeiro item).
    const conta = new Map<Motivo, number>();
    for (const i of itens) if (i.motivo) conta.set(i.motivo, (conta.get(i.motivo) ?? 0) + 1);
    let motivo: Motivo | null = null;
    for (const [k, n] of conta) if (!motivo || n > (conta.get(motivo) ?? 0)) motivo = k;
    return { motivo, fonte: motivo ? 'plataforma' : null, produtos: itens };
  }
  if (l.tipo === 'mudanca') return { motivo: 'nao', fonte: 'plataforma', produtos: [] };
  // O recado para o responsável (mig 381 — fornecedor, vaga, parceria) não é reclamação.
  if (l.paraOResponsavel) return { motivo: 'nao', fonte: null, produtos: [] };
  return { motivo: null, fonte: null, produtos: [] };
}

/** O caso entra na conta das reclamações? (com motivo ≠ "não foi reclamação", ou sem motivo num tipo que pode ser) */
export function contaComoReclamacao(l: LinhaDoCaso, r = oQueAconteceuNoCaso(l)): boolean {
  if (r.motivo === 'nao') return false;
  return r.motivo !== null || PODE_SER_RECLAMACAO.has(l.tipo);
}

/**
 * QUANTO CUSTOU (centavos): o que a loja devolveu ou deixou de receber. `estimado` = a plataforma não mandou o valor e
 * conta o pedido inteiro (reembolso da 99 sem o valor). `conhecido` falso = devia custar e não se sabe quanto (item sem
 * valor na disputa): fica fora da soma.
 *   • disputa do iFood: aceita (pela loja, pelo app ou porque venceu com o "aceitar" automático do iFood) → o valor do
 *     aceite (pedido inteiro; parcial = a soma dos itens); proposta aceita pelo cliente → o valor proposto (mais tempo = 0);
 *   • 99: cancelamento aceito → o pedido; reembolso aceito (pela loja ou pela 99 sozinha) → o valor pedido, senão o pedido;
 *   • cancelamento pedido no cardápio/WhatsApp e aceito → o pedido.
 */
export function custouDoCaso(l: LinhaDoCaso): { centavos: number; estimado: boolean; conhecido: boolean } {
  const zero = { centavos: 0, estimado: false, conhecido: true };
  const caso = {
    tipo: l.tipo,
    detalhe: { disputa: l.disputa ?? {}, pedido99: { valorCentavos: l.valor99 } },
    totalCentavos: l.totalCentavos,
  } as unknown as CasoDaDecisao;
  const doAceite = (): { centavos: number; estimado: boolean; conhecido: boolean } => {
    const v = valorDoAceite(caso);
    if (v === null) return { centavos: 0, estimado: false, conhecido: false };
    const estimado = l.tipo === 'reembolso_99' && !(Number(l.valor99) > 0);
    return { centavos: Math.max(0, Math.round(v)), estimado, conhecido: true };
  };
  if (l.tipo === 'disputa') {
    const st = l.encerramento?.status ?? '';
    if (st === 'ACCEPTED') return doAceite();
    if (st === 'ALTERNATIVE_REPLIED') {
      const p = l.encerramento?.proposta;
      if (!p || p.tipo === 'ADDITIONAL_TIME') return zero;
      const v = Number(p.centavos);
      return Number.isFinite(v) && v > 0 ? { centavos: Math.round(v), estimado: false, conhecido: true } : { centavos: 0, estimado: false, conhecido: false };
    }
    if (st === 'EXPIRED') return l.disputa?.acaoAutomatica === 'ACCEPT_CANCELLATION' ? doAceite() : zero;
    if (st) return zero; // REJECTED e o que mais vier
    // Respondida pela central e o iFood ainda não encerrou: vale o que a loja respondeu.
    return l.decisao === 'aceito' ? doAceite() : zero;
  }
  if (l.tipo === 'cancelamento_99') return l.decisao === 'aceito' || l.decisao === 'aceito_automatico' ? doAceite() : zero;
  if (l.tipo === 'reembolso_99') return l.decisao === 'aceito' || l.decisao === 'reembolsado_pela_99' ? doAceite() : zero;
  if (l.tipo === 'cancelamento') return l.decisao === 'aceito' ? doAceite() : zero;
  return zero;
}

// ───────────────────────── o placar dos casos ─────────────────────────

/** Os grupos do placar que vêm dos CASOS (o chat do iFood e da 99 vem das mensagens). */
export const GRUPOS_DOS_CASOS = ['casos', 'disputa', 'pedido99', 'avaliacao', 'cancelamento'] as const;
export type GrupoDosCasos = (typeof GRUPOS_DOS_CASOS)[number];

export function grupoDoPlacar(l: LinhaDoCaso): GrupoDosCasos | null {
  if (l.tipo === 'chat' || l.tipo === 'instagram') return null; // o chat e o Direct entram pelas mensagens, não pelo caso
  if (l.paraOResponsavel) return null; // o recado para o responsável (mig 381) não conta no tempo de espera
  if (l.tipo === 'disputa') return 'disputa';
  if (l.tipo === 'cancelamento_99' || l.tipo === 'reembolso_99') return 'pedido99';
  if (l.tipo === 'avaliacao') return 'avaliacao';
  if (l.tipo === 'cancelamento') return 'cancelamento';
  return 'casos';
}

/** Quanto tempo um caso sem prazo pode esperar antes de contar como "sem resposta" (o que ainda espera não conta). */
export const ESPERA_SEM_PRAZO_MS = 15 * 60_000;

/**
 * Como o caso entra no placar: `conta` falso = ainda no prazo (ou esperando há pouco) ou decidido por um ajuste da loja
 * (o Regem aceitou sozinho o cancelamento da 99 porque a loja escolheu assim) — fora da conta. `seg` = a 1ª resposta,
 * quando se sabe a hora.
 */
export function situacaoNoPlacar(l: LinhaDoCaso, agora: number): { conta: boolean; respondida: boolean; seg: number | null } {
  // O RECADO para a abertura (mig 379) espera desde a volta da equipe: a madrugada não conta como demora da loja.
  const criado = ms(l.inicioEm ?? l.criadoEm);
  const seg = (fim: number) => (Number.isFinite(fim) && fim >= criado ? Math.round((fim - criado) / 1000) : null);
  const aberto = l.status !== 'resolvido';
  const prazo = ms(l.prazoEm);
  const esperando = aberto && (Number.isFinite(prazo) ? prazo > agora : agora - criado < ESPERA_SEM_PRAZO_MS);
  const g = grupoDoPlacar(l);
  if (g === 'disputa') {
    if (l.resposta?.em) return { conta: true, respondida: true, seg: seg(ms(l.resposta.em)) };
    const st = l.encerramento?.status ?? '';
    if (st === 'ACCEPTED' || st === 'REJECTED' || st === 'ALTERNATIVE_REPLIED') return { conta: true, respondida: true, seg: null }; // pelo app do iFood
    if (esperando) return { conta: false, respondida: false, seg: null };
    return { conta: true, respondida: false, seg: null };
  }
  if (g === 'pedido99') {
    if (l.decisao === 'aceito_automatico') return { conta: false, respondida: false, seg: null };
    if (l.resposta?.em && !l.resposta.automatico) return { conta: true, respondida: true, seg: seg(ms(l.resposta.em)) };
    if (esperando) return { conta: false, respondida: false, seg: null };
    return { conta: true, respondida: false, seg: null }; // a 99 decidiu, ou o Regem recusou pelo ajuste
  }
  if (g === 'avaliacao') {
    if (l.resposta?.em) return { conta: true, respondida: true, seg: seg(ms(l.resposta.em)) };
    if (esperando) return { conta: false, respondida: false, seg: null };
    return { conta: true, respondida: false, seg: null };
  }
  // Casos do robô e o cancelamento pedido no cardápio: respondido quando uma pessoa pega ou resolve.
  const porPessoa = [ms(l.pegoEm), l.resolvidoPorId ? ms(l.resolvidoEm) : NaN].filter(Number.isFinite);
  if (porPessoa.length) return { conta: true, respondida: true, seg: seg(Math.min(...porPessoa)) };
  if (esperando) return { conta: false, respondida: false, seg: null };
  return { conta: true, respondida: false, seg: null };
}

// ───────────────────────── a resposta ─────────────────────────

export type LinhaDoPlacar = {
  k: string;
  canal: 'ifood' | '99food' | 'whatsapp' | 'cardapio' | 'instagram';
  nome: string;
  o: string;
  chegaram: number;
  respondidas: number;
  segMedio: number | null;
  semResposta: number;
  /** Chat: nenhuma mensagem no período (a ponte do chat desligada, ou ninguém escreveu). */
  semMensagens?: boolean;
};
export type ChatDoPeriodo = { canal: string; chegaram: number; respondidas: number; seg: number | null };

const DESCRICAO: Record<string, Omit<LinhaDoPlacar, 'chegaram' | 'respondidas' | 'segMedio' | 'semResposta'>> = {
  'chat-ifood': { k: 'chat-ifood', canal: 'ifood', nome: 'Chat do iFood', o: 'mensagens do cliente' },
  'chat-99': { k: 'chat-99', canal: '99food', nome: 'Chat da 99', o: 'mensagens do cliente' },
  'chat-instagram': { k: 'chat-instagram', canal: 'instagram', nome: 'Instagram Direct', o: 'mensagens do cliente no Direct da loja' },
  casos: { k: 'casos', canal: 'whatsapp', nome: 'WhatsApp', o: 'casos que o robô passou à equipe · tempo até alguém pegar' },
  disputa: { k: 'disputa', canal: 'ifood', nome: 'Disputas do iFood', o: 'disputas · sem resposta, o iFood decide sozinho' },
  pedido99: { k: 'pedido99', canal: '99food', nome: 'Cancelamento e reembolso da 99', o: 'pedidos do cliente · sem resposta, a 99 decide' },
  avaliacao: { k: 'avaliacao', canal: 'ifood', nome: 'Avaliações do iFood', o: 'com comentário ou nota até 3 · a resposta fica pública' },
  cancelamento: { k: 'cancelamento', canal: 'cardapio', nome: 'Cancelamento pedido pelo cliente', o: 'no cardápio ou no WhatsApp' },
};

export type MotivoNoPeriodo = { k: Motivo | 'sem'; nome: string; casos: number; centavos: number; estimado: boolean; daPlataforma: number };
export type ProdutoNoPeriodo = { nome: string; casos: number; centavos: number; motivos: Array<{ k: Motivo | 'sem'; nome: string; casos: number }> };
export type NumerosDoAtendimento = {
  canais: LinhaDoPlacar[];
  motivos: MotivoNoPeriodo[];
  produtos: ProdutoNoPeriodo[];
  custou: { centavos: number; casos: number; estimado: boolean; semValor: number };
  reclamacoes: number;
};

export const MAX_PRODUTOS_NA_LISTA = 10;

/** Monta os números do período com as linhas dos casos e o placar do chat (já contado em SQL). */
export function montarNumeros(linhas: LinhaDoCaso[], chat: ChatDoPeriodo[], agora: number): NumerosDoAtendimento {
  // Placar
  const doChat = (canal: string, k: string): LinhaDoPlacar => {
    const c = chat.find((x) => x.canal === canal);
    const chegaram = Number(c?.chegaram) || 0;
    const respondidas = Number(c?.respondidas) || 0;
    return { ...DESCRICAO[k], chegaram, respondidas, segMedio: respondidas && c?.seg != null ? Math.round(Number(c.seg)) : null, semResposta: Math.max(0, chegaram - respondidas), ...(chegaram ? {} : { semMensagens: true }) } as LinhaDoPlacar;
  };
  const soma = new Map<GrupoDosCasos, { chegaram: number; respondidas: number; seg: number; nSeg: number }>();
  for (const g of GRUPOS_DOS_CASOS) soma.set(g, { chegaram: 0, respondidas: 0, seg: 0, nSeg: 0 });
  for (const l of linhas) {
    const g = grupoDoPlacar(l);
    if (!g) continue;
    const s = situacaoNoPlacar(l, agora);
    if (!s.conta) continue;
    const t = soma.get(g)!;
    t.chegaram++;
    if (s.respondida) t.respondidas++;
    if (s.seg !== null) {
      t.seg += s.seg;
      t.nSeg++;
    }
  }
  const canais: LinhaDoPlacar[] = [
    doChat('ifood', 'chat-ifood'),
    doChat('99food', 'chat-99'),
    doChat('instagram', 'chat-instagram'),
    ...GRUPOS_DOS_CASOS.map((g) => {
      const t = soma.get(g)!;
      return { ...DESCRICAO[g], chegaram: t.chegaram, respondidas: t.respondidas, segMedio: t.nSeg ? Math.round(t.seg / t.nSeg) : null, semResposta: t.chegaram - t.respondidas } as LinhaDoPlacar;
    }),
  ];

  // Reclamações e custo
  const motivos = new Map<Motivo | 'sem', MotivoNoPeriodo>();
  const produtos = new Map<string, { nome: string; casos: number; centavos: number; motivos: Map<Motivo | 'sem', number> }>();
  const custou = { centavos: 0, casos: 0, estimado: false, semValor: 0 };
  let reclamacoes = 0;
  for (const l of linhas) {
    const r = oQueAconteceuNoCaso(l);
    const c = custouDoCaso(l);
    if (c.conhecido && c.centavos > 0) {
      custou.centavos += c.centavos;
      custou.casos++;
      custou.estimado = custou.estimado || c.estimado;
    } else if (!c.conhecido) custou.semValor++;
    if (!contaComoReclamacao(l, r)) continue;
    reclamacoes++;
    const k: Motivo | 'sem' = r.motivo ?? 'sem';
    const m = motivos.get(k) ?? { k, nome: k === 'sem' ? 'Sem motivo marcado' : nomeDoMotivo(k), casos: 0, centavos: 0, estimado: false, daPlataforma: 0 };
    m.casos++;
    if (c.conhecido) m.centavos += c.centavos;
    m.estimado = m.estimado || (c.estimado && c.centavos > 0);
    if (r.fonte === 'plataforma') m.daPlataforma++;
    motivos.set(k, m);
    // O mesmo produto apontado duas vezes no caso conta uma vez; o custo do caso se divide entre os produtos dele.
    const doCaso = new Map<string, ProdutoApontado>();
    for (const p of r.produtos) if (!doCaso.has(chaveDoProduto(p.nome))) doCaso.set(chaveDoProduto(p.nome), p);
    const n = doCaso.size;
    let i = 0;
    for (const [chave, p] of doCaso) {
      const parte = c.conhecido && n ? Math.floor(c.centavos / n) + (i < c.centavos % n ? 1 : 0) : 0;
      i++;
      const x = produtos.get(chave) ?? { nome: p.nome, casos: 0, centavos: 0, motivos: new Map() };
      x.casos++;
      x.centavos += parte;
      const mk: Motivo | 'sem' = p.motivo ?? r.motivo ?? 'sem';
      x.motivos.set(mk, (x.motivos.get(mk) ?? 0) + 1);
      produtos.set(chave, x);
    }
  }
  const listaMotivos = [...motivos.values()].sort((a, b) => (a.k === 'sem' ? 1 : b.k === 'sem' ? -1 : b.casos - a.casos || b.centavos - a.centavos));
  const listaProdutos = [...produtos.values()]
    .sort((a, b) => b.casos - a.casos || b.centavos - a.centavos || a.nome.localeCompare(b.nome))
    .slice(0, MAX_PRODUTOS_NA_LISTA)
    .map((p) => ({
      nome: p.nome,
      casos: p.casos,
      centavos: p.centavos,
      motivos: [...p.motivos.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, nome: k === 'sem' ? 'sem motivo' : nomeDoMotivo(k), casos: n })),
    }));
  return { canais, motivos: listaMotivos, produtos: listaProdutos, custou, reclamacoes };
}

// ───────────────────────── os casos de um número (a gaveta) ─────────────────────────

export type FiltroDosCasos = { motivo?: string; produto?: string };
export type CasoDoNumero = {
  id: string;
  tipo: string;
  canal: string | null;
  titulo: string;
  criadoEm: string;
  motivo: Motivo | null;
  fonte: 'equipe' | 'plataforma' | null;
  produtos: string[];
  centavos: number;
  estimado: boolean;
  aberto: boolean;
};
export const MAX_CASOS_NA_GAVETA = 30;

const primeiroNome = (s: string | null) => (s ? s.trim().split(/\s+/)[0] : '');

/** Os casos atrás de um motivo ou de um produto (os mais novos primeiro; as linhas já vêm assim). */
export function casosDoNumero(linhas: LinhaDoCaso[], f: FiltroDosCasos): { casos: CasoDoNumero[]; total: number } {
  const chave = f.produto ? chaveDoProduto(f.produto) : null;
  const achados: CasoDoNumero[] = [];
  let total = 0;
  for (const l of linhas) {
    const r = oQueAconteceuNoCaso(l);
    if (!contaComoReclamacao(l, r)) continue;
    if (f.motivo && (r.motivo ?? 'sem') !== f.motivo) continue;
    if (chave && !r.produtos.some((p) => chaveDoProduto(p.nome) === chave)) continue;
    total++;
    if (achados.length >= MAX_CASOS_NA_GAVETA) continue;
    const c = custouDoCaso(l);
    const quem = primeiroNome(l.cliente);
    const pedido = l.pedidoNumero ? `pedido ${l.pedidoNumero}` : '';
    achados.push({
      id: l.id,
      tipo: l.tipo,
      canal: l.canal,
      titulo: [quem, pedido].filter(Boolean).join(' · ') || 'Cliente',
      criadoEm: new Date(l.criadoEm).toISOString(),
      motivo: r.motivo,
      fonte: r.fonte,
      produtos: r.produtos.map((p) => p.nome),
      centavos: c.conhecido ? c.centavos : 0,
      estimado: c.estimado && c.centavos > 0,
      aberto: l.status !== 'resolvido',
    });
  }
  return { casos: achados, total };
}
