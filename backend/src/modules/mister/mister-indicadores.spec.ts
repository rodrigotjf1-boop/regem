import { custoTotalFicha, type FichaCusto } from '../../common/regras-negocio';
import { ACOES, centavosDoDado, conferirAcao, ehDadoInformado, lerDiaDoSaldo, resumoDoDado, sigaDaAcao, textoDoDadoGuardado } from './mister-acoes';
import { FERRAMENTAS, FERRAMENTAS_DA_ANALISE, INSTRUCOES_DO_MISTER, ehConsulta, podeRodarJunto } from './mister-agente.regras';
import {
  FOCOS_DOS_INDICADORES,
  calculadoraDeFichas,
  classificarSaidas,
  contarCusto,
  diasEntreDatas,
  indicadorDeCaixa,
  indicadorDeInadimplencia,
  indicadorDeMargem,
  indicadorDePrazo,
  indicadorDeRoi,
  indicadorSemDado,
  mesAnteriorInteiro,
  oQueFaltaNoCusto,
  saldoVale,
  type CadastroDeCusto,
  type ContaDoCusto,
  type FichaDoCusto,
  type GrupoDeVenda,
  type LinhaDaFicha,
} from './mister-indicadores';
import { RECUSAS_DA_MEMORIA, conferirMemoria } from './mister-memoria';
import { responderComFerramentas } from './mister-laco';
import { lerPassos } from './mister-plano';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linha = (o: Partial<LinhaDaFicha> & { nome: string }): LinhaDaFicha => ({ quantidade: 1, fatorCorrecao: 1, custoGravado: 0, itemId: null, subFichaId: null, fichaDoItemId: null, ...o });
const ficha = (linhas: LinhaDaFicha[], o: Partial<FichaDoCusto> = {}): FichaDoCusto => ({ rendimento: 1, margemPerda: 0, linhas, ...o });
const semItem = () => 0;
const calc = (fichas: Record<string, FichaDoCusto>, custoDoItem: (i: string, u: string | null) => number = semItem, mesma = false) =>
  calculadoraDeFichas(new Map(Object.entries(fichas)), custoDoItem, mesma);

