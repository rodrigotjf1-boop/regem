import { ACOES, conferirAcao, ehDaLoja, sigaDaAcao, TEXTOS_DAS_ACOES } from './mister-acoes';
import { apresentacaoDaConta, apresentacaoDoCupom, conferirAcaoDaLoja, descontoDoCupom } from './mister-acoes-loja';
import { instanteDeSaoPaulo } from '../../common/pedido-agendado';

// Versão 9, O5: o cupom e a conta a pagar pela conversa. Puro; o banco e o serviço da tela em `mister-pg.teste-spec.ts`.

const HOJE = '2026-11-24';
const AGORA = instanteDeSaoPaulo(`${HOJE}T20:00`)!;

describe('Mister · O5 — o catálogo', () => {
  it('cupom e conta a pagar são de PIN, tirar o cupom é de botão, cada um pela permissão da rota', () => {
    expect(ACOES.criar_cupom).toMatchObject({ nivel: 'pin', permissao: 'cupons', prazoMin: 15 });
    expect(ACOES.remover_cupom).toMatchObject({ nivel: 'botao', permissao: 'cupons', prazoMin: 10 });
    expect(ACOES.lancar_conta).toMatchObject({ nivel: 'pin', permissao: 'financeiro', prazoMin: 15, pedeVerValores: true });
    expect(['criar_cupom', 'remover_cupom', 'lancar_conta'].every(ehDaLoja)).toBe(true);
    expect(ehDaLoja('pagar_conta')).toBe(false);
    expect(sigaDaAcao('criar_cupom')).toContain('Abrir no Regem');
    expect(TEXTOS_DAS_ACOES.semPermissaoCupons).toContain('Cupons');
  });
});

describe('Mister · O5 — a conferência do cupom', () => {
  it('10% com mínimo, validade, limite e só novos: o código sai em maiúsculas e o resumo diz tudo', () => {
    const r = conferirAcao('criar_cupom', { codigoDoCupom: ' smash10 ', tipoDoDesconto: 'percentual', valorDoDesconto: 10, pedidoMinimo: 40, validoAte: '2026-12-31', usosMaximos: 100, soClientesNovos: true, nomeDoCupom: 'Semana do smash' }, AGORA);
    expect(r).toEqual({
      parametros: { acao: 'criar_cupom', codigo: 'SMASH10', tipo: 'percentual', valor: 10, minimo: 40, validoAte: '2026-12-31', usosMaximos: 100, soClientesNovos: true, nome: 'Semana do smash' },
      resumo: 'Criar o cupom SMASH10 ("Semana do smash"): 10% de desconto, pedido mínimo de R$ 40,00, até 31/12/2026, até 100 usos, só para clientes novos. Ele passa a valer no cardápio e no balcão (PDV · Balcão › Cupons).',
    });
  });

  it('frete grátis não pede valor; em reais pede o valor', () => {
    const f = conferirAcaoDaLoja('criar_cupom', { codigoDoCupom: 'FRETE', tipoDoDesconto: 'fretegratis' }, HOJE);
    expect('parametros' in f && f.parametros).toMatchObject({ tipo: 'fretegratis', valor: 0 });
    expect('resumo' in f && f.resumo).toContain('frete grátis, sem data para acabar');
    expect(conferirAcaoDaLoja('criar_cupom', { codigoDoCupom: 'CINCO', tipoDoDesconto: 'valor' }, HOJE)).toEqual({ erro: 'Diga o desconto em reais.' });
    expect(descontoDoCupom({ tipo: 'valor', valor: 5 })).toBe('R$ 5,00 de desconto');
  });

  it('recusa: código com espaço ou curto, porcentagem acima de 100, validade no passado ou inventada, limite quebrado, tipo desconhecido', () => {
    const ruins: Record<string, unknown>[] = [
      { codigoDoCupom: 'SMASH 10', valorDoDesconto: 10 },
      { codigoDoCupom: 'AB', valorDoDesconto: 10 },
      { codigoDoCupom: 'MUITO', valorDoDesconto: 120 },
      { codigoDoCupom: 'MUITO', valorDoDesconto: -5 },
      { codigoDoCupom: 'MUITO', valorDoDesconto: '10' },
      { codigoDoCupom: 'ONTEM', valorDoDesconto: 10, validoAte: '2026-11-23' },
      { codigoDoCupom: 'FEV', valorDoDesconto: 10, validoAte: '2027-02-30' },
      { codigoDoCupom: 'USOS', valorDoDesconto: 10, usosMaximos: 2.5 },
      { codigoDoCupom: 'TIPO', tipoDoDesconto: 'brinde', valorDoDesconto: 10 },
      { codigoDoCupom: 'MIN', valorDoDesconto: 10, pedidoMinimo: -1 },
    ];
    for (const en of ruins) expect(conferirAcaoDaLoja('criar_cupom', en, HOJE)).toHaveProperty('erro');
    // a validade de hoje vale
    expect(conferirAcaoDaLoja('criar_cupom', { codigoDoCupom: 'HOJE', valorDoDesconto: 10, validoAte: HOJE }, HOJE)).toHaveProperty('parametros');
  });

  it('tirar o cupom só pede o código', () => {
    expect(conferirAcaoDaLoja('remover_cupom', { codigoDoCupom: 'smash10' }, HOJE)).toEqual({
      parametros: { acao: 'remover_cupom', codigo: 'SMASH10' },
      resumo: 'Tirar o cupom SMASH10: ele deixa de valer no cardápio e no balcão.',
    });
  });

  it('a página do PIN mostra o desconto e as condições, sem valor em destaque', () => {
    const r = conferirAcaoDaLoja('criar_cupom', { codigoDoCupom: 'SMASH10', valorDoDesconto: 10, pedidoMinimo: 40 }, HOJE);
    if (!('parametros' in r) || r.parametros.acao !== 'criar_cupom') throw new Error('devia conferir');
    expect(apresentacaoDoCupom(r.parametros)).toEqual({
      titulo: 'Criar o cupom SMASH10',
      itens: ['10% de desconto', 'Pedido mínimo: R$ 40,00', 'Sem data para acabar'],
      detalhe: 'Ele passa a valer no cardápio digital e no balcão.',
      valor: null,
      botao: 'Criar o cupom',
    });
  });
});

