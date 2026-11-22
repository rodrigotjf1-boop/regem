// AS REGRAS DE CADA PESSOA (versão 6, M6e; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão 6" §4;
// protótipo `mockups/regem-mister-v6.html`, aba "Regras"). Regras PURAS: o catálogo das fontes, a conferência da regra
// que a IA escreve, a descrição em português (o código escreve — a IA não descreve o que o código vai fazer) e a avaliação.
//
// O reforço do dono (20/11): "as instruções são dinâmicas e, com base nos dados que o Mister tem acesso, ele monta a regra
// de acordo com a instrução do presidente". Não há lista de regras: há a lista do que o Mister LÊ (as fontes, com os
// campos) e uma linguagem em seis partes — fonte, filtro, medida, condição, quando olhar e como avisar. A IA traduz a frase
// para essa linguagem; o código confere cada parte (a fonte existe, a pessoa tem a permissão, o campo existe e tem o tipo
// certo, os números estão nos limites) e avalia sozinho. A IA nunca escreve código e nunca decide o que é avisado.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type TipoDoCampo = 'numero' | 'texto' | 'sim_nao' | 'dia';
export type Operador = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contem' | 'em';

export interface CampoDaFonte {
  nome: string;
  tipo: TipoDoCampo;
  /** Como o campo aparece na descrição ("minutos desde o aceite"). */
  rotulo: string;
  /** Os valores possíveis (texto): a regra só aceita estes. */
  valores?: readonly string[];
  /** Valor em reais: só para quem vê valores. */
  dinheiro?: boolean;
  /** A unidade que vai depois do número na lista do aviso ("min", "h", "dias"). */
  unidade?: string;
}

export type NomeDaFonte = 'pedidos' | 'contas' | 'tarefas' | 'equipamentos' | 'caixas' | 'canais' | 'vendas';

export interface FonteDaRegra {
  nome: NomeDaFonte;
  /** "pedidos dos canais" — na descrição e na lista para a IA. */
  rotulo: string;
  /** O que cada linha é, para a IA ("um pedido do iFood, da 99, do cardápio…"). */
  descricao: string;
  /** A permissão do perfil que a fonte pede (a mesma das telas); null = presidente e gerente leem. */
  permissao: string | null;
  campos: readonly CampoDaFonte[];
  /** A fonte tem itens que se escolhem por nome (uma conta, uma tarefa): o "alvo" da regra. */
  temAlvo?: boolean;
}

const SITUACOES_DO_PEDIDO = ['aguardando_aceite', 'em_preparo', 'pronto', 'a_caminho', 'entregue', 'cancelado'] as const;
const SITUACOES_DA_TAREFA = ['pendente', 'em_execucao', 'feita', 'parcial', 'nao_feita', 'impossibilitada'] as const;

/**
 * As fontes da versão 1 — o que o Mister lê e a regra pode usar. Fonte nova entra AQUI (com a leitura no serviço) e passa
 * a valer para as regras sem mudar o motor. A ordem é a da lista que a IA recebe.
 */
