import { FERRAMENTAS, ferramentasDaConversa, noticiasNoMister } from './mister-agente.regras';
import { CUIDADO_DAS_NOTICIAS, DIAS_DAS_NOTICIAS_MAX, NOTICIAS_NA_RESPOSTA, consultarNoticias, montarNoticias, pedidoDasNoticias } from './mister-noticias';
import type { BoletimDoRamo, NoticiaDoBoletim } from '../pulso/pulso.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Perguntar ao Mister sobre as notícias do ramo (fase N3). A leitura das cópias no Postgres está em `pulso-pg.spec.ts`.
const noticia = (id: string, categoria: string, publicadoEm: string, extra: Partial<NoticiaDoBoletim> = {}): NoticiaDoBoletim => ({
  id,
  titulo: `Notícia ${id}`,
  link: `https://fonte.teste/${id}`,
  categoria,
  categoriaNome: categoria,
  publicadoEm,
  emDiscussao: false,
  aviso: null,
  credito: 'Fonte: teste',
  ...extra,
});
const boletim = (o: Partial<BoletimDoRamo>): BoletimDoRamo => ({ dia: '2026-11-23', mensagem: null, indicadores: [], destaques: [], novidades: [], mais: [], ...o });
const P = { assunto: null, de: '2026-11-17', ate: '2026-11-23' };

