/* eslint-disable @typescript-eslint/no-explicit-any */
import { REGRA_COM_REPETICAO } from '../../common/adicionais';
import { formas } from './robo-busca';
import { normalizar, reais } from './robo-consultas';

// O PEDIDO MONTADO PELO ROBÔ (Fase 5, F3 — pedido do dono de 30/10/2026). As regras puras do carrinho que fica no Regem
// (`robo_carrinho`, mig 344): achar o produto, a versão e os adicionais pelo NOME que o cliente disse ("x-bacon" =
// "xbacon"), o que falta escolher (como a tela do produto do cardápio), a área de entrega, a forma de pagamento e o troco,
// e o que ainda falta para registrar — na ordem em que o robô pergunta.
// Preço e taxa NÃO se calculam aqui: vêm das MESMAS contas do pedido do cardápio (`CardapioService`), para o resumo que o
// cliente confirma ser exatamente o que vai ser gravado (V74).

export type Linha = {
  linha: number;
  produtoId: string;
  variacaoId: string | null;
  complementos: string[];
  quantidade: number;
  observacao: string | null;
};

export type EntregaDoCarrinho =
  | { tipo: 'retirada' }
  | {
      tipo: 'entrega';
      rua: string;
      numero: string;
      /** O bairro: o da lista (modo bairro) ou o que o cliente disse (modo distância — só para o texto). */
      bairro: string | null;
      bairroId: string | null;
      /** Complemento e ponto de referência — um campo só, como no cardápio online. `null` = ainda não perguntado. */
      referencia: string | null;
      lat: number | null;
      lng: number | null;
      /** O endereço salvo que o cliente escolheu; `null` = endereço novo (guardado no cadastro ao registrar). */
      enderecoId: string | null;
    };

export type PagamentoDoCarrinho = { forma: string; trocoPara: number | null; semTroco: boolean };

export const MAX_LINHAS = 30;
export const MAX_QUANTIDADE = 50;
const SEM_REFERENCIA = 'sem referência';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compacto = (s: unknown) => normalizar(s).replace(/ /g, '');
const texto = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
/** Os nomes que vieram: lista, ou texto separado por vírgula ("bacon, cheddar" — como a ferramenta do n8n manda). */
const nomesDe = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : v == null ? [] : [v]).map((n) => texto(n, 80)).filter(Boolean).slice(0, 30);

/** Todas as palavras de `busca` aparecem no nome (palavra inteira, ou dentro do nome sem espaços: "xbacon"). */
function casaPorPalavras(nome: unknown, busca: string): boolean {
  const ws = normalizar(busca).split(' ').filter(Boolean);
  if (!ws.length) return false;
  const palavras = new Set(normalizar(nome).split(' '));
  const junto = compacto(nome);
  return ws.every((w) => formas(w).some((f) => palavras.has(f) || (f.length >= 3 && junto.includes(f))));
}

const resumoDoProduto = (p: any) => ({ nome: String(p.nome), preco: reais(p.precoVenda), esgotado: p.esgotado === true });

export type ProdutoAchado =
  | { ok: true; produto: any }
  | { ok: false; motivo: 'esgotado'; produto: any }
  | { ok: false; motivo: 'varios'; opcoes: { nome: string; preco: string | null; esgotado: boolean }[] }
  | { ok: false; motivo: 'nenhum' };

/**
 * O produto pelo que o cliente disse: o id (vindo da busca), o nome igual ("x-bacon" = "X-Bacon" = "xbacon") ou o único
 * que tem todas as palavras. Nome igual vence: "x-bacon" é o X-Bacon, não o "Trio X-Bacon". Esgotado não entra.
 */
export function acharProduto(menu: any, pedido: unknown): ProdutoAchado {
  const produtos: any[] = Array.isArray(menu?.produtos) ? menu.produtos : [];
  const t = texto(pedido, 120);
  if (!t) return { ok: false, motivo: 'nenhum' };
  const decide = (lista: any[]): ProdutoAchado | null => {
    if (!lista.length) return null;
    const aVenda = lista.filter((p) => p.esgotado !== true);
    if (aVenda.length === 1) return { ok: true, produto: aVenda[0] };
    if (!aVenda.length && lista.length === 1) return { ok: false, motivo: 'esgotado', produto: lista[0] };
    return { ok: false, motivo: 'varios', opcoes: (aVenda.length ? aVenda : lista).slice(0, 8).map(resumoDoProduto) };
  };
  if (UUID.test(t)) {
    const p = produtos.find((x) => x.id === t);
    if (p) return decide([p])!;
  }
  const q = compacto(t);
  return (
    decide(produtos.filter((p) => compacto(p.nome) === q)) ??
    decide(produtos.filter((p) => casaPorPalavras(p.nome, t))) ?? { ok: false, motivo: 'nenhum' }
  );
}