describe('o custo da ficha: ingrediente sem custo não é custo zero', () => {
  it('com custo em tudo, dá a mesma conta da tela (custoTotalFicha), com fator, margem de perda, sub-receita e rendimento', () => {
    const fichas = {
      a: ficha(
        [linha({ nome: 'Carne', quantidade: 0.12, fatorCorrecao: 1.1, custoGravado: 40 }), linha({ nome: 'Molho', quantidade: 0.5, subFichaId: 'b' }), linha({ nome: 'Caixa', quantidade: 1, custoGravado: 1.5, somenteDelivery: true })],
        { rendimento: 2, margemPerda: 5 },
      ),
      b: ficha([linha({ nome: 'Tomate', quantidade: 2, custoGravado: 6 })], { rendimento: 4 }),
    };
    const mapa: Record<string, FichaCusto> = Object.fromEntries(
      Object.entries(fichas).map(([id, f]) => [
        id,
        {
          rendimento: f.rendimento,
          margemPerda: f.margemPerda,
          ingredientes: f.linhas.map((l) => ({ quantidade: l.quantidade, fatorCorrecao: l.fatorCorrecao, custoUnitario: l.custoGravado, subFichaId: l.subFichaId, fichaDoItemId: l.fichaDoItemId, somenteDelivery: !!l.somenteDelivery, somenteBalcao: !!l.somenteBalcao })),
        },
      ]),
    );
    const c = calc(fichas);
    for (const canal of ['balcao', 'delivery', 'nenhum'] as const) {
      const r = c('a', canal, null);
      expect(r.completo).toBe(true);
      expect(r.custo).toBeCloseTo(custoTotalFicha('a', mapa, canal, false), 9);
      expect(r.porPorcao).toBeCloseTo(custoTotalFicha('a', mapa, canal, false) / 2, 9);
    }
  });

  it('um ingrediente sem custo deixa a ficha incompleta, e diz qual; a conta antiga daria só o que tem custo', () => {
    const r = calc({ a: ficha([linha({ nome: 'Carne', custoGravado: 10 }), linha({ nome: 'Queijo' })]) })('a', 'balcao', null);
    expect(r).toMatchObject({ completo: false, custo: 0, faltam: ['Queijo'] });
  });

  it('a falta dentro da sub-receita também tira o produto, e aponta o ingrediente lá de dentro', () => {
    const c = calc({ a: ficha([linha({ nome: 'Carne', custoGravado: 10 }), linha({ nome: 'Molho', subFichaId: 'b' })]), b: ficha([linha({ nome: 'Tomate' })]) });
    expect(c('a', 'balcao', null)).toMatchObject({ completo: false, faltam: ['Tomate'] });
  });

  it('sub-receita apagada, ficha sem linhas e fator zero não viram custo zero', () => {
    expect(calc({ a: ficha([linha({ nome: 'Molho', subFichaId: 'sumiu' })]) })('a', 'balcao', null).completo).toBe(false);
    expect(calc({ a: ficha([]) })('a', 'balcao', null).completo).toBe(false);
    expect(calc({ a: ficha([linha({ nome: 'Carne', custoGravado: 10, fatorCorrecao: 0 })]) })('a', 'balcao', null).completo).toBe(false);
  });

  it('linha sem quantidade não consome nada e não pede custo', () => {
    expect(calc({ a: ficha([linha({ nome: 'Carne', custoGravado: 10 }), linha({ nome: 'Enfeite', quantidade: 0 })]) })('a', 'balcao', null)).toMatchObject({ completo: true, custo: 10 });
  });

  it('a embalagem de outro canal não pede custo; a do canal, pede', () => {
    const c = calc({ a: ficha([linha({ nome: 'Carne', custoGravado: 10 }), linha({ nome: 'Caixa', somenteDelivery: true })]) });
    expect(c('a', 'balcao', null).completo).toBe(true);
    expect(c('a', 'delivery', null)).toMatchObject({ completo: false, faltam: ['Caixa'] });
  });

  it('ciclo de sub-receita não trava: fica incompleta', () => {
    const c = calc({ a: ficha([linha({ nome: 'b', subFichaId: 'b', custoGravado: 5 })]), b: ficha([linha({ nome: 'a', subFichaId: 'a', custoGravado: 5 })]) });
    expect(c('a', 'balcao', null).completo).toBe(false);
    expect(c('b', 'balcao', null).completo).toBe(false);
    const auto = calc({ x: ficha([linha({ nome: 'x', subFichaId: 'x' })]) });
    expect(auto('x', 'balcao', null).completo).toBe(false);
  });

  it('receita muito aninhada e repetida calcula uma vez cada (sem explosão)', () => {
    const fichas: Record<string, FichaDoCusto> = { f0: ficha([linha({ nome: 'base', custoGravado: 1 })]) };
    for (let i = 1; i <= 40; i++) fichas[`f${i}`] = ficha([linha({ nome: 'a', subFichaId: `f${i - 1}` }), linha({ nome: 'b', subFichaId: `f${i - 1}` })]);
    const inicio = Date.now();
    expect(calc(fichas)('f40', 'balcao', null).custo).toBe(2 ** 40);
    expect(Date.now() - inicio).toBeLessThan(500);
  });

  it('a linha do estoque usa o custo médio de hoje, da loja; sem ele, o gravado', () => {
    const custo = (i: string, u: string | null) => (i === 'bacon' ? (u === 'L1' ? 30 : 20) : 0);
    const f = { a: ficha([linha({ nome: 'Bacon', itemId: 'bacon', custoGravado: 5 })]), b: ficha([linha({ nome: 'Ovo', itemId: 'ovo', custoGravado: 2 })]), c: ficha([linha({ nome: 'Sal', itemId: 'sal' })]) };
    const c = calc(f, custo);
    expect(c('a', 'balcao', 'L1').custo).toBe(30);
    expect(c('a', 'balcao', null).custo).toBe(20);
    expect(c('b', 'balcao', null).custo).toBe(2);
    expect(c('c', 'balcao', null).completo).toBe(false);
  });

  it('item feito na loja: vale a ficha dele; ficha pela metade tira; ficha sem custo nenhum cai no custo do item', () => {
    const fichas = {
      pronta: ficha([linha({ nome: 'Farinha', custoGravado: 4 })], { rendimento: 2 }),
      metade: ficha([linha({ nome: 'Farinha', custoGravado: 4 }), linha({ nome: 'Ovo' })]),
      vazia: ficha([linha({ nome: 'Ovo' })]),
      a: ficha([linha({ nome: 'Massa', itemId: 'm1', fichaDoItemId: 'pronta', custoGravado: 99 })]),
      b: ficha([linha({ nome: 'Massa', itemId: 'm2', fichaDoItemId: 'metade', custoGravado: 99 })]),
      c: ficha([linha({ nome: 'Massa', itemId: 'm3', fichaDoItemId: 'vazia', custoGravado: 7 })]),
    };
    const c = calc(fichas);
    expect(c('a', 'balcao', null).custo).toBe(2);
    expect(c('b', 'balcao', null)).toMatchObject({ completo: false, faltam: ['Ovo'] });
    expect(c('c', 'balcao', null).custo).toBe(7);
  });
});

