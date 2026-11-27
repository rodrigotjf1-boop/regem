import { pontoDaLocalizacao, promocoesParaOCliente, taxaDoEndereco } from './robo-consultas';
import { RoboConsultasController } from './robo-consultas.controller';
import { fluxoComFerramentas26, instrucoesDoRobo } from './robo-instrucoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Itens 4 e 5 do plano das leituras do Mister para o atendente (o "pode" do dono, 27/11/2026): a taxa pelo endereço sem
// montar pedido e as promoções quando o cliente pergunta — e as instruções que só falam delas ao fluxo 2.6.
const MENU_DISTANCIA: any = { loja: { areaModo: 'raio', freteGratisAcima: 80 } };
const MENU_MAPA: any = { loja: { areaModo: 'mapa' } };
const MENU_BAIRRO: any = { loja: { areaModo: 'bairro' }, bairros: [{ id: 'b1', nome: 'Centro', taxa: 5 }] };

describe('a taxa pelo endereço (item 4)', () => {
  it('por distância: atende, a taxa, a distância e o frete grátis da loja; nunca as coordenadas', () => {
    const r: any = taxaDoEndereco(MENU_DISTANCIA, { taxaCheia: 7, alemDaUltimaFaixa: false, semLocalizacao: false, km: 3.24, area: null });
    expect(r).toEqual({ modo: 'distancia', encontrado: true, atende: true, taxa: 'R$ 7,00', distanciaKm: 3.2, freteGratisAcima: 'R$ 80,00' });
    expect(JSON.stringify(r)).not.toMatch(/lat|lng|ponto|poligono/);
  });

  it('por área no mapa: o tempo, o mínimo e o frete grátis da ÁREA', () => {
    const area = { tempoMin: 30, tempoMax: 45, pedidoMinimo: 25, freteGratisAcima: 100 };
    expect(taxaDoEndereco(MENU_MAPA, { taxaCheia: 6, alemDaUltimaFaixa: false, semLocalizacao: false, km: null, area })).toEqual({
      modo: 'mapa',
      encontrado: true,
      atende: true,
      taxa: 'R$ 6,00',
      tempo: '30 a 45 min',
      pedidoMinimo: 'R$ 25,00',
      freteGratisAcima: 'R$ 100,00',
    });
  });

  it('fora da área: "não cobre a região"; endereço não achado: pede a localização', () => {
    expect(taxaDoEndereco(MENU_DISTANCIA, { taxaCheia: 0, alemDaUltimaFaixa: true, semLocalizacao: false, km: 12 })).toEqual({
      modo: 'distancia',
      encontrado: true,
      atende: false,
      mensagem: 'Infelizmente nosso delivery não cobre a região.',
    });
    expect(taxaDoEndereco(MENU_MAPA, { taxaCheia: 0, alemDaUltimaFaixa: false, semLocalizacao: true, km: null })).toMatchObject({ encontrado: false, precisa: 'localizacao' });
  });

  it('a localização do WhatsApp: "[localização] lat,lng"; lixo ou 0,0 não vale', () => {
    expect(pontoDaLocalizacao('[localização] -22.9068,-43.1729')).toEqual({ lat: -22.9068, lng: -43.1729 });
    expect(pontoDaLocalizacao('-22.9, -43.2')).toEqual({ lat: -22.9, lng: -43.2 });
    for (const v of ['', 'perto da praça', '0,0', '95,10', null]) expect(pontoDaLocalizacao(v)).toBeNull();
  });

  describe('a rota publico/bot/taxa', () => {
    const montar = (menu: any) => {
      const chamadas: any[] = [];
      const service: any = {
        tokenDaLojaDoRobo: async () => 'tok',
        menu: async () => menu,
        resolver: async () => ({ tenantId: 't', areaModo: menu.loja.areaModo }),
        taxaDeEntrega: async (_cfg: any, dto: any, total: number) => {
          chamadas.push({ dto, total });
          return { taxaCheia: 7, alemDaUltimaFaixa: false, semLocalizacao: false, km: 2, area: null };
        },
      };
      return { ctl: new RoboConsultasController(service), chamadas };
    };

    it('por distância com rua e número: a MESMA conta do cardápio, sem montar pedido (total 0)', async () => {
      const { ctl, chamadas } = montar(MENU_DISTANCIA);
      const r: any = await ctl.taxa(undefined, 'inst', undefined, undefined, 'senha', 'Rua das Flores', '120');
      expect(r).toMatchObject({ atende: true, taxa: 'R$ 7,00' });
      expect(chamadas).toEqual([{ dto: { rua: 'Rua das Flores', numero: '120' }, total: 0 }]);
    });

    it('com a localização: vai o ponto (o endereço digitado fica de fora)', async () => {
      const { ctl, chamadas } = montar(MENU_MAPA);
      await ctl.taxa(undefined, 'inst', undefined, undefined, 'senha', 'Rua X', '1', '[localização] -22.9,-43.2');
      expect(chamadas).toEqual([{ dto: { lat: -22.9, lng: -43.2 }, total: 0 }]);
    });

    it('sem número (ou loja por bairro): como antes — as faixas ou a taxa do bairro', async () => {
      const dist = montar(MENU_DISTANCIA);
      const r: any = await dist.ctl.taxa(undefined, 'inst', undefined, undefined, 'senha', 'Rua das Flores');
      expect(r).toMatchObject({ modo: 'distancia', encontrado: false });
      expect(dist.chamadas).toEqual([]);
      const bairro = montar(MENU_BAIRRO);
      expect(await bairro.ctl.taxa('centro', 'inst', undefined, undefined, 'senha', 'Rua A', '10')).toMatchObject({ encontrado: true, bairro: 'Centro', taxa: 'R$ 5,00' });
      expect(bairro.chamadas).toEqual([]);
    });
  });
});

