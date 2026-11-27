/* eslint-disable @typescript-eslint/no-explicit-any */
import { linhaDoAtendente } from './dias-especiais';

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

const COMO_FUNCIONA_O_MAPA =
  'A loja entrega em áreas desenhadas no mapa, cada uma com a sua taxa. A taxa certa sai do endereço do cliente (o cardápio online calcula quando ele informa o endereço, ou a localização pelo WhatsApp); fora das áreas a loja não entrega.';

/** Modo mapa: as taxas que existem (do menor ao maior, sem repetir) e como funciona — sem os desenhos. */
function taxasDasAreas(areas: unknown) {
  const valores = [...new Set((Array.isArray(areas) ? areas : []).map((a: any) => Number(a?.taxa)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  return { taxas: valores.map((v) => (v === 0 ? 'grátis' : reais(v))), comoFunciona: COMO_FUNCIONA_O_MAPA };
}

const curto = (s: unknown, max: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** O que o robô precisa saber da loja AGORA: aberta, até quando, como atende, taxas, pagamento e o link. */
/** Coordenadas que servem para o mapa (as mesmas regras de `whatsapp/formato-da-resposta.ts` › `localizacaoDaLoja`). */
function temCoordenadas(lat: unknown, lng: unknown): boolean {
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0);
}

export function resumoDaLoja(menu: any, linkCardapio: string, agora: Date = new Date()) {
  const loja = menu?.loja ?? {};
  const tipos = menu?.tipos ?? {};
  const porTipo = menu?.abertoPorTipo ?? {};
  const porDistancia = loja.areaModo === 'raio';
  const porArea = loja.areaModo === 'mapa';
  return {
    nome: loja.nome ?? null,
    agora: agoraEmSaoPaulo(agora),
    abertaAgora: !!menu?.abertaAgora,
    horario: menu?.horarioLabel ?? null,
    proximaAbertura: menu?.proximaAbertura ?? null,
    horariosDaSemana: horariosDaSemana(menu?.horarios),
    // Os dias especiais dos próximos 30 dias (H1, mig 512): nestas datas vale este horário, não o da semana.
    diasEspeciais: (Array.isArray(menu?.diasEspeciais?.proximos) ? menu.diasEspeciais.proximos : []).map(linhaDoAtendente),
    // Fechada à mão OU com os pedidos pausados no painel do Delivery (mig 392).
    pausadaPelaLoja: loja.aberto === false || !!menu?.pausa,
    // A pausa dos pedidos (mig 392): o motivo e a volta, para o atendente explicar ao cliente — sem ela, null. `frase` vem
    // com o destaque do WhatsApp ("Estamos com *muitos pedidos agora*"); `volta` é "às 21:40" ou "amanhã às 00:30".
    // F3 (mig 394): `mensagem` é a mensagem pronta da loja (sem o nome do cliente) — o Regem já a mandou na 1ª mensagem do
    // cliente na pausa; o atendente lamenta com gentileza, diz o motivo e a volta, e não monta pedido até reabrir.
    pausa: menu?.pausa
      ? {
          motivo: menu.pausa.rotulo ?? null,
          frase: menu.pausa.frase ?? null,
          volta: menu.pausa.volta?.texto ?? null,
          ate: menu.pausa.ate ?? null,
          mensagem: menu.pausa.mensagem ? String(menu.pausa.mensagem).replace(/\*/g, '') : null,
          comoResponder:
            'Os pedidos estão pausados agora. Lamente com gentileza, diga o motivo e a hora em que voltamos, e convide o cliente a pedir quando reabrirmos. Não monte pedido até lá.',
        }
      : null,
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
    // D5: a loja tem as coordenadas no cadastro — o atendente pode mandar o alfinete do mapa (a linha `LOCAL: loja`).
    localizacaoNoMapa: temCoordenadas(loja.lojaLat, loja.lojaLng),
    // D4c: a loja aceita pedido agendado (mig 455) — fechada agora, o atendente oferece agendar para quando abrir; o Pix
    // na hora (G5) quando a loja tem o Pix online no cardápio.
    pedidoAgendado: loja.agendado?.ativo
      ? { aceita: true, janelaMin: Number(loja.agendado.janelaMin) || 15, pixNaHora: loja.agendado.pixObrigatorio === true }
      : null,
    contatos: { instagram: loja.instagram ?? null, site: loja.site ?? null },
    taxaPor: porDistancia ? 'distancia' : porArea ? 'mapa' : 'bairro',
    bairros: porArea ? [] : (Array.isArray(menu?.bairros) ? menu.bairros : []).map((b: any) => ({ nome: b.nome, taxa: reais(b.taxa) })),
    // Por distância não há bairro: o robô lê as faixas e explica que o cardápio calcula pelo endereço (no teste de
    // 29/10 ele dizia "não entregamos em Copacabana" sem saber disso).
    entregaPorDistancia: porDistancia ? { faixas: faixasDeEntrega(loja.raios), comoFunciona: COMO_FUNCIONA_A_DISTANCIA } : null,
    // Área DESENHADA no mapa (mig 425): também sem bairro — as taxas das áreas e como funciona (a taxa exata sai do endereço).
    entregaPorArea: porArea ? taxasDasAreas(menu?.areas) : null,
    linkCardapio,
    categorias: (Array.isArray(menu?.categorias) ? menu.categorias : []).map((c: any) => c.nome),
    robo: {
      saudacao: menu?.robo?.saudacao ?? null,
      // Durante a pausa a "mensagem de ausência" é a da pausa (F3): o atendente do n8n já usa a de ausência com a loja
      // fechada (regra 4 do prompt) — assim ele fala da pausa sem mudar o fluxo. Sem o destaque (ele escreve sem markdown).
      ausencia: menu?.pausa?.mensagem ? String(menu.pausa.mensagem).replace(/\*/g, '') : menu?.robo?.ausencia ?? null,
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
/**
 * "TEM PROMOÇÃO? TEM CUPOM?" (item 5 do plano das leituras do Mister para o atendente — o "pode" do dono, 27/11/2026): os
 * cupons que ESTE cliente pode usar agora, como ele entende ("10% de desconto, até R$ 15", "frete grátis") — da lista que o
 * Regem já filtrou (`cuponsDisponiveis`: sem os pessoais e os "só aniversariantes", com as condições do cliente) — e os
 * planos da fidelidade. O robô só lista quando o cliente PERGUNTA (instruções).
 */
export function promocoesParaOCliente(
  cupons: { codigo: string; tipo: string; valor: number; tetoDesconto?: number | null; minimo?: number | null }[],
  fidelidade: { ativa: boolean; planos: { nome: string; pontosMeta?: number | null; recompensa?: string | null }[] },
) {
  const desconto = (c: (typeof cupons)[number]) =>
    c.tipo === 'fretegratis'
      ? 'frete grátis'
      : c.tipo === 'percentual'
        ? `${Number(c.valor)}% de desconto${c.tetoDesconto ? ` (até ${reais(c.tetoDesconto)})` : ''}`
        : `${reais(c.valor)} de desconto`;
  const lista = cupons.slice(0, 10).map((c) => ({
    codigo: c.codigo,
    desconto: desconto(c),
    ...(c.minimo ? { pedidoMinimo: reais(c.minimo) } : {}),
  }));
  const planos = fidelidade.ativa
    ? fidelidade.planos.slice(0, 5).map((p) => ({ nome: p.nome, ...(p.pontosMeta ? { pontosMeta: p.pontosMeta } : {}), ...(p.recompensa ? { recompensa: p.recompensa } : {}) }))
    : [];
  return {
    cupons: lista,
    fidelidade: planos,
    comoResponder:
      lista.length || planos.length
        ? 'Liste o que veio, com o código de cada cupom e o pedido mínimo quando houver. O cupom se usa no fechamento do pedido (no cardápio ou aqui pela conversa). Não invente outro desconto.'
        : 'Não há promoção nem cupom para este cliente agora: diga isso com gentileza, sem prometer.',
  };
}

/** A localização que o cliente mandou pelo WhatsApp ("[localização] -22.9,-43.2" ou "-22.9,-43.2"), ou null. */
export function pontoDaLocalizacao(v: unknown): { lat: number; lng: number } | null {
  const m = String(v ?? '').match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/**
 * "ENTREGA NO MEU ENDEREÇO? QUANTO FICA?" FORA DO PEDIDO (item 4 do plano das leituras do Mister para o atendente — o "pode"
 * do dono, 27/11/2026). Na loja que cobra por DISTÂNCIA ou por ÁREA DESENHADA no mapa, o robô só tinha as faixas e mandava o
 * link; agora o endereço (rua e número) ou a localização que o cliente mandou passa pela MESMA conta do cardápio e do
 * `definir_entrega` (`CardapioService.taxaDeEntrega`), sem montar pedido. Nunca devolve coordenadas nem o desenho das áreas.
 */
export function taxaDoEndereco(
  menu: any,
  t: { taxaCheia: number; alemDaUltimaFaixa: boolean; semLocalizacao: boolean; km: number | null; area?: { tempoMin?: number | null; tempoMax?: number | null; pedidoMinimo?: number | null; freteGratisAcima?: number | null } | null },
) {
  const modo = menu?.loja?.areaModo === 'raio' ? 'distancia' : 'mapa';
  if (t.semLocalizacao)
    return {
      modo,
      encontrado: false,
      precisa: 'localizacao',
      comoResponder:
        'Não achei esse endereço no mapa: peça ao cliente a localização pelo WhatsApp (clipe → Localização) ou confira a rua e o número.',
    };
  if (t.alemDaUltimaFaixa) return { modo, encontrado: true, atende: false, mensagem: 'Infelizmente nosso delivery não cobre a região.' };
  const area = t.area ?? null;
  const tempo =
    area?.tempoMin != null
      ? area.tempoMax != null && area.tempoMax > area.tempoMin
        ? `${area.tempoMin} a ${area.tempoMax} min`
        : `${area.tempoMin} min`
      : null;
  return {
    modo,
    encontrado: true,
    atende: true,
    taxa: reais(t.taxaCheia),
    ...(t.km != null ? { distanciaKm: Math.round(t.km * 10) / 10 } : {}),
    ...(tempo ? { tempo } : {}),
    ...(area?.pedidoMinimo ? { pedidoMinimo: reais(area.pedidoMinimo) } : {}),
    freteGratisAcima: reais(area?.freteGratisAcima ?? menu?.loja?.freteGratisAcima),
  };
}

export function taxaDoBairro(menu: any, bairro: string) {
  const bairros: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
  const modo = menu?.loja?.areaModo === 'raio' ? 'distancia' : menu?.loja?.areaModo === 'mapa' ? 'mapa' : 'bairro';
  if (modo === 'distancia') {
    return { modo, encontrado: false, faixas: faixasDeEntrega(menu?.loja?.raios), comoFunciona: COMO_FUNCIONA_A_DISTANCIA };
  }
  if (modo === 'mapa') return { modo, encontrado: false, ...taxasDasAreas(menu?.areas) };
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
