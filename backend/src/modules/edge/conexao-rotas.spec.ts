import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PresencaService } from '../equipamento/presenca.service';
import { EdgeController } from './edge.controller';
import { RedeLocalService } from './rede-local.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONEXÃO PC ↔ SERVIDOR, parte 1 — as duas rotas novas do servidor da loja:
//  • `GET /edge/rede`: o endereço do servidor na rede (só gestão com a permissão "servidor");
//  • `POST /edge/presenca`: o app aberto avisa a cada 30 s; com o terminal pareado, o PC fica
//    "conectado agora" — e a resposta é o que o indicador do topo mostra.

describe('rotas da conexão PC ↔ servidor', () => {
  const original = process.env.EDGE_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = original;
  });

  const rede = {
    nome: 'regem.local', maquina: 'SERVIDOR-MB', ip: '192.168.0.10', interface: 'Ethernet', mac: '3C-52-82-4A-19-7E',
    gateway: '192.168.0.1', outros: [], portas: { app: 3001, api: 3002 }, desde: null, anterior: null, medidoEm: new Date().toISOString(),
  };
  const usuario = { tenantId: 't1', categoria: 'execucao' } as any;

  function montar() {
    process.env.EDGE_MODE = 'true';
    const presenca = new PresencaService({ execute: async () => ({ rows: [] }) } as any);
    const redeLocal = { atual: rede, ler: jest.fn() } as any as RedeLocalService;
    const ctl = new EdgeController({} as any, {} as any, redeLocal, presenca);
    return { ctl, presenca };
  }

  it('presença: com o terminal pareado o PC fica conectado, com o IP e o endereço que usou', () => {
    const { ctl, presenca } = montar();
    const req = { ip: '::ffff:192.168.0.23', headers: { host: 'regem.local:3002' }, terminal: { id: 'pdv-1', nome: 'Pdv delivery', tipo: 'pdv' } };
    const r = ctl.presencaDoPc(usuario, req);
    expect(r).toEqual({
      servidor: { nome: 'regem.local', ip: '192.168.0.10', maquina: 'SERVIDOR-MB', versao: process.env.APP_VERSION ?? null },
      pc: { ip: '192.168.0.23', endereco: 'regem.local' },
      terminal: { id: 'pdv-1', nome: 'Pdv delivery', tipo: 'pdv' },
    });
    expect(presenca.doTenant('t1').map((p) => [p.id, p.tipo, p.ip, p.endereco])).toEqual([['pdv-1', 'pdv', '192.168.0.23', 'regem.local']]);
  });

  it('presença: o tablet do garçom (sub-PDV do salão) também conta; sem terminal, responde e não anota', () => {
    const { ctl, presenca } = montar();
    ctl.presencaDoPc(usuario, { ip: '192.168.0.40', headers: { host: '192.168.0.10:3002' }, terminal: { id: 'salao-1', nome: 'Salão', tipo: 'salao' } });
    const semTerminal = ctl.presencaDoPc(usuario, { ip: '192.168.0.50', headers: { host: 'regem.local:3002' } });
    expect(semTerminal.terminal).toBeNull();
    // um equipamento de outro tipo no `req.terminal` (não deveria acontecer) não vira presença
    ctl.presencaDoPc(usuario, { ip: '192.168.0.60', headers: {}, terminal: { id: 'kds-1', nome: 'KDS', tipo: 'kds' } });
    expect(presenca.doTenant('t1').map((p) => [p.id, p.endereco])).toEqual([['salao-1', '192.168.0.10']]);
  });

  it('presença exige sessão; o endereço na rede exige gestão com a permissão "servidor"', () => {
    const guardas = (m: string) => Reflect.getMetadata(GUARDS_METADATA, (EdgeController.prototype as any)[m]) ?? [];
    expect(guardas('presencaDoPc')).toContain(JwtAuthGuard);
    expect(guardas('redeDoServidor')).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(ROLES_KEY, (EdgeController.prototype as any).redeDoServidor)).toEqual(['presidente', 'gerente']);
    expect(Reflect.getMetadata(REQUIRE_PERM, (EdgeController.prototype as any).redeDoServidor)).toMatchObject({ modulo: 'servidor' });
  });

  it('o endereço na rede só existe no servidor da loja; lá junta os PCs conectados', async () => {
    delete process.env.EDGE_MODE;
    const naNuvem = new RedeLocalService({ execute: async () => ({ rows: [] }) } as any);
    await expect(naNuvem.ler('t1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(naNuvem.medir()).resolves.toBeNull();

    process.env.EDGE_MODE = 'true';
    const presenca = new PresencaService({ execute: async () => ({ rows: [] }) } as any);
    presenca.notar({ id: 'pdv-1', tenantId: 't1', tipo: 'pdv', ip: '192.168.0.23', endereco: 'regem.local', maquina: null, versao: null });
    const gravado: any[] = [];
    const svc = new RedeLocalService({ execute: async (q: any) => { gravado.push(q); return { rows: [] }; } } as any, presenca);
    const r = await svc.ler('t1');
    expect(r.nome).toBe('regem.local');
    expect(r.pcsConectados).toBe(1);
    expect(r.portas.api).toBeGreaterThan(0);
    expect(gravado.length).toBeGreaterThan(0); // mediu e guardou (sync_state) para a batida levar à nuvem
  });

  it('servidor sem o sync_state (o sync-daemon ainda não criou): a medição vale do mesmo jeito', async () => {
    process.env.EDGE_MODE = 'true';
    const semTabela = { execute: async () => { throw new Error('relação "sync_state" não existe'); } } as any;
    const svc = new RedeLocalService(semTabela);
    const r = await svc.ler('t1');
    expect(r.nome).toBe('regem.local');
    expect(svc.atual).not.toBeNull(); // guardar falhou, mas a medição ficou (a tela e a presença a usam)
    expect(svc.atual?.medidoEm).toBe(r.medidoEm);
  });
});
