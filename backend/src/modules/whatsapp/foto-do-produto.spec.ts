import { esquecerFotosConferidas, fotoDoProduto, fotoServe, produtoDoLink } from './foto-do-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FOTO NO LINK DO PRODUTO (F5 — decisão do dono, 31/10/2026: "sempre que falar de 1 produto"). A foto é um endereço que
// a loja cadastrou: só vai se for pública, JPEG/PNG e até 5 MB — senão a mensagem vai sem a foto.
const ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LINK = `https://app.dmsregem.com/c/tk-abc?produto=${ID}`;
const FOTO = 'https://storage.googleapis.com/loja/trio-07.jpg';
const resposta = (status: number, h: Record<string, string>) =>
  ({ status, headers: { get: (k: string) => h[k.toLowerCase()] ?? null }, body: { cancel: async () => undefined } }) as any;

describe('foto do produto no link do robô', () => {
  beforeEach(() => esquecerFotosConferidas());

  it('o id do produto sai do link direto; link do cardápio todo ou id estranho, não', () => {
    expect(produtoDoLink(LINK)).toBe(ID);
    expect(produtoDoLink('https://app.dmsregem.com/c/tk-abc')).toBeNull();
    expect(produtoDoLink('https://app.dmsregem.com/c/tk-abc?produto=1%27or%271')).toBeNull();
    expect(produtoDoLink('não é link')).toBeNull();
  });

  it('serve: JPEG/PNG até 5 MB (pelo tamanho total do Content-Range); lembra a conferência', async () => {
    let chamadas = 0;
    const buscar: any = async () => {
      chamadas++;
      return resposta(206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/180000' });
    };
    expect(await fotoServe(FOTO, buscar)).toBe(true);
    expect(await fotoServe(FOTO, buscar)).toBe(true);
    expect(chamadas).toBe(1);
  });

  it('não serve: grande demais, WEBP, fora do ar ou endereço bloqueado (null do guarda) — a mensagem vai sem foto', async () => {
    expect(await fotoServe('https://x/a.jpg', (async () => resposta(206, { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/9000000' })) as any)).toBe(false);
    expect(await fotoServe('https://x/b.webp', (async () => resposta(200, { 'content-type': 'image/webp', 'content-length': '1000' })) as any)).toBe(false);
    expect(await fotoServe('https://x/c.jpg', (async () => resposta(404, {})) as any)).toBe(false);
    expect(await fotoServe('https://x/d.jpg', (async () => null) as any)).toBe(false);
    expect(await fotoServe('https://x/e.jpg', (async () => { throw new Error('timeout'); }) as any)).toBe(false);
  });

  it('a foto do produto da MESMA loja; sem foto https, nada', async () => {
    const db = (imagem: string | null) => ({ select: () => ({ from: () => ({ where: async () => (imagem == null ? [] : [{ imagem }]) }) }) });
    const ok: any = async () => resposta(206, { 'content-type': 'image/png', 'content-range': 'bytes 0-0/50000' });
    expect(await fotoDoProduto(db(FOTO), 't1', LINK, ok)).toBe(FOTO);
    expect(await fotoDoProduto(db(null), 't1', LINK, ok)).toBeNull();
    expect(await fotoDoProduto(db('http://inseguro/x.jpg'), 't1', LINK, ok)).toBeNull();
    expect(await fotoDoProduto(db(FOTO), 't1', 'https://app.dmsregem.com/c/tk-abc', ok)).toBeNull();
  });
});
