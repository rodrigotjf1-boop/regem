import { avisarAutorizacaoPorClique, emailDaAutorizacaoNova, emailDaLigacaoNova, emailDaPermissaoAMais } from './aviso-ligacao';

// O e-mail da ligação nova (Padrão DMS §3, B1-4) manda o presidente a uma tela do Regem: o caminho e o verbo têm de
// ser os do menu e do botão do Regem, não os do RegemCast, de onde o texto veio (ERR-269).
describe('e-mail da ligação nova', () => {
  const e = emailDaLigacaoNova({
    nome: 'Ana Souza',
    aplicativo: 'Liame',
    loja: 'Centro',
    desde: '22/10/2026',
    liberadoEm: '30/09/2026',
    link: 'https://app.exemplo.test/integracoes',
  });

  it('leva ao caminho do menu do Regem: Configurações › Aplicativos conectados', () => {
    for (const t of [e.texto, e.html]) {
      expect(t).toContain('Configurações › Aplicativos conectados');
      expect(t).not.toContain('Integrações');
    }
  });

  it('usa o verbo do botão da tela (Revogar), nunca "desligar"', () => {
    for (const t of [e.texto, e.html]) {
      expect(t).toContain('revoga quando quiser');
      expect(t).toContain('Revogue-o nessa mesma tela');
      expect(t.toLowerCase()).not.toMatch(/deslig/);
    }
  });

  it('o assunto e a saudação seguem a loja e o primeiro nome', () => {
    expect(e.assunto).toBe('O acesso do Liame à loja Centro mudou de forma');
    expect(e.texto.startsWith('Ana, desde 22/10/2026 o Liame lê a loja Centro no Regem')).toBe(true);
    expect(e.texto).toContain('https://app.exemplo.test/integracoes');
  });
});

