import { CardapioPublicoController } from './cardapio.controller';
import {
  alcanceDasFaixas,
  areaDoPonto,
  conferirAreas,
  MAX_AREAS,
  MAX_PONTOS,
  pontoNoPoligono,
  raioConfigurado,
  recusaDaArea,
  type AreaDesenhada,
} from './area-de-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ÁREA DE ENTREGA DO PEDIDO DO CARDÁPIO (ERR-470): o pedido #71 saiu a ~119 km com frete R$ 0 e foi pago no Pix.
// As faixas são as da loja-piloto (a última, até 1,9 km, é R$ 0).
const RAIOS = [{ ateKm: 0.5, taxa: 5 }, { ateKm: 1, taxa: 5 }, { ateKm: 1.5, taxa: 6 }, { ateKm: 1.9, taxa: 0 }];
const RAIO = { areaModo: 'raio', raios: RAIOS, endLat: '-22.84', endLng: '-43.27' };
const taxa = (p: Partial<{ alemDaUltimaFaixa: boolean; semLocalizacao: boolean; km: number | null; bairro: any }> = {}) => ({
  alemDaUltimaFaixa: false,
  semLocalizacao: false,
  km: 1,
  bairro: null,
  ...p,
});

describe('área de entrega do cardápio (ERR-470)', () => {
  it('além da última faixa: recusa com a distância e o alcance', () => {
    expect(recusaDaArea(RAIO, taxa({ alemDaUltimaFaixa: true, km: 119.2 }))).toEqual({
      code: 'FORA_DA_AREA',
      message: 'Não entregamos nesse endereço: ele fica a ~119,2 km da loja, e a entrega vai até 1,9 km. Confira o endereço.',
    });
  });

  it('dentro das faixas: passa', () => {
    expect(recusaDaArea(RAIO, taxa({ km: 1.9 }))).toBeNull();
  });

  it('endereço que não se acha no mapa (loja configurada): recusa e pede a localização', () => {
    expect(recusaDaArea(RAIO, taxa({ semLocalizacao: true, km: null }))?.code).toBe('ENDERECO_NAO_ENCONTRADO');
  });

  it('modo distância com o cadastro da loja incompleto: não recusa (seria parar todas as entregas sem aviso)', () => {
    for (const cfg of [
      { ...RAIO, raios: [] },
      { ...RAIO, raios: [{ ateKm: 'x', taxa: 3 }] },
      { ...RAIO, endLat: null },
      { ...RAIO, endLng: '' },
    ]) {
      expect(raioConfigurado(cfg)).toBe(false);
      expect(recusaDaArea(cfg, taxa({ alemDaUltimaFaixa: true, km: 9000 }))).toBeNull();
      expect(recusaDaArea(cfg, taxa({ semLocalizacao: true }))).toBeNull();
    }
  });

  it('modo bairro: sem bairro da lista recusa; com bairro passa', () => {
    expect(recusaDaArea({ areaModo: 'bairro' }, taxa())?.code).toBe('BAIRRO_FORA_DA_AREA');
    expect(recusaDaArea({ areaModo: null }, taxa())?.code).toBe('BAIRRO_FORA_DA_AREA'); // sem modo = bairro (o padrão)
    expect(recusaDaArea({ areaModo: 'bairro' }, taxa({ bairro: { id: 'b1', nome: 'Penha' } }))).toBeNull();
  });

  it('alcance = a maior faixa válida, em qualquer ordem', () => {
    expect(alcanceDasFaixas([{ ateKm: 3 }, { ateKm: 1 }, { ateKm: 'x' }, { ateKm: -2 }])).toBe(3);
    expect(alcanceDasFaixas(null)).toBeNull();
  });

  it('a rota pública tira o `_sistema` do corpo (só a rotina da recorrência o usa)', async () => {
    const recebido: any[] = [];
    const ctrl = new (CardapioPublicoController as any)({ receberPedido: async (_t: string, dto: any) => recebido.push(dto) });
    await ctrl.pedido('tk', { _sistema: true, tipo: 'entrega', cliente: 'Ana' });
    expect(recebido[0]).toEqual({ tipo: 'entrega', cliente: 'Ana' });
    await ctrl.pedido('tk', null);
    expect(recebido[1]).toEqual({});
  });
});

