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

/**
 * Sem acento, em minúsculas e sem pontuação, para casar "Hamburguer" com "hambúrguer" e "x-bacon" com "X bacon" (o
 * cliente escreve com hífen, o cardápio sem — no teste de 29/10 o robô não achava o X bacon e dava o preço do trio).
 */
export function normalizar(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** O dia da semana e a hora em São Paulo — o robô precisa saber o que é "hoje" e "amanhã". */
export function agoraEmSaoPaulo(agora: Date = new Date()): { diaDaSemana: string; hora: string } {
  const sp = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const p2 = (n: number) => String(n).padStart(2, '0');
  return { diaDaSemana: DIAS[sp.getDay()], hora: `${p2(sp.getHours())}:${p2(sp.getMinutes())}` };
}

/**
 * Os horários da semana, como o cardápio guarda (`dia` 0 = domingo). Janela que passa da meia-noite (fecha antes de
 * abrir) é do dia em que ABRE — `fechaNoDiaSeguinte` avisa o robô para não dizer "abre às 03:00".
 */
export function horariosDaSemana(horarios: unknown): { dia: string; abre: string; fecha: string; fechaNoDiaSeguinte: boolean }[] {
  const hs: any[] = Array.isArray(horarios) ? horarios : [];
  return hs
    .filter((h) => h && h.ativo && h.abre && h.fecha && DIAS[Number(h.dia)])
    .sort((a, b) => Number(a.dia) - Number(b.dia) || String(a.abre).localeCompare(String(b.abre)))
    .map((h) => ({ dia: DIAS[Number(h.dia)], abre: String(h.abre), fecha: String(h.fecha), fechaNoDiaSeguinte: String(h.fecha) <= String(h.abre) }));
}

/** Entrega por distância: as faixas (até X km → taxa), da menor para a maior; taxa zero vira "grátis". */
export function faixasDeEntrega(raios: unknown): { ateKm: number; taxa: string | null }[] {
  const rs: any[] = Array.isArray(raios) ? raios : [];
  return rs
    .filter((r) => r && Number.isFinite(Number(r.ateKm)))
    .sort((a, b) => Number(a.ateKm) - Number(b.ateKm))
    .map((r) => ({ ateKm: Number(r.ateKm), taxa: Number(r.taxa) === 0 ? 'grátis' : reais(r.taxa) }));
}

const COMO_FUNCIONA_A_DISTANCIA =
  'A taxa é pela distância da loja até o endereço do cliente. O cardápio online calcula a taxa certa quando o cliente informa o endereço; fora da última faixa a loja não entrega.';

const curto = (s: unknown, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** O que o robô precisa saber da loja AGORA: aberta, até quando, como atende, taxas, pagamento e o link. */
export function resumoDaLoja(menu: any, linkCardapio: string, agora: Date = new Date()) {
  const loja = menu?.loja ?? {};
  const tipos = menu?.tipos ?? {};
  const porTipo = menu?.abertoPorTipo ?? {};
  const porDistancia = loja.areaModo === 'raio';
  return {
    nome: loja.nome ?? null,
    agora: agoraEmSaoPaulo(agora),
    abertaAgora: !!menu?.abertaAgora,
    horario: menu?.horarioLabel ?? null,
    proximaAbertura: menu?.proximaAbertura ?? null,
    horariosDaSemana: horariosDaSemana(menu?.horarios),
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
    taxaPor: porDistancia ? 'distancia' : 'bairro',
    bairros: (Array.isArray(menu?.bairros) ? menu.bairros : []).map((b: any) => ({ nome: b.nome, taxa: reais(b.taxa) })),
    // Por distância não há bairro: o robô lê as faixas e explica que o cardápio calcula pelo endereço (no teste de
    // 29/10 ele dizia "não entregamos em Copacabana" sem saber disso).
    entregaPorDistancia: porDistancia ? { faixas: faixasDeEntrega(loja.raios), comoFunciona: COMO_FUNCIONA_A_DISTANCIA } : null,
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

/**
 * Taxa de entrega por bairro: o bairro exato; senão os parecidos (até 5); sem bairro, a lista (até 60). Loja que entrega
 * por DISTÂNCIA não tem bairro: devolve as faixas e como funciona (o cardápio calcula pelo endereço).
 */
export function taxaDoBairro(menu: any, bairro: string) {
  const bairros: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
  const modo = menu?.loja?.areaModo === 'raio' ? 'distancia' : 'bairro';
  if (modo === 'distancia') {
    return { modo, encontrado: false, faixas: faixasDeEntrega(menu?.loja?.raios), comoFunciona: COMO_FUNCIONA_A_DISTANCIA };
  }
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
