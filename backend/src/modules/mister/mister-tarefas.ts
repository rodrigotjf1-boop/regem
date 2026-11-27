import { funcaoDoMapa, palavrasDoTexto, parametrosDoCaminho } from './mapa/busca-no-mapa';
import type { FuncaoDoMapa } from './mapa/mapa-do-regem';
import { TAREFAS_ABERTAS, tarefaAberta, type CampoDaTarefa, type TarefaAberta } from './mapa/tarefas-abertas';

// FAZER UMA TAREFA PELO MAPA (Mister, versão 10, fase C4; `docs/plano-mister.md` § "C4a"). A IA propõe a função de escrita com
// os campos; o Regem confere (a tarefa está aberta, cada campo com o tipo certo, os obrigatórios, nenhum a mais, a loja da
// conversa), monta o "Vou fazer" — nunca escrito pela IA — e a pessoa confirma pelo botão. Na confirmação, a chamada vai à
// própria API com o bilhete de uma chamada preso ao método, ao caminho e ao corpo (`auth/bilhete-do-mister.ts`): valem as
// travas da tela. Nasce desligado (`MISTER_FAZER_TAREFAS=1`).

/** O procedimento da proposta (o "Autorizar" faz a tarefa). */
export const PROCEDIMENTO_DA_TAREFA = 'fazer_no_regem' as const;
/** Quanto tempo a pessoa tem para autorizar. */
export const PRAZO_DA_TAREFA_MIN = 15;
/** O liga/desliga da distribuição. */
export const tarefasNoMister = (): boolean => process.env.MISTER_FAZER_TAREFAS === '1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALOR_DO_PARAMETRO = /^[A-Za-z0-9_.:-]{1,80}$/;

export const TEXTOS_DAS_TAREFAS = {
  fora: 'Essa função ainda não está entre as tarefas que o Mister faz pela conversa. Procure com procurar_no_regem: as tarefas que vierem com "campos" são as que dá para fazer.',
  semLoja: 'Diga em qual loja (a empresa tem mais de uma).',
  pergunta: (resumo: string) => `Vou fazer:\n${resumo}\n\nToque em "Autorizar" em até ${PRAZO_DA_TAREFA_MIN} minutos para eu fazer.`,
  siga: 'O "Vou fazer" e os botões vão logo depois da sua resposta: diga em uma frase o que vai acontecer quando a pessoa tocar em "Autorizar". Nada foi feito ainda.',
  /** C4 Onda 1: a tarefa de PIN vai com o link "Abrir no Regem". */
  link: (resumo: string, hora: string) => `Vou fazer:\n${resumo}\n\nPara valer, autorize no Regem com o seu PIN. O pedido vale até ${hora}.`,
  sigaDoPin: 'Mostre o "oQueVouFazer" como veio e diga que o link "Abrir no Regem" chega logo abaixo e pede o PIN. Nada muda sem o PIN; nunca peça o PIN na conversa. Não diga que fez.',
  feita: (frase: string) => `feito: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}.`,
} as const;

/**
 * O "siga" que volta à IA depois do "Vou fazer": a tarefa de PIN fala do link que pede o PIN; a de botão, do "Autorizar".
 * A conversa (`MisterTarefasService.propor`) e a avaliação usam esta MESMA função — a avaliação devolvia sempre o do botão,
 * e as perguntas de PIN (c139, c140) reprovavam sem a IA ter errado (ERR-639).
 */
export function sigaDaTarefa(marca: string): string {
  return marca === 'pin' ? TEXTOS_DAS_TAREFAS.sigaDoPin : TEXTOS_DAS_TAREFAS.siga;
}

/** Como a IA lê o tipo de cada campo. */
const TIPO_PARA_A_IA: Partial<Record<CampoDaTarefa['tipo'], string>> = {
  id: 'id (de uma leitura; nunca invente)',
  ids: 'lista de ids (de uma leitura; nunca invente)',
  data: 'data AAAA-MM-DD',
  hora: 'hora HH:MM',
  mes: 'mês AAAA-MM',
  numero: 'número (pode ter casas: 2.5)',
  booleano: 'true ou false',
  lista: 'lista de itens, cada um com os campos de "itens"',
};