// A ÁREA DESENHADA NO MAPA (mig 425; protótipo aprovado em 15/11/2026). Pontos em torno de uma loja genérica da Penha (RJ).
const L = [-22.8436, -43.2784];
const em = (dLat: number, dLng: number): [number, number] => [L[0] + dLat, L[1] + dLng];
const area = (p: Partial<AreaDesenhada> & { poligono: [number, number][] }): AreaDesenhada => ({
  id: p.id ?? 'a',
  nome: p.nome ?? 'Área',
  taxa: p.taxa ?? 5,
  tempoMin: p.tempoMin ?? 25,
  tempoMax: p.tempoMax ?? 35,
  pedidoMinimo: p.pedidoMinimo ?? null,
  freteGratisAcima: p.freteGratisAcima ?? null,
  ativo: p.ativo ?? true,
  ordem: p.ordem ?? 0,
  poligono: p.poligono,
});
const PERTO = area({ id: 'perto', nome: 'Penha', taxa: 5, ordem: 0, poligono: [em(0.006, -0.008), em(0.007, 0.006), em(-0.002, 0.009), em(-0.007, 0.003), em(-0.005, -0.008)] });
const LONGE = area({ id: 'longe', nome: 'Olaria', taxa: 7, ordem: 1, pedidoMinimo: 30, poligono: [em(0.013, -0.018), em(0.016, 0.004), em(0.004, 0.02), em(-0.012, 0.016), em(-0.014, -0.006), em(-0.004, -0.02)] });

