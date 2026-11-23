import type { EventoNaAgenda, FonteDaPrevisao, LeituraDaChuva } from './mister-clima-eventos';

// O AVISO DA VÉSPERA E A LINHA "AMANHÃ" (versão 8, E3; protótipo `mockups/regem-mister-v8.html`, "Clima e eventos"). Texto fixo,
// sem IA (V8-9). Só sai quando há algo para dizer: feriado, data forte, jogo na cidade, o que a loja cadastrou, ou chuva nas DUAS
// previsões (V8-8: "pancadas isoladas" aparece quase todo dia no verão e, sozinha, viraria ruído).

export const BOTAO_DA_VESPERA = 'vs:';
export const TEXTO_DEIXA_ASSIM = 'Fechado, não mexo em nada. Bom trabalho amanhã.';
export const PERGUNTA_DO_ESTOQUE = 'Confere o estoque abaixo do mínimo para o movimento de amanhã.';

export type DiaDaAgenda = {
  rotulo: string;
  eventos: EventoNaAgenda[];
  previsao: { inmet: FonteDaPrevisao | null; cptec: FonteDaPrevisao | null; chuva: LeituraDaChuva } | null;
};
export type DaVespera = { loja: string; rotulo: string; eventos: EventoNaAgenda[]; chuva: boolean; inmet: FonteDaPrevisao | null; cptec: FonteDaPrevisao | null };

/** O que vale avisar de um dia, ou null. Jogo que só passa na TV (de outra cidade) não conta. */
export function oQueAvisar(loja: string, dia: DiaDaAgenda | null | undefined): DaVespera | null {
  if (!dia) return null;
  const eventos = (dia.eventos ?? []).filter((e) => e.alcance !== 'nacional');
  const chuva = dia.previsao?.chuva === 'as_duas_dao_chuva';
  if (!eventos.length && !chuva) return null;
  return { loja, rotulo: dia.rotulo, eventos, chuva, inmet: dia.previsao?.inmet ?? null, cptec: dia.previsao?.cptec ?? null };
}

const doEvento = (e: EventoNaAgenda) => `${e.nome}${e.hora ? ` às ${e.hora}` : ''}${e.aConfirmar ? ' (a confirmar)' : ''}`;
const temp = (f: FonteDaPrevisao | null) => (f?.maxima != null && f?.minima != null ? `, ${f.maxima}° / ${f.minima}°` : '');
const daFonte = (nome: string, f: FonteDaPrevisao | null) => (f?.resumo ? `${nome}: ${f.resumo}${temp(f)}` : null);

const fraseDoDia = (v: DaVespera): string =>
  [v.eventos.length ? `${v.eventos.map(doEvento).join(', ')}.` : null, v.chuva ? 'As duas previsões dão chuva.' : null].filter(Boolean).join(' ');

/** A sugestão fixa, pelo que vem: é só sugestão, e nada muda sem a pessoa pedir. */
function sugestao(lista: DaVespera[]): string {
  const chuva = lista.some((v) => v.chuva);
  const jogo = lista.some((v) => v.eventos.some((e) => e.tipo === 'Jogo'));
  const forte = lista.some((v) => v.eventos.some((e) => e.tipo !== 'Jogo'));
  if (chuva) return 'Conferir embalagem de entrega e quantos entregadores você tem para a noite.';
  if (jogo) return 'Conferir a equipe e o estoque para o horário do jogo.';
  return forte ? 'Conferir o estoque e a equipe para o dia.' : 'Conferir o estoque.';
}

const comoVeio = (v: DaVespera) => JSON.stringify({ e: v.eventos, c: v.chuva, i: v.inmet, p: v.cptec });

/** O aviso inteiro. Lojas com o mesmo dia saem juntas; com dias diferentes, um bloco por loja. */
export function textoDaVespera(lista: DaVespera[], quando: 'Amanhã' | 'Hoje' = 'Amanhã'): string | null {
  if (!lista.length) return null;
  const iguais = new Set(lista.map(comoVeio)).size === 1;
  const bloco = (v: DaVespera) => [fraseDoDia(v), ...(v.chuva ? [daFonte('INMET', v.inmet), daFonte('CPTEC', v.cptec)].filter(Boolean) : [])].join('\n');
  const corpo = iguais ? bloco(lista[0]) : lista.map((v) => `*${v.loja}*\n${bloco(v)}`).join('\n\n');
  return [`*${quando}, ${lista[0].rotulo}*`, corpo, `*Minha sugestão:* ${sugestao(lista)}`].join('\n\n');
}

/** A linha do fim do resumo do dia, ou null. */
export function linhaDeAmanha(lista: DaVespera[]): string | null {
  if (!lista.length) return null;
  const frase = (v: DaVespera) => {
    const max = [v.inmet?.maxima, v.cptec?.maxima].filter((n): n is number => typeof n === 'number').sort((a, b) => a - b);
    const faixa = v.chuva && max.length ? `, máxima de ${max[0] === max[max.length - 1] ? `${max[0]}°` : `${max[0]}° a ${max[max.length - 1]}°`}` : '';
    return faixa ? `${fraseDoDia(v).replace(/\.$/, '')}${faixa}.` : fraseDoDia(v);
  };
  const iguais = new Set(lista.map(comoVeio)).size === 1;
  return `*Amanhã:* ${iguais ? frase(lista[0]) : lista.map((v) => `${v.loja}: ${frase(v)}`).join(' ')}`;
}

export const botoesDaVespera = (id: string) => [
  { id: `${BOTAO_DA_VESPERA}${id}:estoque`, titulo: 'Conferir o estoque' },
  { id: `${BOTAO_DA_VESPERA}${id}:ok`, titulo: 'Deixa assim' },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerBotaoDaVespera(botaoId: unknown): { id: string; acao: 'estoque' | 'ok' } | null {
  const [prefixo, id, acao] = String(botaoId ?? '').split(':');
  if (`${prefixo}:` !== BOTAO_DA_VESPERA || !UUID.test(id ?? '') || (acao !== 'estoque' && acao !== 'ok')) return null;
  return { id: id.toLowerCase(), acao };
}