/** O que a IA recebe de cada campo: o tipo, se é obrigatório, as opções e, na lista, os campos de cada item. */
function campoParaAIa(c: CampoDaTarefa): Record<string, unknown> {
  return {
    nome: c.nome,
    tipo: TIPO_PARA_A_IA[c.tipo] ?? c.tipo,
    rotulo: c.rotulo,
    ...(c.obrigatorio ? { obrigatorio: true } : {}),
    ...(c.opcoes ? { opcoes: Object.keys(c.opcoes) } : {}),
    ...(c.min !== undefined ? { min: c.min } : {}),
    ...(c.max !== undefined ? { max: c.max } : {}),
    ...(c.tipo === 'lista' && c.itens ? { itens: c.itens.filter((x) => x.tipo !== 'loja').map(campoParaAIa) } : {}),
    ...((c.tipo === 'lista' || c.tipo === 'ids') && c.maxItens ? { maxItens: c.maxItens } : {}),
  };
}

/** O que a IA recebe de uma tarefa (na busca): os campos com o tipo, se é obrigatório e as opções. */
export function camposParaAIa(t: TarefaAberta): Array<Record<string, unknown>> {
  return t.campos.filter((c) => c.tipo !== 'loja').map(campoParaAIa);
}

/**
 * C4 Onda 1: a tarefa de PIN na página do link — o título pela frase do mapa e as linhas do "Vou fazer" gravado (montado pelo
 * Regem, nunca pela IA).
 */
export function apresentacaoDaTarefa(par: { frase?: unknown; resumo?: unknown }): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const frase = String(par.frase ?? '').trim();
  const linhas = String(par.resumo ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\s*[•–-]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 20);
  return { titulo: frase ? `Autorizar: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}?` : 'Autorizar o pedido do Mister?', itens: linhas, detalhe: null, valor: null, botao: 'Autorizar' };
}

/** As tarefas abertas (para a busca), com a frase do mapa. */
export const TAREFAS_DO_MISTER: ReadonlyArray<{ t: TarefaAberta; f: FuncaoDoMapa }> = TAREFAS_ABERTAS.map((t) => ({ t, f: funcaoDoMapa(t.rota)! })).filter((x) => !!x.f);

