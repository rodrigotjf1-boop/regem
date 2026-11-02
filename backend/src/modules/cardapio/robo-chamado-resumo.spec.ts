import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ROTA DO ROBÔ (`POST publico/cardapio/:token/atendimento`) ENTREGA O RESUMO DO CASO à central (Onda 1, PR 4): das
// linhas "Motivo / Quer / Já fiz" da mensagem (o fluxo do n8n de hoje) ou dos campos próprios; urgente = cliente
// chateado. A senha do robô continua exigida (ERR-320). O serviço é montado à mão: só o caminho da rota importa aqui.
describe('o chamado do robô leva o resumo', () => {
  const segredo = process.env.BOT_RESOLVER_SECRET;
  let abertos: any[];
  let svc: any;
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
    abertos = [];
    svc = Object.create(CardapioService.prototype);
    svc.resolver = async () => ({ tenantId: 't1', unidadeId: 'u1' });
    svc.pedidoDoChamado = async () => ({ id: 'p1', numero: '1180' });
    svc.atendimento = { abrirPeloRobo: async (t: string, u: string, d: any) => (abertos.push({ t, u, d }), { ok: true, id: 'c1', posicao: 2, comAlguem: false }) };
  });
  afterAll(() => {
    if (segredo === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = segredo;
  });

  it('das três linhas da mensagem; a resposta ao robô traz a posição na fila', async () => {
    const r = await svc.abrirAtendimento('tok', { tipo: 'erro', telefone: '21987654321', urgente: true, mensagem: 'Motivo: atraso\nQuer: saber quando chega\nJá fiz: mandei o rastreio' }, 'senha-do-robo');
    expect(r).toMatchObject({ posicao: 2, comAlguem: false });
    expect(abertos[0].d).toMatchObject({
      prioridade: 'urgente',
      pedidoId: 'p1',
      resumo: { motivo: 'atraso', quer: 'saber quando chega', jaFez: 'mandei o rastreio', humor: 'chateado' },
    });
  });

  it('mensagem livre (fluxo antigo): sem resumo — a tela mostra a mensagem como sempre', async () => {
    await svc.abrirAtendimento('tok', { tipo: 'humano', telefone: '21987654321', mensagem: 'quer ajuda para pedir' }, 'senha-do-robo');
    expect(abertos[0].d.resumo).toBeNull();
  });

  it('sem a senha do robô: recusa, nada abre (ERR-320)', async () => {
    await expect(svc.abrirAtendimento('tok', { mensagem: 'Motivo: x' }, 'errada')).rejects.toThrow('Não autorizado.');
    expect(abertos).toEqual([]);
  });
});