describe('as promoções quando o cliente pergunta (item 5)', () => {
  it('o desconto como o cliente entende, o mínimo e os planos da fidelidade', () => {
    const r = promocoesParaOCliente(
      [
        { codigo: 'BEMVINDO', tipo: 'percentual', valor: 10, tetoDesconto: 15, minimo: 40 },
        { codigo: 'FRETE', tipo: 'fretegratis', valor: 0, minimo: null },
        { codigo: 'CINCO', tipo: 'valor', valor: 5, minimo: null },
      ],
      { ativa: true, planos: [{ nome: 'Cartão fidelidade', pontosMeta: 10, recompensa: '1 lanche grátis' }] },
    );
    expect(r.cupons).toEqual([
      { codigo: 'BEMVINDO', desconto: '10% de desconto (até R$ 15,00)', pedidoMinimo: 'R$ 40,00' },
      { codigo: 'FRETE', desconto: 'frete grátis' },
      { codigo: 'CINCO', desconto: 'R$ 5,00 de desconto' },
    ]);
    expect(r.fidelidade).toEqual([{ nome: 'Cartão fidelidade', pontosMeta: 10, recompensa: '1 lanche grátis' }]);
    expect(r.comoResponder).toContain('Não invente outro desconto');
  });

  it('nada para este cliente: diz que não há, sem prometer; a fidelidade desligada não aparece', () => {
    const r = promocoesParaOCliente([], { ativa: false, planos: [{ nome: 'x' }] });
    expect(r).toMatchObject({ cupons: [], fidelidade: [] });
    expect(r.comoResponder).toContain('Não há promoção');
  });
});

describe('as instruções só falam das ferramentas da 2.6 ao fluxo 2.6', () => {
  it('a versão do fluxo', () => {
    for (const v of ['2.6', '2.10', '3.0', '2.6.1']) expect(fluxoComFerramentas26(v)).toBe(true);
    for (const v of ['2.5', '2', '', undefined, 'lixo', '1.9']) expect(fluxoComFerramentas26(v)).toBe(false);
  });

  it('o 2.5 no ar (sem a marca) não vê promocoes_da_loja nem a taxa por endereço; o 2.6 vê', () => {
    const sem = instrucoesDoRobo({ loja: 'Loja' }, '2').texto;
    const com = instrucoesDoRobo({ loja: 'Loja', ferramentas26: true }, '2').texto;
    expect(sem).not.toContain('promocoes_da_loja');
    expect(sem).not.toContain('taxa_de_entrega com rua e numero');
    expect(sem).toContain('quem diz é definir_entrega (fora_da_area)');
    expect(com).toContain('promocoes_da_loja');
    expect(com).toContain('taxa_de_entrega com rua e numero');
    expect(com).toContain('5. Cupom, promoção ou desconto: quando o CLIENTE perguntar, chame promocoes_da_loja');
    // O fluxo 1 nunca, mesmo com a marca.
    expect(instrucoesDoRobo({ loja: 'Loja', ferramentas26: true }, '1').texto).not.toContain('promocoes_da_loja');
  });
});
