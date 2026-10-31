/* eslint-disable @typescript-eslint/no-explicit-any */
import { REGRA_COM_REPETICAO } from '../../common/adicionais';
import { GRUPOS, formas, nomeJunto, palavrasComNumero, palavrasDe } from './robo-busca';
import { normalizar, reais } from './robo-consultas';

// O PEDIDO MONTADO PELO ROBÔ (Fase 5, F3 — pedido do dono de 30/10/2026). As regras puras do carrinho que fica no Regem
// (`robo_carrinho`, mig 344): achar o produto, a versão e os adicionais pelo NOME que o cliente disse ("x-bacon" =
// "xbacon"), o que falta escolher (como a tela do produto do cardápio), a área de entrega, a forma de pagamento e o troco,
// e o que ainda falta para registrar — na ordem em que o robô pergunta.
// Preço e taxa NÃO se calculam aqui: vêm das MESMAS contas do pedido do cardápio (`CardapioService`), para o resumo que o
// cliente confirma ser exatamente o que vai ser gravado (V74).
//
// F5 (teste do dono no celular, 31/10/2026): o Regem CONDUZ a conversa (`conducaoDoPedido`). A cada passo ele diz ao
// robô a próxima pergunta, as opções para o cliente tocar e como mandar a resposta — o robô deixou de decidir sozinho
// (pulava o adicional e a observação, escolhia o endereço sem perguntar, marcava "sem troco" e criava um segundo trio).
// A ordem é a que o dono descreveu: escolhas obrigatórias do item → adicionais e observação do item → "mais alguma
// coisa?" (com a sugestão de bebida, sobremesa ou porção) → entrega no último endereço, outro ou retirada → complemento e
// referência → nome → pagamento → dinheiro ou cartão → troco. Com tudo pronto, o Regem manda o resumo para conferir.

export type Linha = {
  linha: number;
  produtoId: string;
  variacaoId: string | null;
  complementos: string[];
  quantidade: number;
  observacao: string | null;
  /** F5: o robô já ofereceu os adicionais e a observação deste item (ou o cliente já pediu com eles). */
  extras?: boolean;
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

/** No "pagar na entrega" genérico: dinheiro (pede troco) ou cartão na maquininha (não pede). `null` = ainda não disse. */
export type Meio = 'dinheiro' | 'cartao';
/**
 * Bloco 1b (plano de 31/10/2026): o que o cliente decidiu sobre os benefícios — usar o cashback (`undefined` = ainda não
 * perguntado), o cupom que ELE disse e o prêmio da fidelidade (`resgateId`; `premioDecidido` = já respondeu à pergunta).
 * Fica no jsonb do pagamento (sem coluna nova): a forma (`forma = ''`) pode ainda não ter sido escolhida.
 */
export type BeneficiosDoCarrinho = { usarCashback?: boolean; cupom?: string | null; resgateId?: string | null; premioDecidido?: boolean };
export type PagamentoDoCarrinho = { forma: string; trocoPara: number | null; semTroco: boolean; meio?: Meio | null; beneficios?: BeneficiosDoCarrinho };

/** As decisões dos benefícios do carrinho (vazio quando nada foi dito). */
export const beneficiosDe = (pg: unknown): BeneficiosDoCarrinho => {
  const b = (pg as any)?.beneficios;
  return b && typeof b === 'object' ? (b as BeneficiosDoCarrinho) : {};
};

/** O pagamento com as decisões dos benefícios mudadas (a forma, o meio e o troco ficam como estavam). */
export function comBeneficios(pg: unknown, mudanca: Partial<BeneficiosDoCarrinho>): PagamentoDoCarrinho {
  const atual = (pg as PagamentoDoCarrinho | null) ?? { forma: '', trocoPara: null, semTroco: false };
  return { ...atual, beneficios: { ...beneficiosDe(atual), ...mudanca } };
}

export const MAX_LINHAS = 30;
export const MAX_QUANTIDADE = 50;
const SEM_REFERENCIA = 'sem referência';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compacto = (s: unknown) => normalizar(s).replace(/ /g, '');
const texto = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
/**
 * Os nomes que vieram: lista, ou texto separado por vírgula ("bacon, cheddar" — como a ferramenta do n8n manda). O
 * detalhe das opções ("Bacon — +R$ 3,50", F5) sai antes: a vírgula do preço não pode partir o nome.
 */
const semDetalhe = (s: string) => s.replace(/\s+—\s+.*?(?=,\s*(?!\d)|;|$)/g, '');
const nomesDe = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map((x) => semDetalhe(String(x ?? ''))) : typeof v === 'string' ? semDetalhe(v).split(/[,;]/) : v == null ? [] : [v])
    .map((n) => texto(n, 80))
    .filter(Boolean)
    .slice(0, 30);