/** A versão (tamanho, sabor) do produto pelo nome. Produto sem versões: nenhuma. Com versões e sem escolha: falta. */
export function acharVariacao(
  produto: any,
  pedido: unknown,
): { ok: true; variacao: any | null } | { ok: false; motivo: 'falta' | 'nenhuma'; opcoes: { nome: string; preco: string | null }[] } {
  const vs: any[] = Array.isArray(produto?.variacoes) ? produto.variacoes : [];
  const opcoes = vs.map((v) => ({ nome: String(v.nome), preco: reais(v.precoVenda) }));
  if (!vs.length) return { ok: true, variacao: null };
  const t = texto(pedido, 80);
  if (!t) return { ok: false, motivo: 'falta', opcoes };
  const q = compacto(t);
  const achada =
    (UUID.test(t) && vs.find((v) => v.id === t)) ||
    vs.find((v) => compacto(v.nome) === q) ||
    (() => {
      const parecidas = vs.filter((v) => casaPorPalavras(v.nome, t));
      return parecidas.length === 1 ? parecidas[0] : null;
    })();
  return achada ? { ok: true, variacao: achada } : { ok: false, motivo: 'nenhuma', opcoes };
}

const obrigatorio = (g: any) => g?.obrigatorio === true || Number(g?.min) > 0;
const minimoDo = (g: any) => (obrigatorio(g) ? Math.max(1, Number(g?.min) || 0) : 0);
const maximoDo = (g: any) => (g?.max != null && Number(g.max) > 0 ? Number(g.max) : null);
const opcoesDoGrupo = (g: any): any[] => (Array.isArray(g?.opcoes) ? g.opcoes : []);
const rotuloDaOpcao = (o: any) => {
  const d = Number(o?.precoDelta) || 0;
  return d > 0 ? `${o.nome} (+${reais(d)})` : String(o?.nome ?? '');
};

export type FaltaEscolher = { grupo: string; minimo: number; maximo: number | null; opcoes: string[] };

/**
 * As escolhas do item pelos NOMES ("bacon", "coca zero"): cada nome vira a opção da etapa do produto. Etapa em que o
 * cliente não escolheu nada fica com as opções que o cadastro traz marcadas (como a tela do produto do cardápio, com o
 * limite da etapa). Repetir a mesma opção só vale onde a etapa aceita ("2x bacon"). Devolve o que não achou, a etapa que
 * passou do limite e a etapa obrigatória que ainda falta escolher.
 */
export function montarEscolhas(
  produto: any,
  nomes: unknown,
): { complementos: string[]; naoAchei: string[]; passouDoLimite: { grupo: string; maximo: number }[]; faltaEscolher: FaltaEscolher[] } {
  const grupos: any[] = Array.isArray(produto?.grupos) ? produto.grupos : [];
  const lista = nomesDe(nomes);
  const escolhidas = new Map<string, string[]>(); // grupo.id → ids das opções, na ordem
  const naoAchei: string[] = [];
  for (const nome of lista) {
    const candidatas = opcaoPeloNome(grupos, nome);
    // A mesma opção em duas etapas: a primeira que ainda tem lugar.
    const cabe = candidatas.find(({ g }) => {
      const max = maximoDo(g);
      return max == null || (escolhidas.get(g.id)?.length ?? 0) < max;
    });
    const alvo = cabe ?? candidatas[0];
    if (!alvo) {
      naoAchei.push(nome);
      continue;
    }
    const ja = escolhidas.get(alvo.g.id) ?? [];
    if (ja.includes(alvo.o.id) && alvo.g.regra !== REGRA_COM_REPETICAO) continue; // uma vez só nesta etapa
    escolhidas.set(alvo.g.id, [...ja, alvo.o.id]);
  }
  const complementos: string[] = [];
  const passouDoLimite: { grupo: string; maximo: number }[] = [];
  const faltaEscolher: FaltaEscolher[] = [];
  for (const g of grupos) {
    const max = maximoDo(g);
    let ids = escolhidas.get(g.id);
    if (!ids) {
      const padrao = opcoesDoGrupo(g).filter((o) => o.padraoMarcada).map((o) => o.id);
      ids = max != null ? padrao.slice(0, max) : padrao;
    }
    if (max != null && ids.length > max) passouDoLimite.push({ grupo: String(g.nome), maximo: max });
    if (ids.length < minimoDo(g))
      faltaEscolher.push({ grupo: String(g.nome), minimo: minimoDo(g), maximo: max, opcoes: opcoesDoGrupo(g).slice(0, 25).map(rotuloDaOpcao) });
    complementos.push(...ids);
  }
  return { complementos, naoAchei, passouDoLimite, faltaEscolher };
}

