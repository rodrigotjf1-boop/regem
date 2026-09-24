import { TaxaServicoBloqueada, linhaTaxaServico, tetoGorjetaIcms } from './taxa-servico';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { FiscalController } from './fiscal.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TAXA DE SERVIÇO NA NFC-e — cada caminho amarrado à norma (ver `taxa-servico.ts`):
//   CLT 457 §4º/§6º — gorjeta não é receita da casa e vai "na respectiva nota de consumo";
//   Conv. ICMS 125/11 — regime normal tira da base até 10% (SP 15%), no RJ como item CST 41;
//   Res. CGSN 140/18, art. 2º, §4º, II — no Simples ela INTEGRA a receita bruta.

const itens = [
  { quantidade: 2, precoUnitario: 32.9 },
  { quantidade: 1, precoUnitario: 7.5 },
]; // subtotal 73,30

describe('linha da taxa de serviço', () => {
  it('sem taxa na comanda, nada muda — nem a escolha da loja importa', () => {
    expect(linhaTaxaServico({ pct: 0, itens, modo: null })).toBeNull();
  });

  it('com taxa e SEM escolha da loja, a nota é recusada — a decisão é do contador, não nossa', () => {
    expect(() => linhaTaxaServico({ pct: 10, itens, modo: null })).toThrow(TaxaServicoBloqueada);
    expect(() => linhaTaxaServico({ pct: 10, itens, modo: '' })).toThrow(/Configuração fiscal/);
  });

  it('"fora da nota": a NFC-e fica só com os itens', () => {
    expect(linhaTaxaServico({ pct: 10, itens, modo: 'fora_da_nota', crt: 1 })).toBeNull();
  });

  it('o valor é exatamente o que a comanda cobrou a mais — o total da nota bate com o pagamento', () => {
    // A comanda cobra round2(73,30 × 1,10) = 80,63 → a linha é 7,33 (não 7,330000001).
    const l: any = linhaTaxaServico({ pct: 10, itens, modo: 'item_tributado', crt: 1 });
    expect(l.precoUnitario).toBe(7.33);
    const subtotal = itens.reduce((s, it) => s + it.quantidade * it.precoUnitario, 0);
    expect(Number((subtotal + l.precoUnitario).toFixed(2))).toBe(80.63);
  });

  it('Simples: linha TRIBUTADA com CSOSN 102 — a gorjeta integra a receita bruta (CGSN 140/18)', () => {
    const l: any = linhaTaxaServico({ pct: 15, itens, modo: 'item_tributado', crt: 1 });
    expect(l).toMatchObject({ csosn: '102', ncm: '00000000', cfop: '5102', quantidade: 1 });
    expect(l.descricao).toContain('15%');
  });

  it('Simples NÃO pode tirar a gorjeta da base — "não tributado" é recusado com o motivo', () => {
    expect(() => linhaTaxaServico({ pct: 10, itens, modo: 'item_nao_tributado', crt: 1 })).toThrow(/CGSN 140/);
  });

  it('regime normal: item NÃO tributado com CST 41, até o teto do Convênio 125/11', () => {
    const l: any = linhaTaxaServico({ pct: 10, itens, modo: 'item_nao_tributado', crt: 3, uf: 'RJ' });
    expect(l).toMatchObject({ cstIcms: '41', ncm: '00000000' });
  });

  it('regime normal acima do teto: recusa — o excedente é tributado e ainda não é separado', () => {
    expect(() => linhaTaxaServico({ pct: 12, itens, modo: 'item_nao_tributado', crt: 3, uf: 'RJ' })).toThrow(/até 10%/);
    // São Paulo tem 15% desde 19/02/2026 (Conv. 8/26).
    expect(() => linhaTaxaServico({ pct: 12, itens, modo: 'item_nao_tributado', crt: 3, uf: 'SP' })).not.toThrow();
  });

  it('o teto é por UF, não um número fixo no código', () => {
    expect(tetoGorjetaIcms('RJ')).toBe(10);
    expect(tetoGorjetaIcms('SP')).toBe(15);
  });

  it('regime normal "tributado" é recusado — exigiria CST 00 com base e alíquota', () => {
    expect(() => linhaTaxaServico({ pct: 10, itens, modo: 'item_tributado', crt: 3 })).toThrow(/CST 00/);
  });
});

// RBAC NO SERVIDOR: quem decide se um terminal emite nota é presidente ou gerência. A tela só
// esconde o botão; é a rota que tem de recusar os demais.
describe('quem pode mudar o terminal fiscal', () => {
  it('as rotas de terminais exigem presidente ou gerente', () => {
    for (const rota of ['terminais', 'definirTerminal'] as const) {
      const papeis = Reflect.getMetadata(ROLES_KEY, (FiscalController.prototype as any)[rota]);
      expect(papeis).toEqual(['presidente', 'gerente']);
    }
  });
});