/**
 * Todas as palavras de `busca` aparecem no nome (palavra inteira, ou dentro do nome sem espaços: "xbacon"). Número é o
 * do nome, sem o zero da frente e também falado ("trio 8" = "trio oito" = "TRIO 08"; "trio 1" não é o "TRIO 10").
 */
function casaPorPalavras(nome: unknown, busca: string): boolean {
  const ws = palavrasComNumero(busca);
  if (!ws.length) return false;
  const palavras = new Set(palavrasComNumero(nome));
  const junto = nomeJunto(nome);
  const numero = (w: string) => /^\d/.test(w);
  return ws.every((w) => (numero(w) ? palavras.has(w) : formas(w).some((f) => palavras.has(f) || (f.length >= 3 && junto.includes(f)))));
}

const resumoDoProduto = (p: any) => ({ id: String(p.id), nome: String(p.nome), preco: reais(p.precoVenda), esgotado: p.esgotado === true });

/**
 * O MESMO produto cadastrado em duas categorias (mesmo nome e mesmo preço — "TRIO 08" em "Burguer + batata + refri" e
 * em "Os mais pedidos") é UM para o cliente: fica a cópia mais completa (com mais etapas). 3º teste do dono (31/10/2026):
 * "trio 08" voltava "mais de um produto com esse nome" com duas opções iguais, e o robô pôs o lanche Número 08.
 */