export const FONTES_DA_REGRA: readonly FonteDaRegra[] = [
  {
    nome: 'pedidos',
    rotulo: 'pedidos dos canais',
    descricao: 'Cada pedido do cardápio digital, do iFood, da 99 e dos outros canais, das últimas 12 horas.',
    permissao: 'delivery',
    campos: [
      { nome: 'numero', tipo: 'numero', rotulo: 'número do pedido' },
      { nome: 'canal', tipo: 'texto', rotulo: 'canal', valores: ['cardapio', 'ifood', '99', 'whatsapp', 'outro'] },
      { nome: 'situacao', tipo: 'texto', rotulo: 'situação', valores: SITUACOES_DO_PEDIDO },
      { nome: 'tipo', tipo: 'texto', rotulo: 'tipo', valores: ['entrega', 'retirada', 'outro'] },
      { nome: 'min_desde_chegada', tipo: 'numero', rotulo: 'minutos desde a chegada', unidade: 'min' },
      { nome: 'min_desde_aceite', tipo: 'numero', rotulo: 'minutos desde o aceite', unidade: 'min' },
      { nome: 'min_aceite_ate_pronto', tipo: 'numero', rotulo: 'minutos do aceite até ficar pronto', unidade: 'min' },
      { nome: 'min_aceite_ate_saida', tipo: 'numero', rotulo: 'minutos do aceite até sair para entrega', unidade: 'min' },
      { nome: 'agendado', tipo: 'sim_nao', rotulo: 'agendado' },
      { nome: 'valor', tipo: 'numero', rotulo: 'valor do pedido', dinheiro: true },
    ],
  },
  {
    nome: 'contas',
    rotulo: 'contas a pagar',
    descricao: 'Cada conta a pagar em aberto (boletos, fornecedores, contas de consumo), dos últimos 30 dias aos próximos 60.',
    permissao: 'financeiro',
    temAlvo: true,
    campos: [
      { nome: 'descricao', tipo: 'texto', rotulo: 'descrição' },
      { nome: 'fornecedor', tipo: 'texto', rotulo: 'fornecedor' },
      { nome: 'valor', tipo: 'numero', rotulo: 'valor', dinheiro: true },
      { nome: 'vencimento', tipo: 'dia', rotulo: 'vencimento' },
      { nome: 'dias_para_vencer', tipo: 'numero', rotulo: 'dias para vencer', unidade: 'dias' },
    ],
  },
  {
    nome: 'tarefas',
    rotulo: 'tarefas de hoje',
    descricao: 'Cada tarefa do dia na loja (as que existem hoje), com o horário e a situação.',
    permissao: null,
    temAlvo: true,
    campos: [
      { nome: 'titulo', tipo: 'texto', rotulo: 'tarefa' },
      { nome: 'situacao', tipo: 'texto', rotulo: 'situação', valores: SITUACOES_DA_TAREFA },
      { nome: 'min_apos_o_fim', tipo: 'numero', rotulo: 'minutos depois do horário de fim', unidade: 'min' },
      { nome: 'quem', tipo: 'texto', rotulo: 'quem faz' },
    ],
  },
  {
    nome: 'equipamentos',
    rotulo: 'impressoras e servidor da loja',
    descricao: 'Cada impressora ou servidor da loja PARADO agora, com há quanto tempo e se está dentro do horário da loja.',
    permissao: null,
    campos: [
      { nome: 'tipo', tipo: 'texto', rotulo: 'equipamento', valores: ['impressora', 'servidor'] },
      { nome: 'nome', tipo: 'texto', rotulo: 'nome' },
      { nome: 'parado_ha_min', tipo: 'numero', rotulo: 'minutos parado', unidade: 'min' },
      { nome: 'no_expediente', tipo: 'sim_nao', rotulo: 'dentro do horário da loja' },
    ],
  },
  {
    nome: 'caixas',
    rotulo: 'caixas abertos',
    descricao: 'Cada caixa aberto agora, com há quantas horas.',
    permissao: null,
    campos: [{ nome: 'aberto_ha_horas', tipo: 'numero', rotulo: 'horas aberto', unidade: 'h' }],
  },
  {
    nome: 'canais',
    rotulo: 'canais pausados',
    descricao: 'Cada canal de venda PAUSADO agora (cardápio digital, iFood, 99), com há quanto tempo e quanto falta para reabrir.',
    permissao: 'delivery',
    campos: [
      { nome: 'canal', tipo: 'texto', rotulo: 'canal', valores: ['cardapio', 'ifood', '99'] },
      { nome: 'pausado_ha_min', tipo: 'numero', rotulo: 'minutos pausado', unidade: 'min' },
      { nome: 'min_para_reabrir', tipo: 'numero', rotulo: 'minutos para reabrir', unidade: 'min' },
    ],
  },
  {
    nome: 'vendas',
    rotulo: 'vendas de hoje',
    descricao: 'Uma linha com as vendas de hoje até agora (as mesmas do Painel), da loja ou de todas as lojas.',
    permissao: 'dashboard',
    campos: [
      { nome: 'faturamento', tipo: 'numero', rotulo: 'faturamento de hoje', dinheiro: true },
      { nome: 'vendas', tipo: 'numero', rotulo: 'número de vendas de hoje' },
      { nome: 'ticket_medio', tipo: 'numero', rotulo: 'ticket médio de hoje', dinheiro: true },
      { nome: 'faturamento_delivery', tipo: 'numero', rotulo: 'faturamento do delivery hoje', dinheiro: true },
      { nome: 'faturamento_balcao', tipo: 'numero', rotulo: 'faturamento do balcão hoje', dinheiro: true },
    ],
  },
];

export const fonteDaRegra = (nome: unknown): FonteDaRegra | undefined => FONTES_DA_REGRA.find((f) => f.nome === nome);

// ───────────────────────────── a regra ─────────────────────────────

export interface Filtro {
  campo: string;
  op: Operador;
  valor: string | number | boolean | string[];
}

export type Medida = 'cada_item' | 'quantidade' | 'soma' | 'maior' | 'menor';

export interface Quando {
  /** Os dias da semana (0 = domingo … 6 = sábado). Ausente = todos. */
  dias?: number[];
  /** A janela do dia (HH:MM, no relógio da loja). Ausente = o dia todo. */
  de?: string;
  ate?: string;
  /** Olhar UMA vez por dia, nesta hora (HH:MM): "às 20h, se…", "uma hora antes do vencimento às 17h" → 16:00. */
  em?: string;
  /** Só neste dia (AAAA-MM-DD): o lembrete de uma conta. */
  data?: string;
  /** Só dentro do horário de atendimento da loja. */
  soNoExpediente?: boolean;
}

export interface Regra {
  fonte: NomeDaFonte;
  /** Um nome curto, para a lista e o título do aviso ("3 pedidos parados há mais de 20 min"). */
  titulo: string;
  /** Todos precisam casar. */
  filtros: Filtro[];
  /** Pelo menos um precisa casar (ausente = nenhuma exigência). */
  algum?: Filtro[];
  /** Um item só (a conta, a tarefa): o id que a busca devolveu. */
  alvo?: { id: string; rotulo: string } | null;
  medida: Medida;
  /** O campo da soma, do maior ou do menor. */
  campoDaMedida?: string;
  /** Sobre a medida (quantidade ≥ 3; soma < 2000). `cada_item` não tem. */
  condicao?: { op: '>' | '>=' | '<' | '<=' | '='; valor: number } | null;
  quando: Quando;
  /** "sempre" ou "uma_vez" (o lembrete): depois do primeiro aviso, a regra se encerra. */
  vezes: 'sempre' | 'uma_vez';
  /** Uma mensagem com a lista (true) ou uma por item (false). */
  agrupar: boolean;
  /** Na medida com condição: o mínimo entre dois avisos enquanto a condição continua (minutos). */
  intervaloMin?: number;
  /** Os avisos da empresa que a pessoa deixa de receber pelo WhatsApp enquanto a regra existir. */
  substitui?: string[];
}