describe('área desenhada no mapa (mig 425)', () => {
  it('ponto dentro e fora do polígono (inclusive o polígono côncavo, em "U")', () => {
    expect(pontoNoPoligono(L[0], L[1], PERTO.poligono)).toBe(true);
    expect(pontoNoPoligono(L[0] + 0.01, L[1], PERTO.poligono)).toBe(false);
    const u: [number, number][] = [[0, 0], [0, 3], [3, 3], [3, 2], [1, 2], [1, 1], [3, 1], [3, 0]];
    expect(pontoNoPoligono(2, 1.5, u)).toBe(false); // o "buraco" do U
    expect(pontoNoPoligono(2, 0.5, u)).toBe(true);
    expect(pontoNoPoligono(0.5, 1.5, u)).toBe(true);
    expect(pontoNoPoligono(1, 1, [[0, 0], [1, 1]])).toBe(false); // menos de 3 cantos
    expect(pontoNoPoligono(NaN, 1, u)).toBe(false);
    expect(pontoNoPoligono(1, 1, [[0, 0], ['x', 1], [2, 2]] as any)).toBe(false);
  });

  it('onde duas se cruzam vale a de cima da lista (menor ordem); a pausada não conta', () => {
    expect(areaDoPonto([LONGE, PERTO], L[0], L[1])?.id).toBe('perto'); // as duas contêm a loja: vale a ordem 0
    expect(areaDoPonto([{ ...LONGE, ordem: 0 }, { ...PERTO, ordem: 1 }], L[0], L[1])?.id).toBe('longe');
    expect(areaDoPonto([{ ...PERTO, ativo: false }, LONGE], L[0], L[1])?.id).toBe('longe');
    expect(areaDoPonto([PERTO, LONGE], ...em(0.009, 0.012))?.id).toBe('longe'); // só a de Olaria
    expect(areaDoPonto([PERTO, LONGE], -21.77, -43.27)).toBeNull(); // a 119 km
    expect(areaDoPonto([{ ...PERTO, ativo: false }], L[0], L[1])).toBeNull();
  });

  it('recusa no modo mapa: fora das áreas, endereço não achado e o pedido mínimo da área (só os itens)', () => {
    const cfg = { areaModo: 'mapa' };
    const t = (p: any) => ({ alemDaUltimaFaixa: false, semLocalizacao: false, km: null, bairro: null, area: null, ...p });
    expect(recusaDaArea(cfg, t({ area: null }), 50)).toEqual({
      code: 'FORA_DA_AREA',
      message: 'Não entregamos nesse endereço: ele fica fora da nossa área de entrega. Confira o endereço.',
    });
    expect(recusaDaArea(cfg, t({ semLocalizacao: true }), 50)?.code).toBe('ENDERECO_NAO_ENCONTRADO');
    expect(recusaDaArea(cfg, t({ area: LONGE }), 29.99)).toEqual({
      code: 'PEDIDO_MINIMO_DA_AREA',
      // O valor em reais vem com o espaço fixo (U+00A0) do toLocaleString: `\s` cobre os dois.
      message: expect.stringMatching(/^Para este endereço, o pedido mínimo é R\$\s30,00 em itens \(a taxa de entrega não conta\)\.$/),
    });
    expect(recusaDaArea(cfg, t({ area: LONGE }), 30)).toBeNull();
    expect(recusaDaArea(cfg, t({ area: PERTO }), 1)).toBeNull(); // sem mínimo
  });

  it('conferir a lista ao salvar: normaliza, e cada erro com a frase para a tela', () => {
    const ok = conferirAreas([
      { nome: '  Penha ', poligono: PERTO.poligono, taxa: '5,5'.replace(',', '.'), tempoMin: '25', tempoMax: 35, pedidoMinimo: '', freteGratisAcima: null, ativo: true },
      { nome: 'Olaria', poligono: LONGE.poligono, taxa: 0, ativo: false },
    ]);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.areas[0]).toMatchObject({ nome: 'Penha', taxa: 5.5, tempoMin: 25, tempoMax: 35, pedidoMinimo: null, ativo: true, ordem: 0 });
      expect(ok.areas[1]).toMatchObject({ nome: 'Olaria', taxa: 0, ativo: false, ordem: 1 });
    }
    const erro = (lista: any) => {
      const r = conferirAreas(lista);
      return r.ok ? null : r.erro;
    };
    expect(erro([{ nome: '', poligono: PERTO.poligono }])).toBe('A área 1 está sem nome.');
    expect(erro([{ nome: 'X', poligono: [L, L] }])).toBe('A área "X" precisa de pelo menos 3 cantos no mapa.');
    expect(erro([{ nome: 'X', poligono: [[91, 0], [0, 0], [1, 1]] }])).toBe('A área "X" tem um canto fora do mapa.');
    expect(erro([{ nome: 'X', poligono: Array.from({ length: MAX_PONTOS + 1 }, (_, i) => [i / 1000, 0]) }])).toBe(`A área "X" tem mais de ${MAX_PONTOS} cantos.`);
    expect(erro([{ nome: 'X', poligono: PERTO.poligono, taxa: -1 }])).toBe('A área "X": a taxa de entrega tem de ser um valor a partir de zero.');
    expect(erro([{ nome: 'X', poligono: PERTO.poligono, tempoMin: 40, tempoMax: 30 }])).toBe('A área "X": o tempo "até" tem de ser maior ou igual ao "de".');
    expect(erro([{ nome: 'X', poligono: PERTO.poligono, pedidoMinimo: 'abc' }])).toBe('A área "X": o pedido mínimo tem de ser um valor a partir de zero.');
    expect(erro(Array.from({ length: MAX_AREAS + 1 }, (_, i) => ({ nome: `A${i}`, poligono: PERTO.poligono })))).toBe(`No máximo ${MAX_AREAS} áreas por loja.`);
    expect(erro('x')).toBe('Lista de áreas inválida.');
    expect(conferirAreas([]).ok).toBe(true); // a lista vazia vale (o modo mapa é que exige uma no ar)
  });
});
