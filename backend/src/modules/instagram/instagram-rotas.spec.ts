import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createHmac } from 'node:crypto';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { AtendimentoLojaController } from '../atendimento/atendimento-loja.controller';
import { InstagramController, InstagramPublicoController } from './instagram.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ROTAS DO INSTAGRAM (mig 377): conectar, desconectar e o estado são de gerente e presidente e só da nuvem (o login
// volta para ela); a conversa é de quem atende a fila e a resposta, da gestão — as duas valem nas duas pontas (V37);
// as rotas "da loja" são só da nuvem e pelo token do servidor; as públicas são só da nuvem e o aviso só entra assinado.
describe('as rotas do Instagram Direct', () => {
  const rota = (nome: string) => (InstagramController.prototype as any)[nome];
  const daLoja = (nome: string) => (AtendimentoLojaController.prototype as any)[nome];

  it('perfis e pontas', () => {
    for (const nome of ['estado', 'conectar', 'desconectar']) {
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(['presidente', 'gerente']);
      expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBe(true);
    }
    expect(Reflect.getMetadata(ROLES_KEY, rota('conversa'))).toEqual(['presidente', 'gerente', 'supervisao', 'execucao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('responder'))).toEqual(['presidente', 'gerente', 'supervisao']);
    for (const nome of ['conversa', 'responder']) expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBeUndefined();
    for (const nome of ['instagramDaLoja', 'responderInstagramDaLoja']) {
      expect(Reflect.getMetadata(CLOUD_ONLY, daLoja(nome))).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, daLoja(nome))).toEqual([SyncTokenGuard]);
    }
    expect(Reflect.getMetadata(CLOUD_ONLY, InstagramPublicoController)).toBe(true);
  });

  describe('o aviso público', () => {
    const antes = { ...process.env };
    afterEach(() => {
      for (const k of ['INSTAGRAM_APP_SECRET', 'INSTAGRAM_WEBHOOK_SECRET', 'WA_CLOUD_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN']) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    });
    const corpo = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));
    const assinado = (s: string) => `sha256=${createHmac('sha256', s).update(corpo).digest('hex')}`;
    const ctrl = (tratados: any[]) => new InstagramPublicoController({ processar: async (b: any) => void tratados.push(b) } as any);

    it('só entra assinado com um segredo da distribuição (o do Instagram ou o do app da Meta)', () => {
      process.env.INSTAGRAM_APP_SECRET = 'seg-ig';
      process.env.WA_CLOUD_APP_SECRET = 'seg-meta';
      const tratados: any[] = [];
      const c = ctrl(tratados);
      expect(c.evento({ rawBody: corpo, body: { object: 'instagram' }, headers: { 'x-hub-signature-256': assinado('seg-ig') } })).toEqual({ ok: true });
      expect(c.evento({ rawBody: corpo, body: { object: 'instagram' }, headers: { 'x-hub-signature-256': assinado('seg-meta') } })).toEqual({ ok: true });
      expect(() => c.evento({ rawBody: corpo, body: {}, headers: { 'x-hub-signature-256': assinado('outro') } })).toThrow('Assinatura inválida.');
      expect(() => c.evento({ rawBody: corpo, body: {}, headers: {} })).toThrow('Assinatura inválida.');
      expect(tratados).toHaveLength(2);
    });
    it('sem segredo configurado, nada entra', () => {
      delete process.env.INSTAGRAM_APP_SECRET;
      delete process.env.INSTAGRAM_WEBHOOK_SECRET;
      delete process.env.WA_CLOUD_APP_SECRET;
      expect(() => ctrl([]).evento({ rawBody: corpo, body: {}, headers: { 'x-hub-signature-256': assinado('') } })).toThrow('Assinatura inválida.');
    });
    it('o desafio: só com o token certo devolve o challenge cru', () => {
      process.env.INSTAGRAM_VERIFY_TOKEN = 'verifica-ig';
      const c = ctrl([]);
      expect(c.verificar('subscribe', 'verifica-ig', '1158201444')).toBe('1158201444');
      expect(() => c.verificar('subscribe', 'errado', '1')).toThrow('Verificação inválida.');
      expect(() => c.verificar('unsubscribe', 'verifica-ig', '1')).toThrow('Verificação inválida.');
      delete process.env.INSTAGRAM_VERIFY_TOKEN;
      expect(() => c.verificar('subscribe', '', '1')).toThrow('Verificação inválida.');
    });
  });
});