export const LIMITES_DA_REGRA = {
  porPessoa: 30, // decisão V6-7
  filtros: 6,
  algum: 4,
  titulo: 80,
  valorTexto: 80,
  itensNaLista: 10,
  intervaloMinimoMin: 5,
  intervaloMaximoMin: 24 * 60,
  intervaloPadraoMin: 30,
  /** A proposta que a pessoa não confirmou some. */
  propostaValeMin: 30,
  /** O "olhar uma vez às HH:MM" ainda vale até esta folga depois da hora (a volta pode atrasar). */
  folgaDoEmMin: 60,
} as const;

/** Os avisos da empresa que NÃO se calam por regra pessoal (decisão V6-6): agrupar sim, calar não. */
export const AVISOS_QUE_NAO_SE_CALAM = ['servidor_sem_sinal', 'certificado', 'chave_ia'] as const;

/**
 * As etapas do aviso "pedido parado": `pedido_parado:confirmado` cala só o aviso daquela etapa e `pedido_parado` cala as
 * três. A regra de "em preparo" não pode calar o "sem aceite" nem o "pronto sem sair".
 */
const ETAPA_DA_SITUACAO: Record<string, string> = { aguardando_aceite: 'novo', em_preparo: 'confirmado', pronto: 'pronto' };
const NOME_DA_ETAPA: Record<string, string> = { novo: 'sem aceite', confirmado: 'em preparo', pronto: 'pronto sem sair' };

/** O aviso substituído em português: `pedido_parado:confirmado` → "pedido parado (em preparo)". */
export function nomeDoAvisoSubstituido(t: string): string {
  const [base, etapa] = String(t).split(':');
  const nome = base.replace(/_/g, ' ');
  return etapa ? `${nome} (${NOME_DA_ETAPA[etapa] ?? etapa})` : nome;
}

/** O que deixa de chegar com a regra ligada: a pessoa precisa ler isto antes do Confirmar. */
export function fraseDoQueDeixaDeChegar(substitui?: string[]): string | null {
  if (!substitui?.length) return null;
  const nomes = substitui.map((t) => `"${nomeDoAvisoSubstituido(t)}"`);
  return `${nomes.length > 1 ? `Os avisos ${lista(nomes)} deixam` : `O aviso ${nomes[0]} deixa`} de chegar no seu WhatsApp enquanto a regra estiver ligada.`;
}

/**
 * A IA pode resumir a proposta e deixar de fora que um aviso vai parar de chegar (a c59 da avaliação, 22/11). O código
 * garante a frase: se a resposta não fala disso, ela entra no fim.
 */
export function comOQueDeixaDeChegar(texto: string, resultados: unknown[]): string {
  if (/deixam? de chegar/i.test(texto)) return texto;
  const frases = [...new Set(resultados.map((d: any) => d?.dizerAntesDoConfirmar).filter((f): f is string => typeof f === 'string' && !!f))];
  return frases.length ? `${texto}\n\n${frases.join(' ')}` : texto;
}

/**
 * A regra que JUNTA pedidos parados ("só me avise quando acumular 3 em preparo há 20 min") fica no lugar do aviso um a um
 * da mesma etapa: juntar e continuar recebendo cada um não faz sentido. Vale só com a situação e o tempo nos filtros (uma
 * regra de volume, "mais de 10 em preparo", não fala de pedido parado). `substitui: []` na regra mantém os dois.
 */
function substituiPorPadrao(r: Pick<Regra, 'fonte' | 'medida' | 'agrupar' | 'filtros' | 'condicao'>): string[] {
  if (r.fonte !== 'pedidos' || r.medida !== 'quantidade' || !r.agrupar) return [];
  if (r.condicao?.op !== '>=' && r.condicao?.op !== '>') return [];
  const temTempo = r.filtros.some((f) => ['min_desde_aceite', 'min_desde_chegada'].includes(f.campo) && (f.op === '>' || f.op === '>='));
  const situacao = r.filtros.find((f) => f.campo === 'situacao' && (f.op === '=' || f.op === 'em'));
  if (!temTempo || !situacao) return [];
  const etapas = (Array.isArray(situacao.valor) ? situacao.valor : [situacao.valor]).map((v) => ETAPA_DA_SITUACAO[String(v)]);
  if (!etapas.length || etapas.some((e) => !e)) return [];
  return new Set(etapas).size === 3 ? ['pedido_parado'] : [...new Set(etapas)].map((e) => `pedido_parado:${e}`);
}

/**
 * O que a regra OLHA, sem o título, sem os avisos que ela substitui e sem o intervalo: duas regras com a mesma chave são a
 * mesma regra. Pedir a mesma com outro intervalo é mudar a que existe, não criar outra.
 */
