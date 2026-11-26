import { NIVEIS_NO_MAXIMO, RESPOSTA_NO_MAXIMO, TEXTO_NO_MAXIMO, limparLeitura, palavrasDoCampo } from './leitura-limpa';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O filtro da leitura (versão 10, C3): o que a tela devolve, antes de ir à IA.

const comValores = { verValores: true };
const semValores = { verValores: false };
const limpar = (v: unknown, op = comValores) => limparLeitura(v, op)!;

describe('o filtro da leitura do Mister', () => {
  it('as palavras do nome do campo: camelCase, sublinhado e acento', () => {
    expect(palavrasDoCampo('clienteNome')).toEqual(['cliente', 'nome']);
    expect(palavrasDoCampo('valor_total')).toEqual(['valor', 'total']);
    expect(palavrasDoCampo('endereçoEntrega')).toEqual(['endereco', 'entrega']);
  });

  it('tira contato, documento, endereço, posição, foto, link e segredo, em qualquer nível', () => {
    const r = limpar({
      pedido: 42,
      telefone: '21999998888',
      contato: 'Seu Jorge',
      email: 'a@b.com',
      cpf: '12345678900',
      endereco: { rua: 'Rua A', numero: '10' },
      latitude: -22.9,
      fotoUrl: 'https://x/y.jpg',
      tokenDaApi: 'abc',
      senhaHash: 'h',
      itens: [{ produto: 'X-Bacon', quantidade: 2, whatsappCliente: '21988887777' }],
    });
    expect(r.dados).toEqual({ pedido: 42, itens: [{ produto: 'X-Bacon', quantidade: 2 }] });
    expect(r.tirados).toBe(10);
  });

  it('tira o cliente (texto, objeto ou lista), mas a contagem de clientes fica', () => {
    const r = limpar({ clienteNome: 'Maria', cliente: { nome: 'Maria' }, clientes: [{ nome: 'João' }], clientesAtivos: 30, novosClientes: 4, clienteId: 'c-1' });
    expect(r.dados).toEqual({ clientesAtivos: 30, novosClientes: 4 });
  });

  it('no objeto com cara de pessoa sai também o nome; no de empresa e no de loja, o nome fica', () => {
    const r = limpar({
      pessoas: [{ nome: 'Ana Souza', telefone: '21977776666', pedidos: 12 }],
      fornecedores: [{ nome: 'Hortifruti Bom Preço', cnpj: '12345678000190', telefone: '2133334444', pendencia: 'atrasado' }],
      lojas: [{ nome: 'Loja Centro', endereco: 'Rua B', timezone: 'America/Sao_Paulo' }],
      escala: [{ colaboradorNome: 'Carla', setor: 'Cozinha', horario: '18:00' }],
    });
    expect(r.dados).toEqual({
      pessoas: [{ pedidos: 12 }],
      fornecedores: [{ nome: 'Hortifruti Bom Preço', pendencia: 'atrasado' }],
      lojas: [{ nome: 'Loja Centro', timezone: 'America/Sao_Paulo' }],
      escala: [{ colaboradorNome: 'Carla', setor: 'Cozinha', horario: '18:00' }],
    });
  });

  it('o texto passa pelo filtro do dado pessoal, mas a data fica inteira', () => {
    const r = limpar({ obs: 'ligar para 21 98765-4321 ou ana@x.com', em: '2026-11-25 23:40:00', dia: '25/11/2026 23:40', iso: '2026-11-25T23:40:00.000Z', hora: '23:40' });
    expect(r.dados).toEqual({ obs: 'ligar para (número omitido) ou (e-mail omitido)', em: '2026-11-25 23:40:00', dia: '25/11/2026 23:40', iso: '2026-11-25T23:40:00.000Z', hora: '23:40' });
  });

  it('quem não vê valores não recebe campo de dinheiro, e o "R$" no texto vira oculto', () => {
    const r = limpar({ pedidos: 87, valorTotal: 4321.45, ticketMedio: 49.67, taxaEntrega: 7.5, saldo: 12, nota: 'Fechou com R$ 3.100,40' }, semValores);
    expect(r.dados).toEqual({ pedidos: 87, saldo: 12, nota: 'Fechou com R$ (oculto)' });
  });

  it('corta lista, texto e nível fundo, com a observação do corte', () => {
    const lista = Array.from({ length: 45 }, (_, i) => ({ n: i }));
    const fundo: any = {};
    let p = fundo;
    for (let i = 0; i < NIVEIS_NO_MAXIMO + 2; i++) p = p.a = {};
    const r = limpar({ lista, texto: 'x'.repeat(TEXTO_NO_MAXIMO + 50), fundo });
    expect((r.dados as any).lista).toHaveLength(30);
    expect((r.dados as any).texto).toHaveLength(TEXTO_NO_MAXIMO);
    expect(r.observacoes.join(' ')).toContain('tem 45 itens; vieram os 30 primeiros');
    expect(r.observacoes.join(' ')).toContain('cortado');
    expect(r.observacoes.join(' ')).toContain('fundo demais');
  });

  it('resposta grande: as listas encolhem até caber; nem com 4 itens cabe, devolve null', () => {
    // 30 itens de ~600 letras passam de 12.000: a lista encolhe para 15.
    const grande = Array.from({ length: 200 }, (_, i) => ({ i, descricao: 'y'.repeat(280), observacao: 'w'.repeat(280) }));
    const r = limpar(grande);
    expect(JSON.stringify(r.dados).length).toBeLessThanOrEqual(RESPOSTA_NO_MAXIMO);
    expect((r.dados as any[]).length).toBeLessThan(30);
    const enorme = Array.from({ length: 50 }, () => Object.fromEntries(Array.from({ length: 40 }, (_, k) => [`campo${k}`, 'z'.repeat(280)])));
    expect(limparLeitura(enorme, comValores)).toBeNull();
  });
});