const cadastro = (extra: Partial<CadastroDeCusto> = {}): CadastroDeCusto => ({
  produtos: new Map([
    ['ok', { nome: 'Smash', tipo: 'simples', fichaId: 'fok', precoCusto: null }],
    ['falta', { nome: 'Batata', tipo: 'simples', fichaId: 'ffalta', precoCusto: null }],
    ['semficha', { nome: 'Água', tipo: 'simples', fichaId: null, precoCusto: null }],
    ['manual', { nome: 'Refri', tipo: 'simples', fichaId: null, precoCusto: 2.5 }],
    ['zero', { nome: 'Suco', tipo: 'simples', fichaId: null, precoCusto: 0 }],
    ['combo', { nome: 'Combo', tipo: 'combo', fichaId: 'fok', precoCusto: null }],
  ]),
  fatores: new Map([['grande', 1.5]]),
  custoDaFicha: calc({ fok: ficha([linha({ nome: 'Carne', custoGravado: 4 })]), ffalta: ficha([linha({ nome: 'Óleo' })]) }),
  ...extra,
});
const grupo = (o: Partial<GrupoDeVenda> & { produtoId: string | null; centavos: number }): GrupoDeVenda => ({ variacaoId: null, unidadeId: null, canal: 'balcao', comAdicional: false, descricao: 'Item', quantidade: 1, ...o });

describe('a venda com custo', () => {
  it('separa o que tem custo do que não tem, em centavos', () => {
    const c = contarCusto([grupo({ produtoId: 'ok', quantidade: 2, centavos: 2000 }), grupo({ produtoId: 'falta', centavos: 1000 }), grupo({ produtoId: 'manual', quantidade: 2, centavos: 1000 })], cadastro());
    expect(c).toMatchObject({ cobertoCentavos: 3000, custoCentavos: 800 + 500, semCustoCentavos: 1000, insumosSemCusto: ['Óleo'] });
  });

  it('preço de custo zero é "não informado", combo sem preço de custo e item solto ficam fora', () => {
    const c = contarCusto([grupo({ produtoId: 'zero', centavos: 100 }), grupo({ produtoId: 'combo', centavos: 200 }), grupo({ produtoId: null, descricao: 'Avulso', centavos: 300 }), grupo({ produtoId: 'semficha', centavos: 50 })], cadastro());
    expect(c.cobertoCentavos).toBe(0);
    expect(c.faltam.map((x) => [x.nome, x.motivo])).toEqual([['Avulso', 'sem_cadastro'], ['Combo', 'combo'], ['Suco', 'sem_ficha'], ['Água', 'sem_ficha']]);
  });

  it('a variação multiplica a ficha; com preço de custo à mão não dá para saber o tamanho, e fica fora', () => {
    const c = contarCusto([grupo({ produtoId: 'ok', variacaoId: 'grande', centavos: 1000 })], cadastro());
    expect(c).toMatchObject({ cobertoCentavos: 1000, custoCentavos: 600 });
    expect(contarCusto([grupo({ produtoId: 'manual', variacaoId: 'grande', centavos: 1000 })], cadastro()).faltam[0].motivo).toBe('variacao');
    expect(contarCusto([grupo({ produtoId: 'ok', variacaoId: 'sumiu', centavos: 1000 })], cadastro()).faltam[0].motivo).toBe('variacao');
  });

  it('a linha com adicional pago fica fora: o preço dele está na linha e o custo não', () => {
    expect(contarCusto([grupo({ produtoId: 'ok', comAdicional: true, centavos: 1000 })], cadastro())).toMatchObject({ cobertoCentavos: 0, semCustoCentavos: 1000 });
  });

  it('o combo com produtos custa a soma deles (ficha completa, custo à mão, lata do estoque); faltando um, fica fora', () => {
    const comCombo = (partes: Array<[string, number]>) =>
      cadastro({
        produtos: new Map([
          ...cadastro().produtos,
          ['lata', { nome: 'Lata', tipo: 'simples', fichaId: null, precoCusto: null, itemId: 'item-lata', itemFator: 1 }],
        ]),
        produtosDosCombos: new Map([['combo', partes.map(([produtoId, quantidade]) => ({ produtoId, quantidade }))]]),
        custoDoItem: (itemId) => (itemId === 'item-lata' ? 2.25 : 0),
      });
    // Smash (ficha: 4) + 2 × Refri (à mão: 2,50) + Lata (estoque: 2,25) = 11,25.
    const c = contarCusto([grupo({ produtoId: 'combo', quantidade: 2, centavos: 5000 })], comCombo([['ok', 1], ['manual', 2], ['lata', 1]]));
    expect(c).toMatchObject({ cobertoCentavos: 5000, custoCentavos: 2250, semCustoCentavos: 0 });
    // A batata com a ficha incompleta deixa o combo sem custo — nunca a soma parcial.
    const falta = contarCusto([grupo({ produtoId: 'combo', centavos: 3000 })], comCombo([['ok', 1], ['falta', 1]]));
    expect(falta).toMatchObject({ cobertoCentavos: 0, semCustoCentavos: 3000 });
    expect(falta.faltam[0]).toMatchObject({ nome: 'Combo', motivo: 'combo' });
    // Custo zero à mão no produto do combo é "não informado" aqui, como no resto desta conta.
    expect(contarCusto([grupo({ produtoId: 'combo', centavos: 100 })], comCombo([['zero', 1]])).faltam[0].motivo).toBe('combo');
    // Variação de combo: não dá para saber o tamanho.
    expect(contarCusto([grupo({ produtoId: 'combo', variacaoId: 'grande', centavos: 100 })], comCombo([['ok', 1]])).faltam[0].motivo).toBe('variacao');
    // A frase diz o que fazer.
    expect(oQueFaltaNoCusto(falta).join(' ')).toContain('a soma dos produtos dele');
  });

  it('o que falta traz os produtos, os ingredientes e o caminho do menu', () => {
    const t = oQueFaltaNoCusto(contarCusto([grupo({ produtoId: 'falta', centavos: 1000 }), grupo({ produtoId: 'semficha', centavos: 500 }), grupo({ produtoId: 'combo', centavos: 100 })], cadastro())).join(' ');
    expect(t).toContain('Batata');
    expect(t).toContain('Óleo');
    expect(t).toContain('Ingrediente sem custo não é custo zero');
    expect(t).toContain('Estoque › aba "Recebimento", botão "Nota avulsa"');
    expect(t).toContain('Estoque › aba "Fichas técnicas", botão "Nova ficha"');
    expect(t).toContain('Cadastros › Cardápio');
  });
});

