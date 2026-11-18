import { createServer, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { ClienteDeIa, IaEmpresaService, opcoesComPrazoTotal } from './ia-empresa.service';
import { classificarFalha } from './ia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRAZO DA IA É TOTAL (ERR-525, LIC-035). O `timeout` do SDK da Anthropic vale por tentativa, e o cliente do Regem
// tem `maxRetries: 1`: sem o sinal do prazo total, a pergunta com "15 s" esperava ~30 s (duas tentativas e a espera
// entre elas). Aqui o SDK de VERDADE, com as mesmas opções de produção, fala com um servidor local que nunca responde.
jest.setTimeout(20_000);

describe('o prazo da IA da empresa é o total, com a nova tentativa dentro dele', () => {
  let servidor: Server;
  let base = '';
  let pedidos = 0;
  const soquetes = new Set<Socket>();

  beforeAll(async () => {
    servidor = createServer(() => {
      pedidos += 1; // segura o pedido e nunca responde
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const s of soquetes) s.destroy();
    await new Promise((fechou) => servidor.close(fechou));
  });

  class IaContraServidorParado extends IaEmpresaService {
    // as mesmas opções de produção (`criarCliente`); só o endereço do provedor muda
    protected criarCliente(chave: string): ClienteDeIa {
      return new Anthropic({ apiKey: chave, baseURL: base, timeout: 20_000, maxRetries: 1 });
    }
  }

  it('a pergunta com prazo de 600 ms acaba perto de 600 ms, não no dobro mais a espera da nova tentativa', async () => {
    const svc = new IaContraServidorParado({} as any, {} as any);
    const acesso = { provedor: 'anthropic', chave: `sk-ant-api03-${'p'.repeat(60)}PPPP`, origem: 'empresa' };
    const pedido = { recurso: 'teste', modelo: 'claude-haiku-5-5', maxTokens: 10, messages: [{ role: 'user', content: 'oi' }], prazoMs: 600 };
    pedidos = 0;
    const inicio = Date.now();
    const erro: any = await (svc as any).chamar(acesso, pedido).then(
      () => null,
      (e: unknown) => e,
    );
    const levou = Date.now() - inicio;
    expect(erro).toBeTruthy();
    expect(levou).toBeGreaterThanOrEqual(550);
    // sem o sinal: ~600 + a espera antes da nova tentativa (≥ 375 ms) + 600 = bem mais de 1,1 s
    expect(levou).toBeLessThan(1_100);
    // a falha por prazo continua sendo "o provedor não atendeu" (passageira), como o estouro do timeout
    expect(classificarFalha({ status: erro?.status ?? null, mensagem: String(erro?.message ?? '') })).toBe('indisponivel');
  });

  it('as opções do pedido levam o prazo de cada tentativa e o sinal do total', () => {
    const o = opcoesComPrazoTotal(500);
    expect(o.timeout).toBe(500);
    expect(o.signal).toBeInstanceOf(AbortSignal);
    expect(o.signal.aborted).toBe(false);
  });
});
