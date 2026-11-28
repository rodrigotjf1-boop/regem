import { acessoAindaVale } from './mister-link-publico.service';
import { MisterNumeroService } from './mister-numero.service';
import { tipoPelosBytes } from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O número do Mister com a Meta montada: os metadados apontam para a CDN; o arquivo é a resposta que o teste der. */
class NumeroDeTeste extends MisterNumeroService {
  inits: any[] = [];
  constructor(private readonly arquivo: (init: any) => Response) {
    super({} as any);
    this.prazoDoArquivoMs = 80;
  }
  protected async buscar(url: string, init?: any): Promise<any> {
    this.inits.push(init);
    if (url.includes('graph.facebook.com'))
      return { ok: true, status: 200, json: async () => ({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg' }), text: async () => '' };
    return this.arquivo(init);
  }
}

// Rodada 7 de segurança, bloco F (ERR-658): documentos, fotos e arquivos — as regras puras. O caminho com o Postgres (a tela dos
// documentos pela loja de agora, o link que deixa de abrir) está em `mister-pg.teste-spec.ts`.

describe('Rodada 7, bloco F (ERR-658)', () => {
  const centro = { id: 'centro' };
  const praia = { id: 'praia' };
  const presidente = { lojas: [centro, praia], lojaUnica: false, presa: null, semLoja: false, verValores: true };
  const resumo = (unidadeId: string | null, semValores = false) => ({ unidadeId, tipo: 'resumo', plano: { semValores } });

  it('MIS-F-10: o link abre só se quem emitiu ainda vê o que ele mostra', () => {
    expect(acessoAindaVale(presidente, resumo(null))).toBe(true);
    expect(acessoAindaVale(presidente, resumo('praia'))).toBe(true);
    // não fala mais com o Mister / sem loja
    expect(acessoAindaVale(null, resumo(null))).toBe(false);
    expect(acessoAindaVale({ ...presidente, lojas: [], semLoja: true }, resumo(null))).toBe(false);
    // presa a outra loja: nem a do link, nem "todas"
    const presaNoCentro = { ...presidente, lojas: [centro], presa: 'centro' };
    expect(acessoAindaVale(presaNoCentro, resumo('praia'))).toBe(false);
    expect(acessoAindaVale(presaNoCentro, resumo(null))).toBe(false);
    expect(acessoAindaVale(presaNoCentro, resumo('centro'))).toBe(true);
    // a loja do link foi apagada (não está mais entre as lojas vivas)
    expect(acessoAindaVale({ ...presidente, lojas: [centro] }, resumo('praia'))).toBe(false);
    // perdeu os valores: o resumo com R$ não abre; o que saiu sem valores, abre
    const semValores = { ...presidente, verValores: false };
    expect(acessoAindaVale(semValores, resumo(null, false))).toBe(false);
    expect(acessoAindaVale(semValores, resumo(null, true))).toBe(true);
    expect(acessoAindaVale(semValores, { unidadeId: null, tipo: 'insumo', plano: {} })).toBe(false);
    // empresa de uma loja só: sem filtro de loja
    const unica = { lojas: [centro], lojaUnica: true, presa: null, semLoja: false, verValores: true };
    expect(acessoAindaVale(unica, resumo('centro'))).toBe(true);
    expect(acessoAindaVale(unica, resumo(null))).toBe(true);
  });

  it('MIS-F-04: o tipo que vai à IA sai dos bytes (o PNG declarado como JPEG vai como PNG); o desconhecido segue o declarado', () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
    expect(tipoPelosBytes(png, 'image/jpeg')).toBe('image/png');
    expect(tipoPelosBytes(jpeg, 'application/pdf')).toBe('image/jpeg');
    expect(tipoPelosBytes(webp, 'image/jpeg')).toBe('image/webp');
    expect(tipoPelosBytes(Buffer.from('%PDF-1.7\n...'), 'image/jpeg')).toBe('application/pdf');
    expect(tipoPelosBytes(Buffer.from('qualquer coisa'), 'image/jpeg')).toBe('image/jpeg');
  });

  describe('MIS-F-03: o download da mídia tem prazo e confere o tamanho antes de juntar tudo', () => {
    const antes = process.env.WA_CLOUD_TOKEN;
    beforeAll(() => (process.env.WA_CLOUD_TOKEN = 'token-de-teste'));
    afterAll(() => (antes === undefined ? delete process.env.WA_CLOUD_TOKEN : (process.env.WA_CLOUD_TOKEN = antes)));
    const MB = 1024 * 1024;

    it('o arquivo pequeno chega; as duas chamadas levam o prazo', async () => {
      const n = new NumeroDeTeste(() => new Response(Buffer.from('foto')));
      expect(await n.baixarMidia('123456')).toEqual({ buffer: Buffer.from('foto'), mime: 'image/jpeg' });
      expect(n.inits.map((i) => i?.signal instanceof AbortSignal)).toEqual([true, true]);
    });

    it('o tamanho declarado acima do teto: nem lê', async () => {
      const n = new NumeroDeTeste(() => new Response(Buffer.from('x'), { headers: { 'content-length': String(30 * MB) } }));
      expect(await n.baixarMidia('123456')).toBeNull();
    });

    it('sem o tamanho declarado, o corpo que passa do teto é cortado na leitura', async () => {
      const pedaco = new Uint8Array(MB);
      let mandados = 0;
      const n = new NumeroDeTeste(
        () =>
          new Response(
            new ReadableStream({
              pull(c) {
                mandados++;
                c.enqueue(pedaco);
              },
            }),
          ),
      );
      expect(await n.baixarMidia('123456')).toBeNull();
      expect(mandados).toBeLessThan(30);
    });

    it('o corpo que não termina: o prazo corta', async () => {
      const n = new NumeroDeTeste(
        (init) =>
          new Response(
            new ReadableStream({
              start(c) {
                init.signal.addEventListener('abort', () => c.error(init.signal.reason));
              },
            }),
          ),
      );
      const inicio = Date.now();
      expect(await n.baixarMidia('123456')).toBeNull();
      expect(Date.now() - inicio).toBeLessThan(2000);
    });
  });
});