/** A opção do produto pelo nome (ou id): o igual primeiro, senão a única que tem as palavras. */
function opcaoPeloNome(grupos: any[], nome: string): { g: any; o: any }[] {
  const q = compacto(nome);
  const iguais: { g: any; o: any }[] = [];
  for (const g of grupos) for (const o of opcoesDoGrupo(g)) if (o.id === nome || compacto(o.nome) === q) iguais.push({ g, o });
  if (iguais.length) return iguais;
  const parecidas: { g: any; o: any }[] = [];
  for (const g of grupos) for (const o of opcoesDoGrupo(g)) if (casaPorPalavras(o.nome, nome)) parecidas.push({ g, o });
  return parecidas;
}

/**
 * Mudar as escolhas de um item que já está no pedido: `adicionar` entra (na etapa de uma escolha só, TROCA a que estava
 * — "coca" no lugar do "guaraná"); `tirar` sai (uma vez cada). Mesmas conferências de limite e de etapa obrigatória.
 */
export function alterarEscolhas(
  produto: any,
  atuais: string[],
  adicionar: unknown,
  tirar: unknown,
): { complementos: string[]; naoAchei: string[]; passouDoLimite: { grupo: string; maximo: number }[]; faltaEscolher: FaltaEscolher[] } {
  const grupos: any[] = Array.isArray(produto?.grupos) ? produto.grupos : [];
  const lista = nomesDe;
  const doGrupo = new Map<string, string>(); // opção → etapa
  for (const g of grupos) for (const o of opcoesDoGrupo(g)) doGrupo.set(o.id, g.id);
  // O que estava e ainda existe no produto (opção que saiu do cardápio cai aqui).
  let ids = (atuais ?? []).filter((id) => doGrupo.has(id));
  const naoAchei: string[] = [];
  for (const nome of lista(tirar)) {
    const alvo = opcaoPeloNome(grupos, nome).find(({ o }) => ids.includes(o.id));
    if (!alvo) {
      naoAchei.push(nome);
      continue;
    }
    const i = ids.indexOf(alvo.o.id);
    ids = [...ids.slice(0, i), ...ids.slice(i + 1)];
  }
  for (const nome of lista(adicionar)) {
    const candidatas = opcaoPeloNome(grupos, nome);
    const alvo = candidatas.find(({ g }) => maximoDo(g) === 1 || maximoDo(g) == null || ids.filter((x) => doGrupo.get(x) === g.id).length < maximoDo(g)!) ?? candidatas[0];
    if (!alvo) {
      naoAchei.push(nome);
      continue;
    }
    if (maximoDo(alvo.g) === 1) ids = ids.filter((x) => doGrupo.get(x) !== alvo.g.id);
    else if (ids.includes(alvo.o.id) && alvo.g.regra !== REGRA_COM_REPETICAO) continue;
    ids = [...ids, alvo.o.id];
  }
  const passouDoLimite: { grupo: string; maximo: number }[] = [];
  const faltaEscolher: FaltaEscolher[] = [];
  for (const g of grupos) {
    const n = ids.filter((x) => doGrupo.get(x) === g.id).length;
    const max = maximoDo(g);
    if (max != null && n > max) passouDoLimite.push({ grupo: String(g.nome), maximo: max });
    if (n < minimoDo(g))
      faltaEscolher.push({ grupo: String(g.nome), minimo: minimoDo(g), maximo: max, opcoes: opcoesDoGrupo(g).slice(0, 25).map(rotuloDaOpcao) });
  }
  // Na ordem das etapas do produto (como a tela do produto manda).
  const ordem = new Map<string, number>();
  grupos.forEach((g, i) => ordem.set(g.id, i));
  const complementos = [...ids].sort((a, b) => (ordem.get(doGrupo.get(a)!) ?? 0) - (ordem.get(doGrupo.get(b)!) ?? 0));
  return { complementos, naoAchei, passouDoLimite, faltaEscolher };
}

