// OS FERIADOS SEM RESPOSTA DA LOJA (fase H2a dos dias especiais; protótipo `mockups/regem-dias-especiais.html`, "Na loja":
// "Próximos feriados sem resposta" e a faixa da tela 10 dias antes). Sem tabela nova: as três listas que já existem viram
// sugestão — os feriados e os pontos facultativos por lei (`perfil-cliente/calendario-regra.ts`), o feriado da Escala
// (Escalas › Feriado / evento, `dia_especial` tipo feriado) e o feriado da cidade do Marketing (Delivery › Clientes ›
// Calendário de eventos, `evento_loja` tipo feriado_municipal). Um feriado sai da lista quando a loja responde: qualquer dia
// especial que cobre a data — "Horário normal" também conta (decisão 9: grava a resposta e ninguém é perguntado de novo).
// Sem resposta, vale o horário da semana (decisão 3). Funções puras: testáveis sem banco.

export type OrigemDoFeriado = 'escala' | 'calendario' | 'lei' | 'ponto_facultativo';

export type FeriadoSugerido = {
  /** Chave estável: a mesma data da mesma fonte dá sempre a mesma chave (vai para `feriado_chave` quando a loja responde). */
  chave: string;
  data: string;
  nome: string;
  origem: OrigemDoFeriado;
};

export type FeriadoSemResposta = FeriadoSugerido & {
  /** O horário da semana daquele dia (o que vale até alguém responder): "18:00 às 00:00", ou `null` (fechada). */
  normal: string | null;
};

/** O que já responde por uma data: um dia especial (qualquer como-fica) ou a chave do feriado gravada nele. */
export type RespostaDaLoja = { data: string; dataFim: string | null; feriadoChave: string | null };

/** Quando duas fontes dão a mesma data, vale o nome que a LOJA deu (Escala, calendário) antes do da lei. */
const PRIORIDADE: Record<OrigemDoFeriado, number> = { escala: 0, calendario: 1, lei: 2, ponto_facultativo: 3 };

export const NOME_DA_ORIGEM: Record<OrigemDoFeriado, string> = {
  lei: 'Feriado por lei',
  ponto_facultativo: 'Ponto facultativo',
  escala: 'Feriado da Escala (Escalas › Feriado / evento)',
  calendario: 'Feriado da cidade (Delivery › Clientes › Calendário de eventos)',
};

/**
 * Os feriados sem resposta entre `hoje` e `hoje + dias` (inclusive), um por data, em ordem de data. `normalDoDia` devolve o
 * horário da semana do dia (texto) ou `null`.
 */
export function feriadosSemResposta(p: {
  hoje: string;
  ate: string;
  candidatos: readonly FeriadoSugerido[];
  respostas: readonly RespostaDaLoja[];
  normalDoDia: (data: string) => string | null;
}): FeriadoSemResposta[] {
  const respondida = (f: FeriadoSugerido) =>
    p.respostas.some((r) => (r.feriadoChave && r.feriadoChave === f.chave) || (r.data <= f.data && (r.dataFim ?? r.data) >= f.data));
  const porData = new Map<string, FeriadoSugerido>();
  for (const f of p.candidatos) {
    if (!f || f.data < p.hoje || f.data > p.ate || !f.nome?.trim()) continue;
    const ja = porData.get(f.data);
    if (!ja || PRIORIDADE[f.origem] < PRIORIDADE[ja.origem]) porData.set(f.data, f);
  }
  return [...porData.values()]
    .filter((f) => !respondida(f))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
    .map((f) => ({ ...f, normal: p.normalDoDia(f.data) }));
}

/** Os dias de um período ('AAAA-MM-DD' a 'AAAA-MM-DD'), para o feriado da Escala que dura mais de um dia. */
export function diasDoPeriodo(de: string, ate: string | null, somarDias: (d: string, n: number) => string, limite = 62): string[] {
  const fim = ate && ate > de ? ate : de;
  const out: string[] = [];
  for (let d = de; d <= fim && out.length < limite; d = somarDias(d, 1)) out.push(d);
  return out;
}
