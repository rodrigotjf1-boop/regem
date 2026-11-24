import { instanteDeSaoPaulo } from '../../common/pedido-agendado';
import {
  ACOES,
  ACOES_DO_MISTER,
  canaisDoProduto,
  PEDIDO_DA_IMAGEM_MAX,
  conferirAcao,
  mesmaUnidade,
  resumoDoMovimento,
  pareceDadoPessoal,
  sigaDaAcao,
  ehAcaoDoMister,
  lerCanal,
  lerCanalDoProduto,
  nomeDoEstadoDaTarefa,
  nomesDosCanais,
  ondeOProduto,
  pedidoAndou,
  pedidoServe,
  produtoFicou,
  resumoDoPedido,
} from './mister-acoes';

// Versão 6, M6j (lote 1, o Delivery; lote 2, a tarefa e o produto): a porta `propor_acao` — as regras puras.

const AGORA = instanteDeSaoPaulo('2026-11-20T20:00')!;

describe('Mister · ações — o catálogo e os canais', () => {
  it('os lotes 1 e 2: de botão, cada uma pela permissão da rota da tela', () => {
    expect([...ACOES_DO_MISTER]).toEqual([
      'pausar_canal', 'reabrir_canal', 'aceitar_pedido', 'pedido_pronto', 'despachar_pedido', 'concluir_tarefa', 'pausar_produto', 'reativar_produto', 'criar_tarefa', 'criar_imagem', 'movimentar_estoque', 'mudar_preco', 'mudar_horario', 'pagar_conta', 'informar_saldo', 'informar_folha', 'informar_custo_campanha',
      // Versão 9, O3: o cadastro pela conversa.
      'cadastrar_insumo', 'alterar_insumo', 'cadastrar_fornecedor', 'excluir_pedido_compra',
      // Versão 9, O5: o cupom e a conta a pagar.
      'criar_cupom', 'remover_cupom', 'lancar_conta',
      // Versão 9, O5 segunda parte: o produto, o fornecedor e a escala.
      'mudar_produto', 'mudar_fornecedor', 'trocar_turno', 'folga_na_escala',
      // Versão 9, O5: classificar o lançamento do extrato.
      'classificar_banco',
      // Versão 9, O3: a contagem do estoque.
      'contar_estoque',
    ]);
    expect(ACOES.criar_tarefa).toMatchObject({ nivel: 'botao', permissao: 'checklist' });
    for (const a of ['pausar_canal', 'reabrir_canal', 'aceitar_pedido', 'pedido_pronto', 'despachar_pedido'] as const)
      expect(ACOES[a]).toMatchObject({ id: a, nivel: 'botao', permissao: 'delivery' });
    expect(ACOES.concluir_tarefa).toMatchObject({ nivel: 'botao', permissao: 'meu_dia' });
    expect(ACOES.pausar_produto).toMatchObject({ nivel: 'botao', permissao: 'loja' });
    expect(ACOES.reativar_produto).toMatchObject({ nivel: 'botao', permissao: 'loja' });
    expect(ehAcaoDoMister('cancelar_pedido')).toBe(false);
    expect(ehAcaoDoMister('pausar_canal')).toBe(true);
  });

  it('o canal como a pessoa diz', () => {
    expect(['99', 'food99', 'iFood', 'Cardápio', 'cardapio digital', 'keeta'].map(lerCanal)).toEqual(['food99', 'food99', 'ifood', 'cardapio', 'cardapio', null]);
    expect(nomesDosCanais(['ifood'])).toBe('o iFood');
    expect(nomesDosCanais(['cardapio', 'ifood', 'food99'])).toBe('o cardápio digital, o iFood e a 99');
  });
});

