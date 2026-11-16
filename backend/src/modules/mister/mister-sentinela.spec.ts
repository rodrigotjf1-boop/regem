import {
  INSTRUCOES_DO_SENTINELA,
  MAX_PROPOSTAS,
  MetadadosDaAnalise,
  conferirDecisaoDaAnalise,
  contarEventos,
  estimativaDaAnalise,
  lerPropostas,
  mensagensDaAnalise,
} from './mister-sentinela';

// A análise com IA da Segurança (S2, mig 434): puro. A rodada com o banco e a IA de mentira está em
// `mister-pg.teste-spec.ts` (pela `ia-empresa-pg.spec.ts`).

const p = (nivel: string, titulo: string) => ({ nivel, titulo, viu: `viu ${titulo}`, proposta: `proposta ${titulo}`, impacto: `impacto ${titulo}` });
const META: MetadadosDaAnalise = {
  dias: 7,
  seguranca: {
    saida: [{ nota: 'segredo', quantas: 1 }, { nota: 'link_tirado', quantas: 3 }],
    entrada: { codigoErrado: { quantas: 14 }, outraPessoa: 2, perdeuOAcesso: 4, naoLigado: { quantas: 9 } },
    limite: 1,
    linksComPin: { bloqueados: 2 },
  },
  telefonesComCodigoErrado: [{ final: '7731', vezes: 9, de: '15/11 22:04', ate: '15/11 22:16' }],
  notasPorConsulta: [{ nota: 'link_tirado', consulta: 'canais_e_integracoes', vezes: 3, empresas: 2 }],
  motivosSemResposta: [{ motivo: 'sem_consulta', vezes: 5 }],
};

describe('a análise com IA da Segurança (o Sentinela, parte 2)', () => {
  it('lê só o JSON pedido: nível da lista fechada, os quatro textos, no máximo 5; o resto cai', () => {
    const r = lerPropostas(
      `Aqui vai: ${JSON.stringify({
        propostas: [p('critico', 'A'), p('inventado', 'B'), { ...p('atencao', 'C'), viu: '   ' }, p('melhoria', 'D'), p('atencao', 'E'), p('atencao', 'F'), p('atencao', 'G'), p('atencao', 'H')],
      })} — fim.`,
    );
    expect(r?.map((x) => [x.nivel, x.titulo])).toEqual([
      ['critico', 'A'],
      ['melhoria', 'D'],
      ['atencao', 'E'],
      ['atencao', 'F'],
      ['atencao', 'G'],
    ]);
    expect(r).toHaveLength(MAX_PROPOSTAS);
  });

  it('fora do formato devolve null; a lista vazia é uma análise sem proposta', () => {
    expect(lerPropostas('Não achei nada de mais.')).toBeNull();
    expect(lerPropostas('{"propostas": "nenhuma"}')).toBeNull();
    expect(lerPropostas('{ quebrado')).toBeNull();
    expect(lerPropostas('{"propostas": []}')).toEqual([]);
  });

  it('os textos ficam numa linha e cortados no tamanho', () => {
    const [x] = lerPropostas(JSON.stringify({ propostas: [{ ...p('atencao', 'T'), titulo: `um\n\ntítulo   ${'x'.repeat(300)}` }] }))!;
    expect(x.titulo.startsWith('um título x')).toBe(true);
    expect(x.titulo.length).toBe(160);
    expect(x.titulo.endsWith('…')).toBe(true);
  });

  it('conta os eventos lidos: os desfechos, as notas, o limite, os links bloqueados e os motivos', () => {
    expect(contarEventos(META)).toBe(14 + 2 + 4 + 9 + 1 + 3 + 1 + 2 + 5);
    expect(contarEventos({ ...META, seguranca: {} as any, motivosSemResposta: [] })).toBe(0);
  });

  it('o pedido leva só os metadados, e as instruções proíbem agir sozinho e inventar número', () => {
    const [m] = mensagensDaAnalise(META);
    expect(m.role).toBe('user');
    expect(m.content).toContain('"final":"7731"');
    expect(INSTRUCOES_DO_SENTINELA).toContain('Nunca proponha agir sozinho');
    expect(INSTRUCOES_DO_SENTINELA).toContain('Não invente evento, empresa, telefone, hora nem número');
    expect(INSTRUCOES_DO_SENTINELA).toContain('Responda SÓ com o JSON');
  });

  it('a estimativa antes de rodar: um número para o modelo conhecido, null para o desconhecido', () => {
    expect(estimativaDaAnalise('claude-haiku-5-5', META)).toBeGreaterThan(0);
    expect(estimativaDaAnalise('modelo-que-nao-existe', META)).toBeNull();
  });

  it('a decisão: o id, "tarefa" ou "descartada"; a tarefa só na "tarefa"', () => {
    const id = '0e1b9a54-7f3a-4c2d-9b8e-1a2b3c4d5e6f';
    expect(conferirDecisaoDaAnalise({ id, decisao: 'tarefa', tarefa: '  DMS-9 ' })).toEqual({ id, decisao: 'tarefa', tarefa: 'DMS-9' });
    expect(conferirDecisaoDaAnalise({ id, decisao: 'tarefa', tarefa: '' })).toEqual({ id, decisao: 'tarefa', tarefa: null });
    expect(conferirDecisaoDaAnalise({ id, decisao: 'descartada', tarefa: 'não vale' })).toEqual({ id, decisao: 'descartada', tarefa: null });
    expect(conferirDecisaoDaAnalise({ id: 'x', decisao: 'tarefa' })).toEqual({ erro: 'Proposta não encontrada.' });
    expect(conferirDecisaoDaAnalise({ id, decisao: 'apagar' })).toEqual({ erro: 'Escolha "Virou tarefa" ou "Descartar".' });
  });
});