const conta = (o: Partial<ContaDoCusto>): ContaDoCusto => ({ cobertoCentavos: 0, custoCentavos: 0, semCustoCentavos: 0, faltam: [], insumosSemCusto: [], ...o });

describe('margem bruta e CMV', () => {
  it('cobertura zero: sem número, com o que falta. Nunca 100% nem R$ 0', () => {
    const r: any = indicadorDeMargem({ vendaOficialCentavos: 100000, pedidos: 10, conta: conta({ semCustoCentavos: 90000, faltam: [{ nome: 'Smash', motivo: 'ficha_incompleta', centavos: 90000 }], insumosSemCusto: ['Carne'] }) });
    expect(r).toMatchObject({ semDados: true, margemBruta: null, cmv: null, cobertura: { partePct: 0, vendaComCustoCompleto: 0 } });
    expect(JSON.stringify(r.oQueFalta)).toContain('Smash');
    expect(r.parcial).toBeUndefined();
  });

  it('a conta, sobre a parte com custo, e a cobertura sobre a venda oficial', () => {
    const r: any = indicadorDeMargem({ vendaOficialCentavos: 100000, pedidos: 10, conta: conta({ cobertoCentavos: 80000, custoCentavos: 27360 }) });
    expect(r).toMatchObject({ parcial: false, margemBruta: { pct: 65.8, valor: 526.4 }, cmv: { pct: 34.2, valor: 273.6 }, cobertura: { partePct: 80 } });
    expect(r.comoContei).toContain('custo de HOJE');
    expect(r.avisos[0]).toContain('80%');
  });

  it('abaixo de 50%: parcial e sem comparar, mesmo com o mês anterior bom', () => {
    const anterior = { rotulo: 'setembro', vendaOficialCentavos: 100000, conta: conta({ cobertoCentavos: 90000, custoCentavos: 30000 }) };
    const r: any = indicadorDeMargem({ vendaOficialCentavos: 100000, pedidos: 10, conta: conta({ cobertoCentavos: 49900, custoCentavos: 10000 }), anterior });
    expect(r.parcial).toBe(true);
    expect(r.comparacao).toBeNull();
    expect(r.avisos[0]).toContain('PARCIAL');
  });

  it('compara só com os dois acima de 50%, como diferença, sem atribuir a insumo', () => {
    const boa = { rotulo: 'setembro', vendaOficialCentavos: 100000, conta: conta({ cobertoCentavos: 90000, custoCentavos: 27000 }) };
    const r: any = indicadorDeMargem({ vendaOficialCentavos: 100000, pedidos: 10, conta: conta({ cobertoCentavos: 90000, custoCentavos: 30000 }), anterior: boa });
    expect(r.comparacao).toMatchObject({ periodo: 'setembro', margemPct: 70, diferencaDaMargemEmPontos: -3.3 });
    expect(r.comparacao.observacao).toContain('Não atribua a nenhum insumo');
    const fraca = { ...boa, conta: conta({ cobertoCentavos: 40000, custoCentavos: 10000 }) };
    const s: any = indicadorDeMargem({ vendaOficialCentavos: 100000, pedidos: 10, conta: conta({ cobertoCentavos: 90000, custoCentavos: 30000 }), anterior: fraca });
    expect(s.comparacao).toBeNull();
  });

  it('sem venda, diz que não há venda', () => {
    expect(indicadorDeMargem({ vendaOficialCentavos: 0, pedidos: 0, conta: conta({}) })).toMatchObject({ semDados: true });
  });

  it('o mês inteiro compara com o mês anterior inteiro', () => {
    expect(mesAnteriorInteiro('2026-10-01', '2026-10-31')).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
    expect(mesAnteriorInteiro('2026-03-01', '2026-03-31')).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
    expect(mesAnteriorInteiro('2026-10-01', '2026-10-30')).toBeNull();
    expect(mesAnteriorInteiro('2026-10-02', '2026-10-31')).toBeNull();
    expect(mesAnteriorInteiro('2026-10-01', '2026-11-30')).toBeNull();
  });
});

