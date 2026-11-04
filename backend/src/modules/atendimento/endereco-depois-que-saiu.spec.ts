import {
  type EnderecoDoCaso,
  enderecoEmUmaLinha,
  estadoDaMudancaDoEndereco,
  idDaMudancaDoCaso,
  lerEnderecoDoCaso,
  resumoDoCasoDoEndereco,
  taxaEscolhida,
  textoAoClienteDepoisQueSaiu,
  textoDoEnderecoAtualizado,
} from './endereco-depois-que-saiu';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2, decisão 8): o que o robô anota no caso, a taxa que a equipe pode escolher,
// o id da alteração (sem sorteio) e os textos do protótipo.

const caso = (o: any = {}): any => ({
  endereco: {
    pedidoId: 'p1',
    numero: '123',
    de: { rua: 'Rua das Flores', numero: '120', bairro: 'Centro', referencia: null },
    para: { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América', bairroId: 'b2', referencia: 'casa azul', lat: null, lng: null },
    taxaAntes: 6,
    taxaNova: 8,
    total: 45,
    aReceber: 45,
    comANova: { total: 47, aReceber: 47 },
    pagoAntes: false,
    formaPagamento: 'dinheiro',
    trocoPara: 50,
    entregador: { nome: 'João Silva', telefone: '21999990000', saiuEm: '2026-11-04T23:05:00.000Z' },
    via: 'cloud',
    em: '2026-11-04T23:06:00.000Z',
    ...o,
  },
});

describe('o endereço do caso (o que o robô anotou)', () => {
  it('lê o que o robô gravou; o que não tem a forma certa conta como nenhum', () => {
    const e = lerEnderecoDoCaso(caso())!;
    expect(e).toMatchObject({ pedidoId: 'p1', numero: '123', taxaAntes: 6, taxaNova: 8, total: 45, aReceber: 45, trocoPara: 50, via: 'cloud' });
    expect(e.comANova).toEqual({ total: 47, aReceber: 47 });
    expect(e.para).toMatchObject({ rua: 'Rua Ipê', numero: '45', bairroId: 'b2', referencia: 'casa azul' });
    // A distância ausente = ainda medindo (sem a chave); null = não deu para medir.
    expect('distancia' in e).toBe(false);
    expect(lerEnderecoDoCaso(caso({ distancia: null }))!.distancia).toBeNull();
    expect(lerEnderecoDoCaso(caso({ distancia: { km: 2.44, min: 6.6, pelo: 'caminho' } }))!.distancia).toEqual({ km: 2.4, min: 7, pelo: 'caminho' });
    expect(lerEnderecoDoCaso(caso({ comANova: { recusa: 'O troco não cobre.' } }))!.comANova).toEqual({ recusa: 'O troco não cobre.' });
    expect(lerEnderecoDoCaso(caso({ taxaNova: null, comANova: null }))).toMatchObject({ taxaNova: null, comANova: null });
    for (const ruim of [null, {}, { endereco: null }, { endereco: { pedidoId: 1, para: {} } }, { endereco: { pedidoId: 'p1' } }])
      expect(lerEnderecoDoCaso(ruim)).toBeNull();
  });

  it('a taxa que a equipe escolhe: a do pedido sempre; a nova só dentro da área, pago na entrega e com a conta que fecha', () => {
    const e = lerEnderecoDoCaso(caso())!;
    expect(taxaEscolhida(e, 'manter')).toEqual({ ok: true, taxa: 6 });
    expect(taxaEscolhida(e, 'nova')).toEqual({ ok: true, taxa: 8 });
    // Nunca um valor digitado.
    for (const x of [8, '8', 'outra', undefined, null]) expect(taxaEscolhida(e, x).ok).toBe(false);
    expect(taxaEscolhida(lerEnderecoDoCaso(caso({ taxaNova: null, comANova: null }))!, 'nova')).toMatchObject({ ok: false });
    expect(taxaEscolhida(lerEnderecoDoCaso(caso({ pagoAntes: true }))!, 'nova')).toMatchObject({ ok: false });
    expect((taxaEscolhida(lerEnderecoDoCaso(caso({ comANova: { recusa: 'O troco para R$ 50,00 não cobre o novo valor (R$ 52,00).' } }))!, 'nova') as any).mensagem).toBe(
      'O troco para R$ 50,00 não cobre o novo valor (R$ 52,00). Mantenha a taxa do pedido.',
    );
    // O pago pelo link mantém a taxa do pedido (o valor não muda).
    expect(taxaEscolhida(lerEnderecoDoCaso(caso({ pagoAntes: true }))!, 'manter')).toEqual({ ok: true, taxa: 6 });
  });

  it('o id da alteração não é sorteado: o mesmo caso e endereço dão o mesmo; outro endereço ou a tentativa nova, outro', () => {
    const a = idDaMudancaDoCaso('c1', '2026-11-04T23:06:00.000Z');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(idDaMudancaDoCaso('c1', '2026-11-04T23:06:00.000Z')).toBe(a);
    expect(idDaMudancaDoCaso('c1', '2026-11-04T23:09:00.000Z')).not.toBe(a);
    expect(idDaMudancaDoCaso('c2', '2026-11-04T23:06:00.000Z')).not.toBe(a);
    const nova = idDaMudancaDoCaso('c1', '2026-11-04T23:06:00.000Z', a);
    expect(nova).not.toBe(a);
    expect(idDaMudancaDoCaso('c1', '2026-11-04T23:06:00.000Z', a)).toBe(nova);
  });

  it('o estado pela alteração: aplicada, recusada, pedida — e a pedida passada da validade é "vencida"', () => {
    expect(estadoDaMudancaDoEndereco({ situacao: 'aplicada', aviso: { em: 'x' } })).toEqual({ situacao: 'aplicada', motivo: null, aviso: { em: 'x' } });
    expect(estadoDaMudancaDoEndereco({ situacao: 'recusada', motivo: 'O pedido mudou de situação.' })).toMatchObject({ situacao: 'recusada', motivo: 'O pedido mudou de situação.' });
    expect(estadoDaMudancaDoEndereco({ situacao: 'pedida', criadaEm: new Date().toISOString() })!.situacao).toBe('pedida');
    expect(estadoDaMudancaDoEndereco({ situacao: 'pedida', criadaEm: new Date(Date.now() - 60 * 60_000) })!.situacao).toBe('vencida');
    // A alteração ainda não chegou a este banco.
    expect(estadoDaMudancaDoEndereco({ situacao: null })).toBeNull();
  });
});

describe('os textos (protótipo, vista "Painel da loja" › "endereço depois que saiu")', () => {
  it('ao cliente: "já chamei" ao pedir e "Endereço atualizado!" quando a mudança vale', () => {
    expect(textoAoClienteDepoisQueSaiu('123')).toBe(
      'Seu pedido nº 123 já saiu para entrega, então a mudança de endereço passa pela equipe: ela avisa o entregador e confere a distância. Já chamei — alguém te responde aqui em instantes 🙋',
    );
    expect(textoAoClienteDepoisQueSaiu(null)).toMatch(/^Seu pedido já saiu para entrega/);
    expect(textoDoEnderecoAtualizado({ rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América' })).toBe(
      'Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍',
    );
  });

  it('o resumo do caso: o motivo, o que o cliente quer (o endereço novo e o de antes) e o que o robô já fez', () => {
    const e = lerEnderecoDoCaso(caso())! as EnderecoDoCaso;
    expect(enderecoEmUmaLinha(e.para)).toBe('Rua Ipê, 45 · Jardim América');
    expect(resumoDoCasoDoEndereco(e)).toEqual({
      motivo: 'o pedido nº 123 já saiu para a entrega e o cliente quer mudar o endereço',
      quer: 'entregar em Rua Ipê, 45 · Jardim América (casa azul) — o pedido vai para Rua das Flores, 120 · Centro',
      jaFez: 'chamei a equipe como urgente e avisei o cliente que a equipe avisa o entregador e confere a distância',
    });
  });
});
