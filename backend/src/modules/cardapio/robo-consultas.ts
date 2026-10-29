/* eslint-disable @typescript-eslint/no-explicit-any */

// AS CONSULTAS DO ROBÔ (Fase 2 do robô de WhatsApp, 29/10/2026) — resumos do cardápio público (`CardapioService.menu`)
// no tamanho que um modelo de linguagem lê sem se perder: a mesma fonte do cardápio online, então preço, esgotado,
// horário e taxa são os que o cliente veria. Funções puras (o controller busca o cardápio e chama).

/** "R$ 12,90" — o robô repete o preço como está aqui, sem fazer conta (evita o "R$ 12,9"). */
export function reais(v: unknown): string | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/** Sem acento e em minúsculas, para casar "Hamburguer" com "hambúrguer". */
export function normalizar(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const curto = (s: unknown, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** O que o robô precisa saber da loja AGORA: aberta, até quando, como atende, taxas, pagamento e o link. */
export function resumoDaLoja(menu: any, linkCardapio: string) {
  const loja = menu?.loja ?? {};
  const tipos = menu?.tipos ?? {};
  const porTipo = menu?.abertoPorTipo ?? {};
  return {
    nome: loja.nome ?? null,
    abertaAgora: !!menu?.abertaAgora,
    horario: menu?.horarioLabel ?? null,
    proximaAbertura: menu?.proximaAbertura ?? null,
    pausadaPelaLoja: loja.aberto === false,
    atende: {
      entrega: tipos.delivery !== false ? { abertaAgora: !!porTipo.entrega, tempoMin: loja.tempoEntregaMin ?? null } : null,
      retirada: tipos.retirada ? { abertaAgora: !!porTipo.retirada, tempoMin: loja.tempoRetiradaMin ?? null } : null,
      noLocal: tipos.local ? { abertaAgora: !!porTipo.local } : null,
    },
    pedidoMinimo: reais(loja.pedidoMinimo),
    freteGratisAcima: reais(loja.freteGratisAcima),
    pagamentos: Array.isArray(loja.pagamentos) ? loja.pagamentos : [],
    endereco: loja.endereco?.texto ?? null,
    referencia: loja.endereco?.referencia ?? null,
    contatos: { instagram: loja.instagram ?? null, site: loja.site ?? null },
    taxaPor: loja.areaModo === 'raio' ? 'distancia' : 'bairro',
    bairros: (Array.isArray(menu?.bairros) ? menu.bairros : []).map((b: any) => ({ nome: b.nome, taxa: reais(b.taxa) })),
    linkCardapio,
    categorias: (Array.isArray(menu?.categorias) ? menu.categorias : []).map((c: any) => c.nome),
    robo: {
      saudacao: menu?.robo?.saudacao ?? null,
      ausencia: menu?.robo?.ausencia ?? null,
      baseDeConhecimento: menu?.robo?.prompt ?? null,
      respostasProntas: Array.isArray(menu?.robo?.mensagens) ? menu.robo.mensagens : [],
    },
  };
}

function itemDoRobo(p: any, categoria: string | null) {
  const adicionais: string[] = [];
  for (const g of Array.isArray(p?.grupos) ? p.grupos : []) {
    for (const o of Array.isArray(g?.opcoes) ? g.opcoes : []) {
      if (adicionais.length >= 8) break;
      const delta = Number(o?.precoDelta) || 0;
      adicionais.push(delta > 0 ? `${o.nome} (+${reais(delta)})` : String(o.nome));
    }
  }
  return {
    nome: p.nome,
    preco: reais(p.precoVenda),
    precoAntes: p.precoDe != null ? reais(p.precoDe) : null,
    categoria,
    esgotado: !!p.esgotado,
    descricao: p.descricao ? curto(p.descricao, 160) : null,
    variacoes: (Array.isArray(p?.variacoes) ? p.variacoes : []).slice(0, 8).map((v: any) => ({ nome: v.nome, preco: reais(v.precoVenda) })),
    opcoes: adicionais,
  };
}

/**
 * Busca no cardápio: os itens que casam com o texto (nome primeiro, depois categoria e descrição), até `limite`. Sem
 * texto: as categorias com até 8 itens cada (nome, preço, esgotado) — o "o que tem aí?".
 */
export function buscarNoCardapio(menu: any, busca: string, limite = 15) {
  const produtos: any[] = Array.isArray(menu?.produtos) ? menu.produtos : [];
  const cats = new Map<string, string>((Array.isArray(menu?.categorias) ? menu.categorias : []).map((c: any) => [c.id, c.nome]));
  const q = normalizar(busca);
  if (!q) {
    const porCategoria = new Map<string, any[]>();
    for (const p of produtos) {
      const nome = cats.get(p.categoriaId) ?? 'Outros';
      const lista = porCategoria.get(nome) ?? [];
      if (lista.length < 8) lista.push({ nome: p.nome, preco: reais(p.precoVenda), esgotado: !!p.esgotado });
      porCategoria.set(nome, lista);
    }
    return { busca: '', total: produtos.length, categorias: [...porCategoria].map(([nome, itens]) => ({ nome, itens })) };
  }
  const palavras = q.split(' ').filter((w) => w.length > 1);
  const pontos = (p: any) => {
    const nome = normalizar(p.nome);
    const cat = normalizar(cats.get(p.categoriaId));
    const desc = normalizar(p.descricao);
    let s = 0;
    if (nome === q) s += 100;
    if (nome.startsWith(q)) s += 40;
    if (nome.includes(q)) s += 30;
    if (cat.includes(q)) s += 15;
    for (const w of palavras) {
      if (nome.includes(w)) s += 10;
      else if (cat.includes(w)) s += 5;
      else if (desc.includes(w)) s += 3;
    }
    return s;
  };
  const achados = produtos
    .map((p) => ({ p, s: pontos(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || String(a.p.nome).localeCompare(String(b.p.nome)));
  return {
    busca,
    total: achados.length,
    itens: achados.slice(0, limite).map((x) => itemDoRobo(x.p, cats.get(x.p.categoriaId) ?? null)),
  };
}

/** Taxa de entrega por bairro: o bairro exato; senão os parecidos (até 5); sem bairro, a lista (até 60). */
export function taxaDoBairro(menu: any, bairro: string) {
  const bairros: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
  const modo = menu?.loja?.areaModo === 'raio' ? 'distancia' : 'bairro';
  const q = normalizar(bairro);
  if (!q) return { modo, encontrado: false, bairros: bairros.slice(0, 60).map((b) => ({ nome: b.nome, taxa: reais(b.taxa) })) };
  const exato = bairros.find((b) => normalizar(b.nome) === q);
  if (exato) return { modo, encontrado: true, bairro: exato.nome, taxa: reais(exato.taxa) };
  const parecidos = bairros
    .filter((b) => {
      const n = normalizar(b.nome);
      return n.includes(q) || q.includes(n);
    })
    .slice(0, 5)
    .map((b) => ({ nome: b.nome, taxa: reais(b.taxa) }));
  return { modo, encontrado: false, parecidos };
}
