import {
  MSG_LOJA_RECUSADA,
  MSG_NAO_GRAVADO,
  MSG_PENDENTE,
  RECUO_INTEGRACAO_MINUTOS,
  corpoCancelamento,
  corpoRepasse,
  ehVendaDoTotem,
  lerRespostaDaNuvem,
  lerRespostaGogem,
  lerRetryAfter,
  recuoMinutos,
  resultadoDoAviso,
} from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO AO GOGEM — o que vai no corpo, que venda é do totem e o que cada resposta quer dizer.
// A resposta decide se o dinheiro do cliente volta: ler "200" como "estornado" seria desistir de
// um estorno que o Mercado Pago recusou naquela hora.

describe('o corpo do aviso cabe no DTO do GoGeM', () => {
  it('idempotencyKey, regemComandaId e motivo — nada a mais', () => {
    expect(corpoCancelamento({ idempotencyKey: 'k-1', regemComandaId: 'c-1', motivo: ' Cliente desistiu ' })).toEqual({
      idempotencyKey: 'k-1',
      regemComandaId: 'c-1',
      motivo: 'Cliente desistiu',
    });
  });

  it('sem comanda (pedido em dinheiro nunca cobrado), o campo nem vai — e o motivo tem padrão', () => {
    const c = corpoCancelamento({ idempotencyKey: 'k-2', regemComandaId: null, motivo: null });
    expect(c).toEqual({ idempotencyKey: 'k-2', motivo: 'Cancelado no Regem' });
    expect('regemComandaId' in c).toBe(false);
  });

  it('respeita os limites do DTO (120 / 120 / 500) — texto longo lá é 400', () => {
    const c = corpoCancelamento({ idempotencyKey: 'k'.repeat(300), regemComandaId: 'c'.repeat(300), motivo: 'm'.repeat(900) });
    expect(c.idempotencyKey).toHaveLength(120);
    expect(c.regemComandaId).toHaveLength(120);
    expect(c.motivo).toHaveLength(500);
  });

  it('o corte não parte um emoji ao meio (um caractere desses são DOIS de UTF-16)', () => {
    const motivo = 'a'.repeat(499) + '🍔' + 'b'.repeat(10); // o emoji cairia nas posições 500 e 501
    const c = corpoCancelamento({ idempotencyKey: 'k', motivo });
    expect(c.motivo).toHaveLength(499);
    expect(c.motivo.endsWith('a')).toBe(true);
    expect(() => encodeURIComponent(c.motivo)).not.toThrow(); // metade de par de UTF-16 lança aqui
  });
});

describe('Retry-After (o GoGeM limita 120 requisições/min por IP)', () => {
  const agora = Date.parse('2026-09-25T12:00:00Z');

  it('em segundos', () => {
    expect(lerRetryAfter('120', agora)).toBe(120);
    expect(lerRetryAfter(' 0 ', agora)).toBe(0);
  });

  it('em data HTTP', () => {
    expect(lerRetryAfter('Fri, 25 Sep 2026 12:01:30 GMT', agora)).toBe(90);
    expect(lerRetryAfter('Fri, 25 Sep 2026 11:59:00 GMT', agora)).toBe(0); // já passou
  });

  it('ausente ou ilegível = nulo; absurdo = teto de 24 h', () => {
    expect(lerRetryAfter(null, agora)).toBeNull();
    expect(lerRetryAfter('', agora)).toBeNull();
    expect(lerRetryAfter('amanhã', agora)).toBeNull();
    expect(lerRetryAfter('99999999', agora)).toBe(24 * 3600);
  });
});

describe('venda do totem: a assinatura do venderTotem', () => {
  it('chave do aparelho e SEM operador → totem', () => {
    expect(ehVendaDoTotem({ idempotencyKey: 'uuid-do-totem', abertaPorId: null })).toBe(true);
  });

  it('o PDV offline também grava chave, mas sempre com o operador logado → não é totem', () => {
    expect(ehVendaDoTotem({ idempotencyKey: 'uuid-do-pdv', abertaPorId: 'operador-1' })).toBe(false);
  });

  it('sem chave (mesa, delivery, balcão comum) → não é totem', () => {
    expect(ehVendaDoTotem({ idempotencyKey: null, abertaPorId: null })).toBe(false);
    expect(ehVendaDoTotem({ idempotencyKey: '  ', abertaPorId: null })).toBe(false);
  });
});

