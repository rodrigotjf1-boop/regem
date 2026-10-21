import {
  APLICATIVOS_DO_CLIQUE,
  CUSTO_TRAVADO,
  cnpjComMascara,
  conferirPedido,
  ehOutraEmpresa,
  emissorDoRegem,
  formatoDoPedido,
  fraseDaSenhaErrada,
  fraseDaTrava,
  gerarPedido,
  hashDoPedido,
  lerConfigClique,
  minutosDaTrava,
  naOrdemDoCatalogo,
  raizDoCnpj,
} from './autorizacao-clique.regras';
import { montarTela, textoGuardado, type EntradaDaTela } from './autorizacao-clique.tela';

// A AUTORIZAÇÃO POR CLIQUE (Hub DMS, F3, parte C) — as regras puras e a tela montada no servidor, com os textos que o
// dono aprovou em 21/10/2026 (C-5). Dados fictícios: os CNPJs têm dígito verificador inválido de propósito.

const LIAME = APLICATIVOS_DO_CLIQUE.liame;
const VOLTA = 'https://api.liame.exemplo/v1/oauth/callback';
const CLIENT = 'aplicativo-liame-de-teste';

const pedidoCerto = (mudar: Record<string, unknown> = {}) => ({
  response_type: 'code',
  redirect_uri: VOLTA,
  scope: 'cupons.ler pedidos.ler custos.ler clientes.telefone.ler',
  state: 'estado-do-liame-1234567890',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  conta_nome: 'Brasa Burger',
  conta_cnpj: '11.222.333/0001-00',
  conta_email: 'Paulo@BrasaBurger.Exemplo',
  ...mudar,
});

describe('autorização por clique — o número do pedido', () => {
  it('tem a forma da RFC 9126 com o prefixo do Regem e 43 caracteres; só o resumo é guardado', () => {
    const { numero, hash } = gerarPedido();
    expect(numero).toMatch(/^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/);
    expect(formatoDoPedido(numero)).toBe(true);
    expect(hash).toBe(hashDoPedido(numero));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(gerarPedido().numero).not.toBe(numero);
    for (const torto of ['', 'urn:ietf:params:oauth:request_uri:rct_' + 'a'.repeat(43), `${numero}x`, 42, null]) {
      expect(formatoDoPedido(torto)).toBe(false);
    }
  });
});