describe('as notícias do ramo no Mister', () => {
  const antes = process.env.MISTER_NOTICIAS_RAMO;
  const antesDosLinks = process.env.MISTER_LINKS;
  const antesDasTelas = process.env.MISTER_LER_TELAS;
  afterEach(() => {
    if (antesDasTelas === undefined) delete process.env.MISTER_LER_TELAS;
    else process.env.MISTER_LER_TELAS = antesDasTelas;
    if (antes === undefined) delete process.env.MISTER_NOTICIAS_RAMO;
    else process.env.MISTER_NOTICIAS_RAMO = antes;
    if (antesDosLinks === undefined) delete process.env.MISTER_LINKS;
    else process.env.MISTER_LINKS = antesDosLinks;
  });

  it('nasce desligada: fora da conversa, mas a avaliação a enxerga; ligada, entra', () => {
    delete process.env.MISTER_NOTICIAS_RAMO;
    process.env.MISTER_LINKS = '1';
    process.env.MISTER_LER_TELAS = '1';
    expect(noticiasNoMister()).toBe(false);
    expect(ferramentasDaConversa().map((f) => f.name)).not.toContain('noticias_do_ramo');
    expect(FERRAMENTAS.map((f) => f.name)).toContain('noticias_do_ramo');
    expect(ferramentasDaConversa()).toHaveLength(FERRAMENTAS.length - 1);
    process.env.MISTER_NOTICIAS_RAMO = '1';
    expect(ferramentasDaConversa()).toHaveLength(FERRAMENTAS.length);
  });

  it('desligada, a consulta recusa antes de ler o banco', async () => {
    delete process.env.MISTER_NOTICIAS_RAMO;
    const execute = jest.fn();
    const r = await consultarNoticias({ execute } as any, { tenantId: 't', nivel: 'presidente', permissoes: {} } as any, {});
    expect(r.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem a permissão, recusa antes de ler o banco; o gerente com a permissão passa', async () => {
    process.env.MISTER_NOTICIAS_RAMO = '1';
    const execute = jest.fn().mockResolvedValueOnce({ rows: [{ ramo: 'food_service' }] }).mockResolvedValueOnce({ rows: [] });
    const sem = await consultarNoticias({ execute } as any, { tenantId: 't', nivel: 'gerente', permissoes: { noticias_ramo: false } } as any, {}, '2026-11-23');
    expect(sem).toEqual({ ok: false, dados: { erro: expect.stringContaining('Notícias do ramo') } });
    expect(execute).not.toHaveBeenCalled();
    const com = await consultarNoticias({ execute } as any, { tenantId: 't', nivel: 'gerente', permissoes: { noticias_ramo: true } } as any, {}, '2026-11-23');
    expect(com.ok).toBe(true);
  });

  it('o pedido: padrão de 7 dias contando hoje; assunto e dias fora da lista são recusados', () => {
    expect(pedidoDasNoticias({}, '2026-11-23')).toEqual({ assunto: null, de: '2026-11-17', ate: '2026-11-23' });
    expect(pedidoDasNoticias({ dias: 1, assunto: 'novidades' }, '2026-11-23')).toEqual({ assunto: 'novidades', de: '2026-11-23', ate: '2026-11-23' });
    for (const en of [{ dias: 0 }, { dias: DIAS_DAS_NOTICIAS_MAX + 1 }, { dias: 1.5 }, { dias: 'x' }, { assunto: 'futebol' }]) expect(pedidoDasNoticias(en, '2026-11-23')).toEqual({ erro: expect.any(String) });
  });

  it('junta os dias sem repetir, da mais nova para a mais velha, com o aviso e a fonte; o link fica na tela do Regem', () => {
    const r: any = montarNoticias(
      [
        boletim({ destaques: [noticia('2', 'impostos', '2026-11-21T10:00:00.000Z', { emDiscussao: true, aviso: 'Em discussão no Congresso: ainda não é lei.' })] }),
        boletim({ dia: '2026-11-22', novidades: [noticia('3', 'tendencias', '2026-11-22T10:00:00.000Z')], mais: [noticia('2', 'impostos', '2026-11-21T10:00:00.000Z')] }),
      ],
      P,
    );
    expect(r.total).toBe(2);
    expect(r.noticias.map((n: any) => n.titulo)).toEqual(['Notícia 3', 'Notícia 2']);
    expect(r.noticias[1]).toMatchObject({ emDiscussao: true, aviso: 'Em discussão no Congresso: ainda não é lei.', fonte: 'Fonte: teste' });
    // O filtro de saída tira todo link: o modelo não recebe o endereço; recebe o id, que `abrir_no_regem` troca pelo link.
    expect(JSON.stringify(r)).not.toContain('https://');
    expect(r.noticias.map((n: any) => n.id)).toEqual(['3', '2']);
    expect(r.cuidado).toBe(CUIDADO_DAS_NOTICIAS);
    expect(r.cuidado).toContain('Relatórios › Notícias do ramo');
    expect(r.periodo).toBe('de 17/11 a 23/11');
  });

  it('o assunto filtra; "novidades" junta tendências, tecnologia e plataformas; sem nada, diz que não há', () => {
    const copia = boletim({
      destaques: [noticia('1', 'impostos', '2026-11-23T10:00:00.000Z')],
      novidades: [noticia('2', 'tendencias', '2026-11-22T10:00:00.000Z'), noticia('3', 'plataformas', '2026-11-22T09:00:00.000Z')],
      mais: [noticia('4', 'tecnologia', '2026-11-21T09:00:00.000Z')],
    });
    expect((montarNoticias([copia], { ...P, assunto: 'impostos' }) as any).noticias.map((n: any) => n.titulo)).toEqual(['Notícia 1']);
    expect((montarNoticias([copia], { ...P, assunto: 'novidades' }) as any).total).toBe(3);
    expect((montarNoticias([copia], { ...P, assunto: 'trabalho' }) as any).semNoticias).toEqual(expect.stringContaining('sem inventar'));
  });

  it('os indicadores vão sem assunto e em economia; a lista tem teto, e o total diz quantas havia', () => {
    const indicadores = [{ id: 'selic', nome: 'Selic (meta)', valor: 13.75, unidade: '% ao ano', referencia: '2026-11-23', acumulado12Meses: null, mudou: false, credito: 'Fonte: Banco Central do Brasil' }];
    const muitas = Array.from({ length: NOTICIAS_NA_RESPOSTA + 5 }, (_, i) => noticia(String(i), 'economia', `2026-11-2${i % 3}T10:00:00.000Z`));
    const r: any = montarNoticias([boletim({ indicadores, mais: muitas })], { ...P, assunto: 'economia' });
    expect(r.indicadores).toEqual([{ nome: 'Selic (meta)', valor: '13,75%', unidade: 'ao ano', referencia: '2026-11-23', fonte: 'Fonte: Banco Central do Brasil' }]);
    expect([r.total, r.mostrando, r.noticias.length]).toEqual([NOTICIAS_NA_RESPOSTA + 5, NOTICIAS_NA_RESPOSTA, NOTICIAS_NA_RESPOSTA]);
    expect((montarNoticias([boletim({ indicadores })], { ...P, assunto: 'impostos' }) as any).indicadores).toBeUndefined();
  });
});