describe('Mister · O5 — a conferência da conta a pagar', () => {
  it('descrição, valor e vencimento; fornecedor e categoria quando a pessoa diz', () => {
    const r = conferirAcao('lancar_conta', { descricaoDaConta: 'Conta de luz de novembro', valorDaConta: 412.345, vencimentoDaConta: '2026-12-10', fornecedor: 'Light', categoriaDaConta: 'Energia' }, AGORA);
    expect(r).toEqual({
      parametros: { acao: 'lancar_conta', descricao: 'Conta de luz de novembro', valor: 412.35, vencimento: '2026-12-10', fornecedor: 'Light', categoria: 'Energia' },
      resumo: 'Lançar a conta a pagar "Conta de luz de novembro" de R$ 412,35, vencendo em 10/12/2026, do fornecedor Light, na categoria Energia. Ela fica em aberto em Financeiro › Contas a pagar.',
    });
  });

  it('recusa sem descrição, sem valor, com valor em texto ou sem vencimento; a data vencida é aceita (conta atrasada)', () => {
    expect(conferirAcaoDaLoja('lancar_conta', { valorDaConta: 10, vencimentoDaConta: HOJE }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('lancar_conta', { descricaoDaConta: 'Gás', vencimentoDaConta: HOJE }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('lancar_conta', { descricaoDaConta: 'Gás', valorDaConta: '90', vencimentoDaConta: HOJE }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('lancar_conta', { descricaoDaConta: 'Gás', valorDaConta: 90 }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('lancar_conta', { descricaoDaConta: 'Gás', valorDaConta: 90, vencimentoDaConta: '10/12/2026' }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('lancar_conta', { descricaoDaConta: 'Gás', valorDaConta: 90, vencimentoDaConta: '2026-11-01' }, HOJE)).toHaveProperty('parametros');
  });

  it('a página do PIN mostra o valor em destaque e diz que nada é pago', () => {
    const a = apresentacaoDaConta({ acao: 'lancar_conta', descricao: 'Gás', valor: 90, vencimento: '2026-12-10', fornecedor: 'Ultragaz', categoria: null, nomeDoFornecedor: 'Ultragaz Ltda' });
    expect(a).toEqual({ titulo: 'Lançar a conta "Gás"', itens: ['Vence em 10/12/2026', 'Fornecedor: Ultragaz Ltda'], detalhe: 'Ela fica em aberto em Financeiro › Contas a pagar. Nada é pago.', valor: 90, botao: 'Lançar a conta' });
  });
});
