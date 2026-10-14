import { ForbiddenException } from '@nestjs/common';
import { ACEITA_INTEGRADOR } from './aceita-integrador.decorator';
import { SyncTokenGuard } from './sync-token.guard';
import { SyncController } from './sync.controller';
import { CatalogoSyncController } from '../produto/catalogo-sync.controller';
import { VendasExternaController } from '../vendas/vendas-externa.controller';
import { DeliveryController } from '../delivery/delivery.controller';
import { DeliveryLojaController } from '../delivery/delivery-loja.controller';
import { EntregadoresAoVivoController } from '../delivery/entregadores-ao-vivo.controller';
import { EdgeController } from '../edge/edge.controller';
import { IbptController } from '../fiscal/ibpt/ibpt.controller';
import { GogemRepasseController } from '../gogem/gogem-repasse.controller';
import { ImpressaoController } from '../impressao/impressao.controller';
import { LicencaController } from '../licenca/licenca.controller';
import { MidiaController } from '../midia/midia.controller';
import { TefController } from '../tef/tef.controller';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL DO GOGEM SÓ ABRE AS ROTAS DELA (fase 0 da credencial própria do GoGeM, 14/10/2026).
// A credencial do GoGeM é o token de um equipamento `servidor_local` (mig 290) e passava pelo mesmo
// guarda do servidor da loja: abria o sincronismo inteiro (`/sync/pull`, `/sync/snapshot`,
// `/sync/restore`, `/sync/push` — a cópia de todos os dados da empresa) e o tempo real da empresa.
// Agora, na NUVEM, a credencial de integrador passa só nas rotas marcadas com `@AceitaIntegrador()`
// (as cinco que o GoGeM chama) e não entra no tempo real. O servidor da loja não muda nada.

const NUVEM = () => delete process.env.EDGE_MODE;
const LOJA = () => (process.env.EDGE_MODE = 'true');

function contexto(controller: any, metodo: string, headers: Record<string, string> = { 'x-sync-token': 'tok' }) {
  const req: any = { headers, originalUrl: `/api/v1/${metodo}`, url: `/api/v1/${metodo}` };
  return {
    req,
    ctx: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => controller.prototype[metodo],
      getClass: () => controller,
    } as any,
  };
}
function guardCom(dev: any) {
  return new SyncTokenGuard({ validarToken: async () => dev, notarIntegrador: async () => undefined } as any);
}

const servidorDaLoja = { id: 'e-loja', tenantId: 't1', unidadeId: 'u1', tipo: 'servidor_local', integrador: null, lastPushSeq: 42 };
const credencialGogem = { id: 'e-gogem', tenantId: 't1', unidadeId: 'u1', tipo: 'servidor_local', integrador: 'gogem' };
const credencialSemMarca = { id: 'e-novo', tenantId: 't1', unidadeId: 'u1', tipo: 'servidor_local', integrador: null };

// As cinco rotas que a nuvem do GoGeM chama (clientes do Regem no GoGeM, `origin/main` a77bfaa).
const ROTAS_DO_GOGEM: Array<[any, string]> = [
  [CatalogoSyncController, 'catalogo'], // GET /sync/catalogo
  [CatalogoSyncController, 'pausar'], // POST /sync/produtos/pausa
  [VendasExternaController, 'venderTotem'], // POST /vendas/externa-pdv
  [VendasExternaController, 'falhaTotem'], // POST /vendas/externa-pdv/falha
  [DeliveryController, 'totemDinheiro'], // POST /delivery/totem-dinheiro
];

