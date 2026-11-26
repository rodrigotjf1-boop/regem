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
  feita: (frase: string) => `feito: ${frase.charAt(0).toLowerCase()}${frase.slice(1)}.`,
} as const;

/** O que a IA recebe de uma tarefa (na busca): os campos com o tipo, se é obrigatório e as opções. */
export function camposParaAIa(t: TarefaAberta): Array<Record<string, unknown>> {
  return t.campos
    .filter((c) => c.tipo !== 'loja')
    .map((c) => ({
      nome: c.nome,
      tipo: c.tipo === 'id' ? 'id (de uma leitura; nunca invente)' : c.tipo === 'data' ? 'data AAAA-MM-DD' : c.tipo === 'hora' ? 'hora HH:MM' : c.tipo,
      rotulo: c.rotulo,
      ...(c.obrigatorio ? { obrigatorio: true } : {}),
      ...(c.opcoes ? { opcoes: Object.keys(c.opcoes) } : {}),
      ...(c.min !== undefined ? { min: c.min } : {}),
      ...(c.max !== undefined ? { max: c.max } : {}),
    }));
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
  metodo: 'POST' | 'PUT' | 'PATCH';
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
  const [metodo, base] = f.rota.split(' ') as ['POST' | 'PUT' | 'PATCH', string];

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
  const conhecidos = new Map(t.campos.map((c) => [c.nome, c]));
  for (const k of Object.keys(dados)) {
    const c = conhecidos.get(k);
    if (!c || c.tipo === 'loja') return { erro: `Esta tarefa não tem o campo "${k}". Os campos são: ${t.campos.filter((x) => x.tipo !== 'loja').map((x) => x.nome).join(', ') || 'nenhum'}.` };
  }
  const corpo: Record<string, unknown> = {};
  for (const c of t.campos) {
    if (c.tipo === 'loja') {
      if (loja.unidadeId) corpo[c.nome] = loja.unidadeId;
      else if (c.obrigatorio) return { erro: TEXTOS_DAS_TAREFAS.semLoja };
      continue;
    }
    const v = dados[c.nome];
    if (v === undefined || v === null || v === '') {
      if (c.obrigatorio) return { erro: `Falta "${c.rotulo}" (${c.nome}).` };
      continue;
    }
    const r = valorDoCampo(c, v);
    if ('erro' in r) return r;
    corpo[c.nome] = r.valor;
    const mostrado = c.tipo === 'opcao' ? c.opcoes![r.valor as string] : c.tipo === 'id' ? (nomeNaOrigem(String(r.valor), origem) ?? `…${String(r.valor).slice(-6)}`) : String(r.valor);
    linhas.push(`• ${c.rotulo}: ${mostrado}`);
  }
  const resumo = [`${f.frase}.`, ...linhas].join('\n');
  return { f, t, metodo, caminho, corpo, resumo };
}

/** O valor de um campo, conferido e normalizado pelo tipo. */
function valorDoCampo(c: CampoDaTarefa, v: unknown): { valor: unknown } | { erro: string } {
  const ruim = (como: string) => ({ erro: `"${c.rotulo}" (${c.nome}) precisa ser ${como}.` });
  switch (c.tipo) {
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