describe('inadimplência e prazo', () => {
  const l = { abertas: 11, totalCentavos: 842000, vencidas: 3, vencidoCentavos: 118000, maisAntiga: '2026-10-12' };
  it('o vencido sobre o aberto, quantas contas e a mais antiga, e aponta a tela para os nomes', () => {
    const r: any = indicadorDeInadimplencia(l, '2026-11-22', true);
    expect(r).toMatchObject({ inadimplenciaPct: 14, vencido: 1180, totalAReceber: 8420, contasVencidas: 3, contasEmAberto: 11, diasDaMaisAntiga: 41 });
    expect(r.ondeVer).toContain('Financeiro › Contas a pagar');
  });
  it('quem não vê valores recebe as contagens, sem R$ e sem percentual', () => {
    expect(indicadorDeInadimplencia(l, '2026-11-22', false)).toMatchObject({ inadimplenciaPct: null, vencido: null, totalAReceber: null, contasVencidas: 3 });
  });
  it('sem conta a receber: falta dado, não "0% de inadimplência"', () => {
    const r: any = indicadorDeInadimplencia({ abertas: 0, totalCentavos: 0, vencidas: 0, vencidoCentavos: 0, maisAntiga: null }, '2026-11-22', true);
    expect(r.semDados).toBe(true);
    expect(r.inadimplenciaPct).toBeUndefined();
    expect(r.oQueFalta[0]).toContain('Cadastrar conta');
  });
  it('prazo: com menos de 3 contas pagas, é pouco para concluir e não compara', () => {
    const r: any = indicadorDePrazo({ titulos: 2, mediaDias: 10 }, { titulos: 5, mediaDias: 20, rotulo: 'antes' });
    expect(r.prazoMedioDias).toBe(10);
    expect(r.avisos[0]).toContain('pouco para concluir');
    expect(r.comparacao).toBeNull();
    expect(indicadorDePrazo({ titulos: 3, mediaDias: 18 }, { titulos: 4, mediaDias: 21, rotulo: 'antes' })).toMatchObject({ comparacao: { diferencaEmDias: -3 } });
    expect(indicadorDePrazo({ titulos: 0, mediaDias: null }, null)).toMatchObject({ semDados: true });
  });
});