/** As tarefas abertas que combinam com o que a IA procura (as mesmas palavras da busca das leituras), até 5. */
export function procurarTarefas(busca: unknown): Array<{ rota: string; frase: string; parametros: string[]; campos: Array<Record<string, unknown>> }> {
  const palavras = palavrasDoTexto(busca).slice(0, 12);
  if (!palavras.length) return [];
  return TAREFAS_DO_MISTER.map(({ t, f }) => {
    const naFrase = new Set(palavrasDoTexto(f.frase));
    const noCaminho = new Set(palavrasDoTexto(f.rota.split(' ')[1].replace(/^\/api\/v1\//, '').replace(/\{[^}]+\}/g, ' ')));
    const nos = new Set(palavrasDoTexto(t.campos.map((c) => c.rotulo).join(' ')));
    let n = 0;
    for (const p of palavras) n += (naFrase.has(p) ? 3 : 0) + (noCaminho.has(p) ? 2 : 0) + (nos.has(p) ? 1 : 0);
    return { t, f, n };
  })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.f.rota.localeCompare(b.f.rota))
    .slice(0, 5)
    .map(({ t, f }) => ({ rota: f.rota, frase: f.frase, parametros: parametrosDoCaminho(f.rota), campos: camposParaAIa(t) }));
}

/** O nome de um registro, procurado no que as leituras desta pergunta trouxeram (o "Vou fazer" mostra o nome, não o id). */
function nomeNaOrigem(id: string, origem: unknown[]): string | null {
  let achado: string | null = null;
  const andar = (v: unknown, nivel: number): void => {
    if (achado || nivel > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) andar(x, nivel + 1);
      return;
    }
    const o = v as Record<string, unknown>;
    if (o.id === id) {
      const n = o.nome ?? o.titulo ?? o.descricao ?? o.mensagem;
      if (typeof n === 'string' && n.trim()) {
        achado = n.trim().slice(0, 80);
        return;
      }
    }
    for (const x of Object.values(o)) andar(x, nivel + 1);
  };
  for (const r of origem) andar(r, 0);
  return achado;
}

export interface PedidoDaTarefa {
  f: FuncaoDoMapa;
  t: TarefaAberta;
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  caminho: string;
  corpo: Record<string, unknown>;
  /** O "Vou fazer", montado pelo Regem. */
  resumo: string;
}

/**
 * Confere o pedido de `fazer_no_regem` (a avaliação usa a MESMA): a tarefa aberta; cada parâmetro do caminho simples; cada
 * campo conhecido, do tipo certo; os obrigatórios presentes; nenhum campo a mais; a loja da conversa no campo `loja`.
 * `origem` = o que as consultas desta pergunta trouxeram (dá o nome do registro escolhido por id).
 */
export function pedidoDaTarefa(entrada: unknown, loja: { unidadeId: string | null }, origem: unknown[] = []): PedidoDaTarefa | { erro: string } {
  const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const t = tarefaAberta(en.rota);
  const f = t ? funcaoDoMapa(t.rota) : undefined;
  if (!t || !f || (f.marca !== 'botao' && f.marca !== 'pin')) return { erro: TEXTOS_DAS_TAREFAS.fora };
  const [metodo, base] = f.rota.split(' ') as ['POST' | 'PUT' | 'PATCH' | 'DELETE', string];

  const params = (en.parametros && typeof en.parametros === 'object' && !Array.isArray(en.parametros) ? en.parametros : {}) as Record<string, unknown>;
  let caminho = base;
  const linhas: string[] = [];
  for (const p of parametrosDoCaminho(f.rota)) {
    const v = params[p];
    const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
    if (!VALOR_DO_PARAMETRO.test(s) || /^\.+$/.test(s)) return { erro: `Falta o "${p}" desta tarefa (o id que uma leitura trouxe).` };
    caminho = caminho.replace(`{${p}}`, encodeURIComponent(s));
    const nome = UUID.test(s) ? nomeNaOrigem(s, origem) : null;
    linhas.push(`• Registro: ${nome ?? `…${s.slice(-6)}`}`);
  }

  const dados = (en.campos && typeof en.campos === 'object' && !Array.isArray(en.campos) ? en.campos : {}) as Record<string, unknown>;
  // A exclusão vai com o corpo `{}` (ou só os campos que a rota pede, como o motivo): o campo que a tarefa não tem é recusado.
  const r = conferirCampos(t.campos, dados, origem, loja.unidadeId, '•');
  if ('erro' in r) return r;
  const resumo = [`${f.frase}.`, ...linhas, ...r.linhas].join('\n');
  return { f, t, metodo, caminho, corpo: r.corpo, resumo };
}

/** Quantas linhas de uma lista o "Vou fazer" mostra (o resto vira "e mais N"). */
const ITENS_NO_RESUMO = 12;

/**
 * Os campos de um nível (a tarefa, ou um item de uma lista): nenhum desconhecido, os obrigatórios presentes, cada um do tipo
 * certo; a loja da conversa no campo `loja`. Devolve o corpo e as linhas do "Vou fazer".
 */
function conferirCampos(
  campos: readonly CampoDaTarefa[],
  dados: Record<string, unknown>,
  origem: unknown[],
  lojaId: string | null,
  marca: string,
): { corpo: Record<string, unknown>; linhas: string[] } | { erro: string } {
  const conhecidos = new Map(campos.map((c) => [c.nome, c]));
  for (const k of Object.keys(dados)) {
    const c = conhecidos.get(k);
    if (!c || c.tipo === 'loja') return { erro: `Esta tarefa não tem o campo "${k}". Os campos são: ${campos.filter((x) => x.tipo !== 'loja').map((x) => x.nome).join(', ') || 'nenhum'}.` };
  }
  const corpo: Record<string, unknown> = {};
  const linhas: string[] = [];
  for (const c of campos) {
    if (c.tipo === 'loja') {
      if (lojaId) corpo[c.nome] = lojaId;
      else if (c.obrigatorio) return { erro: TEXTOS_DAS_TAREFAS.semLoja };
      continue;
    }
    const v = dados[c.nome];
    if (v === undefined || v === null || v === '') {
      if (c.obrigatorio) return { erro: `Falta "${c.rotulo}" (${c.nome}).` };
      continue;
    }
    if (c.tipo === 'lista') {
      const max = c.maxItens ?? 50;
      if (!Array.isArray(v) || !v.length || v.length > max) return { erro: `"${c.rotulo}" (${c.nome}) precisa ser uma lista de 1 a ${max} itens.` };
      const itens: Record<string, unknown>[] = [];
      linhas.push(`${marca} ${c.rotulo}: ${v.length} ${v.length === 1 ? 'item' : 'itens'}`);
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (!x || typeof x !== 'object' || Array.isArray(x)) return { erro: `"${c.rotulo}": o item ${i + 1} precisa ter os campos ${(c.itens ?? []).map((y) => y.nome).join(', ')}.` };
        const sub = conferirCampos(c.itens ?? [], x as Record<string, unknown>, origem, lojaId, '');
        if ('erro' in sub) return { erro: `"${c.rotulo}", item ${i + 1}: ${sub.erro}` };
        itens.push(sub.corpo);
        if (i < ITENS_NO_RESUMO) linhas.push(`   – ${sub.linhas.map((l) => l.replace(/^\s*/, '')).join(' · ')}`);
      }
      if (v.length > ITENS_NO_RESUMO) linhas.push(`   – e mais ${v.length - ITENS_NO_RESUMO}`);
      corpo[c.nome] = itens;
      continue;
    }
    const r = valorDoCampo(c, v);
    if ('erro' in r) return r;
    corpo[c.nome] = r.valor;
    const nomeDoId = (id: string) => nomeNaOrigem(id, origem) ?? `…${id.slice(-6)}`;
    const mostrado =
      c.tipo === 'opcao'
        ? c.opcoes![r.valor as string]
        : c.tipo === 'id'
          ? nomeDoId(String(r.valor))
          : c.tipo === 'ids'
            ? (r.valor as string[]).map(nomeDoId).join(', ')
            : c.tipo === 'booleano'
              ? (r.valor ? 'sim' : 'não')
              : c.tipo === 'numero'
                ? Number(r.valor).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
                : c.tipo === 'mes'
                  ? String(r.valor).split('-').reverse().join('/')
                  : String(r.valor);
    linhas.push(`${marca ? `${marca} ` : ''}${c.rotulo}: ${mostrado}`);
  }
  return { corpo, linhas };
}

