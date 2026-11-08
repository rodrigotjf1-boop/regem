import { createHmac } from 'node:crypto';
import {
  assinarEstado,
  assinaturaDoAvisoOk,
  ESCOPOS,
  ESTADO_VALE_MS,
  frase,
  janela,
  JANELA_MS,
  lerAviso,
  lerEstado,
  nomeDoCliente,
  textoDaResposta,
  urlDeAutorizacao,
} from './instagram';

/* eslint-disable @typescript-eslint/no-explicit-any */

// INSTAGRAM DIRECT — a regra pura (mig 377; protótipo versão 7), pela documentação da Meta conferida em 06/11/2026.
const SEG = 'segredo-do-app';
const CONTA = '17841400000000001';
const CLIENTE = '9988776655';

describe('o login do Instagram', () => {
  it('o endereço leva o app, o retorno, as três permissões (F6: + a dos comentários), o state e a conta profissional', () => {
    const u = new URL(urlDeAutorizacao({ appId: '990602627938098', redirect: 'https://api.exemplo/retorno', estado: 'abc.def' }));
    expect(`${u.origin}${u.pathname}`).toBe('https://www.instagram.com/oauth/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '990602627938098',
      redirect_uri: 'https://api.exemplo/retorno',
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments',
      state: 'abc.def',
      force_reauth: 'true',
    });
    expect(ESCOPOS).toEqual(['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments']);
  });

  it('o state: volta quem pediu; adulterado, de outro segredo ou vencido não vale', () => {
    const agora = Date.now();
    const s = assinarEstado('T1', 'C1', SEG, agora);
    expect(lerEstado(s, SEG, agora)).toMatchObject({ t: 'T1', c: 'C1' });
    const [corpo, ass] = s.split('.');
    const outroCorpo = Buffer.from(JSON.stringify({ t: 'T2', c: 'C1', e: agora + 60_000, n: 'x' })).toString('base64url');
    expect(lerEstado(`${outroCorpo}.${ass}`, SEG, agora)).toBeNull();
    expect(lerEstado(`${corpo}.${ass}x`, SEG, agora)).toBeNull();
    expect(lerEstado(s, 'outro-segredo', agora)).toBeNull();
    expect(lerEstado(s, SEG, agora + ESTADO_VALE_MS + 1)).toBeNull();
    expect(lerEstado(`${s}.mais`, SEG, agora)).toBeNull();
    expect(lerEstado(undefined, SEG, agora)).toBeNull();
    expect(lerEstado(s, '', agora)).toBeNull();
  });
});