describe('caixa', () => {
  const mes = { de: '2026-10-01', ate: '2026-10-31', nome: 'outubro' };
  const hoje = '2026-11-16';
  it('a conta do protótipo: R$ 42.300 cobrem 8 dias de R$ 152.400', () => {
    const r: any = indicadorDeCaixa({ saldo: { centavos: 4230000, dia: hoje }, folha: { centavos: 2400000, dia: hoje }, saidas: [{ categoria: 'aluguel', centavos: 12840000 }], mes, hoje });
    expect(r.diasQueOSaldoCobre).toBe(8);
    expect(r.saidasDoMes.comAFolhaInformada).toBe(152400);
    expect(r).toMatchObject({ burnRate: null, runwayEmMeses: null });
    expect(r.porQueNaoTemRunway).toContain('repasses');
    expect(r.semDados).toBeUndefined();
  });
  it('sangria, estorno e venda não são despesa; folha lançada não soma com a informada', () => {
    expect(classificarSaidas([{ categoria: 'Sangria', centavos: 100 }, { categoria: 'estorno', centavos: 200 }, { categoria: 'aluguel', centavos: 300 }, { categoria: 'Folha de pagamento', centavos: 400 }, { categoria: 'salários', centavos: 50 }, { categoria: '', centavos: 10 }, { categoria: 'pagamento_entregador', centavos: 20 }])).toEqual({
      despesasCentavos: 330,
      folhaLancadaCentavos: 450,
      foraDaContaCentavos: 300,
    });
    const r: any = indicadorDeCaixa({ saldo: { centavos: 100000, dia: hoje }, folha: { centavos: 200000, dia: hoje }, saidas: [{ categoria: 'aluguel', centavos: 100000 }, { categoria: 'folha', centavos: 180000 }], mes, hoje });
    expect(r.saidasDoMes.comAFolhaInformada).toBe(3000);
    expect(r.avisos.join(' ')).toContain('para não contar duas vezes');
  });
  it('o saldo vale 7 dias: com 8, não entra na conta e o Mister pede de novo', () => {
    expect(saldoVale('2026-11-09', hoje)).toBe(true);
    expect(saldoVale('2026-11-08', hoje)).toBe(false);
    expect(saldoVale('2026-11-17', hoje)).toBe(false);
    const r: any = indicadorDeCaixa({ saldo: { centavos: 4230000, dia: '2026-11-08' }, folha: { centavos: 2400000, dia: hoje }, saidas: [{ categoria: 'aluguel', centavos: 100000 }], mes, hoje });
    expect(r).toMatchObject({ saldo: null, diasQueOSaldoCobre: null, semDados: true });
    expect(r.oQueFalta[0]).toContain('08/11');
    expect(JSON.stringify(r)).not.toContain('42300');
  });
  it('sem folha, ou sem nenhuma despesa lançada, não conta', () => {
    expect(indicadorDeCaixa({ saldo: { centavos: 100000, dia: hoje }, folha: null, saidas: [{ categoria: 'aluguel', centavos: 100000 }], mes, hoje })).toMatchObject({ diasQueOSaldoCobre: null, semDados: true });
    expect(indicadorDeCaixa({ saldo: { centavos: 100000, dia: hoje }, folha: { centavos: 100000, dia: hoje }, saidas: [{ categoria: 'sangria', centavos: 100000 }], mes, hoje })).toMatchObject({ diasQueOSaldoCobre: null, semDados: true });
  });
  it('só entregador ou folha lançados não fecham a conta: fornecedor e aluguel faltam, e o saldo pareceria durar mais', () => {
    const so = (categoria: string): any => indicadorDeCaixa({ saldo: { centavos: 4230000, dia: hoje }, folha: { centavos: 2400000, dia: hoje }, saidas: [{ categoria, centavos: 50000 }], mes, hoje });
    for (const categoria of ['pagamento_entregador', 'folha']) {
      const r = so(categoria);
      expect(r).toMatchObject({ diasQueOSaldoCobre: null, semDados: true });
      expect(r.oQueFalta.join(' ')).toContain('fornecedor, aluguel');
    }
    expect(so('fornecedor').diasQueOSaldoCobre).not.toBeNull();
  });
  it('dias entre datas não depende do fuso', () => {
    expect(diasEntreDatas('2026-10-31', '2026-11-01')).toBe(1);
  });
});

