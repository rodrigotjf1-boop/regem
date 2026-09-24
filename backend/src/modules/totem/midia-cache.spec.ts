import { ehLocal, extDoMime, nomeCache } from './midia-cache';

// O nome tem que passar na validação da rota que serve mídia local — se não passar,
// o totem recebe 404 em toda foto e o cardápio fica sem imagem.
const ARQUIVO_RE = /^[0-9a-fA-F-]{36}\.(jpg|png|webp|gif)$/;

describe('midia-cache (R5)', () => {
  it('o nome gerado passa na validação da rota pública', () => {
    for (const ext of ['jpg', 'png', 'webp', 'gif'] as const) {
      expect(nomeCache('https://x.supabase.co/a/b.png', ext)).toMatch(ARQUIVO_RE);
    }
  });

  it('mesma URL sempre vira o MESMO arquivo (cache estável entre reinícios)', () => {
    const a = nomeCache('https://x.supabase.co/storage/v1/object/public/midia/p1.png', 'png');
    const b = nomeCache('https://x.supabase.co/storage/v1/object/public/midia/p1.png', 'png');
    expect(a).toBe(b);
  });

  it('URLs diferentes não colidem', () => {
    const a = nomeCache('https://x/p1.png', 'png');
    const b = nomeCache('https://x/p2.png', 'png');
    expect(a).not.toBe(b);
  });

  it('extensão vem do mime REAL (magic bytes), não da URL', () => {
    expect(extDoMime('image/jpeg')).toBe('jpg');
    expect(extDoMime('image/png')).toBe('png');
    expect(extDoMime('image/webp')).toBe('webp');
    expect(extDoMime('image/gif')).toBe('gif');
    expect(extDoMime('application/pdf')).toBeNull();
    expect(extDoMime(null)).toBeNull();
  });

  it('reconhece o que já é servido daqui (não rebaixa nem rebaixaria de novo)', () => {
    expect(ehLocal('http://192.168.0.9:3002/api/v1/publico/midia/t/a.png')).toBe(true);
    expect(ehLocal('https://x.supabase.co/storage/v1/object/public/midia/p.png')).toBe(false);
  });
});
