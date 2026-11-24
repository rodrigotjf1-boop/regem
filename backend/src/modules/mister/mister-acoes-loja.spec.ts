import { ACOES, conferirAcao, ehDaLoja, sigaDaAcao, TEXTOS_DAS_ACOES } from './mister-acoes';
import { apresentacaoDaConta, apresentacaoDoCupom, conferirAcaoDaLoja, descontoDoCupom, resumoDaFolga, resumoDaTroca, resumoDoFornecedor, resumoDoProduto } from './mister-acoes-loja';
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

describe('Mister · O5 segunda parte — o produto, o fornecedor e a escala', () => {
  it('o catálogo: tudo de botão, cada um pela permissão da rota (produtos: loja; fornecedores: cadastros; escala: escalas editar)', () => {
    expect(ACOES.mudar_produto).toMatchObject({ nivel: 'botao', permissao: 'loja', prazoMin: 10 });
    expect(ACOES.mudar_fornecedor).toMatchObject({ nivel: 'botao', permissao: 'cadastros' });
    expect(ACOES.trocar_turno).toMatchObject({ nivel: 'botao', permissao: 'escalas', crud: 'editar' });
    expect(ACOES.folga_na_escala).toMatchObject({ nivel: 'botao', permissao: 'escalas', crud: 'editar' });
    expect(['mudar_produto', 'mudar_fornecedor', 'trocar_turno', 'folga_na_escala'].every(ehDaLoja)).toBe(true);
  });

  it('o produto: diz o que mudar (nome, descrição ou categoria); sem nada, pergunta', () => {
    expect(conferirAcaoDaLoja('mudar_produto', { produto: 'X-Bacon', descricaoDoProduto: ' Pão brioche,  bacon e cheddar ' }, HOJE)).toEqual({
      parametros: { acao: 'mudar_produto', produto: 'X-Bacon', nomeNovo: null, descricao: 'Pão brioche, bacon e cheddar', categoria: null },
      resumo: '',
    });
    expect(conferirAcaoDaLoja('mudar_produto', { produto: 'X-Bacon' }, HOJE)).toEqual({ erro: 'Diga o que mudar no produto: o nome, a descrição ou a categoria.' });
    expect(conferirAcaoDaLoja('mudar_produto', { produto: 'X-Bacon', nomeNovoDoProduto: '12' }, HOJE)).toHaveProperty('erro');
    expect(resumoDoProduto('X-Bacon', { nomeNovo: null, descricao: 'Pão brioche' }, 'Lanches')).toBe(
      'Mudar a descrição para "Pão brioche" e a categoria para Lanches do produto "X-Bacon" em Cadastros › Cardápio. Vale no cardápio digital e no balcão; o iFood e a 99 seguem o que a Gestão do catálogo manda.',
    );
  });

  it('o fornecedor: o telefone com DDD, o e-mail que parece e-mail; o resumo mostra só o fim do telefone', () => {
    const r = conferirAcaoDaLoja('mudar_fornecedor', { fornecedor: 'Felipão', contato: 'Marcos', foneDoFornecedor: '(21) 99876-5432', emailDoFornecedor: 'compras@felipao.com.br' }, HOJE);
    expect(r).toEqual({ parametros: { acao: 'mudar_fornecedor', fornecedor: 'Felipão', nomeNovo: null, contato: 'Marcos', telefone: '21998765432', email: 'compras@felipao.com.br' }, resumo: '' });
    expect(conferirAcaoDaLoja('mudar_fornecedor', { fornecedor: 'Felipão', foneDoFornecedor: '9876' }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('mudar_fornecedor', { fornecedor: 'Felipão', emailDoFornecedor: 'felipao.com' }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('mudar_fornecedor', { fornecedor: 'Felipão' }, HOJE)).toHaveProperty('erro');
    expect(resumoDoFornecedor('Felipão da Penha', { nomeNovo: null, contato: 'Marcos', telefone: '21998765432', email: null })).toBe(
      'Mudar o contato para Marcos e o telefone para o número terminado em 5432 do fornecedor "Felipão da Penha" em Fornecedores.',
    );
  });

  it('a escala: o dia de hoje em diante, quem sai e quem entra; o turno só quando a pessoa tem dois', () => {
    expect(conferirAcaoDaLoja('trocar_turno', { quemSai: 'Bruna', quemEntra: 'Diego', diaDaEscala: '2026-11-28' }, HOJE)).toEqual({
      parametros: { acao: 'trocar_turno', quemSai: 'Bruna', quemEntra: 'Diego', dia: '2026-11-28', turno: null },
      resumo: '',
    });
    expect(conferirAcaoDaLoja('folga_na_escala', { quemSai: 'Bruna', diaDaEscala: HOJE, turnoDaEscala: 'noite' }, HOJE)).toEqual({
      parametros: { acao: 'folga_na_escala', quem: 'Bruna', dia: HOJE, turno: 'noite' },
      resumo: '',
    });
    expect(conferirAcaoDaLoja('trocar_turno', { quemSai: 'Bruna', quemEntra: 'Diego', diaDaEscala: '2026-11-23' }, HOJE)).toEqual({ erro: 'Esse dia já passou: a escala de dias passados muda só na tela.' });
    expect(conferirAcaoDaLoja('trocar_turno', { quemSai: 'Bruna', diaDaEscala: '2026-11-28' }, HOJE)).toHaveProperty('erro');
    expect(conferirAcaoDaLoja('folga_na_escala', { quemSai: 'Bruna', diaDaEscala: '28/11' }, HOJE)).toHaveProperty('erro');
    const turno = { nome: 'Noite', inicio: '18:00', fim: '23:30' };
    expect(resumoDaTroca('Bruna Alves', 'Diego Rocha', '2026-11-28', turno)).toBe('Trocar Bruna Alves por Diego Rocha na escala de sábado, 28/11, turno Noite (18:00–23:30). As regras da CLT são conferidas antes de gravar.');
    expect(resumoDaFolga('Bruna Alves', '2026-11-28', turno)).toBe('Dar folga a Bruna Alves em sábado, 28/11: sai do turno Noite (18:00–23:30) e a vaga fica aberta na escala para outra pessoa.');
  });
});