export function chaveDaRegra(r: Regra): string {
  const filtros = (l?: Filtro[]) =>
    [...(l ?? [])]
      .map((f) => ({ campo: f.campo, op: f.op, valor: Array.isArray(f.valor) ? [...f.valor].map(String).sort() : f.valor }))
      .sort((a, b) => `${a.campo}|${a.op}`.localeCompare(`${b.campo}|${b.op}`));
  const q = r.quando ?? {};
  return JSON.stringify({
    fonte: r.fonte,
    filtros: filtros(r.filtros),
    algum: filtros(r.algum),
    alvo: r.alvo?.id ?? null,
    medida: r.medida,
    campo: r.campoDaMedida ?? null,
    condicao: r.condicao ?? null,
    quando: [q.dias ?? null, q.de ?? null, q.ate ?? null, q.em ?? null, q.data ?? null, q.soNoExpediente === true],
    vezes: r.vezes,
    agrupar: r.agrupar,
  });
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const OPS_DO_TIPO: Record<TipoDoCampo, readonly Operador[]> = {
  numero: ['=', '!=', '>', '>=', '<', '<='],
  texto: ['=', '!=', 'contem', 'em'],
  sim_nao: ['='],
  dia: ['=', '!=', '>', '>=', '<', '<='],
};

export interface QuemFazARegra {
  presidente: boolean;
  /** As permissões do perfil (as mesmas das telas); o presidente pode tudo. */
  pode: (permissao: string) => boolean;
  verValores: boolean;
}

/** Os tipos de aviso da empresa que a regra pode substituir (os configuráveis da loja, menos os que não se calam). */
export type ConferirSubstitui = (tipo: string) => boolean;

/**
 * Confere a regra que a IA escreveu. Devolve a regra limpa (só os campos conhecidos, os textos aparados) ou o erro em
 * português — que volta à IA para ela perguntar à pessoa ou explicar o que não dá.
 */
export function conferirRegra(bruta: unknown, quem: QuemFazARegra, substituivel: ConferirSubstitui): { regra: Regra } | { erro: string } {
  const r = (bruta && typeof bruta === 'object' && !Array.isArray(bruta) ? bruta : {}) as Record<string, any>;
  const fonte = fonteDaRegra(r.fonte);
  if (!fonte) return { erro: `Essa fonte não existe. As fontes são: ${FONTES_DA_REGRA.map((f) => f.nome).join(', ')}.` };
  if (fonte.permissao && !quem.presidente && !quem.pode(fonte.permissao)) {
    return { erro: `O perfil desta pessoa no Regem não dá acesso a ${fonte.rotulo}. Quem muda o perfil é o presidente.` };
  }
  const titulo = String(r.titulo ?? '').replace(/\s+/g, ' ').trim();
  if (!titulo) return { erro: 'Dê um nome curto à regra (o título).' };
  if (titulo.length > LIMITES_DA_REGRA.titulo) return { erro: `O título passa de ${LIMITES_DA_REGRA.titulo} letras.` };

  const lerFiltros = (lista: unknown, max: number, nome: string): Filtro[] | { erro: string } => {
    if (lista === undefined || lista === null) return [];
    if (!Array.isArray(lista)) return { erro: `${nome} tem de ser uma lista.` };
    if (lista.length > max) return { erro: `No máximo ${max} itens em ${nome}.` };
    const fora: Filtro[] = [];
    for (const f of lista) {
      const lido = conferirFiltro(f, fonte, quem);
      if ('erro' in lido) return lido;
      fora.push(lido.filtro);
    }
    return fora;
  };
  const filtros = lerFiltros(r.filtros, LIMITES_DA_REGRA.filtros, 'os filtros');
  if ('erro' in filtros) return filtros;
  const algum = lerFiltros(r.algum, LIMITES_DA_REGRA.algum, '"algum"');
  if ('erro' in algum) return algum;

  let alvo: Regra['alvo'] = null;
  if (r.alvo !== undefined && r.alvo !== null) {
    if (!fonte.temAlvo) return { erro: `Em ${fonte.rotulo} não se escolhe um item: use os filtros.` };
    const id = String(r.alvo?.id ?? '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { erro: 'O item escolhido não veio com o id da busca. Busque o item antes.' };
    alvo = { id: id.toLowerCase(), rotulo: String(r.alvo?.rotulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) };
  }

  const medidas: Medida[] = ['cada_item', 'quantidade', 'soma', 'maior', 'menor'];
  if (!medidas.includes(r.medida)) return { erro: `A medida é uma destas: ${medidas.join(', ')}.` };
  const medida = r.medida as Medida;
  let campoDaMedida: string | undefined;
  if (medida === 'soma' || medida === 'maior' || medida === 'menor') {
    const c = fonte.campos.find((x) => x.nome === r.campoDaMedida);
    if (!c || c.tipo !== 'numero') return { erro: `Diga de qual campo numérico é ${medida === 'soma' ? 'a soma' : `o ${medida}`}.` };
    if (c.dinheiro && !quem.verValores) return { erro: 'O perfil desta pessoa não mostra valores em reais.' };
    campoDaMedida = c.nome;
  }
  let condicao: Regra['condicao'] = null;
  if (medida !== 'cada_item') {
    const op = r.condicao?.op;
    const valor = Number(r.condicao?.valor);
    if (!['>', '>=', '<', '<=', '='].includes(op) || !Number.isFinite(valor)) return { erro: 'Diga quando dispara: a comparação e o número (ex.: quantidade ≥ 3).' };
    condicao = { op, valor };
  }

  const q = (r.quando && typeof r.quando === 'object' ? r.quando : {}) as Record<string, any>;
  const quando: Quando = {};
  if (q.dias !== undefined && q.dias !== null) {
    if (!Array.isArray(q.dias) || !q.dias.length || q.dias.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6)) return { erro: 'Os dias da semana vão de 0 (domingo) a 6 (sábado).' };
    quando.dias = [...new Set<number>(q.dias)].sort();
  }
  for (const k of ['de', 'ate', 'em'] as const) {
    if (q[k] === undefined || q[k] === null || q[k] === '') continue;
    if (!HHMM.test(String(q[k]))) return { erro: `O horário "${k}" vai como HH:MM (24 horas).` };
    quando[k] = String(q[k]);
  }
  if ((quando.de && !quando.ate) || (!quando.de && quando.ate)) return { erro: 'A janela do dia precisa do começo e do fim (de e até).' };
  if (q.data !== undefined && q.data !== null && q.data !== '') {
    if (!DIA.test(String(q.data))) return { erro: 'O dia vai como AAAA-MM-DD.' };
    quando.data = String(q.data);
  }
  if (q.soNoExpediente === true) quando.soNoExpediente = true;

  const vezes = r.vezes === 'uma_vez' ? 'uma_vez' : 'sempre';
  if (vezes === 'uma_vez' && !quando.em) return { erro: 'Uma regra de uma vez só precisa da hora de olhar ("em", HH:MM).' };
  const agrupar = r.agrupar !== false;
  let intervaloMin: number | undefined;
  if (r.intervaloMin !== undefined && r.intervaloMin !== null) {
    const n = Number(r.intervaloMin);
    if (!Number.isInteger(n) || n < LIMITES_DA_REGRA.intervaloMinimoMin || n > LIMITES_DA_REGRA.intervaloMaximoMin) {
      return { erro: `O intervalo entre avisos vai de ${LIMITES_DA_REGRA.intervaloMinimoMin} a ${LIMITES_DA_REGRA.intervaloMaximoMin} minutos.` };
    }
    intervaloMin = n;
  }
  let substitui: string[] | undefined;
  if (r.substitui !== undefined && r.substitui !== null) {
    if (!Array.isArray(r.substitui)) return { erro: '"substitui" tem de ser uma lista de avisos.' };
    for (const t of r.substitui) {
      const [base, etapa, ...resto] = String(t).split(':');
      if ((AVISOS_QUE_NAO_SE_CALAM as readonly string[]).includes(base)) return { erro: 'Esse aviso da empresa é crítico: dá para juntar, mas não para deixar de receber.' };
      const etapaVale = etapa === undefined || (base === 'pedido_parado' && etapa in NOME_DA_ETAPA);
      if (!substituivel(base) || !etapaVale || resto.length) return { erro: `"${t}" não é um aviso da empresa que a regra possa substituir.` };
    }
    substitui = [...new Set<string>(r.substitui.map(String))];
  } else if (substituivel('pedido_parado')) {
    const padrao = substituiPorPadrao({ fonte: fonte.nome, medida, agrupar, filtros, condicao });
    if (padrao.length) substitui = padrao;
  }
  if (!filtros.length && !algum.length && !alvo && medida === 'cada_item' && fonte.nome !== 'vendas') {
    return { erro: 'Uma regra sem filtro avisaria de tudo. Diga o que conta (ex.: mais de 20 minutos).' };
  }
  return {
    regra: {
      fonte: fonte.nome,
      titulo,
      filtros,
      ...(algum.length ? { algum } : {}),
      ...(alvo ? { alvo } : {}),
      medida,
      ...(campoDaMedida ? { campoDaMedida } : {}),
      condicao,
      quando,
      vezes,
      agrupar,
      ...(intervaloMin ? { intervaloMin } : {}),
      ...(substitui?.length ? { substitui } : {}),
    },
  };
}

function conferirFiltro(bruto: unknown, fonte: FonteDaRegra, quem: QuemFazARegra): { filtro: Filtro } | { erro: string } {
  const f = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, any>;
  const campo = fonte.campos.find((c) => c.nome === f.campo);
  if (!campo) return { erro: `${fonte.rotulo} não tem o campo "${f.campo}". Os campos são: ${fonte.campos.map((c) => c.nome).join(', ')}.` };
  if (campo.dinheiro && !quem.verValores) return { erro: 'O perfil desta pessoa não mostra valores em reais.' };
  const op = f.op as Operador;
  if (!OPS_DO_TIPO[campo.tipo].includes(op)) return { erro: `O campo "${campo.nome}" aceita: ${OPS_DO_TIPO[campo.tipo].join(' ')}.` };
  const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITES_DA_REGRA.valorTexto);
  let valor: Filtro['valor'];
  if (campo.tipo === 'numero') {
    const n = Number(f.valor);
    if (!Number.isFinite(n)) return { erro: `O valor de "${campo.nome}" é um número.` };
    valor = n;
  } else if (campo.tipo === 'sim_nao') {
    if (typeof f.valor !== 'boolean') return { erro: `O valor de "${campo.nome}" é sim (true) ou não (false).` };
    valor = f.valor;
  } else if (campo.tipo === 'dia') {
    if (!DIA.test(String(f.valor))) return { erro: `O valor de "${campo.nome}" é um dia AAAA-MM-DD.` };
    valor = String(f.valor);
  } else if (op === 'em') {
    if (!Array.isArray(f.valor) || !f.valor.length) return { erro: `"em" pede uma lista de valores para "${campo.nome}".` };
    valor = [...new Set<string>(f.valor.map(texto))].filter(Boolean);
  } else {
    valor = texto(f.valor);
    if (!valor) return { erro: `Diga o valor de "${campo.nome}".` };
  }
  if (campo.valores && op !== 'contem') {
    const lista = Array.isArray(valor) ? valor : [valor];
    const fora = lista.filter((v) => !campo.valores!.includes(String(v)));
    if (fora.length) return { erro: `"${campo.nome}" aceita: ${campo.valores.join(', ')}.` };
  }
  return { filtro: { campo: campo.nome, op, valor } };
}