/** O que falta escolher numa linha já guardada (o produto pode ter mudado no cadastro depois). */
export function faltaDaLinha(produto: any, l: Pick<Linha, 'variacaoId' | 'complementos'>): string[] {
  const falta: string[] = [];
  const vs: any[] = Array.isArray(produto?.variacoes) ? produto.variacoes : [];
  if (vs.length && !vs.some((v) => v.id === l.variacaoId)) falta.push(`a versão (${vs.map((v) => v.nome).join(', ')})`);
  for (const g of Array.isArray(produto?.grupos) ? produto.grupos : []) {
    const ids = new Set(opcoesDoGrupo(g).map((o) => o.id));
    const n = (l.complementos ?? []).filter((c) => ids.has(c)).length;
    if (n < minimoDo(g)) falta.push(`${g.nome} (${opcoesDoGrupo(g).slice(0, 12).map((o) => o.nome).join(', ')})`);
  }
  return falta;
}

/** A quantidade do pedido: inteiro de 1 a 50 (o cliente que quer mais fala com a loja). Vazio ou 0 = o padrão. */
export function quantidadeDoPedido(v: unknown, padrao = 1): number | null {
  if (v == null || v === '' || Number(v) === 0) return padrao;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 1 || n > MAX_QUANTIDADE || Math.floor(n) !== n) return null;
  return n;
}

// ───────────────────────── entrega ─────────────────────────

/** O bairro da lista da loja pelo nome: igual; senão os parecidos (até 5). */
export function acharBairro(menu: any, nome: unknown): { ok: true; bairro: { id: string; nome: string } } | { ok: false; parecidos: string[] } {
  const bairros: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
  const t = texto(nome, 80);
  const q = normalizar(t);
  if (!q) return { ok: false, parecidos: [] };
  const exato = bairros.find((b) => normalizar(b.nome) === q) ?? (UUID.test(t) ? bairros.find((b) => b.id === t) : null);
  if (exato) return { ok: true, bairro: { id: exato.id, nome: exato.nome } };
  const parecidos = bairros
    .filter((b) => {
      const n = normalizar(b.nome);
      return n.includes(q) || q.includes(n) || compacto(n) === compacto(q);
    })
    .slice(0, 5);
  if (parecidos.length === 1 && compacto(parecidos[0].nome) === compacto(q)) return { ok: true, bairro: { id: parecidos[0].id, nome: parecidos[0].nome } };
  return { ok: false, parecidos: parecidos.map((b) => String(b.nome)) };
}

/** "Rua A, 10 · Centro · ref: portão azul" — o texto do endereço para o robô repetir ao cliente. */
export function textoDoEndereco(e: EntregaDoCarrinho | null | undefined): string | null {
  if (!e || e.tipo !== 'entrega') return null;
  const ref = e.referencia && e.referencia !== SEM_REFERENCIA ? `ref: ${e.referencia}` : '';
  return [[e.rua, e.numero].filter(Boolean).join(', '), e.bairro ?? '', ref].filter((s) => s && s.trim()).join(' · ') || null;
}

/** A referência informada; "não tem" vira a marca de "sem referência" (já perguntado, para o robô não repetir). */
export function referenciaDoPedido(v: unknown): string | null {
  const t = texto(v, 160);
  if (!t) return null;
  return /^(n[aã]o|nenhum[a]?|sem|nada|n[aã]o tem|n[aã]o precisa)\.?$/i.test(t) || /^sem (refer[eê]ncia|ponto|complemento)/i.test(t) ? SEM_REFERENCIA : t;
}