describe('autorização por clique — o pedido do aplicativo', () => {
  it('o pedido certo sai com as permissões separadas, na ordem do catálogo, e a conta que pede limpa', () => {
    const r = conferirPedido(pedidoCerto(), LIAME, CLIENT, [VOLTA]);
    expect(r).toEqual({
      redirectUri: VOLTA,
      necessarias: ['pedidos.ler', 'cupons.ler'],
      opcionais: ['clientes.telefone.ler', 'custos.ler'],
      state: 'estado-do-liame-1234567890',
      desafio: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      contaQuePede: { nome: 'Brasa Burger', cnpj: '11222333000100', email: 'paulo@brasaburger.exemplo', marca: null },
    });
  });

  it('o client_id, quando vem, tem de ser o do token; a marca vai junto', () => {
    expect(conferirPedido(pedidoCerto({ client_id: CLIENT, conta_marca: 'Brasa' }), LIAME, CLIENT, [VOLTA])).toMatchObject({
      contaQuePede: { marca: 'Brasa' },
    });
  });

  it.each([
    ['response_type errado', { response_type: 'token' }, 'response_type precisa ser "code".'],
    ['client_id de outro aplicativo', { client_id: 'outro-aplicativo' }, 'client_id não é o do token do DMS ID que fez o pedido.'],
    ['endereço de volta fora da lista', { redirect_uri: 'https://ataque.exemplo/cb' }, 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.'],
    ['endereço de volta com caminho a mais', { redirect_uri: `${VOLTA}/x` }, 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.'],
    ['sem permissão', { scope: '  ' }, 'scope precisa trazer ao menos uma permissão.'],
    ['permissão repetida', { scope: 'pedidos.ler pedidos.ler' }, 'scope tem permissão repetida.'],
    ['permissão que o Liame não pede pelo clique', { scope: 'pedidos.ler clientes.ler' }, 'A permissão "clientes.ler" não pode ser pedida por este aplicativo na autorização por clique.'],
    ['state curto', { state: 'curto' }, 'state precisa ter de 16 a 200 caracteres visíveis.'],
    ['state com espaço', { state: 'estado com espaco 123456' }, 'state precisa ter de 16 a 200 caracteres visíveis.'],
    ['PKCE plain', { code_challenge_method: 'plain' }, 'code_challenge_method precisa ser "S256".'],
    ['desafio torto', { code_challenge: 'curto' }, 'code_challenge precisa ser o SHA-256 do verificador, em base64url (43 caracteres).'],
    ['conta sem nome', { conta_nome: ' ' }, 'conta_nome precisa ter de 1 a 120 caracteres.'],
    ['nome comprido', { conta_nome: 'n'.repeat(121) }, 'conta_nome precisa ter de 1 a 120 caracteres.'],
    ['CNPJ torto', { conta_cnpj: '11.222.333/0001' }, 'conta_cnpj precisa ter 14 dígitos (ou ficar vazio).'],
    ['e-mail torto', { conta_email: 'paulo-sem-arroba' }, 'conta_email precisa ser um e-mail.'],
    ['marca comprida', { conta_marca: 'm'.repeat(121) }, 'conta_marca pode ter até 120 caracteres.'],
  ])('recusa %s com a frase do campo', (_nome, mudar, erro) => {
    expect(conferirPedido(pedidoCerto(mudar), LIAME, CLIENT, [VOLTA])).toEqual({ erro });
  });
});

describe('autorização por clique — a mesma empresa (C-3: a raiz do CNPJ)', () => {
  it('matriz e filial são a mesma empresa; outra raiz ou sem CNPJ é outra', () => {
    expect(raizDoCnpj('11.222.333/0002-00')).toBe('11222333');
    expect(raizDoCnpj('11222333')).toBe('');
    expect(ehOutraEmpresa('11222333000200', '11.222.333/0001-00')).toBe(false);
    expect(ehOutraEmpresa('44555666000100', '11222333000100')).toBe(true);
    expect(ehOutraEmpresa(null, '11222333000100')).toBe(true);
    expect(ehOutraEmpresa('11222333000100', null)).toBe(true);
    expect(ehOutraEmpresa(null, null)).toBe(true); // ninguém com CNPJ: não dá para dizer que é a mesma

  });

  it('o CNPJ sai com a máscara', () => {
    expect(cnpjComMascara('11222333000100')).toBe('11.222.333/0001-00');
    expect(cnpjComMascara(null)).toBeNull();
    expect(cnpjComMascara(' 123 ')).toBe('123');
  });
});

describe('autorização por clique — a senha e a configuração', () => {
  it('a senha errada diz quantas faltam; na quarta, "mais uma"; a trava diz os minutos', () => {
    expect(fraseDaSenhaErrada(1)).toBe('Senha incorreta. Nada foi autorizado. Mais 4 senhas erradas travam a autorização por 15 minutos.');
    expect(fraseDaSenhaErrada(4)).toBe('Senha incorreta. Nada foi autorizado. Mais uma senha errada trava a autorização por 15 minutos.');
    expect(fraseDaTrava(1)).toBe('A autorização está travada por 1 minuto: foram cinco senhas erradas seguidas. Nada foi liberado.');
    expect(fraseDaTrava(15)).toContain('por 15 minutos');
    expect(minutosDaTrava(new Date(1_000_000 + 61_000), 1_000_000)).toBe(2);
    expect(minutosDaTrava(new Date(999_000), 1_000_000)).toBe(1);
  });

  it('a chave liga só com a empresa e o CNPJ da DMS; torta fica desligada com o motivo', () => {
    expect(lerConfigClique({})).toMatchObject({ ligada: false, motivo: null });
    expect(lerConfigClique({ AUTORIZACAO_POR_CLIQUE: 'true', AUTORIZACAO_DMS_RAZAO_SOCIAL: 'DMS Exemplo', AUTORIZACAO_DMS_CNPJ: '33.444.555/0001-00' })).toEqual({
      ligada: true,
      empresa: 'DMS Exemplo',
      cnpj: '33444555000100',
      motivo: null,
    });
    expect(lerConfigClique({ AUTORIZACAO_POR_CLIQUE: 'true', AUTORIZACAO_DMS_RAZAO_SOCIAL: 'D', AUTORIZACAO_DMS_CNPJ: '33444555000100' }).ligada).toBe(false);
    expect(lerConfigClique({ AUTORIZACAO_POR_CLIQUE: 'true', AUTORIZACAO_DMS_RAZAO_SOCIAL: 'DMS Exemplo', AUTORIZACAO_DMS_CNPJ: '123' })).toMatchObject({
      ligada: false,
      motivo: 'AUTORIZACAO_DMS_CNPJ precisa ter 14 dígitos',
    });
    expect(lerConfigClique({ AUTORIZACAO_POR_CLIQUE: 'sim', AUTORIZACAO_DMS_RAZAO_SOCIAL: 'DMS Exemplo', AUTORIZACAO_DMS_CNPJ: '33444555000100' }).ligada).toBe(false);
  });

  it('o iss é a origem da API do Regem, sem caminho', () => {
    expect(emissorDoRegem('https://api.regem.exemplo/api/v1/integracao')).toBe('https://api.regem.exemplo');
  });

  it('as permissões saem na ordem do catálogo do Regem', () => {
    expect(naOrdemDoCatalogo(['cupons.criar', 'pedidos.ler', 'x', 'custos.ler'])).toEqual(['pedidos.ler', 'custos.ler', 'cupons.criar']);
  });
});

describe('autorização por clique — a tela', () => {
  const entrada = (mudar: Partial<EntradaDaTela> = {}): EntradaDaTela => ({
    cliente: 'liame',
    app: LIAME,
    dms: { empresa: 'DMS Exemplo Ltda', cnpj: '33444555000100' },
    pedido: {
      redirectUri: VOLTA,
      necessarias: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
      opcionais: ['custos.ler', 'cupons.criar', 'clientes.telefone.ler'],
      contaQuePede: { nome: 'Brasa Burger', cnpj: '11222333000100', email: 'paulo@brasaburger.exemplo', marca: null },
    },
    empresa: { nome: 'Brasa Burger', cnpj: '11222333000100' },
    lojas: [
      { id: 'loja-centro', nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: null, jaLiberado: [] },
      { id: 'loja-praia', nome: 'Brasa Praia', tipo: 'filial', fuso: 'America/Sao_Paulo', conectadaDesde: null, jaLiberado: [] },
    ],
    verFinanceiro: true,
    ...mudar,
  });

  it('a tela comum: título e abertura aprovados, nenhuma loja marcada com duas (C-2), opcionais e dado pessoal à parte', () => {
    const t = montarTela(entrada());
    expect(t.versao).toBe(1);
    expect(t.modo).toBe('nova');
    expect(t.titulo).toBe('O Liame quer ler as vendas das suas lojas');
    expect(t.abertura).toBe(
      'O Liame mede quais anúncios viraram pedido no caixa. Ele só lê o que estiver listado aqui; não muda pedido, preço nem cardápio. Você veio de app.agencialiame.com e volta para lá ao terminar.',
    );
    expect(t.lojas.map((l) => [l.nome, l.tipo, l.marcada])).toEqual([['Brasa Centro', 'Matriz', false], ['Brasa Praia', 'Filial', false]]);
    expect(t.ajudaLojas).toBe('Marque as lojas que o Liame vai ler. Cada uma ganha a própria ligação.');
    expect(t.necessarias.map((p) => p.id)).toEqual(['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler']);
    expect(t.opcionais.map((p) => [p.id, p.disponivel, p.opcional])).toEqual([['custos.ler', true, true], ['cupons.criar', true, true]]);
    expect(t.dadosDosClientes).toEqual([expect.objectContaining({ id: 'clientes.telefone.ler', dadoPessoal: true, opcional: true })]);
    expect(t.necessarias[0]).toMatchObject({ rotulo: 'Pedidos', motivo: 'Para saber qual anúncio ou link trouxe cada venda.', semEla: null });
    expect(t.aplicativo).toMatchObject({ selo: 'Produto da DMS', empresa: 'DMS Exemplo Ltda', cnpj: '33.444.555/0001-00' });
    expect(t.aplicativo.detalhes).toContain('o endereço de volta (api.liame.exemplo)');
    expect(t.contaQuePede).toEqual({ nome: 'Brasa Burger', cnpj: '11.222.333/0001-00', email: 'paulo@brasaburger.exemplo', marca: null, outraEmpresa: false });
    expect(t.confirmacao).toBeNull();
    expect(t.naoPode.map((n) => n.rotulo)).toEqual([
      'Mudar pedido, preço ou cardápio',
      'Mexer nos cupons da loja',
      'Ver quem é o cliente',
      'Ver o resto da operação',
      'Entrar no seu Regem',
    ]);
    expect(t.rodape).toBe('Fica registrado: quem autorizou, quando, este texto (versão 1), as lojas e o que foi liberado. Os presidentes da empresa recebem um e-mail.');
    expect(t.botoes).toEqual({ autorizar: 'Autorizar', cancelar: 'Cancelar' });
  });

  it('com uma loja só, ela já vem marcada e o título fala da sua loja', () => {
    const t = montarTela(entrada({ lojas: [entrada().lojas[0]] }));
    expect(t.lojas[0].marcada).toBe(true);
    expect(t.titulo).toBe('O Liame quer ler as vendas da sua loja');
    expect(t.ajudaLojas).toBeNull();
  });

  it('sem "Ver valores em R$", a chave do custo vem travada com o texto da trava', () => {
    const custo = montarTela(entrada({ verFinanceiro: false })).opcionais[0];
    expect(custo).toMatchObject({ id: 'custos.ler', disponivel: false, trava: CUSTO_TRAVADO });
  });

  it('a conta de outra empresa pede a confirmação com o nome e o CNPJ dela', () => {
    const t = montarTela(entrada({ pedido: { ...entrada().pedido, contaQuePede: { nome: 'Agência Vitrine', cnpj: '44555666000100', email: 'ana@vitrine.exemplo', marca: 'Brasa Burger' } } }));
    expect(t.contaQuePede.outraEmpresa).toBe(true);
    expect(t.confirmacao).toEqual({
      titulo: 'A conta que pede é de outra empresa',
      texto: 'A Agência Vitrine (CNPJ 44.555.666/0001-00) vai ver, pelo Liame, os dados das lojas marcadas listados aqui. Continue só se você contratou essa empresa.',
      rotulo: 'Contratei a Agência Vitrine e quero ligar a conta dela às lojas marcadas',
    });
  });

  it('a loja já conectada que ganha o telefone: o modo "pede mais", com o que já foi liberado', () => {
    const desde = new Date('2026-09-30T15:00:00Z');
    const t = montarTela(
      entrada({
        lojas: [{ id: 'loja-centro', nome: 'Brasa Centro', tipo: 'matriz', fuso: 'America/Sao_Paulo', conectadaDesde: desde, jaLiberado: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'custos.ler'] }],
        pedido: { ...entrada().pedido, opcionais: ['custos.ler', 'clientes.telefone.ler'] },
      }),
    );
    expect(t.modo).toBe('mais');
    expect(t.titulo).toBe('O Liame pede mais uma permissão');
    expect(t.abertura).toBe(
      'O Liame já lê a Brasa Centro desde 30/09/2026 e agora pede também o telefone do cliente no pedido. Se você disser não, ele continua com o que já tinha.',
    );
    expect(t.novas.map((p) => [p.id, p.opcional, p.naFrase])).toEqual([['clientes.telefone.ler', true, 'o telefone do cliente']]);
    expect(t.jaLiberado?.permissoes.map((p) => p.rotulo)).toEqual(['Pedidos', 'Custo dos itens', 'Aviso de cliente anonimizado', 'Cupons', 'Usos dos cupons']);
    expect(t.necessarias).toEqual([]);
    expect(t.lojas[0].nota).toBe('O que já foi liberado continua valendo. Autorizar soma o que está em “O que muda”.');
    expect(t.botoes).toEqual({ autorizar: 'Liberar o telefone', cancelar: 'Agora não' });
  });

  it('uma loja conectada e outra não: a tela comum, com a conectada marcada como tal', () => {
    const t = montarTela(
      entrada({
        lojas: [
          { ...entrada().lojas[0], conectadaDesde: new Date('2026-09-30T15:00:00Z'), jaLiberado: ['pedidos.ler'] },
          entrada().lojas[1],
        ],
      }),
    );
    expect(t.modo).toBe('nova');
    expect(t.lojas[0]).toMatchObject({ conectadaDesde: '2026-09-30T15:00:00.000Z', nota: 'O que já foi liberado continua valendo.' });
    expect(t.lojas[1].nota).toBeNull();
  });

  it('o texto guardado é a tela com a decisão: as lojas marcadas, as opcionais ligadas e a confirmação', () => {
    const t = montarTela(entrada());
    const g = textoGuardado(t, { lojas: ['loja-praia'], ligadas: ['cupons.criar'], confirmouOutraEmpresa: false });
    expect(g.lojas.map((l) => l.marcada)).toEqual([false, true]);
    expect(g.opcionais.map((o) => [o.id, o.ligada])).toEqual([['custos.ler', false], ['cupons.criar', true]]);
    expect(g.dadosDosClientes.map((o) => o.ligada)).toEqual([false]);
    expect(g.confirmouOutraEmpresa).toBeNull();
    expect(g.titulo).toBe(t.titulo);
  });
});
