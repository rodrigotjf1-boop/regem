import { DeliveryController } from './delivery.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O mapa dos entregadores no KDS mostra onde estão PESSOAS (mig 293): ligar e desligar fica na
// auditoria — e só quando muda (a tela do delivery manda a configuração inteira a cada ajuste).
describe('configuração do delivery — auditoria do mapa no KDS', () => {
  const gestor: any = { tenantId: 't1', colaboradorId: 'g1', categoria: 'gerente' };

  function montar(antes: boolean, depois: boolean) {
    const service: any = {
      getConfig: jest.fn(async () => ({ kdsMapaEntregadores: antes })),
      setConfig: jest.fn(async () => ({ kdsMapaEntregadores: depois, qrDespacho: true })),
    };
    const auditoria: any = { registrar: jest.fn(async () => undefined) };
    return { ctl: new DeliveryController(service, auditoria), service, auditoria };
  }

  it('ligar registra quem ligou', async () => {
    const { ctl, auditoria } = montar(false, true);
    await expect(ctl.setConfig(gestor, { kdsMapaEntregadores: true })).resolves.toMatchObject({ kdsMapaEntregadores: true });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', atorId: 'g1', tipo: 'delivery', acao: 'ligou_mapa_entregadores_kds' }),
    );
  });

  it('desligar também; salvar outra coisa sem mudar a chave não registra', async () => {
    const d = montar(true, false);
    await d.ctl.setConfig(gestor, { kdsMapaEntregadores: false });
    expect(d.auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'desligou_mapa_entregadores_kds' }));

    const igual = montar(true, true);
    await igual.ctl.setConfig(gestor, { qrDespacho: true, kdsMapaEntregadores: true });
    expect(igual.auditoria.registrar).not.toHaveBeenCalled();
  });
});