describe('credencial de integrador (GoGeM): só as rotas dela', () => {
  const ORIG = process.env.EDGE_MODE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIG;
  });

  it('na nuvem, a credencial do GoGeM é recusada (403) no sincronismo da empresa', async () => {
    NUVEM();
    for (const metodo of ['pull', 'restore', 'snapshot', 'push']) {
      const { ctx } = contexto(SyncController, metodo);
      await expect(guardCom(credencialGogem).canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('na nuvem, a credencial do GoGeM passa nas cinco rotas dele', async () => {
    NUVEM();
    for (const [controller, metodo] of ROTAS_DO_GOGEM) {
      const { ctx, req } = contexto(controller, metodo);
      await expect(guardCom(credencialGogem).canActivate(ctx)).resolves.toBe(true);
      expect(req.sync).toMatchObject({ tenantId: 't1', equipamentoId: 'e-gogem' });
    }
  });

  it('quem ainda não foi marcado mas chama com X-Integrador: gogem também fica restrito', async () => {
    NUVEM();
    const pull = contexto(SyncController, 'pull', { 'x-sync-token': 'tok', 'x-integrador': 'gogem' });
    await expect(guardCom(credencialSemMarca).canActivate(pull.ctx)).rejects.toBeInstanceOf(ForbiddenException);
    const venda = contexto(VendasExternaController, 'venderTotem', { 'x-sync-token': 'tok', 'x-integrador': 'gogem' });
    await expect(guardCom(credencialSemMarca).canActivate(venda.ctx)).resolves.toBe(true);
  });

  it('o servidor da loja segue abrindo o sincronismo (nada muda para ele)', async () => {
    NUVEM();
    for (const metodo of ['pull', 'restore', 'snapshot', 'push']) {
      const { ctx } = contexto(SyncController, metodo);
      await expect(guardCom(servidorDaLoja).canActivate(ctx)).resolves.toBe(true);
    }
    // Cabeçalho desconhecido não restringe nem marca nada.
    const { ctx } = contexto(SyncController, 'pull', { 'x-sync-token': 'tok', 'x-integrador': 'outro' });
    await expect(guardCom(servidorDaLoja).canActivate(ctx)).resolves.toBe(true);
  });

  it('no servidor da loja a regra não vale (lá a credencial do GoGeM nem existe)', async () => {
    LOJA();
    const { ctx } = contexto(SyncController, 'pull');
    await expect(guardCom(credencialGogem).canActivate(ctx)).resolves.toBe(true);
  });

  it('contexto sem rota identificável: recusa (a lista é do que pode)', async () => {
    NUVEM();
    const req: any = { headers: { 'x-sync-token': 'tok' }, originalUrl: '/api/v1/sync/pull' };
    await expect(guardCom(credencialGogem).canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lista FECHADA: entre todas as rotas de token de dispositivo, só as cinco do GoGeM aceitam integrador', () => {
    const controllers = [
      SyncController, CatalogoSyncController, VendasExternaController, DeliveryController, DeliveryLojaController,
      EntregadoresAoVivoController, EdgeController, IbptController, GogemRepasseController, ImpressaoController,
      LicencaController, MidiaController, TefController,
    ];
    const marcadas: string[] = [];
    for (const c of controllers) {
      if (Reflect.getMetadata(ACEITA_INTEGRADOR, c)) marcadas.push(`${c.name} (a classe inteira)`);
      for (const m of Object.getOwnPropertyNames(c.prototype))
        if (m !== 'constructor' && Reflect.getMetadata(ACEITA_INTEGRADOR, c.prototype[m])) marcadas.push(`${c.name}.${m}`);
    }
    expect(marcadas.sort()).toEqual(ROTAS_DO_GOGEM.map(([c, m]) => `${c.name}.${m}`).sort());
  });
});

describe('credencial de integrador (GoGeM): o tempo real da empresa', () => {
  const ORIG = process.env.EDGE_MODE;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = ORIG;
  });
  function conectar(dev: any) {
    let pings = 0;
    const g = new RealtimeGateway({} as any, { validarToken: async () => dev, registrarPing: async () => { pings++; } } as any);
    const emits: any[] = [];
    (g as any).server = { to: (room: string) => ({ emit: (ev: string, p: any) => emits.push({ room, ev, p }) }) };
    const salas: string[] = [];
    const recebidos: any[] = [];
    let desligado = false;
    const socket: any = {
      handshake: { auth: { token: 'tok' }, headers: {} },
      data: {},
      join: (s: string) => salas.push(s),
      emit: (ev: string, p: any) => recebidos.push({ ev, p }),
      disconnect: () => { desligado = true; },
    };
    return { g, socket, salas, recebidos, emits, foi: () => desligado, pings: () => pings };
  }

  it('na nuvem, a credencial do GoGeM não entra nas salas da empresa', async () => {
    NUVEM();
    const c = conectar(credencialGogem);
    await c.g.handleConnection(c.socket);
    expect(c.foi()).toBe(true);
    expect(c.salas).toEqual([]);
    expect(c.recebidos).toEqual([{ ev: 'erro', p: { motivo: 'credencial de integração não abre o tempo real' } }]);
    expect(c.emits).toEqual([]); // nem anuncia "aparelho online" para a empresa
  });

  it('o aparelho da loja segue conectando', async () => {
    NUVEM();
    const c = conectar({ id: 'e-kds', tenantId: 't1', unidadeId: 'u1', tipo: 'kds', nome: 'KDS', integrador: null });
    await c.g.handleConnection(c.socket);
    expect(c.foi()).toBe(false);
    expect(c.salas.length).toBeGreaterThan(0);
    expect(c.pings()).toBe(1);
  });
});
