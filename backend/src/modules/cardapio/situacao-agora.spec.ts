import { RoboConsultasController } from './robo-consultas.controller';
import { instrucoesDoRobo, VERSAO_INSTRUCOES } from './robo-instrucoes';
import { situacaoAgoraParaAsInstrucoes } from './situacao-agora';
import { vereditoDaLoja } from './situacao-da-loja';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-629 (teste do dono, 27/11/2026): o atendente seguiu com o horário e as formas de pagamento que tinha na memória da
// conversa — "não estamos recebendo pedidos" depois de o dono estender o horário, e as formas de pagamento de um pedido de 5
// horas antes, sem o Pix. As instruções (lidas do Regem a cada mensagem) passam a trazer a situação de AGORA, no fim.
const AGORA = new Date('2026-11-27T04:00:00Z'); // sexta, 01:00 em São Paulo
const MENU: any = {
  tipos: { delivery: true, retirada: true },
  abertoPorTipo: { entrega: true, retirada: true },
  fechaAs: { entrega: '01:55', retirada: '03:00' },
  proximaAbertura: { entrega: null, retirada: null },
  loja: { pagamentos: ['pix', 'entrega', 'vr'] },
};

describe('a situação da loja agora, nas instruções (ERR-629)', () => {
  it('aberta: até que horas cada tipo recebe, as formas de pagamento com o Pix e que isso vale mais que a conversa', () => {
    const t = situacaoAgoraParaAsInstrucoes(MENU, null, AGORA);
    expect(t).toContain('SITUAÇÃO DA LOJA AGORA (lida do sistema nesta mensagem: sexta, 01:00)');
    expect(t).toContain('vale mais que qualquer coisa dita antes nesta conversa');
    expect(t).toContain('- Entrega: aberta, recebe pedido até 01:55.');
    expect(t).toContain('- Retirada: aberta, recebe pedido até 03:00.');
    expect(t).toContain('- Formas de pagamento pela conversa agora: Pix, Dinheiro, Cartão na entrega, Vale-refeição.');
    expect(t).toContain('Nunca repita uma mensagem, opções ou uma confirmação de antes na conversa');
  });

  it('a entrega fechada pelo horário e a retirada aberta: cada uma pelo seu; a volta da entrega', () => {
    const t = situacaoAgoraParaAsInstrucoes(
      { ...MENU, abertoPorTipo: { entrega: false, retirada: true }, fechaAs: { entrega: null, retirada: '03:00' }, proximaAbertura: { entrega: 'sex 19:00', retirada: null } },
      null,
      AGORA,
    );
    expect(t).toContain('- Entrega: fechada agora (abre sex 19:00).');
    expect(t).toContain('- Retirada: aberta, recebe pedido até 03:00.');
  });

  it('fechada pelos aplicativos (o veredito conferido): fechada nos dois tipos e o como responder; incerta: não afirmar', () => {
    const fechada = vereditoDaLoja({ cardapioAberto: true, canais: [{ nome: '99', estado: 'fechada', motivo: null, ate: null, fonte: 'plataforma' }], servidor: 'ok', agora: AGORA });
    const t = situacaoAgoraParaAsInstrucoes(MENU, fechada, AGORA);
    expect(t).toContain('- Entrega: fechada agora (conferido com os aplicativos da loja).');
    expect(t).toContain('- Retirada: fechada agora (conferido com os aplicativos da loja).');
    expect(t).toContain('A loja NÃO está recebendo pedidos agora');
    const incerta = vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: 'sem_sinal', agora: AGORA });
    expect(situacaoAgoraParaAsInstrucoes(MENU, incerta, AGORA)).toContain('Não deu para confirmar agora se a loja está atendendo');
  });

  it('a pausa dos pedidos, a loja só de retirada e a loja sem formas de pagamento pela conversa', () => {
    const pausada = situacaoAgoraParaAsInstrucoes(
      { ...MENU, abertoPorTipo: { entrega: false, retirada: false }, pausa: { rotulo: 'Muitos pedidos', volta: { texto: 'às 21:40' } } },
      null,
      AGORA,
    );
    expect(pausada).toContain('- Pedidos pausados pela loja (Muitos pedidos), voltam às 21:40: não monte pedido até lá.');
    const soRetirada = situacaoAgoraParaAsInstrucoes({ ...MENU, tipos: { delivery: false, retirada: true }, loja: { pagamentos: [] } }, null, AGORA);
    expect(soRetirada).not.toContain('- Entrega:');
    expect(soRetirada).not.toContain('Formas de pagamento');
  });

  it('as instruções levam o bloco POR ÚLTIMO (fluxo 2 e fluxo 1); sem ele, o texto de antes', () => {
    const bloco = situacaoAgoraParaAsInstrucoes(MENU, null, AGORA);
    for (const fluxo of ['2', '1']) {
      const r = instrucoesDoRobo({ loja: 'Loja', agora: bloco }, fluxo);
      expect(r.texto.endsWith(bloco)).toBe(true);
      expect(instrucoesDoRobo({ loja: 'Loja' }, fluxo).texto).not.toContain('SITUAÇÃO DA LOJA AGORA');
    }
    expect(VERSAO_INSTRUCOES).toBe('2026-11-27.f39');
  });

  describe('a rota publico/bot/instrucoes', () => {
    const montar = (conferida: () => Promise<any>) => {
      const service: any = {
        tokenDaLojaDoRobo: async () => 'tok',
        menu: async () => ({ ...MENU, abertaAgora: true, loja: { ...MENU.loja, nome: 'Loja', aberto: true } }),
        jeitoDoAtendenteDoRobo: async () => '',
        assuntosDoAtendenteDoRobo: async () => '',
        conhecimentoDoRobo: async () => '',
        printDeAjudaDoRobo: async () => false,
        agendadoDoRobo: async () => false,
        situacaoConferida: jest.fn(conferida),
      };
      return { ctl: new RoboConsultasController(service), service };
    };

    it('no WhatsApp: o bloco com o veredito conferido, pela mesma entrada do consultar_loja (aberta e sem pausa)', async () => {
      const { ctl, service } = montar(async () => vereditoDaLoja({ cardapioAberto: true, canais: [], servidor: 'ok' }));
      const r: any = await ctl.instrucoes('2', 'inst', undefined, undefined, 'senha');
      expect(r.texto).toContain('- Entrega: aberta, recebe pedido até 01:55.');
      expect(r.texto).toContain('Pix, Dinheiro, Cartão na entrega, Vale-refeição');
      expect(service.situacaoConferida).toHaveBeenCalledWith('tok', true);
    });

    it('a conferência falhou: o bloco sai só com o cardápio (as instruções nunca caem por isso)', async () => {
      const { ctl } = montar(async () => {
        throw new Error('banco fora');
      });
      const r: any = await ctl.instrucoes('2', 'inst', undefined, undefined, 'senha');
      expect(r.texto).toContain('SITUAÇÃO DA LOJA AGORA');
      expect(r.texto).toContain('- Retirada: aberta, recebe pedido até 03:00.');
    });
  });
});