// Os e-mails da autorização por clique (Hub DMS, F3, parte C): os textos aprovados pelo dono em 21/10/2026, com "com a
// própria senha" no lugar de "com a senha dele" (o presidente pode ser qualquer pessoa).
describe('e-mails da autorização por clique', () => {
  const comum = { nome: 'Marta Lima', aplicativo: 'Liame', hora: '10:20', data: '04/11/2026', por: 'Paulo', empresa: 'Brasa Burger', link: 'https://app.exemplo.test/integracoes' };

  it('loja nova: o que pode, o que ficou desligado, o que não pode e a quem perguntar', () => {
    const e = emailDaAutorizacaoNova({
      ...comum,
      lojas: ['Brasa Praia'],
      conta: { nome: 'Brasa Burger', cnpj: '11.222.333/0001-00' },
      pode: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
      desligado: ['custos.ler', 'cupons.criar', 'clientes.telefone.ler'],
      naoPode: 'Ele não pode mudar pedido, preço nem cardápio, nem ver nome, e-mail e endereço dos clientes.',
    });
    expect(e.assunto).toBe('O Liame foi autorizado na loja Brasa Praia');
    expect(e.texto).toBe(
      [
        'Marta, às 10:20 de 04/11/2026 o Paulo (presidente) autorizou o Liame a ler a loja Brasa Praia no Regem, com a própria senha. O pedido veio da conta Brasa Burger no Liame (CNPJ 11.222.333/0001-00).',
        'O Liame pode ver: pedidos, aviso de cliente anonimizado, cupons e usos dos cupons.',
        'Ficou desligado: custo dos itens, criar cupom de campanha e telefone do cliente no pedido.',
        'Ele não pode mudar pedido, preço nem cardápio, nem ver nome, e-mail e endereço dos clientes.',
        'Foi alguém da sua empresa? Não precisa fazer nada. Não reconhece? Revogue agora em Configurações › Aplicativos conectados.',
        'Aplicativos conectados: https://app.exemplo.test/integracoes',
        'Este aviso não se desliga: ele protege a sua empresa. Vai para todos os presidentes da Brasa Burger.',
      ].join('\n\n'),
    );
    expect(e.html).toContain('<b>O Liame pode ver:</b>');
    expect(e.html).toContain('Ver aplicativos conectados');
  });

  it('duas lojas no mesmo clique: um e-mail só, com as duas', () => {
    const e = emailDaAutorizacaoNova({ ...comum, lojas: ['Brasa Centro', 'Brasa Praia'], conta: { nome: 'Agência Vitrine', cnpj: null }, pode: ['pedidos.ler'], desligado: [], naoPode: '' });
    expect(e.assunto).toBe('O Liame foi autorizado nas lojas Brasa Centro e Brasa Praia');
    expect(e.texto).toContain('a ler as lojas Brasa Centro e Brasa Praia no Regem');
    expect(e.texto).toContain('(sem CNPJ informado)');
    expect(e.texto).not.toContain('Ficou desligado');
  });

  it('permissão a mais: o que passou a receber, como vai e o resto como estava', () => {
    const e = emailDaPermissaoAMais({
      ...comum,
      loja: 'Brasa Centro',
      hora: '10:12',
      novas: ['clientes.telefone.ler'],
      resto: ['pedidos.ler', 'custos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
    });
    expect(e.assunto).toBe('O Liame passou a receber o telefone do cliente na Brasa Centro');
    expect(e.texto.split('\n\n').slice(0, 4)).toEqual([
      'Marta, às 10:12 de 04/11/2026 o Paulo (presidente) liberou para o Liame o telefone do cliente no pedido, na loja Brasa Centro, com a própria senha.',
      'O telefone de quem fez o pedido, um código do cliente no Regem e se é o primeiro pedido dele na loja. Sem nome, e-mail e endereço, e nunca de pedido de aplicativo de entrega.',
      'O resto continua como estava: pedidos, custo dos itens, aviso de cliente anonimizado, cupons e usos dos cupons.',
      'Não reconhece? Revogue agora em Configurações › Aplicativos conectados.',
    ]);
  });

  describe('quem recebe o quê', () => {
    /** Um banco de mentira: devolve as respostas na ordem das consultas (a autorização, depois os presidentes). */
    const banco = (respostas: any[][]) => {
      const fila = [...respostas];
      return { execute: jest.fn(async () => ({ rows: fila.shift() ?? [] })) };
    };
    const autorizacao = {
      criado_em: '2026-11-04T13:20:00Z',
      conta_que_pede: { nome: 'Brasa Burger', cnpj: '11222333000100' },
      opcionais_desligados: ['cupons.criar'],
      empresa: 'Brasa Burger',
      fuso: 'America/Sao_Paulo',
    };
    const presidentes = [
      { nome: 'Marta Lima', email: 'marta@brasa.exemplo' },
      { nome: 'Paulo Reis', email: 'paulo@brasa.exemplo' },
    ];
    const base = { tenantId: '6f0c2a1e-4b7d-4e8a-9c3f-2d1e0b9a8c7d', cliente: 'liame', porNome: 'Paulo', autorizacaoId: '7d1f3a52-9c0e-4b6a-8f21-3e5d7c9b1a04' };

    it('loja nova e loja que ganhou permissão: os dois e-mails para cada presidente, na hora do clique no fuso da loja', async () => {
      const enviar = jest.fn(async () => true);
      await avisarAutorizacaoPorClique(
        banco([[autorizacao], presidentes]),
        {
          ...base,
          lojas: [
            { id: 'a', nome: 'Brasa Praia', escopos: ['pedidos.ler', 'cupons.ler'], antes: null },
            { id: 'b', nome: 'Brasa Centro', escopos: ['pedidos.ler', 'clientes.telefone.ler'], antes: ['pedidos.ler'] },
          ],
        },
        enviar,
      );
      expect(enviar).toHaveBeenCalledTimes(4);
      const assuntos = (enviar.mock.calls as any[]).map((c) => `${c[0]} · ${c[1]}`);
      expect(assuntos).toEqual(
        expect.arrayContaining([
          'marta@brasa.exemplo · O Liame foi autorizado na loja Brasa Praia',
          'marta@brasa.exemplo · O Liame passou a receber o telefone do cliente na Brasa Centro',
          'paulo@brasa.exemplo · O Liame foi autorizado na loja Brasa Praia',
          'paulo@brasa.exemplo · O Liame passou a receber o telefone do cliente na Brasa Centro',
        ]),
      );
      const texto = String((enviar.mock.calls as any[])[0][3]);
      expect(texto).toContain('às 10:20 de 04/11/2026');
      expect(texto).toContain('Ficou desligado: criar cupom de campanha.');
    });

    it('renovar com as mesmas permissões (ou menos) não manda nada nem consulta o banco', async () => {
      const enviar = jest.fn(async () => true);
      const db = banco([[autorizacao], presidentes]);
      await avisarAutorizacaoPorClique(db, { ...base, lojas: [{ id: 'b', nome: 'Brasa Centro', escopos: ['pedidos.ler'], antes: ['pedidos.ler', 'custos.ler'] }] }, enviar);
      expect(enviar).not.toHaveBeenCalled();
      expect(db.execute).not.toHaveBeenCalled();
    });

    it('nunca rejeita: o banco fora vira linha de log', async () => {
      const db = { execute: jest.fn(async () => Promise.reject(new Error('banco fora'))) };
      await expect(avisarAutorizacaoPorClique(db, { ...base, lojas: [{ id: 'a', nome: 'Brasa Praia', escopos: ['pedidos.ler'], antes: null }] })).resolves.toBeUndefined();
    });
  });
});
