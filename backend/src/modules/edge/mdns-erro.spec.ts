import { EdgeService } from './edge.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O anúncio mDNS do servidor local (KDS/Ponto acham o servidor por ele). A biblioteca LANÇA a
// falha de envio por padrão — EHOSTUNREACH quando a placa de rede cai ou o Wi-Fi reconecta — e
// isso virava exceção não tratada: a API saía e o NSSM a reiniciava, com os caixas sem servidor
// a cada oscilação da rede. Reproduzido na loja simulada: a API caiu 6 min depois de subir
// (ERR-112).
describe('mDNS do servidor local: erro de rede não derruba a API (ERR-112)', () => {
  const antes = process.env.EDGE_MODE;
  let svc: EdgeService | undefined;

  afterAll(() => {
    svc?.onModuleDestroy();
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
  });

  it('falha ao enviar ou no socket vira aviso no log, não exceção', () => {
    process.env.EDGE_MODE = 'true';
    svc = new EdgeService({} as any);
    const avisos: string[] = [];
    (svc as any).logger = { warn: (m: string) => avisos.push(m), log: () => undefined };
    svc.onApplicationBootstrap();
    const bonjour = (svc as any).bonjour;
    expect(bonjour).toBeDefined();

    const erro = Object.assign(new Error('send EHOSTUNREACH 224.0.0.251:5353'), { code: 'EHOSTUNREACH' });
    // O caminho do incidente: a resposta a uma consulta não sai (callback do envio).
    expect(() => bonjour.server.errorCallback(erro)).not.toThrow();
    // E o socket: 'error' sem ouvinte num EventEmitter também derruba o processo.
    expect(() => bonjour.server.mdns.emit('error', erro)).not.toThrow();
    expect(avisos.filter((a) => a.includes('[EHOSTUNREACH]'))).toHaveLength(1); // 1x por minuto
  });
});