/** O valor de um campo, conferido e normalizado pelo tipo. */
function valorDoCampo(c: CampoDaTarefa, v: unknown): { valor: unknown } | { erro: string } {
  const ruim = (como: string) => ({ erro: `"${c.rotulo}" (${c.nome}) precisa ser ${como}.` });
  switch (c.tipo) {
    case 'numero': {
      // "2,5" vira 2.5; nada de milhar ("1.234,5" não passa: a IA manda o número).
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN;
      if (!Number.isFinite(n) || (c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max))
        return ruim(`um número${c.min !== undefined ? ` de ${c.min}` : ''}${c.max !== undefined ? ` até ${c.max}` : ''}`);
      return { valor: Math.round(n * 1e6) / 1e6 };
    }
    case 'booleano': {
      if (typeof v === 'boolean') return { valor: v };
      const s = String(v).trim().toLowerCase();
      if (s === 'true' || s === 'sim') return { valor: true };
      if (s === 'false' || s === 'nao' || s === 'não') return { valor: false };
      return ruim('true ou false');
    }
    case 'ids': {
      const max = c.maxItens ?? 50;
      if (!Array.isArray(v) || !v.length || v.length > max) return ruim(`uma lista de 1 a ${max} ids que uma leitura trouxe`);
      const ids = v.map((x) => String(x).trim().toLowerCase());
      if (ids.some((x) => !UUID.test(x))) return ruim('uma lista de ids que uma leitura trouxe');
      return { valor: [...new Set(ids)] };
    }
    case 'texto': {
      if (typeof v !== 'string' && typeof v !== 'number') return ruim('um texto');
      const s = String(v).replace(/\s+/g, ' ').trim();
      if (!s) return ruim('um texto');
      return { valor: s.slice(0, c.maxLetras ?? 300) };
    }
    case 'inteiro': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : NaN;
      if (!Number.isInteger(n) || (c.min !== undefined && n < c.min) || (c.max !== undefined && n > c.max)) return ruim(`um número inteiro${c.min !== undefined ? ` de ${c.min} a ${c.max}` : ''}`);
      return { valor: n };
    }
    case 'data': {
      const s = String(v).trim();
      if (!DATA.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`))) return ruim('uma data AAAA-MM-DD');
      return { valor: s };
    }
    case 'hora': {
      const s = String(v).trim().slice(0, 5);
      if (!HORA.test(s)) return ruim('uma hora HH:MM');
      return { valor: s };
    }
    case 'mes': {
      // C4 Onda 3: a competência AAAA-MM. Conferida aqui porque a rota do fechamento troca o mês torto pelo anterior, calada.
      const s = String(v).trim();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return ruim('um mês AAAA-MM');
      return { valor: s };
    }
    case 'id': {
      const s = String(v).trim().toLowerCase();
      if (!UUID.test(s)) return ruim('um id que uma leitura trouxe');
      return { valor: s };
    }
    case 'opcao': {
      const s = String(v).trim();
      if (!c.opcoes || !(s in c.opcoes)) return ruim(`uma destas: ${Object.keys(c.opcoes ?? {}).join(', ')}`);
      return { valor: s };
    }
    default:
      return ruim('um valor que a tarefa aceita');
  }
}
