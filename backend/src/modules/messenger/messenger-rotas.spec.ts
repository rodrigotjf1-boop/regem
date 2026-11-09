import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createHmac } from 'node:crypto';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { AtendimentoLojaController } from '../atendimento/atendimento-loja.controller';
import { MessengerController, MessengerPublicoController } from './messenger.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ROTAS DO MESSENGER (mig 386): o estado, conectar, a escolha da página e desconectar são de gerente e presidente e só
// da nuvem (o login volta para ela); a conversa é de quem atende a fila e a resposta, da gestão — as duas valem nas duas
// pontas (V37); as rotas "da loja" são só da nuvem e pelo token do servidor; as públicas são só da nuvem e o aviso só entra
// assinado com o segredo do app do Facebook.
describe('as rotas do Messenger', () => {
  const rota = (nome: string) => (MessengerController.prototype as any)[nome];
  const daLoja = (nome: string) => (AtendimentoLojaController.prototype as any)[nome];

  it('perfis e pontas', () => {
    for (const nome of ['estado', 'conectar', 'paginas', 'escolher', 'desconectar']) {
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(['presidente', 'gerente']);
      expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBe(true);
    }
    expect(Reflect.getMetadata(ROLES_KEY, rota('conversa'))).toEqual(['presidente', 'gerente', 'supervisao', 'execucao']);
    expect(Reflect.getMetadata(ROLES_KEY, rota('responder'))).toEqual(['presidente', 'gerente', 'supervisao']);
    for (const nome of ['conversa', 'responder']) expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBeUndefined();
    for (const nome of ['messengerDaLoja', 'responderMessengerDaLoja']) {
      expect(Reflect.getMetadata(CLOUD_ONLY, daLoja(nome))).toBe(true);
      expect(Reflect.getMetadata(GUARDS_METADATA, daLoja(nome))).toEqual([SyncTokenGuard]);
    }
    expect(Reflect.getMetadata(CLOUD_ONLY, MessengerPublicoController)).toBe(true);
  });

  describe('o aviso público', () => {
    const antes = { ...process.env };
    afterEach(() => {
      for (const k of ['FACEBOOK_APP_SECRET', 'FACEBOOK_VERIFY_TOKEN', 'INSTAGRAM_APP_SECRET', 'WA_CLOUD_APP_SECRET']) {
        if (antes[k] === undefined) delete process.env[k];
        else process.env[k] = antes[k];
      }
    });
    const corpo = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
    const assinado = (s: string) => `sha256=${createHmac('sha256', s).update(corpo).digest('hex')}`;
    const ctrl = (tratados: any[]) => new MessengerPublicoController({ processar: async (b: any) => void tratados.push(b) } as any);

    it('só entra assinado com o segredo do app do Facebook (nem o do Instagram, nem o do WhatsApp)', () => {
      process.env.FACEBOOK_APP_SECRET = 'seg-fb';
      process.env.INSTAGRAM_APP_SECRET = 'seg-ig';
      process.env.WA_CLOUD_APP_SECRET = 'seg-wa';
      const tratados: any[] = [];
      const c = ctrl(tratados);
      expect(c.evento({ rawBody: corpo, body: { object: 'page' }, headers: { 'x-hub-signature-256': assinado('seg-fb') } })).toEqual({ ok: true });
      for (const s of ['seg-ig', 'seg-wa', 'outro'])
        expect(() => c.evento({ rawBody: corpo, body: {}, headers: { 'x-hub-signature-256': assinado(s) } })).toThrow('Assinatura inválida.');
      expect(() => c.evento({ rawBody: corpo, body: {}, headers: {} })).toThrow('Assinatura inválida.');
      // assinado sobre o corpo CRU: o mesmo JSON com outro corpo cru não passa
      expect(() => c.evento({ rawBody: Buffer.from('{"object":"page","entry":[] }'), body: {}, headers: { 'x-hub-signature-256': assinado('seg-fb') } })).toThrow(
        'Assinatura inválida.',
      );
      expect(tratados).toHaveLength(1);
    });

    it('sem o segredo configurado, nada entra', () => {
      delete process.env.FACEBOOK_APP_SECRET;
      expect(() => ctrl([]).evento({ rawBody: corpo, body: {}, headers: { 'x-hub-signature-256': assinado('') } })).toThrow('Assinatura inválida.');
    });

    it('o desafio: só com o token certo devolve o challenge cru', () => {
      process.env.FACEBOOK_VERIFY_TOKEN = 'verifica-fb';
      const c = ctrl([]);
      expect(c.verificar('subscribe', 'verifica-fb', '1158201444')).toBe('1158201444');
      expect(() => c.verificar('subscribe', 'errado', '1')).toThrow('Verificação inválida.');
      expect(() => c.verificar('unsubscribe', 'verifica-fb', '1')).toThrow('Verificação inválida.');
      delete process.env.FACEBOOK_VERIFY_TOKEN;
      expect(() => c.verificar('subscribe', '', '1')).toThrow('Verificação inválida.');
    });
  });
});
