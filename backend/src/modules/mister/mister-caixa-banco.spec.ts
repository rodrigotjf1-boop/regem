import { mesesCompletos } from './mister-analises';
import { caixaPeloBanco, indicadorDeCaixaPeloBanco, oQueFaltaNoBanco, periodosCobrem, temBuracoComVenda, type DiaDoExtrato, type LeituraDoCaixa } from './mister-caixa-banco';

// O caixa pelo extrato (R2 da versão 8): os números do protótipo, e cada caso em que a conta NÃO pode sair.

const HOJE = '2026-11-23';
const MESES = mesesCompletos(HOJE, 3);

/** Um lançamento a cada 3 dias, com o saldo do mês dividido entre eles. */
function diasDoMes(contaId: string, de: string, ate: string, entrou: number, saiu: number): DiaDoExtrato[] {
  const dias: string[] = [];
  const fim = Number(ate.slice(8, 10));
  for (let d = 1; d <= fim; d += 3) dias.push(`${de.slice(0, 8)}${String(d).padStart(2, '0')}`);
  return dias.map((dia, i) => ({ contaId, dia, entrouCentavos: i === 0 ? entrou : 0, saiuCentavos: i === 0 ? saiu : 0 }));
}

function leitura(sobras: [number, number][], o: Partial<LeituraDoCaixa> = {}): LeituraDoCaixa {
  return {
    lojas: [{ id: 'L1', nome: 'Centro' }],
    contas: [{ id: 'C1', unidadeId: 'L1', final: '7654', saldoCentavos: 3842000, saldoEm: '2026-11-22' }],
    periodos: [{ contaId: 'C1', de: '2026-08-01', ate: '2026-11-22' }],
    dias: MESES.flatMap((m, i) => diasDoMes('C1', m.de, m.ate, sobras[i][0], sobras[i][1])),
    vendas: [],
    ...o,
  };
}

const ENCOLHENDO: [number, number][] = [[1000000, 1650000], [1000000, 1570000], [1000000, 1655000]];
const GERANDO: [number, number][] = [[1214000, 1000000], [1138000, 1000000], [1301000, 1000000]];