describe('o que ainda não tem dado e o ROI', () => {
  it('margem líquida e giro: falta dado, com a lista', () => {
    expect(indicadorSemDado('margem_liquida')).toMatchObject({ semDados: true, margemLiquida: null });
    expect((indicadorSemDado('giro_de_recebiveis') as any).oQueFalta[0]).toContain('repasses');
  });

  const base = { campanha: 'SMASH10', desde: '2026-10-20', pedidos: 64, faturamentoCentavos: 384000, baseCentavos: 360000, verValores: true };
  it('a conta do protótipo: (margem − custo) ÷ custo', () => {
    const r: any = indicadorDeRoi({ ...base, baseCentavos: 384000, conta: conta({ cobertoCentavos: 384000, custoCentavos: 131300 }), custoCentavos: 30000 });
    expect(r).toMatchObject({ faturamento: 3840, custoInformado: 300, margemDasVendas: 2527, sobraDepoisDoCusto: 2227, roiPct: 742.3 });
    expect(r.limite).toContain('compraria de qualquer jeito');
  });
  it('sem custo da mercadoria não há ROI, e o faturamento não entra no lugar da margem', () => {
    const r: any = indicadorDeRoi({ ...base, conta: conta({ semCustoCentavos: 360000, faltam: [{ nome: 'Smash', motivo: 'ficha_incompleta', centavos: 360000 }] }), custoCentavos: 30000 });
    expect(r).toMatchObject({ semDados: true, roiPct: null, custoInformado: 300 });
    expect(r.margemDasVendas).toBeUndefined();
    expect(r.explica).toContain('Não use o faturamento');
  });
  it('com só parte do custo, também não', () => {
    expect(indicadorDeRoi({ ...base, conta: conta({ cobertoCentavos: 300000, custoCentavos: 100000, semCustoCentavos: 60000 }), custoCentavos: 30000 })).toMatchObject({ roiPct: null, coberturaPct: 83.3 });
  });
  it('sem o custo da campanha, pede', () => {
    const r: any = indicadorDeRoi({ ...base, conta: conta({ cobertoCentavos: 360000, custoCentavos: 100000 }), custoCentavos: null });
    expect(r).toMatchObject({ semDados: true, roiPct: null, margemDasVendas: 2600 });
    expect(r.oQueFalta[0]).toContain('Quanto foi gasto');
  });
  it('sem valores, só a quantidade de pedidos; sem pedido, diz', () => {
    const r: any = indicadorDeRoi({ ...base, verValores: false, conta: conta({ cobertoCentavos: 360000, custoCentavos: 100000 }), custoCentavos: 30000 });
    expect(r).toMatchObject({ pedidosComCupom: 64, roiPct: null });
    expect(r.faturamento).toBeUndefined();
    expect(r.margemDasVendas).toBeUndefined();
    expect(indicadorDeRoi({ ...base, pedidos: 0, conta: conta({}), custoCentavos: null })).toMatchObject({ semDados: true });
  });
});

describe('o dado informado na conversa', () => {
  const AGORA = new Date('2026-11-22T15:00:00Z');
  it('o valor passa pelo servidor: positivo, com teto e com até 2 casas (V109)', () => {
    expect(centavosDoDado(42300, 1e6)).toBe(4230000);
    expect(centavosDoDado(0.1 + 0.2 > 0 ? 19.9 : 0, 1e6)).toBe(1990);
    for (const v of [0, -1, Number.NaN, Infinity, '42300', null, undefined, 1.234, 1e6 + 1]) expect(centavosDoDado(v, 1e6)).toBeNull();
  });

  it('as ações: só o presidente, de botão, fora do plano', () => {
    for (const a of ['informar_saldo', 'informar_folha', 'informar_custo_campanha'] as const) {
      expect(ACOES[a]).toMatchObject({ nivel: 'botao', soPresidente: true, pedeVerValores: true });
      expect(ehDadoInformado(a)).toBe(true);
      expect(sigaDaAcao(a)).toContain('"Guardar" e "Corrigir"');
      const l = lerPassos([{ acao: a, valorInformado: 10 }, { acao: 'reabrir_canal', canais: ['ifood'] }]);
      expect('erro' in l && l.erro).toContain('pedido à parte');
    }
    expect(ehDadoInformado('pagar_conta')).toBe(false);
    const plano = FERRAMENTAS.find((f) => f.name === 'propor_plano')!.input_schema.properties.passos.items.properties;
    expect(plano.acao.enum).not.toContain('informar_saldo');
    expect(plano.valorInformado).toBeUndefined();
  });

  it('o saldo: a frase diz que veio da pessoa, e a data fica de hoje até 7 dias atrás', () => {
    const r = conferirAcao('informar_saldo', { valorInformado: 42300 }, AGORA);
    expect(r).toEqual({ parametros: { acao: 'informar_saldo', centavos: 4230000, dia: '2026-11-22', campanha: null }, resumo: expect.stringContaining('R$ 42.300,00') });
    expect('resumo' in r && r.resumo).toContain('Veio de você, não do banco');
    expect(conferirAcao('informar_saldo', { valorInformado: 100, dataDoSaldo: '2026-11-15' }, AGORA)).toMatchObject({ parametros: { dia: '2026-11-15' } });
    expect(conferirAcao('informar_saldo', { valorInformado: 100, dataDoSaldo: '2026-11-14' }, AGORA)).toHaveProperty('erro');
    expect(conferirAcao('informar_saldo', { valorInformado: 100, dataDoSaldo: '2026-11-23' }, AGORA)).toHaveProperty('erro');
    expect(lerDiaDoSaldo('2026-02-31', '2026-03-01')).toBeNull();
    for (const v of [0, -5, '42300', 1e9, 10.123]) expect(conferirAcao('informar_saldo', { valorInformado: v }, AGORA)).toHaveProperty('erro');
  });

  it('a folha e a campanha', () => {
    expect(conferirAcao('informar_folha', { valorInformado: 24000 }, AGORA)).toMatchObject({ parametros: { centavos: 2400000 }, resumo: expect.stringContaining('estimativa sua') });
    expect(conferirAcao('informar_folha', { valorInformado: 10_000_000 }, AGORA)).toHaveProperty('erro');
    expect(conferirAcao('informar_custo_campanha', { valorInformado: 300 }, AGORA)).toHaveProperty('erro');
    expect(conferirAcao('informar_custo_campanha', { valorInformado: 300, campanha: ' SMASH10 ' }, AGORA)).toMatchObject({ parametros: { campanha: 'SMASH10', centavos: 30000 } });
    expect(resumoDoDado('informar_custo_campanha', 30000, '2026-11-22', 'SMASH10')).toContain('cupom SMASH10');
  });

  it('o desfecho não traz o valor: ele fica na auditoria e no histórico', () => {
    for (const a of ['informar_saldo', 'informar_folha', 'informar_custo_campanha'] as const) {
      const t = textoDoDadoGuardado(a, '2026-11-22');
      expect(t).not.toMatch(/R\$|\d{3}/);
      expect(t).toContain('Veio de você');
    }
  });

  it('a memória não guarda saldo nem folha, com número em qualquer forma', () => {
    for (const t of ['O saldo do banco é 42.300', 'saldo 42300', 'A folha dá uns 24 mil por mês', 'folha de 24k', 'Tem cinquenta mil no banco', 'salários somam R$ 24.000'])
      expect(conferirMemoria(t)).toEqual({ erro: RECUSAS_DA_MEMORIA.caixa });
    // Sem quantia é contexto normal.
    for (const t of ['A folha sai no dia 5', 'O presidente confere o saldo toda segunda', 'A loja fecha às 23h']) expect(conferirMemoria(t)).toEqual({ texto: t });
  });
});