describe('o aviso de mensagem', () => {
  it('a assinatura confere sobre o corpo cru, com o segredo; qualquer diferença recusa', () => {
    const corpo = Buffer.from('{"object":"instagram"}');
    const ok = `sha256=${createHmac('sha256', SEG).update(corpo).digest('hex')}`;
    expect(assinaturaDoAvisoOk(corpo, ok, SEG)).toBe(true);
    expect(assinaturaDoAvisoOk(Buffer.from('{"object":"instagram" }'), ok, SEG)).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, ok, 'outro')).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, ok.replace('sha256=', ''), SEG)).toBe(false);
    expect(assinaturaDoAvisoOk(undefined, ok, SEG)).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, ok, '')).toBe(false);
  });

  const aviso = (...messaging: any[]) => ({ object: 'instagram', entry: [{ id: CONTA, time: 1, messaging }] });
  it('texto do cliente: a conta, o cliente, o id e a hora', () => {
    const [e] = lerAviso(aviso({ sender: { id: CLIENTE }, recipient: { id: CONTA }, timestamp: 1762470000000, message: { mid: 'm1', text: 'Vocês entregam no Centro?' } }));
    expect(e).toEqual({ conta: CONTA, igsid: CLIENTE, mid: 'm1', eco: false, apagada: false, tipo: 'texto', texto: 'Vocês entregam no Centro?', midiaUrl: null, em: new Date(1762470000000) });
  });
  it('o eco (a loja mandou): o cliente é o destinatário', () => {
    const [e] = lerAviso(aviso({ sender: { id: CONTA }, recipient: { id: CLIENTE }, timestamp: 1, message: { mid: 'm2', text: 'Oi!', is_echo: true } }));
    expect(e).toMatchObject({ igsid: CLIENTE, eco: true, mid: 'm2' });
  });
  it('anexos viram o tipo (foto, áudio, story, reel…); o endereço só se for https', () => {
    const tipos = lerAviso(
      aviso(
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'a', attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }] } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'b', attachments: [{ type: 'audio', payload: { url: 'http://inseguro' } }] } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'c', attachments: [{ type: 'story_mention', payload: {} }] } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'd', attachments: [{ type: 'ig_reel', payload: {} }] } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'e', attachments: [{ type: 'algo_novo', payload: {} }] } },
      ),
    );
    expect(tipos.map((t) => [t.tipo, t.midiaUrl])).toEqual([
      ['imagem', 'https://cdn/x.jpg'],
      ['audio', null],
      ['story', null],
      ['reel', null],
      ['outro', null],
    ]);
    expect(frase(tipos[0])).toBe('[foto]');
  });
  it('apagada marca; o que não é mensagem (lida, reação) e o que não é do Instagram ficam de fora', () => {
    const l = lerAviso(
      aviso(
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, message: { mid: 'm9', is_deleted: true } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, read: { mid: 'm1' } },
        { sender: { id: CLIENTE }, recipient: { id: CONTA }, reaction: { mid: 'm1', action: 'react' } },
        { sender: { id: CONTA }, recipient: { id: CONTA }, message: { mid: 'self', text: 'eu' } },
      ),
    );
    expect(l.map((e) => [e.mid, e.apagada])).toEqual([['m9', true]]);
    expect(lerAviso({ object: 'page', entry: [] })).toEqual([]);
    expect(lerAviso(null)).toEqual([]);
  });
  it('várias contas e várias mensagens no mesmo aviso: cada uma sozinha', () => {
    const l = lerAviso({
      object: 'instagram',
      entry: [
        { id: CONTA, messaging: [{ sender: { id: 'c1' }, recipient: { id: CONTA }, message: { mid: 'x1', text: 'a' } }] },
        { id: 'OUTRA', messaging: [{ sender: { id: 'c2' }, recipient: { id: 'OUTRA' }, message: { mid: 'x2', text: 'b' } }] },
      ],
    });
    expect(l.map((e) => [e.conta, e.igsid])).toEqual([
      [CONTA, 'c1'],
      ['OUTRA', 'c2'],
    ]);
  });
});

describe('responder', () => {
  it('a janela: 24 h depois da última mensagem do cliente; sem mensagem dele, fechada', () => {
    const t = Date.parse('2026-11-06T20:13:00Z');
    expect(janela(new Date(t), t + JANELA_MS - 1)).toEqual({ aberta: true, ate: new Date(t + JANELA_MS).toISOString() });
    expect(janela(new Date(t), t + JANELA_MS).aberta).toBe(false);
    expect(janela(null)).toEqual({ aberta: false, ate: null });
  });
  it('o texto: não vazio e até 1.000 bytes em UTF-8 (acento conta 2)', () => {
    expect(textoDaResposta('  Oi!  ')).toEqual({ ok: true, texto: 'Oi!' });
    expect(textoDaResposta('   ').ok).toBe(false);
    expect(textoDaResposta(3).ok).toBe(false);
    expect(textoDaResposta('a'.repeat(1000)).ok).toBe(true);
    expect(textoDaResposta('ã'.repeat(501)).ok).toBe(false);
    expect(textoDaResposta('ã'.repeat(500)).ok).toBe(true);
  });
  it('o nome do cliente: o do perfil, senão o @, senão "Cliente do Instagram"', () => {
    expect(nomeDoCliente({ nome: 'Joana Souza', usuario: 'joana.souza' })).toBe('Joana Souza');
    expect(nomeDoCliente({ nome: ' ', usuario: '@joana.souza' })).toBe('@joana.souza');
    expect(nomeDoCliente(null)).toBe('Cliente do Instagram');
  });
});
