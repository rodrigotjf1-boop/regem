import { readFileSync } from 'node:fs';
import {
  cupomDoContrato,
  decidirCupom,
  montarFotoCupom,
  montarFotoUso,
  tipoDoContrato,
  usoDoContrato,
  validarCriacaoCupom,
} from './cupom-integracao';
import { hashPedidoIntegracao, lerChaveIdempotencia } from './cupons-integracao.service';
import { errosCupomBancoLiame, errosCupomRegem, errosPagina, errosUsoCupomRegem } from './contrato-liame.teste-spec';
import { codificarCursor, lerCursor, vinculoCursor } from './cursor-integracao';
import { BASE_TIPO_PROBLEMA, corpoProblema, problemaGuardado, ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEÇAS PURAS dos cupons da API de integração (trilha C, C1c — PR3), sem banco. O contrato é o de
// cupons v1 do Liame: a fixture dele (`apps/server/test/fixtures/regem/v1/cupons.json`) está
// copiada abaixo — o validador daqui tem de aceitá-la e recusar o que o zod de lá recusa.

const FIXTURE_LIAME_CUPONS = {
  itens: [
    {
      id: 'cup-combo-sexta',
      versao: 4,
      atualizado_em: '2026-09-25T14:02:11.382Z',
      codigo: 'COMBOSEXTA',
      nome: 'Combo de sexta',
      tipo: 'percentual',
      percentual: '10.00',
      valor_centavos: null,
      teto_desconto_centavos: 1500,
      pedido_minimo_centavos: 4000,
      valido_de: '2026-09-26',
      valido_ate: '2026-10-31',
      fuso: 'America/Sao_Paulo',
      ativo: true,
      max_usos: 300,
      usos: 42,
      condicoes: { somente_novos: false, max_por_cliente: 1, min_dias_sem_compra: null },
      todas_as_lojas: false,
    },
    {
      id: 'cup-frete',
      versao: 1,
      atualizado_em: '2026-09-20T10:00:00Z',
      codigo: 'FRETEGRATIS',
      nome: null,
      tipo: 'frete_gratis',
      percentual: null,
      valor_centavos: null,
      teto_desconto_centavos: null,
      pedido_minimo_centavos: null,
      valido_de: null,
      valido_ate: null,
      fuso: 'America/Sao_Paulo',
      ativo: true,
      max_usos: null,
      usos: 7,
      condicoes: {},
      todas_as_lojas: true,
    },
  ],
  proximo_cursor: 'cup-c1',
  tem_mais: false,
};

describe('contrato de cupons do Liame (v1) — o validador daqui', () => {
  it('aceita a fixture de cupons do Liame (e ela é a mesma do repositório dele, quando ele está na máquina)', () => {
    expect(errosPagina(FIXTURE_LIAME_CUPONS, errosCupomRegem)).toEqual([]);
    for (const c of FIXTURE_LIAME_CUPONS.itens) expect(errosCupomBancoLiame(c)).toEqual([]);
    let doLiame: any = null;
    try {
      doLiame = JSON.parse(readFileSync('C:/Liame/apps/server/test/fixtures/regem/v1/cupons.json', 'utf8'));
    } catch {
      /* CI: o repositório do Liame não está lá — a cópia acima vale */
    }
    if (doLiame) expect(doLiame).toEqual(FIXTURE_LIAME_CUPONS);
  });

  it('recusa o que o zod do Liame recusa (e que pararia a leitura dos cupons da loja)', () => {
    const base = FIXTURE_LIAME_CUPONS.itens[0];
    const casos: [string, any][] = [
      ['codigo', { ...base, codigo: '' }],
      ['codigo', { ...base, codigo: 'X'.repeat(61) }],
      ['tipo', { ...base, tipo: 'fretegratis' }],
      ['percentual', { ...base, percentual: '10.555' }],
      ['percentual', { ...base, percentual: 10 }],
      ['valido_ate', { ...base, valido_ate: '2026-02-30' }],
      ['valido_de', { ...base, valido_de: '26/09/2026' }],
      ['max_usos', { ...base, max_usos: -1 }],
      ['usos', { ...base, usos: 1.5 }],
      ['ativo', { ...base, ativo: 'sim' }],
      ['fuso', { ...base, fuso: '' }],
      ['atualizado_em', { ...base, atualizado_em: '2026-09-25 14:02:11' }],
    ];
    for (const [campo, c] of casos) expect(errosCupomRegem(c)).toContain(campo);
    // O zod aceita percentual "0.00" e "150.00"; o banco do Liame não (percent > 0 e ≤ 100).
    expect(errosCupomRegem({ ...base, percentual: '150.00' })).toEqual([]);
    expect(errosCupomBancoLiame({ ...base, percentual: '150.00' })).toContain('percent');
    expect(errosCupomBancoLiame({ ...base, percentual: '0.00' })).toContain('percent');
  });

  it('uso: pedido_id pode ser nulo mas tem de vir; usado_em é instante', () => {
    const u = {
      id: 'u1',
      versao: 1,
      atualizado_em: '2026-09-26T23:00:00.123456Z',
      cupom_id: 'c1',
      codigo: 'COMBOSEXTA',
      pedido_id: null,
      usado_em: '2026-09-26T23:00:00Z',
      desconto_centavos: 599,
      removido: false,
    };
    expect(errosUsoCupomRegem(u)).toEqual([]);
    const semPedido: any = { ...u };
    delete semPedido.pedido_id;
    expect(errosUsoCupomRegem(semPedido)).toContain('pedido_id');
    expect(errosUsoCupomRegem({ ...u, usado_em: null })).toContain('usado_em');
    expect(errosUsoCupomRegem({ ...u, desconto_centavos: -1 })).toContain('desconto_centavos');
  });
});

describe('foto do cupom (o que o Regem faz com o cupom hoje)', () => {
  const linha = (x: any = {}) => ({
    id: 'c1',
    tenant_id: 't',
    unidade_id: 'loja-1',
    codigo: 'COMBOSEXTA',
    nome: '  Combo de sexta ',
    tipo: 'percentual',
    percentual: '10.00',
    valor_centavos: '1000',
    teto_centavos: '1500',
    minimo_centavos: '4000',
    ativo: true,
    valido_de: '2026-09-26',
    valido_ate: '2026-10-31',
    max_usos: 300,
    somente_novos: false,
    max_por_cliente: 1,
    min_dias_sem_compra: null,
    usos: 42,
    ...x,
  });

  it('percentual com teto, mínimo, janela, limites e condições — no formato do contrato', () => {
    const r = montarFotoCupom(linha());
    expect(r.erro).toBeUndefined();
    const c = cupomDoContrato({ id: 'c1', versao: '4', atualizado_em: '2026-09-25T14:02:11.382000Z', situacao: null, foto: r.foto! });
    expect(c).toEqual({
      id: 'c1',
      versao: 4,
      atualizado_em: '2026-09-25T14:02:11.382000Z',
      codigo: 'COMBOSEXTA',
      nome: 'Combo de sexta',
      tipo: 'percentual',
      percentual: '10.00',
      valor_centavos: null,
      teto_desconto_centavos: 1500,
      pedido_minimo_centavos: 4000,
      valido_de: '2026-09-26',
      valido_ate: '2026-10-31',
      fuso: 'America/Sao_Paulo',
      ativo: true,
      max_usos: 300,
      usos: 42,
      condicoes: { somente_novos: false, max_por_cliente: 1, min_dias_sem_compra: null },
      todas_as_lojas: false,
      removido: false,
    });
    expect(errosCupomRegem(c)).toEqual([]);
    expect(errosCupomBancoLiame(c)).toEqual([]);
  });

  it('tipos: valor em centavos, frete grátis sem valor, desconhecido vira "outro"; sem loja = todas as lojas', () => {
    expect(tipoDoContrato('fretegratis')).toBe('frete_gratis');
    expect(tipoDoContrato('brinde')).toBe('outro');
    const v = montarFotoCupom(linha({ tipo: 'valor', valor_centavos: '1234', unidade_id: null })).foto!;
    expect(v).toMatchObject({ tipo: 'valor', valor_centavos: 1234, percentual: null, teto_desconto_centavos: null, todas_as_lojas: true });
    const f = montarFotoCupom(linha({ tipo: 'fretegratis' })).foto!;
    expect(f).toMatchObject({ tipo: 'frete_gratis', valor_centavos: null, percentual: null, teto_desconto_centavos: null });
  });

  it('dado que a tela aceitou e o banco do Liame recusa sai como "outro" (nunca derruba a página)', () => {
    const avisos: string[] = [];
    const av = (m: string) => avisos.push(m);
    for (const p of ['0.00', '150.00', '1500.00', '-5.00']) {
      const f = montarFotoCupom(linha({ percentual: p }), av).foto!;
      expect(f).toMatchObject({ tipo: 'outro', percentual: null, teto_desconto_centavos: null });
      expect(errosCupomBancoLiame(cupomDoContrato({ id: 'c', versao: 1, atualizado_em: '2026-09-25T14:02:11Z', situacao: null, foto: f }))).toEqual([]);
    }
    expect(montarFotoCupom(linha({ tipo: 'valor', valor_centavos: '-500' }), av).foto!.tipo).toBe('outro');
    expect(avisos.length).toBe(5);
    // limites "se tem valor": 0 = sem limite; negativo = bloqueia tudo (0)
    const lim = montarFotoCupom(linha({ max_usos: 0, max_por_cliente: -1, min_dias_sem_compra: -3, minimo_centavos: '0', teto_centavos: '0' })).foto!;
    expect(lim).toMatchObject({ max_usos: null, pedido_minimo_centavos: null, teto_desconto_centavos: null });
    expect(lim.condicoes).toEqual({ somente_novos: false, max_por_cliente: 0, min_dias_sem_compra: null });
    expect(montarFotoCupom(linha({ max_usos: -2 })).foto!.max_usos).toBe(0);
    // código: vazio não publica; comprido demais sai nos 60 primeiros
    expect(montarFotoCupom(linha({ codigo: '  ' })).erro).toBe('cupom sem código');
    expect(montarFotoCupom(linha({ codigo: 'a'.repeat(70) }), av).foto!.codigo).toBe('A'.repeat(60));
    // data fora do formato do contrato (ano com 5 dígitos) vira nula
    expect(montarFotoCupom(linha({ valido_ate: '20260-01-01' })).foto!.valido_ate).toBeNull();
  });

  it('uso: código do cupom, pedido, instante e desconto em centavos (desconhecido → nulo)', () => {
    const u = montarFotoUso({ id: 'u1', cupom_id: 'c1', codigo: 'combosexta', pedido_id: 'p1', usado_em: '2026-09-26T23:00:00.000000Z', desconto: '599' }).foto!;
    expect(u).toEqual({ cupom_id: 'c1', codigo: 'COMBOSEXTA', pedido_id: 'p1', usado_em: '2026-09-26T23:00:00.000000Z', desconto_centavos: 599 });
    expect(montarFotoUso({ id: 'u', cupom_id: 'c1', codigo: 'X1', pedido_id: null, usado_em: 'x', desconto: null }).foto!.desconto_centavos).toBeNull();
    expect(montarFotoUso({ id: 'u', cupom_id: 'c1', codigo: null, usado_em: 'x' }).erro).toBeTruthy();
    const c = usoDoContrato({ id: 'u1', versao: '2', atualizado_em: '2026-09-27T01:00:00.000001Z', situacao: 'removido', foto: u });
    expect(c).toMatchObject({ id: 'u1', versao: 2, removido: true, pedido_id: 'p1' });
    expect(errosUsoCupomRegem(c)).toEqual([]);
  });
});

describe('publicar? — versão, lápide e descarte', () => {
  const linhaCupom = { id: 'c1', unidade_id: 'L1', codigo: 'ABC', tipo: 'valor', valor_centavos: '500', ativo: true, usos: 1 };
  const guardada = (x: any = {}) => ({
    recurso: 'cupom' as const,
    publicada: true,
    situacao: null,
    unidade_id: 'L1',
    foto: montarFotoCupom(linhaCupom).foto,
    confirmado_em: null,
    mudou_em: '2026-09-29T12:00:00.000000Z',
    ...x,
  });

  it('igual → mantém; mudou a foto ou a loja → publica; nunca publicado → publica', () => {
    expect(decidirCupom(guardada(), linhaCupom)).toEqual({ acao: 'manter' });
    expect(decidirCupom(guardada(), { ...linhaCupom, usos: 2 })).toMatchObject({ acao: 'publicar', situacao: null });
    expect(decidirCupom(guardada(), { ...linhaCupom, unidade_id: 'L2' })).toMatchObject({ acao: 'publicar', unidade_id: 'L2' });
    expect(decidirCupom(guardada({ publicada: false, foto: null }), linhaCupom)).toMatchObject({ acao: 'publicar' });
  });

  it('apagado depois de publicado → lápide com a última foto (cupom inativo); sem publicar → descarta', () => {
    const d: any = decidirCupom(guardada(), undefined);
    expect(d).toMatchObject({ acao: 'publicar', situacao: 'removido', unidade_id: 'L1', removido_em: '2026-09-29T12:00:00.000000Z' });
    expect(d.foto).toMatchObject({ codigo: 'ABC', ativo: false, usos: 1 });
    expect(decidirCupom(guardada({ situacao: 'removido' }), undefined)).toEqual({ acao: 'manter' });
    expect(decidirCupom(guardada({ publicada: false, foto: null }), undefined)).toEqual({ acao: 'descartar' });
    // o uso apagado guarda o instante do uso (filtro `desde`)
    const u: any = decidirCupom(
      { recurso: 'cupom_uso', publicada: true, situacao: null, unidade_id: 'L1', foto: { cupom_id: 'c1', codigo: 'ABC', pedido_id: null, usado_em: 'x', desconto_centavos: null }, confirmado_em: '2026-09-28T00:00:00.000000Z', mudou_em: 'y' },
      undefined,
    );
    expect(u).toMatchObject({ acao: 'publicar', situacao: 'removido', confirmado_em: '2026-09-28T00:00:00.000000Z' });
  });
});

describe('criação pela integração (POST /cupons) — regra conferida campo a campo', () => {
  const HOJE = '2026-09-29';
  const ok = {
    codigo: 'liamemeta10',
    nome: 'Meta · Combo de sexta',
    tipo: 'percentual',
    percentual: '10.00',
    teto_desconto_centavos: 1500,
    pedido_minimo_centavos: 4000,
    valido_de: '2026-10-01',
    valido_ate: '2026-10-31',
    max_usos: 300,
    condicoes: { max_por_cliente: 1 },
  };

  it('o exemplo do contrato vira o cupom do Regem (código em maiúsculas, valores em reais exatos)', () => {
    const r = validarCriacaoCupom(ok, HOJE);
    expect(r).toEqual({
      ok: true,
      cupom: {
        codigo: 'LIAMEMETA10',
        nome: 'Meta · Combo de sexta',
        tipo: 'percentual',
        valor: '10.00',
        tetoDesconto: '15.00',
        minimo: '40.00',
        validoDe: '2026-10-01',
        validade: '2026-10-31',
        maxUsos: 300,
        somenteNovos: false,
        maxPorCliente: 1,
        minDiasSemCompra: null,
      },
    });
    expect(validarCriacaoCupom({ codigo: 'VALE5', tipo: 'valor', valor_centavos: 505 }, HOJE)).toMatchObject({
      ok: true,
      cupom: { tipo: 'valor', valor: '5.05', tetoDesconto: null, minimo: null, validade: null, maxUsos: null },
    });
    expect(validarCriacaoCupom({ codigo: 'FRETE1', tipo: 'frete_gratis', pedido_minimo_centavos: 0 }, HOJE)).toMatchObject({
      ok: true,
      cupom: { tipo: 'fretegratis', valor: '0', minimo: null },
    });
    // fim hoje ainda vale (o dia inteiro, no fuso da operação)
    expect(validarCriacaoCupom({ ...ok, valido_de: null, valido_ate: HOJE }, HOJE).ok).toBe(true);
  });

  it.each([
    ['codigo', { ...ok, codigo: 'AB' }],
    ['codigo', { ...ok, codigo: 'COM ESPACO' }],
    ['codigo', { ...ok, codigo: 'AÇÃO10' }],
    ['codigo', { ...ok, codigo: 123456 }],
    ['tipo', { ...ok, tipo: 'outro' }],
    ['tipo', { ...ok, tipo: 'fretegratis' }],
    ['percentual', { ...ok, percentual: '0' }],
    ['percentual', { ...ok, percentual: '100.01' }],
    ['percentual', { ...ok, percentual: '10.555' }],
    ['percentual', { ...ok, percentual: undefined }],
    ['percentual', { codigo: 'VALE5', tipo: 'valor', valor_centavos: 500, percentual: '5.00' }],
    ['valor_centavos', { codigo: 'VALE5', tipo: 'valor', valor_centavos: 0 }],
    ['valor_centavos', { codigo: 'VALE5', tipo: 'valor', valor_centavos: -1 }],
    ['valor_centavos', { codigo: 'VALE5', tipo: 'valor', valor_centavos: 5.5 }],
    ['valor_centavos', { codigo: 'VALE5', tipo: 'valor', valor_centavos: '500' }],
    ['teto_desconto_centavos', { codigo: 'VALE5', tipo: 'valor', valor_centavos: 500, teto_desconto_centavos: 100 }],
    ['teto_desconto_centavos', { ...ok, teto_desconto_centavos: -1 }],
    ['pedido_minimo_centavos', { ...ok, pedido_minimo_centavos: -100 }],
    ['valido_ate', { ...ok, valido_ate: '2026-02-30' }],
    ['valido_ate', { ...ok, valido_ate: '2020-01-01' }],
    ['valido_de', { ...ok, valido_de: '2026-11-01' }],
    ['valido_de', { ...ok, valido_de: '01/10/2026' }],
    ['max_usos', { ...ok, max_usos: 0 }],
    ['max_usos', { ...ok, max_usos: 1.5 }],
    ['condicoes.somente_novos', { ...ok, condicoes: { somente_novos: 'sim' } }],
    ['condicoes.max_por_cliente', { ...ok, condicoes: { max_por_cliente: 0 } }],
    ['condicoes: campo desconhecido', { ...ok, condicoes: { cashback: true } }],
    ['campo desconhecido: ativo', { ...ok, ativo: false }],
    ['nome', { ...ok, nome: 'x'.repeat(301) }],
    ['nome', { ...ok, nome: `quebra${String.fromCharCode(10)}linha` }],
  ])('recusa (422) — %s', (campo, corpo) => {
    const r = validarCriacaoCupom(corpo, HOJE);
    expect(r.ok).toBe(false);
    expect((r as any).erros.join(' | ')).toContain(campo);
  });

  it('corpo que não é objeto', () => {
    for (const c of [null, [], 'x', 1]) expect(validarCriacaoCupom(c, HOJE).ok).toBe(false);
  });
});

describe('idempotência e cursor', () => {
  it('Idempotency-Key: obrigatória, 1 a 255 visíveis, sem espaço', () => {
    expect(lerChaveIdempotencia('acao-123:abc')).toBe('acao-123:abc');
    expect(lerChaveIdempotencia(['k1', 'k2'])).toBe('k1');
    for (const k of [undefined, '', 'com espaço', 'x'.repeat(256), `tab${String.fromCharCode(9)}x`, 'ação']) {
      let erro: any = null;
      try {
        lerChaveIdempotencia(k);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ProblemaException);
      expect(erro.getStatus()).toBe(400);
    }
  });

  it('hash: a ordem das chaves do corpo não importa; outro corpo ou outra rota muda', () => {
    const a = hashPedidoIntegracao('POST', '/integracao/cupons', { codigo: 'A1B', tipo: 'valor', condicoes: { x: 1, y: 2 } });
    const b = hashPedidoIntegracao('POST', '/integracao/cupons', { tipo: 'valor', condicoes: { y: 2, x: 1 }, codigo: 'A1B' });
    expect(a).toBe(b);
    expect(hashPedidoIntegracao('POST', '/integracao/cupons', { codigo: 'A1C', tipo: 'valor' })).not.toBe(a);
    expect(hashPedidoIntegracao('POST', '/integracao/cupons/x/desativar', {})).not.toBe(hashPedidoIntegracao('POST', '/integracao/cupons', {}));
    // sem corpo = corpo vazio
    expect(hashPedidoIntegracao('POST', '/x', undefined)).toBe(hashPedidoIntegracao('POST', '/x', {}));
  });

  it('resposta de erro guardada volta com o mesmo type/status/detail', () => {
    const c = corpoProblema(409, 'codigo-em-uso', 'O código X já existe');
    expect(c).toEqual({ type: `${BASE_TIPO_PROBLEMA}codigo-em-uso`, title: 'Código em uso', status: 409, detail: 'O código X já existe' });
    const e = problemaGuardado(c, 409);
    expect([e.getStatus(), e.tipo, e.message]).toEqual([409, 'codigo-em-uso', 'O código X já existe']);
    expect(problemaGuardado({ type: 'outra-coisa' }, 422).tipo).toBe('regra-invalida');
  });

  it('cursor de cupons não vale nos usos nem nas vendas (e vice-versa)', () => {
    const v = vinculoCursor('t', 'l');
    const c = codificarCursor('cupom', v, { posicao: { t: '2026-09-29T20:00:01.123456Z', i: '0b4f0c2e-1111-4222-8333-944455556666' }, desde: null });
    expect(lerCursor(c, 'cupom', v).posicao?.i).toBe('0b4f0c2e-1111-4222-8333-944455556666');
    for (const rota of ['uso', 'venda', 'cliente'] as const) expect(() => lerCursor(c, rota, v)).toThrow(ProblemaException);
  });
});