// ───────────────────────────── a descrição (o código escreve) ─────────────────────────────

const NOME_DO_VALOR: Record<string, string> = {
  aguardando_aceite: 'aguardando aceite',
  em_preparo: 'em preparo',
  a_caminho: 'a caminho',
  em_execucao: 'em execução',
  nao_feita: 'não feita',
  cardapio: 'cardápio digital',
  ifood: 'iFood',
  '99': '99',
};
const OP_EM_PALAVRAS: Record<Operador, string> = {
  '=': 'é',
  '!=': 'não é',
  '>': 'acima de',
  '>=': 'a partir de',
  '<': 'abaixo de',
  '<=': 'até',
  contem: 'contém',
  em: 'é um de',
};
const DIAS_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const dinheiro = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const valorEmPalavras = (campo: CampoDaFonte | undefined, v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => valorEmPalavras(campo, x)).join(', ');
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v === 'number') return campo?.dinheiro ? dinheiro(v) : `${v.toLocaleString('pt-BR')}${campo?.unidade ? ` ${campo.unidade}` : ''}`;
  if (campo?.tipo === 'dia' && DIA.test(String(v))) return String(v).split('-').reverse().join('/');
  return NOME_DO_VALOR[String(v)] ?? String(v);
};
const filtroEmPalavras = (f: Filtro, fonte: FonteDaRegra): string => {
  const c = fonte.campos.find((x) => x.nome === f.campo);
  return `${c?.rotulo ?? f.campo} ${OP_EM_PALAVRAS[f.op]} ${valorEmPalavras(c, f.valor)}`;
};
const lista = (partes: string[], e = 'e') => (partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} ${e} ${partes[partes.length - 1]}`);

/** O que a regra faz, em português — o Mister repete isto antes do "Confirmar" (o código escreve, nunca a IA). */
export function descreverRegra(r: Regra): string {
  const fonte = fonteDaRegra(r.fonte)!;
  const partes: string[] = [];
  const oQue = r.alvo ? `${fonte.rotulo}: ${r.alvo.rotulo || 'o item escolhido'}` : fonte.rotulo;
  const filtros = r.filtros.map((f) => filtroEmPalavras(f, fonte));
  const algum = (r.algum ?? []).map((f) => filtroEmPalavras(f, fonte));
  let quais = filtros.length ? ` com ${lista(filtros)}` : '';
  if (algum.length) quais += `${quais ? ' e' : ' com'} ${lista(algum, 'ou')}`;
  if (r.medida === 'cada_item') {
    partes.push(`Vou te avisar de ${oQue}${quais}.`);
  } else {
    const c = r.condicao!;
    const comparar = `${OP_EM_PALAVRAS[c.op === '=' ? '=' : c.op]} ${c.valor.toLocaleString('pt-BR')}`;
    const campo = fonte.campos.find((x) => x.nome === r.campoDaMedida);
    const medida =
      r.medida === 'quantidade'
        ? `a quantidade de ${oQue}${quais} for ${comparar.replace(/^é /, '')}`
        : `${r.medida === 'soma' ? 'a soma' : r.medida === 'maior' ? 'o maior valor' : 'o menor valor'} de ${campo?.rotulo ?? r.campoDaMedida} em ${oQue}${quais} for ${
            campo?.dinheiro ? `${OP_EM_PALAVRAS[c.op]} ${dinheiro(c.valor)}` : comparar
          }`;
    partes.push(`Vou te avisar quando ${medida}.`);
  }
  const q = r.quando;
  const quando: string[] = [];
  if (q.data) quando.push(`só no dia ${q.data.split('-').reverse().join('/')}`);
  if (q.dias?.length && q.dias.length < 7) quando.push(`${lista(q.dias.map((d) => DIAS_DA_SEMANA[d]))}`);
  if (q.em) quando.push(`olhando às ${q.em}`);
  if (q.de && q.ate) quando.push(`das ${q.de} às ${q.ate}`);
  if (q.soNoExpediente) quando.push('só no horário da loja');
  if (quando.length) partes.push(`Quando: ${quando.join(', ')}.`);
  if (r.medida === 'cada_item') partes.push(r.agrupar ? 'Os que aparecerem juntos vão numa mensagem só; cada um é avisado uma vez.' : 'Uma mensagem por item; cada um é avisado uma vez.');
  else partes.push(`Numa mensagem só, com a lista; enquanto continuar, de novo só depois de ${r.intervaloMin ?? LIMITES_DA_REGRA.intervaloPadraoMin} min e se a lista mudar.`);
  if (r.vezes === 'uma_vez') partes.push('Avisa uma vez e a regra se encerra.');
  const deixaDeChegar = fraseDoQueDeixaDeChegar(r.substitui);
  if (deixaDeChegar) partes.push(deixaDeChegar);
  return partes.join(' ');
}

// ───────────────────────────── a avaliação ─────────────────────────────

/** Uma linha de uma fonte: o item, o nome dele na lista e os campos. */
export interface LinhaDaFonte {
  /** O item (o pedido, a conta, a instância da tarefa): a chave de "já avisei". */
  id: string;
  /** O item escolhível (a conta; a tarefa — a definição, não a instância do dia). */
  alvoId: string;
  /** "#284 · iFood 4821", "Boleto · Distribuidora Sul", "Limpar a chapa". */
  rotulo: string;
  unidadeId: string | null;
  campos: Record<string, unknown>;
}

/** O que a regra lembra entre uma volta e outra (na linha da regra, `estado`). */
export interface EstadoDaRegra {
  /** Os itens já avisados (cada_item), com o instante — saem depois de 2 dias. */
  avisados?: Record<string, string>;
  /** Na medida com condição: estava valendo na volta anterior? */
  valendo?: boolean;
  /** Os itens do último aviso da condição (para só repetir se a lista mudar). */
  ultimos?: string[];
  ultimoEnvio?: string | null;
  /** O dia (AAAA-MM-DD) em que o "em HH:MM" já olhou. */
  olhouEm?: string | null;
}

export interface Agora {
  /** O instante (para os prazos). */
  instante: Date;
  /** O dia na loja (AAAA-MM-DD) e o dia da semana (0 = domingo). */
  dia: string;
  diaDaSemana: number;
  /** HH:MM na loja. */
  hora: string;
}

export interface Disparo {
  itens: LinhaDaFonte[];
  /** A medida (quantidade, soma…) quando a regra tem condição. */
  valor: number | null;
  /** A chave do envio (idempotente): a regra + o que foi avisado. */
  chave: string;
}

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A regra olha agora? (dia, data, janela, a hora do "em"). O expediente quem diz é a fonte (o campo da linha). */
export function olhaAgora(r: Regra, e: EstadoDaRegra, agora: Agora): boolean {
  const q = r.quando;
  if (q.data && q.data !== agora.dia) return false;
  if (q.dias?.length && !q.dias.includes(agora.diaDaSemana)) return false;
  if (q.de && q.ate) {
    const h = minutos(agora.hora);
    const de = minutos(q.de);
    const ate = minutos(q.ate);
    const dentro = de <= ate ? h >= de && h <= ate : h >= de || h <= ate; // a janela que passa da meia-noite
    if (!dentro) return false;
  }
  if (q.em) {
    if (e.olhouEm === agora.dia) return false;
    const h = minutos(agora.hora);
    const em = minutos(q.em);
    if (h < em || h > em + LIMITES_DA_REGRA.folgaDoEmMin) return false;
  }
  return true;
}

function casa(f: Filtro, linha: LinhaDaFonte): boolean {
  const v = linha.campos[f.campo];
  if (v === null || v === undefined) return false;
  switch (f.op) {
    case '=':
      return typeof f.valor === 'boolean' ? v === f.valor : String(v) === String(f.valor);
    case '!=':
      return String(v) !== String(f.valor);
    case '>':
      return comparar(v, f.valor) > 0;
    case '>=':
      return comparar(v, f.valor) >= 0;
    case '<':
      return comparar(v, f.valor) < 0;
    case '<=':
      return comparar(v, f.valor) <= 0;
    case 'contem':
      return semAcento(String(v)).includes(semAcento(String(f.valor)));
    case 'em':
      return Array.isArray(f.valor) && f.valor.map(String).includes(String(v));
  }
}
const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && typeof a !== 'string') return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** As linhas que a regra pega (o alvo, todos os filtros e pelo menos um do "algum"). */
export function linhasDaRegra(r: Regra, linhas: LinhaDaFonte[]): LinhaDaFonte[] {
  return linhas.filter(
    (l) => (!r.alvo || l.alvoId === r.alvo.id) && r.filtros.every((f) => casa(f, l)) && (!r.algum?.length || r.algum.some((f) => casa(f, l))),
  );
}

const DOIS_DIAS_MS = 2 * 24 * 3_600_000;

/**
 * Avalia a regra nas linhas de agora. Devolve os disparos (um, ou um por item quando não agrupa) e o estado novo. Quem
 * chama grava o estado e reserva cada envio pela chave ANTES de mandar.
 */
export function avaliarRegra(r: Regra, linhas: LinhaDaFonte[], estado: EstadoDaRegra, agora: Agora): { disparos: Disparo[]; estado: EstadoDaRegra } {
  const e: EstadoDaRegra = { ...estado, avisados: { ...(estado.avisados ?? {}) } };
  // limpa o "já avisei" velho
  for (const [k, quando] of Object.entries(e.avisados!)) if (agora.instante.getTime() - Date.parse(quando) > DOIS_DIAS_MS) delete e.avisados![k];
  if (!olhaAgora(r, e, agora)) return { disparos: [], estado: e };
  if (r.quando.em) e.olhouEm = agora.dia;
  const pegas = linhasDaRegra(r, linhas);

  if (r.medida === 'cada_item') {
    const novas = pegas.filter((l) => !e.avisados![l.id]);
    if (!novas.length) return { disparos: [], estado: e };
    for (const l of novas) e.avisados![l.id] = agora.instante.toISOString();
    e.ultimoEnvio = agora.instante.toISOString();
    const disparos = r.agrupar
      ? [{ itens: novas, valor: null, chave: `itens:${novas.map((l) => l.id).sort().join(',')}` }]
      : novas.map((l) => ({ itens: [l], valor: null, chave: `item:${l.id}` }));
    return { disparos, estado: e };
  }

  const valor = medir(r, pegas);
  const c = r.condicao!;
  const vale = comparar(valor, c.valor) === 0 ? ['=', '>=', '<='].includes(c.op) : c.op === '>' ? valor > c.valor : c.op === '>=' ? valor >= c.valor : c.op === '<' ? valor < c.valor : c.op === '<=' ? valor <= c.valor : false;
  if (!vale) return { disparos: [], estado: { ...e, valendo: false, ultimos: [] } };
  const ids = pegas.map((l) => l.id).sort();
  const intervalo = (r.intervaloMin ?? LIMITES_DA_REGRA.intervaloPadraoMin) * 60_000;
  const passou = !e.ultimoEnvio || agora.instante.getTime() - Date.parse(e.ultimoEnvio) >= intervalo;
  const mudou = ids.join(',') !== (e.ultimos ?? []).join(',');
  const subiu = !e.valendo;
  if (!subiu && !(passou && mudou)) return { disparos: [], estado: { ...e, valendo: true } };
  return {
    disparos: [{ itens: pegas, valor, chave: `condicao:${agora.instante.toISOString().slice(0, 16)}:${ids.join(',').slice(0, 400)}` }],
    estado: { ...e, valendo: true, ultimos: ids, ultimoEnvio: agora.instante.toISOString() },
  };
}

function medir(r: Regra, pegas: LinhaDaFonte[]): number {
  if (r.medida === 'quantidade') return pegas.length;
  const valores = pegas.map((l) => Number(l.campos[r.campoDaMedida!])).filter((n) => Number.isFinite(n));
  if (r.medida === 'soma') return Math.round(valores.reduce((a, b) => a + b, 0) * 100) / 100;
  if (!valores.length) return r.medida === 'maior' ? -Infinity : Infinity;
  return r.medida === 'maior' ? Math.max(...valores) : Math.min(...valores);
}

/** O campo que aparece ao lado de cada item no aviso: o primeiro filtro numérico (o que a regra mede). */
function campoDeDestaque(r: Regra): CampoDaFonte | undefined {
  const fonte = fonteDaRegra(r.fonte)!;
  const nome = r.campoDaMedida ?? [...r.filtros, ...(r.algum ?? [])].find((f) => fonte.campos.find((c) => c.nome === f.campo)?.tipo === 'numero')?.campo;
  return nome ? fonte.campos.find((c) => c.nome === nome) : undefined;
}

/** O texto do aviso da regra — o código escreve: o título, a lista (até 10) e o número que a regra mede. */
export function textoDoDisparo(r: Regra, d: Disparo): string {
  const destaque = campoDeDestaque(r);
  const linhas = d.itens.slice(0, LIMITES_DA_REGRA.itensNaLista).map((l) => {
    const v = destaque ? l.campos[destaque.nome] : null;
    return `• ${l.rotulo}${v !== null && v !== undefined && v !== '' ? ` · ${valorEmPalavras(destaque, v)}` : ''}`;
  });
  const resto = d.itens.length > LIMITES_DA_REGRA.itensNaLista ? `\n…e mais ${d.itens.length - LIMITES_DA_REGRA.itensNaLista}.` : '';
  const campo = fonteDaRegra(r.fonte)!.campos.find((c) => c.nome === r.campoDaMedida);
  const medida =
    d.valor === null || r.medida === 'cada_item'
      ? ''
      : r.medida === 'quantidade'
        ? ` (${d.valor.toLocaleString('pt-BR')})`
        : ` (${r.medida === 'soma' ? 'soma' : r.medida}: ${campo?.dinheiro ? dinheiro(d.valor) : d.valor.toLocaleString('pt-BR')})`;
  return `⏱ ${r.titulo}${medida}${linhas.length ? `\n${linhas.join('\n')}` : ''}${resto}`.slice(0, 1500);
}

/** A descrição das fontes para a IA (vai na ferramenta; muda só quando o catálogo muda — o cache segue valendo). */
export function fontesParaAIa(): string {
  return FONTES_DA_REGRA.map(
    (f) =>
      `${f.nome} (${f.descricao}${f.temAlvo ? ' Dá para escolher UM item pela busca.' : ''}) campos: ${f.campos
        .map((c) => `${c.nome} [${c.tipo}${c.valores ? `: ${c.valores.join('|')}` : ''}${c.dinheiro ? ', reais' : ''}]`)
        .join(', ')}`,
  ).join('\n');
}

// ───────────────────────────── os botões ─────────────────────────────

export const PREFIXO_DA_REGRA = 'regra:';
export type AcaoDoBotaoDaRegra = 'sim' | 'mudar' | 'apagar' | 'deixar';
export const botoesDaProposta = (id: string) => [
  { id: `${PREFIXO_DA_REGRA}sim:${id}`, titulo: 'Confirmar' },
  { id: `${PREFIXO_DA_REGRA}mudar:${id}`, titulo: 'Mudar' },
];
export const botoesDoApagar = (id: string) => [
  { id: `${PREFIXO_DA_REGRA}apagar:${id}`, titulo: 'Apagar' },
  { id: `${PREFIXO_DA_REGRA}deixar:${id}`, titulo: 'Deixar' },
];
export function lerBotaoDaRegra(id: unknown): { acao: AcaoDoBotaoDaRegra; regraId: string } | null {
  const m = /^regra:(sim|mudar|apagar|deixar):([0-9a-f-]{36})$/i.exec(String(id ?? ''));
  return m ? { acao: m[1].toLowerCase() as AcaoDoBotaoDaRegra, regraId: m[2].toLowerCase() } : null;
}

export const TEXTOS_DAS_REGRAS = {
  ligada: (titulo: string) => `Pronto, regra ligada: "${titulo}". Para ver, pausar ou apagar, é só me pedir ("minhas regras").`,
  mudar: 'Certo, não liguei. Diga o que mudar e eu monto de novo.',
  apagada: (titulo: string) => `Apagada: "${titulo}".`,
  deixada: (titulo: string) => `Certo, a regra "${titulo}" continua.`,
  venceu: 'Essa proposta de regra venceu (30 minutos). Me peça de novo.',
  naoAchada: 'Não achei essa regra. Se precisar, me peça a lista das suas regras.',
  teto: (n: number) => `Você já tem ${n} regras, o máximo. Apague uma antes de criar outra.`,
} as const;