describe('o que a resposta do GoGeM quer dizer', () => {
  it('sem resposta (rede, tempo esgotado): continua na fila — reenviar é seguro (o GoGeM é idempotente)', () => {
    expect(lerRespostaGogem(null, null)).toMatchObject({
      status: 'pendente',
      paraOperador: { situacao: 'pendente', mensagem: MSG_PENDENTE },
    });
  });

  it('200 com estorno feito: entregue — o operador vê o valor', () => {
    const d = lerRespostaGogem(200, {
      status: 'cancelado',
      pedidoId: 'p-1',
      estorno: { feito: true, meio: 'credito', valorCentavos: 4590, refundId: 'r-1', mensagem: 'Estorno solicitado' },
    });
    expect(d.status).toBe('entregue');
    expect(d.estorno).toMatchObject({ feito: true, meio: 'credito', valorCentavos: 4590, refundId: 'r-1' });
    expect(d.paraOperador.situacao).toBe('solicitado');
    expect(d.paraOperador.mensagem).toContain('R$');
    expect(d.paraOperador.mensagem).toContain('45,90');
  });

  it.each(['dinheiro', 'desconhecido'])('200, feito:false, meio "%s": entregue — nada eletrônico a estornar', (meio) => {
    const d = lerRespostaGogem(200, { estorno: { feito: false, meio, valorCentavos: 2000, mensagem: 'Nada a estornar' } });
    expect(d.status).toBe('entregue');
    expect(d.paraOperador.situacao).toBe('sem_estorno_eletronico');
    expect(d.paraOperador.mensagem).toMatch(/devolva o valor ao cliente no balcão/);
  });

  it('200, feito:false, meio ELETRÔNICO: o Mercado Pago falhou — volta para a fila (o GoGeM tenta de novo)', () => {
    const d = lerRespostaGogem(200, {
      estorno: { feito: false, meio: 'pix', valorCentavos: 2000, mensagem: 'Cancelado, mas o estorno eletrônico falhou: timeout' },
    });
    expect(d.status).toBe('pendente');
    expect(d.paraOperador.situacao).toBe('pendente');
  });

  it('200 sem o bloco de estorno: entregue, mas pede para conferir no painel do GoGeM', () => {
    const d = lerRespostaGogem(200, { status: 'cancelado' });
    expect(d.status).toBe('entregue');
    expect(d.paraOperador.mensagem).toMatch(/confira no painel do GoGeM/);
  });

  it.each([401, 403])('%i: token recusado — aguarda a integração (não insiste em laço)', (http) => {
    const d = lerRespostaGogem(http, { message: 'Token inválido.' });
    expect(d.status).toBe('aguardando_integracao');
    expect(d.paraOperador.situacao).toBe('integracao_recusou');
    expect(d.paraOperador.mensagem).toMatch(/NÃO foi pedido/);
  });

  it.each([408, 429, 500, 502, 503])('%i: passageiro — volta para a fila', (http) => {
    expect(lerRespostaGogem(http, null).status).toBe('pendente');
  });

  it.each([400, 404, 422])('%i: recusado de vez — o estorno vira manual, com o motivo do GoGeM', (http) => {
    const d = lerRespostaGogem(http, { message: 'Pedido não encontrado.' });
    expect(d.status).toBe('recusado');
    expect(d.paraOperador.mensagem).toContain(`HTTP ${http}`);
    expect(d.paraOperador.mensagem).toContain('Pedido não encontrado.');
    expect(d.paraOperador.mensagem).toMatch(/manualmente/);
  });
});

describe('recuo entre tentativas', () => {
  it('cresce devagar no começo e para em 12 h', () => {
    expect([1, 2, 3, 4, 5, 6].map(recuoMinutos)).toEqual([1, 2, 5, 10, 30, 60]);
    expect(recuoMinutos(50)).toBe(720);
    expect(RECUO_INTEGRACAO_MINUTOS).toBe(360);
  });
});

