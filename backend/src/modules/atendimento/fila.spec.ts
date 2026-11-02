import { canalDoCaso, canalValido, compararNaFila, posicoes, situacaoDo } from './fila';

// AS REGRAS DA FILA (central de atendimento, Onda 1 — protótipo aprovado pelo dono em 02/11/2026), sem banco.

describe('canal do caso', () => {
  it('o gravado vale; fora da lista não é canal', () => {
    expect(canalValido('ifood')).toBe('ifood');
    expect(canalValido('99food')).toBe('99food');
    expect(canalValido('telegram')).toBeNull();
    expect(canalDoCaso({ canal: 'cardapio', telefone: '21987654321' })).toBe('cardapio');
  });

  it('chamado antigo (sem canal): o do pedido ligado; sem pedido, quem tem telefone veio do WhatsApp', () => {
    expect(canalDoCaso({ canal: null, pedidoCanal: 'ifood' })).toBe('ifood');
    expect(canalDoCaso({ canal: null, pedidoCanal: '99food' })).toBe('99food');
    expect(canalDoCaso({ canal: null, pedidoCanal: 'cardapio', telefone: '21987654321' })).toBe('cardapio');
    expect(canalDoCaso({ canal: null, pedidoCanal: null, telefone: '21987654321' })).toBe('whatsapp');
    expect(canalDoCaso({ canal: null, pedidoCanal: null, telefone: null })).toBeNull();
  });
});

describe('situação do caso', () => {
  it('resolvido > aguardando o cliente > com alguém > na fila', () => {
    expect(situacaoDo({ status: 'resolvido', responsavelId: 'x', aguardandoDesde: new Date() })).toBe('resolvido');
    expect(situacaoDo({ status: 'aberto', responsavelId: 'x', aguardandoDesde: new Date() })).toBe('aguardando');
    expect(situacaoDo({ status: 'aberto', responsavelId: 'x', aguardandoDesde: null })).toBe('com_alguem');
    expect(situacaoDo({ status: 'aberto', responsavelId: null, aguardandoDesde: null })).toBe('fila');
  });
});

describe('ordem da fila', () => {
  const agora = Date.now();
  const em = (seg: number) => new Date(agora + seg * 1000);
  const caso = (id: string, extra: Record<string, unknown>) => ({ id, prioridade: 'normal', criadoEm: em(-600), ...extra });

  it('prazo mais curto primeiro, depois urgente, depois quem espera há mais tempo', () => {
    const lista = [
      caso('normal-novo', { criadoEm: em(-60) }),
      caso('urgente', { prioridade: 'urgente', criadoEm: em(-30) }),
      caso('prazo-longo', { prazoEm: em(600) }),
      caso('normal-velho', { criadoEm: em(-900) }),
      caso('prazo-curto', { prazoEm: em(120) }),
    ];
    expect([...lista].sort(compararNaFila).map((c) => c.id)).toEqual([
      'prazo-curto',
      'prazo-longo',
      'urgente',
      'normal-velho',
      'normal-novo',
    ]);
  });

  it('a posição conta só quem espera uma pessoa (sem responsável, sem aguardar o cliente, sem prazo)', () => {
    const ordenados = [
      { id: 'disputa', prazoEm: em(300), responsavelId: null, aguardandoDesde: null, status: 'aberto' },
      { id: 'a', prazoEm: null, responsavelId: null, aguardandoDesde: null, status: 'aberto' },
      { id: 'comigo', prazoEm: null, responsavelId: 'ana', aguardandoDesde: null, status: 'aberto' },
      { id: 'esperando', prazoEm: null, responsavelId: 'bruno', aguardandoDesde: em(-60), status: 'aberto' },
      { id: 'b', prazoEm: null, responsavelId: null, aguardandoDesde: null, status: 'aberto' },
    ];
    expect(posicoes(ordenados).map((c) => [c.id, c.posicao])).toEqual([
      ['disputa', null],
      ['a', 1],
      ['comigo', null],
      ['esperando', null],
      ['b', 2],
    ]);
  });
});