describe('Mister · ações — a conferência (os limites da tela)', () => {
  it('pausar o iFood e a 99 por 30 min, com o motivo: o resumo diz até quando cada um volta', () => {
    const r = conferirAcao('pausar_canal', { canais: ['99', 'ifood'], motivo: 'pedidos', minutos: 30 }, AGORA);
    expect(r).toEqual({
      parametros: { acao: 'pausar_canal', canais: ['ifood', 'food99'], motivo: 'pedidos', motivoTexto: null, minutos: 30, ate: null, fimDoDia: false },
      resumo: 'Pausar o iFood e a 99 (motivo: Muitos pedidos agora). Volta: o iFood às 20:30; a 99 às 20:30.',
    });
  });

  it('os tempos de cada canal são os da tela: 1 hora não serve para a 99; "até 22:00" serve para o cardápio', () => {
    const r = conferirAcao('pausar_canal', { canais: ['99'], motivo: 'cozinha', minutos: 60 }, AGORA);
    expect('erro' in r && r.erro).toContain('99: A 99 aceita 10, 20 ou 30 min');
    const c = conferirAcao('pausar_canal', { canais: ['cardapio'], motivo: 'fechando', ate: '22:00' }, AGORA);
    expect('resumo' in c && c.resumo).toBe('Pausar o cardápio digital (motivo: Perto de fechar). Volta: o cardápio digital às 22:00.');
    const fim = conferirAcao('pausar_canal', { canais: ['99'], motivo: 'energia', fimDoDia: true }, AGORA);
    expect('resumo' in fim && fim.resumo).toContain('a 99 às 23:59');
  });

  it('sem motivo, sem canal ou com canal desconhecido: a pergunta volta à pessoa', () => {
    expect(conferirAcao('pausar_canal', { canais: ['ifood'], minutos: 30 }, AGORA)).toEqual({ erro: expect.stringContaining('Escolha o motivo da pausa.') });
    expect(conferirAcao('pausar_canal', { canais: ['ifood'], motivo: 'outro', minutos: 30 }, AGORA)).toEqual({ erro: expect.stringContaining('Escreva o motivo da pausa.') });
    expect(conferirAcao('pausar_canal', { motivo: 'pedidos', minutos: 30 }, AGORA)).toEqual({ erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' });
    expect(conferirAcao('reabrir_canal', { canais: ['keeta'] }, AGORA)).toEqual({ erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' });
    expect(conferirAcao('apagar_tudo', {}, AGORA)).toEqual({ erro: expect.stringContaining('Essa ação não existe.') });
  });

  it('reabrir e as ações de pedido', () => {
    expect(conferirAcao('reabrir_canal', { canal: 'ifood' }, AGORA)).toEqual({ parametros: { acao: 'reabrir_canal', canais: ['ifood'] }, resumo: 'Reabrir o iFood agora.' });
    expect(conferirAcao('aceitar_pedido', { numero: '#4821' }, AGORA)).toEqual({ parametros: { acao: 'aceitar_pedido', numero: '4821' }, resumo: '' });
    expect(conferirAcao('despachar_pedido', {}, AGORA)).toEqual({ erro: 'Diga o número do pedido como aparece no painel do Delivery.' });
  });
});

describe('Mister · ações — o pedido: a situação que serve e a conferência do efeito', () => {
  it('cada ação na situação certa', () => {
    expect(pedidoServe('aceitar_pedido', { status: 'novo', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('aceitar_pedido', { status: 'confirmado', tipo: 'entrega' })).toBe('Esse pedido já foi aceito.');
    expect(pedidoServe('pedido_pronto', { status: 'novo', tipo: 'entrega' })).toBe('Esse pedido ainda não foi aceito: aceite antes.');
    expect(pedidoServe('pedido_pronto', { status: 'confirmado', tipo: 'retirada' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'pronto', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'confirmado', tipo: 'entrega' })).toBeNull();
    expect(pedidoServe('despachar_pedido', { status: 'pronto', tipo: 'retirada' })).toBe('Esse pedido é para retirar: ele não sai para entrega.');
    expect(pedidoServe('despachar_pedido', { status: 'despachado', tipo: 'entrega' })).toBe('Esse pedido já saiu para a entrega.');
    expect(pedidoServe('aceitar_pedido', { status: 'cancelado', tipo: 'entrega' })).toBe('Esse pedido está cancelado.');
  });

  it('o "feito" só com o pedido na situação de depois', () => {
    expect(pedidoAndou('aceitar_pedido', 'confirmado')).toBe(true);
    expect(pedidoAndou('aceitar_pedido', 'novo')).toBe(false);
    expect(pedidoAndou('pedido_pronto', 'confirmado')).toBe(false);
    expect(pedidoAndou('despachar_pedido', 'despachado')).toBe(true);
    expect(resumoDoPedido('despachar_pedido', '#4821 (iFood)')).toBe('Despachar o pedido #4821 (iFood) (saiu para a entrega).');
  });
});

describe('Mister · ações (lote 2) — a tarefa e o produto', () => {
  it('a tarefa: feita sem dizer; "não feita" pede o motivo (a mesma regra da tela)', () => {
    expect(conferirAcao('concluir_tarefa', { tarefa: '  Limpar   a coifa ' }, AGORA)).toEqual({
      parametros: { acao: 'concluir_tarefa', tarefa: 'Limpar a coifa', estado: 'feita', justificativa: null },
      resumo: 'Marcar a tarefa "Limpar a coifa" como feita.',
    });
    expect(conferirAcao('concluir_tarefa', { tarefa: 'Limpar a coifa', estado: 'nao_feita' }, AGORA)).toEqual({
      erro: 'Para marcar como não feita, diga o motivo (vai junto na tarefa).',
    });
    expect(conferirAcao('concluir_tarefa', { tarefa: 'Limpar a coifa', estado: 'nao_feita', justificativa: 'faltou o produto' }, AGORA)).toMatchObject({
      resumo: 'Marcar a tarefa "Limpar a coifa" como não feita (motivo: faltou o produto).',
    });
    expect(conferirAcao('concluir_tarefa', { tarefa: 'Limpar a coifa', estado: 'parcial', justificativa: 'não vai' }, AGORA)).toMatchObject({
      parametros: { estado: 'parcial', justificativa: null },
    });
    expect(conferirAcao('concluir_tarefa', { tarefa: 'x' }, AGORA)).toEqual({ erro: 'Diga a tarefa de hoje como ela aparece na lista (o título).' });
    expect(conferirAcao('concluir_tarefa', { tarefa: 'Limpar', estado: 'cancelada' }, AGORA)).toEqual({ erro: 'A tarefa fica feita, parcial ou nao_feita.' });
    expect(['feita', 'parcial', 'nao_feita', 'pendente', 'em_execucao'].map(nomeDoEstadoDaTarefa)).toEqual(['feita', 'feita em parte', 'não feita', 'pendente', 'em execução']);
  });

  it('o produto: sem canal, os canais em que ele está; com canal, só ele', () => {
    expect(conferirAcao('pausar_produto', { produto: 'X-Burger' }, AGORA)).toEqual({
      parametros: { acao: 'pausar_produto', produto: 'X-Burger', canais: null },
      resumo: 'Pausar "X-Burger" em todos os canais em que ele está.',
    });
    expect(conferirAcao('reativar_produto', { produto: 'X-Burger', canais: ['99', 'cardapio'] }, AGORA)).toEqual({
      parametros: { acao: 'reativar_produto', produto: 'X-Burger', canais: ['regem', '99food'] },
      resumo: 'Reativar "X-Burger" no Regem (balcão e cardápio digital) e na 99.',
    });
    expect(conferirAcao('pausar_produto', { produto: 'X-Burger', canais: ['keeta'] }, AGORA)).toEqual({ erro: 'Os canais do produto são regem (balcão e cardápio digital), ifood e 99.' });
    expect(['Balcão', 'iFood', '99', 'regem', 'keeta'].map(lerCanalDoProduto)).toEqual(['regem', 'ifood', '99food', 'regem', null]);
    expect(canaisDoProduto({ noIfood: true, na99: false })).toEqual(['regem', 'ifood']);
    expect(ondeOProduto(['regem', 'ifood', '99food'])).toBe('no Regem (balcão e cardápio digital), no iFood e na 99');
  });

  it('a conferência do produto: o Regem pelo balcão E o cardápio; os apps pela lista de pausados', () => {
    const p = { disponivelBalcao: false, disponivelCardapio: false, canaisPausados: ['ifood'] };
    expect(produtoFicou(p, ['regem', 'ifood', '99food'], true)).toEqual(['regem', 'ifood']);
    expect(produtoFicou({ ...p, disponivelCardapio: true }, ['regem'], true)).toEqual([]);
    expect(produtoFicou({ disponivelBalcao: true, disponivelCardapio: true, canaisPausados: [] }, ['regem', 'ifood'], false)).toEqual(['regem', 'ifood']);
  });
});

describe('Mister · ações (lote 3) — criar a tarefa de hoje', () => {
  it('o título e a função são obrigatórios (a tela exige a função); o horário em HH:MM; o responsável é opcional', () => {
    expect(conferirAcao('criar_tarefa', { titulo: 'Repor guardanapos', funcao: 'Salão', horario: '18:30', responsavel: 'Edu' }, AGORA)).toEqual({
      parametros: { acao: 'criar_tarefa', titulo: 'Repor guardanapos', funcao: 'Salão', horario: '18:30', responsavel: 'Edu' },
      resumo: 'Criar para hoje a tarefa "Repor guardanapos" às 18:30, da função Salão, para Edu.',
    });
    expect(conferirAcao('criar_tarefa', { titulo: 'Repor guardanapos' }, AGORA)).toEqual({
      erro: 'Diga a função da tarefa (quem faz: a cozinha, o caixa, a limpeza…), como está no cadastro das funções.',
    });
    expect(conferirAcao('criar_tarefa', { titulo: 'Repor guardanapos', funcao: 'Salão', horario: '18h30' }, AGORA)).toEqual({ erro: 'O horário da tarefa vai em HH:MM (por exemplo 15:30).' });
    expect(conferirAcao('criar_tarefa', { titulo: 'R', funcao: 'Salão' }, AGORA)).toEqual({ erro: 'Diga o título da tarefa (de 2 a 120 letras).' });
    expect(conferirAcao('criar_tarefa', { titulo: 'Repor guardanapos', funcao: 'Salão' }, AGORA)).toMatchObject({ parametros: { horario: null, responsavel: null } });
  });
});

describe('Mister · ações (M6l) — a imagem', () => {
  const PEDIDO = "Cartaz vertical da terça do smash. Foto de um smash duplo com batata, fundo escuro, luz quente. Texto exato: \"TERÇA DO SMASH\" e \"Smash duplo + batata · R$ 29,90\".";
  it('o pedido vale como veio, com a proporção; sem dizer, 1:1', () => {
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: PEDIDO, proporcao: '9:16' }, AGORA)).toEqual({ parametros: { acao: 'criar_imagem', pedido: PEDIDO, proporcao: '9:16' }, resumo: PEDIDO });
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: PEDIDO }, AGORA)).toMatchObject({ parametros: { proporcao: '1:1' } });
    expect(ACOES.criar_imagem).toMatchObject({ nivel: 'botao', permissao: 'delivery', prazoMin: 30 });
  });
  it('pedido curto, longo ou com proporção que não existe volta à pessoa', () => {
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: 'um cartaz' }, AGORA)).toHaveProperty('erro');
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: 'x'.repeat(PEDIDO_DA_IMAGEM_MAX + 1) }, AGORA)).toHaveProperty('erro');
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: PEDIDO, proporcao: '4:3' }, AGORA)).toHaveProperty('erro');
  });
  it('telefone, e-mail, CPF e CNPJ não vão à IA de imagem; preço, data e @ da loja vão', () => {
    for (const t of ['ligue (21) 99999-0000', 'fale em dono@loja.com.br', 'CPF 123.456.789-09', 'CNPJ 12.345.678/0001-95'])
      expect(pareceDadoPessoal(t)).toBe(true);
    for (const t of ['R$ 29,90 ou R$ 39,90', 'válido até 25/11/2026', 'siga @mister.burger', 'combo 2 por 1'])
      expect(pareceDadoPessoal(t)).toBe(false);
    expect(conferirAcao('criar_imagem', { pedidoDaImagem: `${PEDIDO} Peça pelo (21) 99999-0000.` }, AGORA)).toHaveProperty('erro');
  });
  it('a instrução para a IA diz os botões certos de cada ação', () => {
    expect(sigaDaAcao('criar_imagem')).toContain('"Gerar" e "Mudar"');
    expect(sigaDaAcao('pausar_canal')).toContain('"Autorizar" e "Não agora"');
  });
});