/** A referência que vai no pedido (sem a marca de "sem referência"). */
export const referenciaParaOPedido = (r: string | null | undefined) => (r && r !== SEM_REFERENCIA ? r : undefined);

// ───────────────────────── pagamento ─────────────────────────

/** As chaves fixas do cardápio que são pagamento ONLINE — o robô não cobra; quem quer pagar assim usa o link. */
const ONLINE = new Set(['pix', 'cartao']);

/** As formas do cardápio que o robô oferece (as de pagar na entrega/retirada), com o nome para o cliente. */
export function formasDoRobo(menu: any, tipo: 'entrega' | 'retirada' | null): { forma: string; nome: string; pedeTroco: boolean }[] {
  const lista: string[] = Array.isArray(menu?.loja?.pagamentos) ? menu.loja.pagamentos : [];
  const onde = tipo === 'retirada' ? 'na retirada' : 'na entrega';
  return lista
    .filter((f) => typeof f === 'string' && f.trim() && !ONLINE.has(f))
    .map((f) => ({
      forma: f,
      nome: f === 'entrega' ? `Pagar ${onde} (dinheiro ou maquininha)` : f === 'vr' ? 'Vale-refeição (na maquininha)' : f,
      pedeTroco: pedeTroco(f),
    }));
}

/** As formas ONLINE do cardápio (Pix e cartão pelo link): o robô avisa que essas são pelo link. */
export function formasSoPeloLink(menu: any): string[] {
  const lista: string[] = Array.isArray(menu?.loja?.pagamentos) ? menu.loja.pagamentos : [];
  return lista.filter((f) => ONLINE.has(f)).map((f) => (f === 'pix' ? 'Pix pelo link' : 'Cartão online pelo link'));
}

/** Forma em que pode haver troco: "pagar na entrega" (dinheiro ou maquininha) ou uma forma de dinheiro da loja. */
export function pedeTroco(forma: unknown): boolean {
  const f = String(forma ?? '');
  return f === 'entrega' || normalizar(f).includes('dinheiro');
}

/** A forma do cardápio pelo que o cliente disse ("dinheiro", "cartão na entrega", "pix na entrega"). */
export function acharForma(
  menu: any,
  tipo: 'entrega' | 'retirada' | null,
  pedido: unknown,
): { ok: true; forma: string; porCartao: boolean } | { ok: false; motivo: 'so_pelo_link' | 'nenhuma'; opcoes: string[] } {
  const formasRobo = formasDoRobo(menu, tipo);
  const opcoes = formasRobo.map((f) => f.nome);
  const t = texto(pedido, 80);
  const q = compacto(t);
  if (!q) return { ok: false, motivo: 'nenhuma', opcoes };
  // "cartão", "maquininha", "débito": no "pagar na entrega" genérico, é cartão — não há troco a perguntar.
  const cartao = /cartao|maquin|debito|credito/.test(q) && !/dinheiro|especie/.test(q);
  const igual = formasRobo.find((f) => compacto(f.forma) === q || compacto(f.nome) === q);
  if (igual) return { ok: true, forma: igual.forma, porCartao: false };
  const parecidas = formasRobo.filter((f) => casaPorPalavras(f.nome, t) || casaPorPalavras(t, f.forma === 'entrega' ? 'entrega' : f.nome));
  if (parecidas.length === 1) return { ok: true, forma: parecidas[0].forma, porCartao: parecidas[0].forma === 'entrega' && cartao };
  // "dinheiro" / "cartão" / "maquininha" quando a loja só tem o "pagar na entrega" genérico.
  const generica = formasRobo.find((f) => f.forma === 'entrega');
  if (generica && /dinheiro|cartao|maquin|debito|credito|especie/.test(q) && !parecidas.length) return { ok: true, forma: generica.forma, porCartao: cartao };
  if (!parecidas.length && /pix|online|link/.test(q) && formasSoPeloLink(menu).length) return { ok: false, motivo: 'so_pelo_link', opcoes };
  return { ok: false, motivo: 'nenhuma', opcoes };
}