describe('o que o operador vê depois de cancelar', () => {
  it('não era venda do totem: nada', async () => {
    expect(await resultadoDoAviso(null)).toBeNull();
  });

  it('o aviso nem foi gravado (tabela ausente): diz que o estorno é manual', async () => {
    expect(await resultadoDoAviso({ id: null, erro: 'relation does not exist' })).toBe(MSG_NAO_GRAVADO);
  });

  it('gravado e sem quem envie agora: fica na fila, e a mensagem diz isso', async () => {
    expect(await resultadoDoAviso({ id: 'a-1' })).toEqual({ situacao: 'pendente', mensagem: MSG_PENDENTE });
  });

  it('gravado e enviado agora: o resultado do envio', async () => {
    const r = await resultadoDoAviso({ id: 'a-1' }, async (id) => ({ situacao: 'solicitado', mensagem: `ok ${id}` }));
    expect(r).toEqual({ situacao: 'solicitado', mensagem: 'ok a-1' });
  });
});

// O servidor da LOJA não fala com o GoGeM (ERR-108): repassa o aviso para a nuvem do Regem.
describe('o repasse do servidor da loja para a nuvem', () => {
  const linha = {
    id: 'a-1',
    chave: 'totem-1',
    corpo: { idempotencyKey: 'totem-1', motivo: 'Cliente desistiu' },
    referencia_tipo: 'comanda',
    referencia_id: 'c-1',
    tenant_id: 't-1', // não vai: a nuvem sabe a empresa pelo token de sync
  };

  it('leva o id do aviso (a nuvem grava com o mesmo), a chave e o corpo — a empresa, não', () => {
    expect(corpoRepasse(linha)).toEqual({
      avisoId: 'a-1',
      chave: 'totem-1',
      corpo: { idempotencyKey: 'totem-1', motivo: 'Cliente desistiu' },
      referenciaTipo: 'comanda',
      referenciaId: 'c-1',
    });
  });

  it('aceito pela nuvem: ENTREGUE para a loja, e o operador vê o que a nuvem conseguiu com o GoGeM', () => {
    const d = lerRespostaDaNuvem(200, {
      aceito: true,
      avisoId: 'a-1',
      estorno: { situacao: 'solicitado', mensagem: 'Estorno de R$ 20,00' },
    });
    expect(d.status).toBe('entregue');
    expect(d.paraOperador).toEqual({ situacao: 'solicitado', mensagem: 'Estorno de R$ 20,00' });
  });

  it('aceito sem desfecho legível: entregue, e o operador vê "pendente"', () => {
    const d = lerRespostaDaNuvem(200, { aceito: true, estorno: { situacao: 'inventada', mensagem: 1 } });
    expect(d.status).toBe('entregue');
    expect(d.paraOperador).toEqual({ situacao: 'pendente', mensagem: MSG_PENDENTE });
  });

  it('200 sem "aceito" não é entregue — sai de novo', () => {
    expect(lerRespostaDaNuvem(200, { ok: true }).status).toBe('pendente');
  });

  it('401/403: a nuvem recusou o servidor da loja — espera, com o aviso ao operador', () => {
    expect(lerRespostaDaNuvem(401, null)).toMatchObject({ status: 'aguardando_integracao', paraOperador: MSG_LOJA_RECUSADA });
    expect(lerRespostaDaNuvem(403, null).status).toBe('aguardando_integracao');
  });

  it('sem resposta, 404 (nuvem ainda sem a rota), 408, 429 e 5xx: passageiro', () => {
    for (const http of [null, 404, 408, 429, 500, 503]) expect(lerRespostaDaNuvem(http, null).status).toBe('pendente');
  });

  it('outro 4xx: recusado — o operador faz o estorno à mão e avisa o suporte', () => {
    const d = lerRespostaDaNuvem(400, { message: 'Aviso sem a chave da venda.' });
    expect(d.status).toBe('recusado');
    expect(d.paraOperador.mensagem).toContain('Aviso sem a chave da venda.');
    expect(d.paraOperador.mensagem).toContain('manualmente');
  });
});