describe('Mister · ações (lote 7) — o movimento de estoque', () => {
  it('entrada e saída pedem a quantidade; o ajuste pede o saldo contado', () => {
    expect(conferirAcao('movimentar_estoque', { item: 'Bacon', tipo: 'entrada', quantidade: 2.5 }, AGORA)).toMatchObject({ parametros: { acao: 'movimentar_estoque', item: 'Bacon', tipo: 'entrada', quantidade: 2.5, saldoContado: null, motivo: null } });
    expect(conferirAcao('movimentar_estoque', { item: 'Bacon', tipo: 'ajuste', saldoContado: 0, motivoDoMovimento: 'acabou' }, AGORA)).toMatchObject({ parametros: { tipo: 'ajuste', quantidade: null, saldoContado: 0, motivo: 'acabou' } });
    for (const en of [
      { item: 'Bacon', tipo: 'entrada' },
      { item: 'Bacon', tipo: 'entrada', quantidade: 0 },
      { item: 'Bacon', tipo: 'saida', quantidade: -1 },
      { item: 'Bacon', tipo: 'saida', quantidade: '3' },
      { item: 'Bacon', tipo: 'entrada', quantidade: 1_000_001 },
      { item: 'Bacon', tipo: 'entrada', quantidade: Number.NaN },
      { item: 'Bacon', tipo: 'ajuste' },
      { item: 'Bacon', tipo: 'ajuste', saldoContado: -2 },
      { item: 'Bacon', tipo: 'troca', quantidade: 1 },
      { item: 'B', tipo: 'entrada', quantidade: 1 },
    ])
      expect(conferirAcao('movimentar_estoque', en, AGORA)).toHaveProperty('erro');
    expect(ACOES.movimentar_estoque).toMatchObject({ nivel: 'botao', permissao: 'estoque' });
  });
  it('a unidade dita confere com a do item, pelas formas de dizer', () => {
    for (const [dita, doItem] of [['quilos', 'kg'], ['Kg', 'KG'], ['litro', 'L'], ['unidades', 'un'], ['gramas', 'g'], ['ml', 'ML']]) expect(mesmaUnidade(dita, doItem)).toBe(true);
    for (const [dita, doItem] of [['caixas', 'kg'], ['g', 'kg'], ['l', 'ml']]) expect(mesmaUnidade(dita, doItem)).toBe(false);
  });
  it('o resumo diz o saldo antes e depois, em centésimos sem erro de vírgula, e avisa do negativo', () => {
    expect(resumoDoMovimento({ tipo: 'entrada', quantidade: 0.1, saldoContado: null, motivo: null }, { nome: 'Sal', unidade: 'kg', saldo: 0.2, loja: null })).toBe('Dar entrada de 0,1 kg em "Sal". Saldo: 0,2 kg → 0,3 kg.');
    expect(resumoDoMovimento({ tipo: 'saida', quantidade: 5, saldoContado: null, motivo: 'perda' }, { nome: 'Sal', unidade: 'kg', saldo: 2, loja: 'Loja Centro' })).toBe('Dar saída de 5 kg em "Sal" na Loja Centro (motivo: perda). Saldo: 2 kg → -3 kg. O saldo fica negativo.');
    expect(resumoDoMovimento({ tipo: 'ajuste', quantidade: null, saldoContado: 12, motivo: null }, { nome: 'Sal', unidade: 'kg', saldo: 13, loja: null })).toBe('Acertar o saldo de "Sal" pelo que foi contado. Saldo: 13 kg → 12 kg.');
  });
});