describe('o caixa pelo extrato do banco', () => {
  it('a conta do protótipo: encolhe R$ 6.250 por mês e dura cerca de 6,1 meses', () => {
    const r = caixaPeloBanco(leitura(ENCOLHENDO), MESES, HOJE);
    expect(r.pronto).toBe(true);
    const i: any = indicadorDeCaixaPeloBanco(r, null, HOJE);
    expect(i).toMatchObject({ fonte: 'extrato do banco', situacao: 'caixa_encolhendo', mediaPorMes: -6250, burnRate: 6250, runwayEmMeses: 6.1 });
    expect(i.saldo).toEqual({ valor: 38420, em: '22/11', origem: 'do extrato do banco' });
    expect(i.mesesNoBanco.map((m: any) => [m.mes, m.sobrouOuFaltou])).toEqual([['agosto', -6500], ['setembro', -5700], ['outubro', -6550]]);
    expect(i.foraDaConta).toContain('não sendo da loja');
  });

  it('loja que gera caixa não tem runway', () => {
    const i: any = indicadorDeCaixaPeloBanco(caixaPeloBanco(leitura(GERANDO), MESES, HOJE), null, HOJE);
    expect(i).toMatchObject({ situacao: 'gerando_caixa', mediaPorMes: 2176.67, burnRate: null, runwayEmMeses: null });
    expect(i.porQueNaoTemRunway).toContain('não faz sentido');
  });

  it('o runway arredonda para baixo; saldo zerado ou negativo dá 0 e avisa', () => {
    const conta = (saldoCentavos: number) => [{ id: 'C1', unidadeId: 'L1', final: '7654', saldoCentavos, saldoEm: '2026-11-22' }];
    expect((indicadorDeCaixaPeloBanco(caixaPeloBanco(leitura(ENCOLHENDO, { contas: conta(1249999) }), MESES, HOJE), null, HOJE) as any).runwayEmMeses).toBe(1.9);
    const negativo: any = indicadorDeCaixaPeloBanco(caixaPeloBanco(leitura(ENCOLHENDO, { contas: conta(-5000) }), MESES, HOJE), null, HOJE);
    expect(negativo.runwayEmMeses).toBe(0);
    expect(negativo.avisos[0]).toContain('zerado ou negativo');
  });

  it('saldo velho: o burn rate sai, o runway não, e diz o que falta', () => {
    const r = caixaPeloBanco(leitura(ENCOLHENDO, { contas: [{ id: 'C1', unidadeId: 'L1', final: '7654', saldoCentavos: 3842000, saldoEm: '2026-11-10' }] }), MESES, HOJE);
    const i: any = indicadorDeCaixaPeloBanco(r, null, HOJE);
    expect(i).toMatchObject({ burnRate: 6250, runwayEmMeses: null, saldo: null });
    expect(i.oQueFalta[0]).toContain('10/11');
  });

  it('sem saldo válido no extrato, usa o informado na conversa e diz de onde veio', () => {
    const r = caixaPeloBanco(leitura(ENCOLHENDO, { contas: [{ id: 'C1', unidadeId: 'L1', final: '7654', saldoCentavos: null, saldoEm: null }] }), MESES, HOJE);
    const i: any = indicadorDeCaixaPeloBanco(r, { centavos: 1250000, dia: '2026-11-22' }, HOJE);
    expect(i.runwayEmMeses).toBe(2);
    expect(i.saldo.origem).toBe('veio de você, não do banco');
  });

  it('sem extrato: diz o que falta, com os meses e onde importar', () => {
    const r = caixaPeloBanco({ lojas: [], contas: [], periodos: [], dias: [], vendas: [] }, MESES, HOJE);
    expect(r.pronto).toBe(false);
    expect(r.faltam[0]).toContain('agosto, setembro e outubro');
    expect(r.faltam[0]).toContain('Financeiro › Banco e repasses');
    expect(oQueFaltaNoBanco(r).porQueNaoTemRunway).toContain('3 meses');
  });

  it('um mês que o arquivo não cobre: não calcula e diz qual', () => {
    const r = caixaPeloBanco(leitura(ENCOLHENDO, { periodos: [{ contaId: 'C1', de: '2026-09-01', ate: '2026-11-22' }] }), MESES, HOJE);
    expect(r.pronto).toBe(false);
    expect(r.meses.map((m) => m.nome)).toEqual(['setembro', 'outubro']);
    expect(r.faltam).toHaveLength(1);
    expect(r.faltam[0]).toContain('agosto');
    expect(oQueFaltaNoBanco(r).mesesNoBanco).toHaveLength(2);
  });

  it('buraco com venda no meio do mês: incompleto; o mesmo buraco com a loja fechada: completo', () => {
    const semOutubroDoMeio = leitura(ENCOLHENDO);
    semOutubroDoMeio.dias = semOutubroDoMeio.dias.filter((d) => !(d.dia >= '2026-10-08' && d.dia <= '2026-10-20'));
    expect(caixaPeloBanco(semOutubroDoMeio, MESES, HOJE).pronto).toBe(true);
    const comVenda = { ...semOutubroDoMeio, vendas: [{ unidadeId: 'L1', dia: '2026-10-12' }] };
    const r = caixaPeloBanco(comVenda, MESES, HOJE);
    expect(r.pronto).toBe(false);
    expect(r.faltam[0]).toContain('outubro');
    // Venda sem loja vale para todas (V4).
    expect(caixaPeloBanco({ ...semOutubroDoMeio, vendas: [{ unidadeId: null, dia: '2026-10-12' }] }, MESES, HOJE).pronto).toBe(false);
    // Venda de outra loja, não.
    expect(caixaPeloBanco({ ...semOutubroDoMeio, vendas: [{ unidadeId: 'L2', dia: '2026-10-12' }] }, MESES, HOJE).pronto).toBe(true);
  });

  it('empresa com duas lojas: soma as duas, e sem a conta de uma não calcula', () => {
    const base = leitura(ENCOLHENDO);
    const duas: LeituraDoCaixa = {
      ...base,
      lojas: [{ id: 'L1', nome: 'Centro' }, { id: 'L2', nome: 'Barra' }],
      contas: [...base.contas, { id: 'C2', unidadeId: 'L2', final: '1111', saldoCentavos: 158000, saldoEm: '2026-11-21' }],
      periodos: [...base.periodos, { contaId: 'C2', de: '2026-08-01', ate: '2026-11-21' }],
      dias: [...base.dias, ...MESES.flatMap((m) => diasDoMes('C2', m.de, m.ate, 100000, 100000))],
    };
    const r = caixaPeloBanco(duas, MESES, HOJE);
    expect(r.pronto).toBe(true);
    expect(r.saldo).toEqual({ centavos: 4000000, dia: '2026-11-21' });

    const faltaUma = caixaPeloBanco({ ...base, lojas: duas.lojas }, MESES, HOJE);
    expect(faltaUma.pronto).toBe(false);
    expect(faltaUma.saldo).toBeNull();
    expect(faltaUma.faltam[0]).toContain('Barra');

    const semOutubroNaBarra = caixaPeloBanco({ ...duas, periodos: [base.periodos[0], { contaId: 'C2', de: '2026-08-01', ate: '2026-09-30' }] }, MESES, HOJE);
    expect(semOutubroNaBarra.pronto).toBe(false);
    expect(semOutubroNaBarra.faltam[0]).toContain('outubro de Barra');
  });

  it('os arquivos juntos cobrem o mês, dia a dia', () => {
    expect(periodosCobrem([{ de: '2026-10-01', ate: '2026-10-15' }, { de: '2026-10-16', ate: '2026-10-31' }], '2026-10-01', '2026-10-31')).toBe(true);
    expect(periodosCobrem([{ de: '2026-10-16', ate: '2026-11-02' }, { de: '2026-09-20', ate: '2026-10-15' }], '2026-10-01', '2026-10-31')).toBe(true);
    expect(periodosCobrem([{ de: '2026-10-01', ate: '2026-10-15' }, { de: '2026-10-17', ate: '2026-10-31' }], '2026-10-01', '2026-10-31')).toBe(false);
    expect(periodosCobrem([{ de: '2026-10-02', ate: '2026-10-31' }], '2026-10-01', '2026-10-31')).toBe(false);
    expect(periodosCobrem([{ de: '2026-10-01', ate: '2026-10-30' }], '2026-10-01', '2026-10-31')).toBe(false);
    expect(periodosCobrem([], '2026-10-01', '2026-10-31')).toBe(false);
  });

  it('o buraco: só com 5 dias ou mais e venda dentro dele', () => {
    const comLancamento = new Set(['2026-10-01', '2026-10-07']);
    expect(temBuracoComVenda(comLancamento, new Set(['2026-10-03']), '2026-10-01', '2026-10-07')).toBe(true);
    expect(temBuracoComVenda(comLancamento, new Set(), '2026-10-01', '2026-10-07')).toBe(false);
    expect(temBuracoComVenda(new Set(['2026-10-01', '2026-10-06']), new Set(['2026-10-03']), '2026-10-01', '2026-10-06')).toBe(false);
  });
});
