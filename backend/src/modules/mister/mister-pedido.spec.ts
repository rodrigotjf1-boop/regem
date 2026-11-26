import { randomUUID } from 'node:crypto';
import { codigoDoBotao, toqueNoModelo } from './mister-modelos';
import { BOTOES_DO_PEDIDO, PRAZO_DO_PEDIDO_MIN, TEXTOS_DO_PEDIDO, pedirAoPresidenteLigado, quemPediu, resumoGuardado } from './mister-pedido';

// Versão 10, C6b: pedir ao presidente — a parte pura (o fluxo inteiro, com o Postgres, está em `mister-pg.teste-spec.ts`).

describe('C6b · pedir ao presidente', () => {
  it('nasce desligado (MISTER_PEDIR_AO_PRESIDENTE=1 liga)', () => {
    const antes = process.env.MISTER_PEDIR_AO_PRESIDENTE;
    try {
      delete process.env.MISTER_PEDIR_AO_PRESIDENTE;
      expect(pedirAoPresidenteLigado()).toBe(false);
      process.env.MISTER_PEDIR_AO_PRESIDENTE = '1';
      expect(pedirAoPresidenteLigado()).toBe(true);
    } finally {
      if (antes === undefined) delete process.env.MISTER_PEDIR_AO_PRESIDENTE;
      else process.env.MISTER_PEDIR_AO_PRESIDENTE = antes;
    }
  });

  it('quem pediu e o resumo saem dos parâmetros da proposta; a proposta que não é pedido não tem quem pediu', () => {
    const id = randomUUID();
    expect(quemPediu({ pedidaPor: id, pedidaPorNome: 'Carlos Lima' })).toEqual({ pedidaPor: id, pedidaPorNome: 'Carlos Lima' });
    expect(quemPediu({ colaboradorId: id })).toBeNull();
    expect(quemPediu({ pedidaPor: 'não é id' })).toBeNull();
    expect(quemPediu(null)).toBeNull();
    expect(resumoGuardado({ resumoDoPedido: '  Pausar o cardápio digital.  ' })).toBe('Pausar o cardápio digital.');
    expect(resumoGuardado({})).toBe('a ação que você pediu.');
  });

  it('os textos: o primeiro nome, os botões e o prazo do gerente; o modelo sem valores', () => {
    expect(BOTOES_DO_PEDIDO).toEqual({ autorizar: 'Pedir ao presidente', naoAgora: 'Agora não' });
    expect(TEXTOS_DO_PEDIDO.perguntaAoGerente('Ana Souza', 'Pausar o cardápio.')).toContain(`Posso pedir a Ana`);
    expect(TEXTOS_DO_PEDIDO.perguntaAoGerente('Ana', 'x')).toContain(`${PRAZO_DO_PEDIDO_MIN} minutos`);
    expect(TEXTOS_DO_PEDIDO.aoPresidente('Carlos Lima')).toBe('📨 Pedido de Carlos (gerente). Só você autoriza:');
    expect(TEXTOS_DO_PEDIDO.tituloDoModelo('Carlos Lima')).toBe('Carlos pediu a sua autorização');
    expect(TEXTOS_DO_PEDIDO.tituloDoModelo('Carlos')).not.toMatch(/R\$|\d/);
  });

  it('o toque no modelo do pedido (fora das 24 horas) volta como "pedido" com o id da proposta', () => {
    const id = randomUUID();
    expect(toqueNoModelo(codigoDoBotao({ tipo: 'pedido', id }))).toEqual({ tipo: 'pedido', id });
    expect(toqueNoModelo(`mister:pedido:não-é-id`)).toBeNull();
  });
});
