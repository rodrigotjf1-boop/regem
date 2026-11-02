import { EntregadorService } from './entregador.service';
import { RAIO_ENTREGUE_M, distanciaParaLer, localInformado, longeDoEndereco, textoDeLonge } from './local-da-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "ENTREGUE" PERTO DO ENDEREÇO quando o pedido não tem código (a loja desligou o código, mig 348; decisão do dono de
// 01/11/2026): o app manda a posição do toque e o servidor confere a distância até o endereço do pedido.
const ENTREGADOR: any = { tenantId: 't1', colaboradorId: 'c1', categoria: 'execucao', nome: 'Ana', funcaoNome: 'Entregador' };
const DESTINO = { lat: -22.9, lng: -43.2 };
// 0,001° de latitude ≈ 111 m.
const PERTO = { lat: -22.901, lng: -43.2, precisao: 15 };
const LONGE = { lat: -22.911, lng: -43.2, precisao: 15 }; // ≈ 1,2 km

describe('local da entrega — a regra', () => {
  it('a posição só vale com números de verdade; o "0,0" de aparelho sem GPS não conta', () => {
    expect(localInformado({ lat: -22.9, lng: -43.2, precisao: 12 })).toEqual({ lat: -22.9, lng: -43.2, precisao: 12 });
    expect(localInformado({ lat: '-22.9', lng: '-43.2' })).toEqual({ lat: -22.9, lng: -43.2, precisao: null });
    for (const v of [null, undefined, 'x', {}, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: 'a', lng: 1 }, { lat: 0, lng: 0 }])
      expect(localInformado(v)).toBeNull();
    expect(localInformado({ lat: 1, lng: 1, precisao: -5 })).toEqual({ lat: 1, lng: 1, precisao: null });
  });

  it(`perto é até ${RAIO_ENTREGUE_M} m, com a precisão do GPS de folga até 150 m`, () => {
    expect(longeDoEndereco(300, null)).toBe(false);
    expect(longeDoEndereco(301, null)).toBe(true);
    expect(longeDoEndereco(400, 120)).toBe(false); // 400 − 120 = 280
    expect(longeDoEndereco(400, 900)).toBe(false); // a folga para em 150: 250
    expect(longeDoEndereco(500, 900)).toBe(true); // 350
  });

  it('a distância e a recusa para a pessoa ler, com o nome dos botões das telas (V65)', () => {
    expect(distanciaParaLer(847)).toBe('850 m');
    expect(distanciaParaLer(1234)).toBe('1,2 km');
    expect(textoDeLonge(1234)).toBe(
      'Você está a 1,2 km do endereço do cliente. Toque em "Concluir entrega" quando estiver lá. Se já está no endereço, peça à loja para finalizar o pedido no painel.',
    );
    // O botão do app que conclui a entrega tem esse nome (pedido_screen.dart); o do painel é o FINALIZAR (delivery/page.tsx).
    const raiz = require('node:path').join(__dirname, '../../../..');
    const ler = (arq: string) => require('node:fs').readFileSync(require('node:path').join(raiz, arq), 'utf8');
    expect(ler('app-entregador/lib/screens/pedido_screen.dart')).toContain("'Concluir entrega'");
    expect(ler('frontend/src/app/delivery/page.tsx')).toContain("'FINALIZAR'");
  });
});

describe('local da entrega — finalizar o pedido sem código', () => {
  function servico(ped: any, opts: { destino?: any } = {}) {
    const db: any = {
      select: () => ({ from: () => ({ where: async () => [ped] }) }),
      execute: async () => ({ rows: [{ id: 'p1', unidade_id: 'u1' }] }),
    };
    const delivery: any = { marcarEntregue: jest.fn(async () => ({})), confirmarEntregaComCodigo: jest.fn() };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    const svc = new EntregadorService(db, delivery, {} as any, auditoria);
    (svc as any).avancarSaida = jest.fn(async () => undefined);
    (svc as any).coordDoPedido = jest.fn(async () => ('destino' in opts ? opts.destino : DESTINO));
    return { svc, delivery, auditoria };
  }
  const semCodigo = (extra: any = {}) => ({ canal: 'cardapio', tipo: 'entrega', raw: null, codigoEntrega: null, status: 'despachado', ...extra });

  it('perto do endereço: entregue', async () => {
    const { svc, delivery, auditoria } = servico(semCodigo());
    await expect(svc.finalizar(ENTREGADOR, 'p1', undefined, PERTO)).resolves.toEqual({ ok: true, valid: true });
    expect(delivery.marcarEntregue).toHaveBeenCalledWith('t1', 'c1', 'p1');
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('longe do endereço: recusa com a distância, e o pedido segue a caminho', async () => {
    const { svc, delivery } = servico(semCodigo());
    await expect(svc.finalizar(ENTREGADOR, 'p1', undefined, LONGE)).rejects.toThrow('Você está a 1,2 km do endereço do cliente');
    expect(delivery.marcarEntregue).not.toHaveBeenCalled();
  });

  it('sem a posição (app antigo, GPS desligado) ou endereço sem coordenadas: entregue, e a auditoria diz que não conferiu', async () => {
    const a = servico(semCodigo());
    await a.svc.finalizar(ENTREGADOR, 'p1');
    expect(a.delivery.marcarEntregue).toHaveBeenCalled();
    expect(a.auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', unidadeId: 'u1', atorId: 'c1', acao: 'entregue_sem_conferir_local', entidadeId: 'p1', detalhe: { motivo: 'o app não mandou a posição' } }),
    );
    const b = servico(semCodigo(), { destino: null });
    await b.svc.finalizar(ENTREGADOR, 'p1', undefined, LONGE);
    expect(b.delivery.marcarEntregue).toHaveBeenCalled();
    expect(b.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ detalhe: { motivo: 'o endereço do pedido não tem coordenadas' } }));
  });

  it('pedido COM código, ou já entregue (o reenvio da fila sem internet): o local não é conferido', async () => {
    const comCodigo = servico(semCodigo({ codigoEntrega: '4821' }));
    await comCodigo.svc.finalizar(ENTREGADOR, 'p1', '4821', LONGE);
    expect(comCodigo.delivery.marcarEntregue).toHaveBeenCalled();
    expect((comCodigo.svc as any).coordDoPedido).not.toHaveBeenCalled();
    const jaEntregue = servico(semCodigo({ status: 'entregue' }));
    await jaEntregue.svc.finalizar(ENTREGADOR, 'p1', undefined, LONGE);
    expect(jaEntregue.delivery.marcarEntregue).toHaveBeenCalled();
    expect((jaEntregue.svc as any).coordDoPedido).not.toHaveBeenCalled();
  });
});
