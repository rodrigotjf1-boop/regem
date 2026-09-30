import { gravarOrigemPedido, limparOrigem, valorOrigem, CAMPOS_ORIGEM, MAX_CAMPO_ORIGEM, type CampoOrigem } from './origem-pedido';
// As regras da TELA (sem DOM) — o frontend não tem executor de testes; a mesma tabela de casos
// confere os dois lados, para a tela nunca guardar o que o servidor descarta (e vice-versa).
import {
  origemDaUrl,
  proximaOrigem,
  valorOrigemClique,
  PARAMS_ORIGEM,
} from '../../../../frontend/src/components/loja/origem-clique-regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AGORA = new Date('2026-09-30T15:00:00.000Z');

// [campo, valor, esperado]
const CASOS: [CampoOrigem, unknown, string | null][] = [
  ['utm_source', 'meta', 'meta'],
  ['utm_campaign', '  Combo sexta  ', 'Combo sexta'],
  ['utm_campaign', 'Promoção 20% — sábado', 'Promoção 20% — sábado'],
  ['utm_campaign', '', null],
  ['utm_campaign', '   ', null],
  ['utm_campaign', 'a'.repeat(MAX_CAMPO_ORIGEM), 'a'.repeat(MAX_CAMPO_ORIGEM)],
  ['utm_campaign', 'a'.repeat(MAX_CAMPO_ORIGEM + 1), null], // longo demais
  ['utm_campaign', 'linha\nquebrada', null], // caractere de controle
  ['utm_medium', 42, null], // não é texto
  ['lk', 'aB3_x-9', 'aB3_x-9'],
  ['lk', 'abc', null], // curto
  ['lk', 'tem espaço', null],
  ['lk', 'x'.repeat(65), null],
  ['campaign_id', '120215566778899', '120215566778899'],
  ['ad_id', '{{ad.id}}', null], // macro não expandida
  ['adset_id', '{{adset.id}}', null],
  ['adgroup_id', '12a', null],
  ['fbclid', 'IwAR0ped001_x-Y.z', 'IwAR0ped001_x-Y.z'],
  ['gclid', 'Cj0KCQjw', 'Cj0KCQjw'],
  ['gclid', 'abc def', null],
  ['wbraid', 'a/b', null],
];

describe('origem do pedido — limpeza de cada campo (servidor e tela iguais)', () => {
  it('os dois lados conhecem os mesmos campos, na mesma ordem', () => {
    expect([...PARAMS_ORIGEM]).toEqual([...CAMPOS_ORIGEM]);
  });

  it.each(CASOS)('%s = %p → %p', (campo, valor, esperado) => {
    expect(valorOrigem(campo, valor)).toBe(esperado);
    expect(valorOrigemClique(campo, valor)).toBe(esperado);
  });
});

describe('origem do pedido — o que o servidor aceita no corpo', () => {
  it('fica só com o que presta e nunca inventa campo', () => {
    const o = limparOrigem(
      { utm_source: 'meta', ad_id: '{{ad.id}}', fbclid: 'IwAR1', lixo: 'x', capturado_em: '2026-09-30T14:00:00Z' },
      AGORA,
    );
    expect(o).toEqual({ capturado_em: '2026-09-30T14:00:00.000Z', utm_source: 'meta', fbclid: 'IwAR1' });
  });

  it('sem nenhum campo aproveitável → null (não grava linha vazia)', () => {
    expect(limparOrigem({ ad_id: '{{ad.id}}', capturado_em: '2026-09-30T14:00:00Z' }, AGORA)).toBeNull();
    expect(limparOrigem({}, AGORA)).toBeNull();
    expect(limparOrigem(null, AGORA)).toBeNull();
    expect(limparOrigem('utm_source=meta', AGORA)).toBeNull();
    expect(limparOrigem(['meta'], AGORA)).toBeNull();
  });

  it('hora da captura: a do aparelho só se plausível (30 dias atrás a 5 min à frente); senão a do pedido', () => {
    const h = (capturado_em: unknown) => limparOrigem({ utm_source: 'x', capturado_em }, AGORA)!.capturado_em;
    expect(h('2026-09-01T15:00:01Z')).toBe('2026-09-01T15:00:01.000Z'); // 29 dias
    expect(h('2026-08-30T00:00:00Z')).toBe(AGORA.toISOString()); // mais de 30 dias
    expect(h('2026-09-30T15:04:00Z')).toBe('2026-09-30T15:04:00.000Z'); // relógio 4 min adiantado
    expect(h('2026-09-30T15:10:00Z')).toBe(AGORA.toISOString()); // 10 min no futuro
    expect(h('ontem')).toBe(AGORA.toISOString());
    expect(h(undefined)).toBe(AGORA.toISOString());
    expect(h(1759244400000)).toBe(AGORA.toISOString()); // número não vale
  });
});