/** O troco: "100", "R$ 100,00", "1.000" — só o número (o "maior que o total" se confere com o total na mão). */
export function valorDoTroco(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 && v < 100000 ? Math.round(v * 100) / 100 : null;
  if (/-\s*\d/.test(String(v))) return null; // negativo não é troco
  const s = String(v).replace(/[^\d,.]/g, '');
  const milhar = /^\d{1,3}(\.\d{3})+$/.test(s); // "1.000" = mil, não 1
  const n = Number(s.includes(',') || milhar ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 100) / 100 : null;
}

// ───────────────────────── o que falta ─────────────────────────

export type Falta = { campo: string; pergunta: string };

/**
 * O que ainda falta para registrar, na ordem em que o robô pergunta: itens, escolhas dos itens, o jeito de receber, o
 * endereço (e a referência), o pedido mínimo, o nome, a forma de pagamento e o troco.
 */
export function faltaDoPedido(e: {
  linhas: number;
  linhasIncompletas: { linha: number; produto: string; falta: string[] }[];
  tipo: 'entrega' | 'retirada' | null;
  tiposAbertos: ('entrega' | 'retirada')[];
  entrega: EntregaDoCarrinho | null;
  enderecoForaDaArea: boolean;
  subtotal: number;
  pedidoMinimo: number | null;
  nome: string | null;
  pagamento: PagamentoDoCarrinho | null;
  pagamentoServe: boolean;
}): Falta[] {
  const f: Falta[] = [];
  if (!e.linhas) f.push({ campo: 'itens', pergunta: 'O que o cliente quer pedir.' });
  for (const l of e.linhasIncompletas)
    f.push({ campo: `linha ${l.linha}`, pergunta: `No item ${l.linha} (${l.produto}) falta escolher: ${l.falta.join('; ')}.` });
  if (!e.tipo)
    f.push({
      campo: 'tipo',
      pergunta:
        e.tiposAbertos.length > 1 ? 'Se é para entregar ou para retirar na loja.' : e.tiposAbertos.length ? `Confirmar ${e.tiposAbertos[0]}.` : 'A loja não está recebendo pedidos agora.',
    });
  if (e.tipo === 'entrega') {
    const en = e.entrega && e.entrega.tipo === 'entrega' ? e.entrega : null;
    if (!en) f.push({ campo: 'endereco', pergunta: 'O endereço de entrega (rua, número e bairro).' });
    else if (e.enderecoForaDaArea) f.push({ campo: 'endereco', pergunta: 'O endereço está fora da área de entrega: outro endereço ou retirada.' });
    else if (en.referencia == null) f.push({ campo: 'referencia', pergunta: 'O complemento e um ponto de referência (ou "sem referência").' });
    if (e.pedidoMinimo != null && e.pedidoMinimo > 0 && e.subtotal < e.pedidoMinimo && e.linhas)
      f.push({ campo: 'minimo', pergunta: `O pedido mínimo para entrega é ${reais(e.pedidoMinimo)} em itens (faltam ${reais(e.pedidoMinimo - e.subtotal)}).` });
  }
  if (!e.nome) f.push({ campo: 'nome', pergunta: 'O nome do cliente para o pedido.' });
  if (!e.pagamento || !e.pagamentoServe) f.push({ campo: 'pagamento', pergunta: 'A forma de pagamento.' });
  else if (pedeTroco(e.pagamento.forma) && e.pagamento.trocoPara == null && !e.pagamento.semTroco)
    f.push({
      campo: 'troco',
      pergunta: e.pagamento.forma === 'entrega' ? 'Se vai pagar em dinheiro (e troco para quanto) ou no cartão.' : 'Se precisa de troco, e para quanto.',
    });
  return f;
}

/** O nome que o cliente deu: letras, até 60 caracteres. */
export function nomeDoCliente(v: unknown): string | null {
  const t = texto(v, 60).replace(/\s+/g, ' ');
  return /[a-zA-ZÀ-ÿ]/.test(t) ? t : null;
}

/** Ids e quantidades das linhas no formato do pedido do cardápio (`receberPedido`). */
export function itensDoPedido(linhas: Linha[]) {
  return linhas.map((l) => ({
    produtoId: l.produtoId,
    variacaoId: l.variacaoId ?? undefined,
    quantidade: l.quantidade,
    complementos: l.complementos,
    observacao: l.observacao ?? undefined,
  }));
}