describe('o modelo maior nos indicadores (V7-7)', () => {
  const uso = { entrada: 1, cacheEscrita: 0, cacheLeitura: 0, saida: 1 };
  const usar = (input: any) => ({ texto: '', recusou: false, origem: 'lojista', uso, parou: 'tool_use', conteudo: [{ type: 'tool_use', id: 't1', name: 'indicadores_financeiros', input }] });
  const falar = { texto: 'Pronto.', recusou: false, origem: 'lojista', uso, parou: 'end_turn', conteudo: [{ type: 'text', text: 'Pronto.' }] };
  const rodar = async (dados: any, ok = true) => {
    const modelos: string[] = [];
    const roteiro: any[] = [usar({ foco: 'margem' }), falar];
    await responderComFerramentas(
      {
        modelo: 'claude-haiku-5-5',
        modeloDaAnalise: 'claude-sonnet-5-5',
        conversa: 'c',
        pedir: async (p: any) => (modelos.push(p.modelo), roteiro.shift()),
        executar: async () => ({ ok, dados }),
      },
      [],
      'como está a margem?',
    );
    return modelos;
  };
  it('com dados, a resposta usa o maior; com "falta dado" ou erro, fica no de sempre', async () => {
    expect(await rodar({ cmv: { pct: 30 } })).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(await rodar({ semDados: true })).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    expect(await rodar({ erro: 'não li' }, false)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
  });
});

describe('a ferramenta e as instruções', () => {
  it('existe, é consulta, tem os focos e libera o modelo das análises', () => {
    const f = FERRAMENTAS.find((x) => x.name === 'indicadores_financeiros')!;
    expect(f.input_schema.properties.foco.enum).toEqual([...FOCOS_DOS_INDICADORES]);
    expect(ehConsulta('indicadores_financeiros')).toBe(true);
    expect(podeRodarJunto('indicadores_financeiros')).toBe(true);
    expect(FERRAMENTAS_DA_ANALISE).toEqual(['analisar_vendas', 'indicadores_financeiros']);
  });

  it('as instruções: número primeiro, sugestão separada, sem dado diz o que falta e não estima', () => {
    expect(INSTRUCOES_DO_MISTER).toContain('OS INDICADORES FINANCEIROS');
    expect(INSTRUCOES_DO_MISTER).toContain('nunca diga 100% de margem nem R$ 0 de custo');
    expect(INSTRUCOES_DO_MISTER).toContain('nunca estime pela média do setor');
    expect(INSTRUCOES_DO_MISTER).toContain('nunca use faturamento no lugar de margem');
    expect(INSTRUCOES_DO_MISTER).toContain('Nunca anote saldo, folha ou valor na memória');
    expect(INSTRUCOES_DO_MISTER).toContain('não atribua a um insumo');
  });
});