function umaCopiaDeCada(lista: any[]): any[] {
  const porChave = new Map<string, any>();
  for (const p of lista) {
    const chave = `${nomeJunto(p.nome)}|${Number(p.precoVenda)}`;
    const ja = porChave.get(chave);
    const etapas = (x: any) => (Array.isArray(x?.grupos) ? x.grupos.length : 0);
    if (!ja || etapas(p) > etapas(ja)) porChave.set(chave, p);
  }
  return [...porChave.values()];
}

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
  const decide = (achados: any[]): ProdutoAchado | null => {
    if (!achados.length) return null;
    const lista = umaCopiaDeCada(achados);
    const aVenda = umaCopiaDeCada(achados.filter((p) => p.esgotado !== true));
    if (aVenda.length === 1) return { ok: true, produto: aVenda[0] };
    if (!aVenda.length && lista.length === 1) return { ok: false, motivo: 'esgotado', produto: lista[0] };
    return { ok: false, motivo: 'varios', opcoes: (aVenda.length ? aVenda : lista).slice(0, 8).map(resumoDoProduto) };
  };
  if (UUID.test(t)) {
    const p = produtos.find((x) => x.id === t);
    if (p) return decide([p])!;
  }
  const q = nomeJunto(t);
  return (
    decide(produtos.filter((p) => nomeJunto(p.nome) === q)) ??
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

/** Algum dos nomes é ADICIONAL opcional do produto (não é escolha obrigatória nem "sem cebola")? O cliente já disse. */
export function temAdicionalOpcional(produto: any, nomes: unknown): boolean {
  const grupos: any[] = Array.isArray(produto?.grupos) ? produto.grupos : [];
  return nomesDe(nomes).some((n) => opcaoPeloNome(grupos, n).some(({ g }) => !obrigatorio(g) && String(g?.tipo ?? '') !== 'remover'));
}

/** O nome casa com uma opção do produto (em qualquer etapa)? Para achar o item a que a escolha pertence. */
export function temOpcao(produto: any, nome: unknown): boolean {
  const grupos: any[] = Array.isArray(produto?.grupos) ? produto.grupos : [];
  const n = texto(nome, 80);
  return !!n && opcaoPeloNome(grupos, n).length > 0;
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
  return escolhasQueFaltam(produto, l).map((e) => (e.versao ? `a versão (${e.nomes.join(', ')})` : `${e.grupo} (${e.nomes.slice(0, 12).join(', ')})`));
}

/** "Título — detalhe": o formato das opções que o robô põe na linha OPCOES (o Regem separa o detalhe na lista). */
export const opcaoComDetalhe = (titulo: string, detalhe?: string | null) => (detalhe ? `${titulo} — ${detalhe}` : titulo);

const detalheDoPreco = (o: any) => {
  const d = Number(o?.precoDelta) || 0;
  return d > 0 ? `+${reais(d)}` : null;
};

/**
 * As etapas obrigatórias que faltam na linha, com as opções no formato da linha OPCOES ("Batata Frita - Grande —
 * +R$ 5,00"), TODAS (o Regem mostra em lista até 10 e em menu numerado acima disso — no teste, o robô cortava em 3).
 */
export function escolhasQueFaltam(
  produto: any,
  l: Pick<Linha, 'variacaoId' | 'complementos'>,
): { grupo: string; versao: boolean; nomes: string[]; opcoes: string[] }[] {
  const r: { grupo: string; versao: boolean; nomes: string[]; opcoes: string[] }[] = [];
  const vs: any[] = Array.isArray(produto?.variacoes) ? produto.variacoes : [];
  if (vs.length && !vs.some((v) => v.id === l.variacaoId))
    r.push({ grupo: 'a versão', versao: true, nomes: vs.map((v) => String(v.nome)), opcoes: vs.slice(0, 25).map((v) => opcaoComDetalhe(String(v.nome), reais(v.precoVenda))) });
  for (const g of Array.isArray(produto?.grupos) ? produto.grupos : []) {
    const ids = new Set(opcoesDoGrupo(g).map((o) => o.id));
    const n = (l.complementos ?? []).filter((c) => ids.has(c)).length;
    if (n < minimoDo(g))
      r.push({
        grupo: String(g.nome),
        versao: false,
        nomes: opcoesDoGrupo(g).map((o) => String(o.nome)),
        opcoes: opcoesDoGrupo(g).slice(0, 25).map((o) => opcaoComDetalhe(String(o.nome), detalheDoPreco(o))),
      });
  }
  return r;
}

/**
 * Os ADICIONAIS que dá para pôr no item (as etapas opcionais de acrescentar — "Sem cebola" é observação, não entra),
 * com o preço, sem repetir nome; os que o item já tem ficam de fora (a etapa de uma escolha só troca, e o cliente pede
 * "mais um bacon" escrevendo).
 */
export function adicionaisDoItem(produto: any, complementos: string[] = []): string[] {
  const ja = new Set(complementos ?? []);
  const vistos = new Set<string>();
  const r: string[] = [];
  for (const g of Array.isArray(produto?.grupos) ? produto.grupos : []) {
    if (obrigatorio(g) || String(g?.tipo ?? '') === 'remover') continue;
    for (const o of opcoesDoGrupo(g)) {
      if (o?.informativa || ja.has(o.id)) continue;
      const chave = compacto(o.nome);
      if (!chave || vistos.has(chave)) continue;
      vistos.add(chave);
      r.push(opcaoComDetalhe(String(o.nome), detalheDoPreco(o) ?? 'sem custo'));
    }
  }
  return r;
}

/** Lanche (sanduíche, trio, combo) pelo nome ou pela categoria: mesmo sem adicional, o robô oferece a observação. */
export function ehLanche(produto: any, nomeDaCategoria?: string | null): boolean {
  const ws = new Set([...palavrasDe(produto?.nome), ...palavrasDe(nomeDaCategoria)]);
  if (['trio', 'combo', ...GRUPOS.sanduiche].some((w) => ws.has(w))) return true;
  return /^x[a-z]/.test(compacto(produto?.nome)); // "X-Bacon", "Xsalada"
}

/** O item pede a pergunta dos extras (adicionais e observação)? Tem adicional para oferecer ou é lanche. */
export const pedeExtras = (produto: any, nomeDaCategoria?: string | null) => adicionaisDoItem(produto).length > 0 || ehLanche(produto, nomeDaCategoria);

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

export type OpcaoDePagamento = { titulo: string; detalhe: string | null; forma: string; meio: Meio | null };

/**
 * As formas de pagamento como o cliente escolhe nos botões (F5): nomes CURTOS — o botão da Meta corta em 20 letras, e
 * "Pagar na entrega (dinheiro ou maquininha)" chegava como "Pagar na entrega (d…". O "pagar na entrega" do cardápio vira
 * DUAS opções, "Dinheiro" e "Cartão na entrega" (é a mesma forma no pedido; o dinheiro pede o troco).
 */
export function opcoesDePagamento(menu: any, tipo: 'entrega' | 'retirada' | null): OpcaoDePagamento[] {
  const onde = tipo === 'retirada' ? 'na retirada' : 'na entrega';
  const r: OpcaoDePagamento[] = [];
  const poe = (o: OpcaoDePagamento) => {
    if (!r.some((x) => compacto(x.titulo) === compacto(o.titulo))) r.push(o);
  };
  for (const f of formasDoRobo(menu, tipo)) {
    if (f.forma === 'entrega') {
      poe({ titulo: 'Dinheiro', detalhe: `pago ${onde}`, forma: f.forma, meio: 'dinheiro' });
      poe({ titulo: tipo === 'retirada' ? 'Cartão na retirada' : 'Cartão na entrega', detalhe: 'débito ou crédito na maquininha', forma: f.forma, meio: 'cartao' });
    } else if (f.forma === 'vr') poe({ titulo: 'Vale-refeição', detalhe: 'na maquininha', forma: f.forma, meio: 'cartao' });
    else poe({ titulo: f.nome, detalhe: null, forma: f.forma, meio: normalizar(f.nome).includes('dinheiro') ? 'dinheiro' : null });
  }
  return r;
}

/** A forma do cardápio pelo que o cliente disse ("dinheiro", "cartão na entrega", "pix na entrega", o botão tocado). */
export function acharForma(
  menu: any,
  tipo: 'entrega' | 'retirada' | null,
  pedido: unknown,
): { ok: true; forma: string; porCartao: boolean; meio: Meio | null } | { ok: false; motivo: 'so_pelo_link' | 'nenhuma'; opcoes: string[] } {
  const formasRobo = formasDoRobo(menu, tipo);
  const opcoes = opcoesDePagamento(menu, tipo).map((o) => o.titulo);
  // O botão tocado chega como "Dinheiro" ou "Dinheiro — pago na entrega": o detalhe não conta.
  const t = texto(pedido, 80).split(' — ')[0].trim();
  const q = compacto(t);
  if (!q) return { ok: false, motivo: 'nenhuma', opcoes };
  // "cartão", "maquininha", "débito": no "pagar na entrega" genérico, é cartão — não há troco a perguntar. Os dois juntos
  // ("dinheiro ou maquininha", o nome inteiro da forma) não dizem qual: o robô pergunta.
  const temCartao = /cartao|maquin|debito|credito/.test(q);
  const temDinheiro = /dinheiro|especie/.test(q);
  const cartao = temCartao && !temDinheiro;
  const dinheiro = temDinheiro && !temCartao;
  const meioDe = (forma: string): Meio | null =>
    forma === 'vr' ? 'cartao' : forma === 'entrega' ? (cartao ? 'cartao' : dinheiro ? 'dinheiro' : null) : normalizar(forma).includes('dinheiro') ? 'dinheiro' : null;
  // O título do botão ("Dinheiro", "Cartão na entrega", "Vale-refeição").
  const doBotao = opcoesDePagamento(menu, tipo).find((o) => compacto(o.titulo) === q);
  if (doBotao) return { ok: true, forma: doBotao.forma, porCartao: doBotao.forma === 'entrega' && doBotao.meio === 'cartao', meio: doBotao.meio };
  const igual = formasRobo.find((f) => compacto(f.forma) === q || compacto(f.nome) === q);
  if (igual) return { ok: true, forma: igual.forma, porCartao: false, meio: meioDe(igual.forma) };
  const parecidas = formasRobo.filter((f) => casaPorPalavras(f.nome, t) || casaPorPalavras(t, f.forma === 'entrega' ? 'entrega' : f.nome));
  if (parecidas.length === 1) {
    const forma = parecidas[0].forma;
    return { ok: true, forma, porCartao: forma === 'entrega' && cartao, meio: meioDe(forma) };
  }
  // "dinheiro" / "cartão" / "maquininha" quando a loja só tem o "pagar na entrega" genérico.
  const generica = formasRobo.find((f) => f.forma === 'entrega');
  if (generica && (temCartao || temDinheiro) && !parecidas.length)
    return { ok: true, forma: generica.forma, porCartao: cartao, meio: meioDe(generica.forma) };
  if (!parecidas.length && /pix|online|link/.test(q) && formasSoPeloLink(menu).length) return { ok: false, motivo: 'so_pelo_link', opcoes };
  return { ok: false, motivo: 'nenhuma', opcoes };
}

/** "Não preciso", "sem troco", "tenho trocado": o cliente disse que NÃO precisa de troco (o texto do campo troco). */
export function semTrocoNoTexto(v: unknown): boolean {
  const t = normalizar(v);
  return !!t && /^(n[a]?o|nao preciso|sem|nenhum|ja tenho|tenho trocado|trocado|dinheiro certo|valor certo|certinho|exato)/.test(t) && !/\d/.test(t);
}

/** O pagamento ainda precisa dizer dinheiro ou cartão (o "pagar na entrega" genérico, sem troco dito). */
export const precisaDoMeio = (pg: PagamentoDoCarrinho | null): boolean =>
  !!pg && pg.forma === 'entrega' && !pg.meio && pg.trocoPara == null && !pg.semTroco;

/** O pagamento ainda precisa do troco: é dinheiro e o cliente não disse o valor nem que não precisa. */
export function precisaDeTroco(pg: PagamentoDoCarrinho | null): boolean {
  if (!pg || pg.semTroco || pg.trocoPara != null) return false;
  if (pg.meio === 'dinheiro') return true;
  if (pg.meio === 'cartao') return false;
  return pg.forma !== 'entrega' && normalizar(pg.forma).includes('dinheiro');
}

/** Duas notas que cobrem o total, para os botões do troco ("R$ 50", "R$ 100"). */
export function sugestoesDeTroco(total: number): string[] {
  const notas = [20, 50, 100, 150, 200, 300, 500];
  return notas
    .filter((n) => n > total + 0.009)
    .slice(0, 2)
    .map((n) => `R$ ${n}`);
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

// ───────────────────────── a condução (o que falta, na ordem) ─────────────────────────

/** Um passo da conversa: o que perguntar, as opções para tocar e como mandar a resposta ao Regem. */
export type Falta = {
  campo: string;
  pergunta: string;
  /** As opções como vão na linha OPCOES ("Título — detalhe"): até 10 viram lista; mais que isso, menu numerado. */
  opcoes?: string[];
  /** A ferramenta e os campos para a resposta do cliente. */
  comoResponder?: string;
  linha?: number;
};

export type EstadoDaConducao = {
  linhas: { linha: number; produto: string; faltaEscolher: { grupo: string; opcoes: string[] }[]; extrasPendentes: boolean; adicionais: string[] }[];
  itensFechados: boolean;
  /** A sugestão do fim dos itens (bebida se não tem; senão sobremesa ou porção): "Nome — R$ 7,00". */
  sugestao: { papel: 'bebida' | 'sobremesa' | 'porcao'; opcoes: string[] } | null;
  /** Bloco 1 (31/10/2026): o lanche sozinho que tem trio — a opção "Trocar pelo TRIO 08 — +R$ 11,00" e o item. */
  trocaPorTrio?: { linha: number; opcao: string } | null;
  tipo: 'entrega' | 'retirada' | null;
  tiposAbertos: ('entrega' | 'retirada')[];
  entrega: EntregaDoCarrinho | null;
  enderecoForaDaArea: boolean;
  /** O último endereço que o cliente usou (o número dele em enderecosSalvos) — o que o robô oferece primeiro. */
  ultimoEndereco: { n: number; texto: string } | null;
  enderecosSalvos: number;
  subtotal: number;
  pedidoMinimo: number | null;
  nome: string | null;
  pagamento: PagamentoDoCarrinho | null;
  pagamentoServe: boolean;
  /** As formas no formato das opções ("Dinheiro — pago na entrega"). */
  opcoesDePagamento: string[];
  total: number;
  /**
   * Bloco 1b (31/10/2026): os benefícios que o cliente TEM e ainda não decidiu — os prêmios da fidelidade e o cashback
   * que dá para usar neste pedido (com o total que fica). Só os que existem viram pergunta; nenhum = nada a perguntar.
   */
  beneficios?: { premios: { nome: string }[]; cashbackParaUsar: number; totalComCashback: number } | null;
};

const OFERTA = { bebida: 'uma bebida', sobremesa: 'uma sobremesa', porcao: 'uma porção' } as const;

/**
 * O que ainda falta, na ORDEM em que o robô pergunta (o primeiro é a próxima pergunta). Pedido do dono (31/10/2026):
 * escolhas obrigatórias do item → adicionais e observação do item → "mais alguma coisa?" → entrega no último endereço,
 * outro endereço ou retirada (uma pergunta, três botões) → complemento e referência → mínimo → nome → prêmio da
 * fidelidade e cashback (só os que o cliente tem — Bloco 1b) → pagamento → dinheiro ou cartão → troco.
 */
export function conducaoDoPedido(e: EstadoDaConducao): Falta[] {
  const f: Falta[] = [];
  if (!e.linhas.length) f.push({ campo: 'itens', pergunta: 'O que o cliente quer pedir.', comoResponder: 'mexer_no_pedido com acao = adicionar, o produto e a quantidade' });
  for (const l of e.linhas) {
    for (const g of l.faltaEscolher)
      f.push({
        campo: `linha ${l.linha}`,
        linha: l.linha,
        pergunta: `Pergunte ${g.grupo === 'a versão' ? 'a versão' : `"${g.grupo}"`} do item ${l.linha} (${l.produto}), com TODAS as opções.`,
        opcoes: g.opcoes,
        comoResponder:
          g.grupo === 'a versão'
            ? `mexer_no_pedido com acao = escolher, linha = ${l.linha} e versao = a opção escolhida`
            : `mexer_no_pedido com acao = escolher, linha = ${l.linha} e adicionais = a opção escolhida`,
      });
    if (!l.faltaEscolher.length && l.extrasPendentes)
      f.push({
        campo: `extras ${l.linha}`,
        linha: l.linha,
        pergunta: l.adicionais.length
          ? `Pergunte se quer acrescentar algum adicional ou deixar uma observação no ${l.produto} (ex.: sem cebola).`
          : `Pergunte se quer deixar alguma observação no ${l.produto} (ex.: sem cebola, ponto da carne).`,
        opcoes: [...l.adicionais.slice(0, 8), 'Pôr observação', 'Não, obrigado'],
        comoResponder: `adicional: mexer_no_pedido com acao = escolher, linha = ${l.linha} e adicionais = o nome; "Pôr observação": pergunte qual e use acao = alterar, linha = ${l.linha} e observacao = o texto; "Não, obrigado": acao = concluir, linha = ${l.linha}`,
      });
  }

  const itensProntos = e.linhas.length > 0 && e.linhas.every((l) => !l.faltaEscolher.length && !l.extrasPendentes);
  // Mesmo com a entrega já dita (o cliente falou o endereço logo de cara), o "mais alguma coisa?" vem antes de fechar.
  if (itensProntos && !e.itensFechados) {
    const oferta = e.sugestao?.opcoes.length ? e.sugestao : null;
    const troca = e.trocaPorTrio ?? null;
    const ofereca = [troca ? 'trocar o lanche pelo trio' : '', oferta ? OFERTA[oferta.papel] : ''].filter(Boolean).join(' e ');
    const tituloDaTroca = troca ? troca.opcao.split(' — ')[0] : '';
    f.push({
      campo: 'mais_algo',
      pergunta: ofereca ? `Pergunte se quer mais alguma coisa e ofereça ${ofereca}, uma vez só.` : 'Pergunte se quer mais alguma coisa.',
      opcoes: [...(troca ? [troca.opcao] : []), ...(oferta?.opcoes ?? []).slice(0, troca ? 2 : 3), 'Não, só isso'],
      comoResponder:
        (troca ? `"${tituloDaTroca}": mexer_no_pedido com acao = trocar_pelo_trio e linha = ${troca.linha}; ` : '') +
        'outro produto: mexer_no_pedido com acao = adicionar; "Não, só isso": mexer_no_pedido com acao = fechar',
    });
  }

  const entregaAberta = e.tiposAbertos.includes('entrega');
  const retiradaAberta = e.tiposAbertos.includes('retirada');
  const en = e.entrega && e.entrega.tipo === 'entrega' ? e.entrega : null;
  if (!e.tipo && !e.tiposAbertos.length) f.push({ campo: 'tipo', pergunta: 'A loja não está recebendo pedidos agora.' });
  else if (!e.tipo && !entregaAberta)
    f.push({ campo: 'tipo', pergunta: 'A entrega está fechada agora: confirme a retirada na loja.', opcoes: ['Retirar na loja'], comoResponder: 'definir_entrega com tipo = retirada' });
  else if (e.tipo !== 'retirada') {
    if (!en) {
      const comRetirada = !e.tipo && retiradaAberta;
      if (e.ultimoEndereco) {
        const outro =
          e.enderecosSalvos > 1
            ? 'mostre os endereços salvos (enderecosSalvos, cada um como "Endereço N — rua, número, bairro") e, no fim, "Cadastrar novo endereço"'
            : 'peça o endereço novo (rua, número e bairro)';
        f.push({
          campo: 'endereco',
          pergunta: `Pergunte se a entrega é no último endereço: ${e.ultimoEndereco.texto}.`,
          opcoes: ['Sim, nesse', 'Outro endereço', ...(comRetirada ? ['Retirar na loja'] : [])],
          comoResponder: `"Sim, nesse": definir_entrega com tipo = entrega e endereco = ${e.ultimoEndereco.n}; "Outro endereço": ${outro}; endereço da lista: definir_entrega com endereco = o número dele; endereço novo: definir_entrega com rua, numero e bairro${comRetirada ? '; "Retirar na loja": definir_entrega com tipo = retirada' : ''}`,
        });
      } else if (comRetirada)
        f.push({ campo: 'tipo', pergunta: 'Pergunte se é entrega ou retirada na loja.', opcoes: ['Entrega', 'Retirar na loja'], comoResponder: 'definir_entrega com tipo = entrega ou retirada' });
      else
        f.push({
          campo: 'endereco',
          pergunta: 'Peça o endereço de entrega: rua, número e bairro (ou a localização pelo WhatsApp).',
          comoResponder: 'definir_entrega com tipo = entrega, rua, numero e bairro (ou localizacao)',
        });
    } else if (e.enderecoForaDaArea)
      f.push({ campo: 'endereco', pergunta: 'O endereço está fora da área de entrega: peça outro endereço ou ofereça a retirada.', comoResponder: 'definir_entrega com o endereço novo, ou tipo = retirada' });
    else if (en.referencia == null)
      f.push({
        campo: 'referencia',
        pergunta: 'Peça o complemento (apto, bloco, casa, fundos) e um ponto de referência — essencial em endereço difícil.',
        comoResponder: 'definir_entrega com referencia = o que o cliente disse (ou "sem referência")',
      });
    if (e.tipo === 'entrega' && e.pedidoMinimo != null && e.pedidoMinimo > 0 && e.subtotal < e.pedidoMinimo && e.linhas.length)
      f.push({
        campo: 'minimo',
        pergunta: `O pedido mínimo para entrega é ${reais(e.pedidoMinimo)} em itens (faltam ${reais(e.pedidoMinimo - e.subtotal)}).`,
        comoResponder: 'mais itens: mexer_no_pedido com acao = adicionar; ou definir_entrega com tipo = retirada',
      });
  }
  if (!e.nome) f.push({ campo: 'nome', pergunta: 'Pergunte o nome do cliente para o pedido.', comoResponder: 'definir_nome' });
  // Bloco 1b (pedido do dono, 31/10/2026): antes do pagamento, o prêmio da fidelidade e o cashback — só os que o cliente
  // tem. O cupom não entra aqui: só quando o cliente fala dele.
  const ben = e.beneficios ?? null;
  if (ben?.premios.length) {
    const varios = ben.premios.length > 1;
    f.push({
      campo: 'premio',
      pergunta: `O cliente tem ${varios ? 'prêmios' : 'um prêmio'} da fidelidade para usar: ${ben.premios.map((p) => p.nome).join('; ')}. Pergunte se quer usar neste pedido.`,
      opcoes: [
        ...ben.premios.slice(0, 3).map((p, i) => opcaoComDetalhe(varios ? `Usar o prêmio ${i + 1}` : 'Usar o prêmio', p.nome)),
        'Deixar para depois',
      ],
      comoResponder: `"Usar o prêmio": mexer_no_pedido com acao = usar_premio${varios ? ' e linha = o número do prêmio' : ''}; "Deixar para depois": mexer_no_pedido com acao = guardar_premio`,
    });
  }
  if (ben && ben.cashbackParaUsar > 0)
    f.push({
      campo: 'cashback',
      pergunta: `O cliente tem ${reais(ben.cashbackParaUsar)} de cashback para usar neste pedido. Pergunte se quer usar agora (o total fica ${reais(ben.totalComCashback)}) ou guardar para depois.`,
      opcoes: [opcaoComDetalhe('Usar meu cashback', `−${reais(ben.cashbackParaUsar)}`), 'Guardar para depois'],
      comoResponder: '"Usar meu cashback": mexer_no_pedido com acao = usar_cashback; "Guardar para depois": mexer_no_pedido com acao = guardar_cashback',
    });
  if (!e.pagamento || !e.pagamentoServe)
    f.push({ campo: 'pagamento', pergunta: 'Pergunte a forma de pagamento.', opcoes: e.opcoesDePagamento, comoResponder: 'definir_pagamento com forma = a opção escolhida' });
  else if (precisaDoMeio(e.pagamento))
    f.push({
      campo: 'meio',
      pergunta: 'Pergunte se vai pagar em dinheiro ou no cartão (na maquininha).',
      opcoes: ['Dinheiro', e.tipo === 'retirada' ? 'Cartão na retirada' : 'Cartão na entrega'],
      comoResponder: 'definir_pagamento com forma = Dinheiro ou Cartão',
    });
  else if (precisaDeTroco(e.pagamento))
    f.push({
      campo: 'troco',
      pergunta: `Pergunte se precisa de troco e para quanto (o total é ${reais(e.total)}).`,
      opcoes: [...sugestoesDeTroco(e.total), 'Não preciso de troco'],
      comoResponder: 'definir_pagamento com troco = o valor (ex.: 100) ou "não preciso"',
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