describe('origem do pedido — a tela', () => {
  const url = (qs: string) => new URLSearchParams(qs);

  it('link marcado: pega só os parâmetros conhecidos e limpos', () => {
    expect(origemDaUrl(url('utm_source=meta&ad_id=%7B%7Bad.id%7D%7D&fbclid=IwAR9&mesa=4&u=abc'), AGORA)).toEqual({
      capturado_em: AGORA.toISOString(),
      utm_source: 'meta',
      fbclid: 'IwAR9',
    });
  });

  it('link sem marca (ou só com macro) → nada', () => {
    expect(origemDaUrl(url('mesa=4&u=abc'), AGORA)).toBeNull();
    expect(origemDaUrl(url('ad_id=%7B%7Bad.id%7D%7D'), AGORA)).toBeNull();
    expect(origemDaUrl(null, AGORA)).toBeNull();
  });

  it('vale o último link: marcado substitui, sem marca mantém', () => {
    const antiga = { capturado_em: '2026-09-30T10:00:00.000Z', utm_source: 'google' };
    const nova = { capturado_em: '2026-09-30T11:00:00.000Z', utm_source: 'meta' };
    expect(proximaOrigem(antiga, nova)).toBe(nova);
    expect(proximaOrigem(antiga, null)).toBe(antiga);
    expect(proximaOrigem(null, null)).toBeNull();
  });
});

describe('gravarOrigemPedido — nunca derruba o pedido', () => {
  const dados = { tenantId: '00000000-0000-4000-8000-000000000001', unidadeId: null, pedidoId: '00000000-0000-4000-8000-000000000002' };

  it('falha do banco (tabela ausente, rede) → false, sem lançar', async () => {
    const db: any = {
      execute: jest.fn().mockRejectedValue(Object.assign(new Error('relation "pedido_origem" does not exist'), { code: '42P01' })),
    };
    await expect(gravarOrigemPedido(db, { ...dados, bruto: { utm_source: 'meta' } })).resolves.toBe(false);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('sem origem (ou só lixo) → nem vai ao banco', async () => {
    const db: any = { execute: jest.fn() };
    await expect(gravarOrigemPedido(db, { ...dados, bruto: undefined })).resolves.toBe(false);
    await expect(gravarOrigemPedido(db, { ...dados, bruto: { ad_id: '{{ad.id}}' } })).resolves.toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('gravou → true; já havia (reenvio) ou loja não mede → false', async () => {
    const gravou: any = { execute: jest.fn().mockResolvedValue({ rows: [{ pedido_id: dados.pedidoId }] }) };
    const nada: any = { execute: jest.fn().mockResolvedValue({ rows: [] }) };
    await expect(gravarOrigemPedido(gravou, { ...dados, bruto: { utm_source: 'meta' } })).resolves.toBe(true);
    await expect(gravarOrigemPedido(nada, { ...dados, bruto: { utm_source: 'meta' } })).resolves.toBe(false);
  });
});
