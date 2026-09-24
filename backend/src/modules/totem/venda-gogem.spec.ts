import {
  documentoParaNota,
  ehDinheiro,
  paraPedidoDinheiro,
  paraVendaExternaPdv,
  respostaParaTotem,
  totalCentavos,
} from './venda-gogem';

// R3b — o que quebraria dinheiro de verdade: fator 100 errado, split tratado como
// dinheiro, senha indo como número (o DTO do Regem valida @IsString) e campo interno
// do Regem vazando para o aparelho.
const venda = {
  idempotencyKey: 'uuid-1',
  itens: [{ codigoPdv: '101', quantidade: 2, observacao: 'sem cebola' }],
  pagamentos: [{ forma: 'credito', valor: 2990, nsu: '123', autorizacao: 'A1' }],
  cpf: '12345678909',
  cliente: 'Ana',
  consumo: 'viagem',
  taxaServicoPct: 10,
  senhaLocal: 37,
};

describe('venda-gogem (R3b)', () => {
  it('converte CENTAVOS do totem em REAIS do Regem', () => {
    const r = paraVendaExternaPdv(venda);
    expect(r.pagamentos[0].valor).toBe(29.9);
    expect(paraVendaExternaPdv({ pagamentos: [{ forma: 'pix', valor: 1 }] }).pagamentos[0].valor).toBe(0.01);
    expect(paraVendaExternaPdv({ pagamentos: [{ forma: 'pix', valor: 199999 }] }).pagamentos[0].valor).toBe(1999.99);
  });

  it('leva itens, CPF, cliente, consumo e taxa; marca a plataforma', () => {
    const r = paraVendaExternaPdv(venda);
    expect(r.itens).toEqual([{ codigoPdv: '101', quantidade: 2, observacao: 'sem cebola' }]);
    expect(r.cpf).toBe('12345678909');
    expect(r.cliente).toBe('Ana');
    expect(r.consumo).toBe('viagem');
    expect(r.taxaServicoPct).toBe(10);
    expect(r.plataforma).toBe('GoGeM Totem');
  });

  it('senha do totem vai como STRING (o DTO do Regem valida @IsString)', () => {
    expect(paraVendaExternaPdv(venda).senhaPlataforma).toBe('37');
    expect(paraPedidoDinheiro({ ...venda, senhaLocal: 37 }).senhaPlataforma).toBe('37');
    expect(paraVendaExternaPdv({ ...venda, senhaLocal: undefined }).senhaPlataforma).toBeUndefined();
  });

  it('campos vazios não viram lixo no corpo', () => {
    const r = paraVendaExternaPdv({ idempotencyKey: 'k', itens: [], pagamentos: [] });
    expect('cpf' in r).toBe(false);
    expect('cliente' in r).toBe(false);
    expect('senhaPlataforma' in r).toBe(false);
  });

  it('dinheiro puro é dinheiro; split com cartão NÃO é', () => {
    expect(ehDinheiro({ pagamentos: [{ forma: 'dinheiro', valor: 100 }] })).toBe(true);
    expect(ehDinheiro({ pagamentos: [{ forma: 'DINHEIRO', valor: 100 }] })).toBe(true);
    expect(ehDinheiro({ pagamentos: [{ forma: ' dinheiro ', valor: 100 }] })).toBe(true);
    expect(
      ehDinheiro({ pagamentos: [{ forma: 'dinheiro', valor: 100 }, { forma: 'credito', valor: 50 }] }),
    ).toBe(false);
    expect(ehDinheiro({ pagamentos: [] })).toBe(false);
    expect(ehDinheiro({})).toBe(false);
  });

  it('dinheiro leva o total em CENTAVOS (contrato do totem-dinheiro)', () => {
    const r = paraPedidoDinheiro({
      ...venda,
      pagamentos: [{ forma: 'dinheiro', valor: 1550 }, { forma: 'dinheiro', valor: 450 }],
    });
    expect(r.totalCentavos).toBe(2000);
    expect(totalCentavos({ pagamentos: [{ forma: 'x', valor: 1 }, { forma: 'y', valor: 2 }] })).toBe(3);
  });

  it('pedido que nasce antes do pagamento não manda pagamentos (não é venda fechada)', () => {
    const r: any = paraPedidoDinheiro(venda);
    expect(r.pagamentos).toBeUndefined();
    expect(r.itens).toEqual([{ codigoPdv: '101', quantidade: 2 }]);
  });

  // Antes o CPF ficava de fora "porque não é venda fechada" — mas a NOTA sai depois (na
  // liberação do retido, ou no balcão no dinheiro) e lê o CPF do pedido. O cliente digitava
  // o CPF no totem e a nota saía sem ele; acima do limite da UF, a emissão era recusada.
  it('pedido que nasce antes do pagamento LEVA o CPF para a nota', () => {
    expect(paraPedidoDinheiro(venda).cpf).toBe('12345678909');
    expect(paraPedidoDinheiro({ ...venda, cpf: '123.456.789-09' }).cpf).toBe('12345678909');
    expect('cpf' in paraPedidoDinheiro({ ...venda, cpf: undefined })).toBe(false);
  });

  it('documento para a nota: só dígitos, e só com 11 (CPF) ou 14 (CNPJ)', () => {
    expect(documentoParaNota('123.456.789-09')).toBe('12345678909');
    expect(documentoParaNota('12.345.678/0001-95')).toBe('12345678000195');
    expect(documentoParaNota('123')).toBeUndefined();
    expect(documentoParaNota('')).toBeUndefined();
    expect(documentoParaNota(null)).toBeUndefined();
    expect(paraVendaExternaPdv({ ...venda, cpf: '123.456.789-09' }).cpf).toBe('12345678909');
  });

  it('resposta ao totem não vaza campo interno do Regem', () => {
    const r = respostaParaTotem({
      comandaId: 'c1',
      senha: 12,
      total: 29.9,
      producaoPayloads: [{ segredo: true }],
      nfce: { status: 'autorizada' },
    });
    expect(r).toEqual({ comandaId: 'c1', senha: 12, total: 29.9, nfce: { status: 'autorizada' } });
    expect('producaoPayloads' in r).toBe(false);
  });

  it('resposta do dinheiro usa o numero do pedido como senha', () => {
    expect(respostaParaTotem({ id: 'p1', numero: 284, total: 20 })).toEqual({
      comandaId: null,
      senha: 284,
      total: 20,
    });
  });

  it('total numeric do Postgres ("20.00") chega ao totem como NÚMERO', () => {
    // Visto no ambiente real: o caminho do dinheiro devolve a coluna numeric como
    // string e o do cartão devolve number — o app receberia tipos diferentes.
    expect(respostaParaTotem({ numero: 1, total: '20.00' })).toEqual({
      comandaId: null,
      senha: 1,
      total: 20,
    });
    expect(respostaParaTotem({ total: 'abc' }).total).toBeNull();
  });

  it('replay idempotente é sinalizado', () => {
    expect(respostaParaTotem({ comandaId: 'c1', idempotente: true })).toEqual({
      comandaId: 'c1',
      senha: null,
      total: null,
      idempotente: true,
    });
  });
});
