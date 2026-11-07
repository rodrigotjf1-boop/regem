import { lerPedidoDeSugestao, limparSugestao, mascarar, montarPedido, MAX_SUGESTAO } from './copiloto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O COPILOTO (mig 376) — as regras puras: o que a tela manda, o que sai da conversa antes de ir ao modelo, o pedido ao
// modelo (o mínimo de dado; a regra da plataforma no chat do iFood e da 99) e a limpeza da sugestão.
const contexto = (o: Record<string, unknown> = {}): any => ({
  loja: 'Burger da Praça',
  canal: 'whatsapp',
  tipoDoCaso: 'atraso',
  cliente: 'Carlos Alberto Souza',
  resumo: { motivo: 'Atraso', quer: 'Saber quando chega', jaFez: 'Mandou o rastreio' },
  pedido: { numero: '1180', status: 'despachado', tipo: 'entrega', itens: [{ nome: 'X-tudo', quantidade: 1 }], criadoEm: '2026-11-06T21:48:00Z', despachadoEm: '2026-11-06T22:31:00Z', entregador: 'João Pereira' },
  mensagens: [{ de: 'cliente', texto: 'Cadê meu lanche? Meu número é (21) 98765-4321' }],
  prontas: ['Pedimos desculpas pela demora.'],
  ...o,
});

describe('copiloto — regras', () => {
  it('o que a tela manda: precisa de mensagem do cliente; as 30 mais novas; até 10 respostas prontas; quem falou desconhecido = cliente', () => {
    expect(() => lerPedidoDeSugestao({})).toThrow('Mande as mensagens da conversa.');
    expect(() => lerPedidoDeSugestao({ mensagens: [{ de: 'loja', texto: 'Oi' }] })).toThrow('Ainda não há mensagem do cliente');
    const muitas = Array.from({ length: 40 }, (_, i) => ({ de: i % 2 ? 'loja' : 'cliente', texto: `m${i}` }));
    const r = lerPedidoDeSugestao({ mensagens: [...muitas, { de: 'outro', texto: '  oi   tudo bem ' }, { de: 'cliente', texto: '' }], prontas: Array(15).fill('ok') });
    expect(r.mensagens).toHaveLength(30);
    expect(r.mensagens[29]).toEqual({ de: 'cliente', texto: 'oi tudo bem' });
    expect(r.prontas).toHaveLength(10);
  });

  it('o mínimo de dado: telefone, e-mail, documento e número longo saem da conversa', () => {
    expect(mascarar('liga (21) 98765-4321 ou +55 21 98765 4321')).toBe('liga [número] ou [número]');
    expect(mascarar('meu email é ana.p@gmail.com')).toBe('meu email é [e-mail]');
    expect(mascarar('cpf 123.456.789-09')).toBe('cpf [documento]');
    expect(mascarar('pedido 1180 às 19h55')).toBe('pedido 1180 às 19h55');
  });

  it('o pedido ao modelo: o primeiro nome, o pedido e a conversa sem o telefone; nada inventado; a regra do canal', () => {
    const { system, conteudo } = montarPedido(contexto());
    expect(system).toContain('Burger da Praça');
    expect(system).toContain('no WhatsApp');
    expect(system).toContain('Nunca invente prazo, valor, desconto, reembolso');
    expect(system).not.toContain('nunca escreva telefone, WhatsApp');
    expect(conteudo).toContain('Cliente: Carlos.');
    expect(conteudo).not.toContain('Souza');
    expect(conteudo).toContain('Pedido 1180:');
    expect(conteudo).toContain('- Situação: em rota de entrega.');
    expect(conteudo).toContain('- Itens: 1× X-tudo.');
    expect(conteudo).toContain('- Saiu para entrega às 19:31 com João.');
    expect(conteudo).toContain('Cliente: Cadê meu lanche? Meu número é [número]');
    expect(conteudo).not.toContain('98765');
    expect(conteudo).toContain('- Pedimos desculpas pela demora.');
    const doIfood = montarPedido(contexto({ canal: 'ifood' })).system;
    expect(doIfood).toContain('no chat do iFood');
    expect(doIfood).toContain('nunca escreva telefone, WhatsApp, Instagram, e-mail nem link');
  });

  it('a sugestão: sem aspas nem rótulo, até 700 letras; no chat da plataforma, a que traz telefone, rede ou link não vale', () => {
    expect(limparSugestao('"Carlos, o João chega às 19h55."', 'whatsapp')).toBe('Carlos, o João chega às 19h55.');
    expect(limparSugestao('Sugestão de resposta: Oi, Carlos!', 'whatsapp')).toBe('Oi, Carlos!');
    expect(limparSugestao('   ', 'whatsapp')).toBeNull();
    expect(limparSugestao('a'.repeat(900), 'whatsapp')!.length).toBe(MAX_SUGESTAO);
    expect(limparSugestao('Chama no WhatsApp (21) 98765-4321', 'ifood')).toBeNull();
    expect(limparSugestao('Veja em www.loja.com', '99food')).toBeNull();
    expect(limparSugestao('Maria, o Carlos chega em 5 minutos.', 'ifood')).toBe('Maria, o Carlos chega em 5 minutos.');
  });
});
