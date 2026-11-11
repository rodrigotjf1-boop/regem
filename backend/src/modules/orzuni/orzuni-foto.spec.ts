import {
  LIMITE_FOTO_IFOOD,
  chaveDaFoto,
  dataUriDaFoto,
  ehQuadrada,
  medidaDaImagem,
  problemaDaFoto,
} from './orzuni-foto.regras';

// "MANDAR ESTA FOTO AO iFOOD" (R3 F6b): as regras da foto (medida pelos bytes, 8 MB, quadrada, 300 px, data-URI, chave)
// sem banco. O serviço inteiro (a permissão da ligação, o produto, a foto, a chamada `item_foto_definir` e cada recusa)
// está em `orzuni-envio.spec.ts`, que já monta o banco do Orzuni — uma spec a mais aplicando as mesmas migrations em
// paralelo disputava trava com as outras no CI.

/** Um PNG só com o cabeçalho (o que a medida lê) e um pouco de corpo. */
function png(largura: number, altura: number, corpo = 64): Buffer {
  const b = Buffer.alloc(33 + corpo);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(largura, 16);
  b.writeUInt32BE(altura, 20);
  return b;
}
/** Um JPEG mínimo: SOI, um APP0 e o SOF0 com a medida. */
function jpeg(largura: number, altura: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(altura, 5);
  sof.writeUInt16BE(largura, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

describe('as regras da foto ao iFood (sem banco)', () => {
  it('a medida sai dos bytes: PNG e JPEG; outra coisa (ou cortada) = null', () => {
    expect(medidaDaImagem(png(400, 400))).toEqual({ tipo: 'png', largura: 400, altura: 400 });
    expect(medidaDaImagem(jpeg(640, 600))).toEqual({ tipo: 'jpeg', largura: 640, altura: 600 });
    expect(medidaDaImagem(Buffer.from('GIF89a……'))).toBeNull();
    expect(medidaDaImagem(png(400, 400).subarray(0, 20))).toBeNull();
    expect(medidaDaImagem(jpeg(640, 600).subarray(0, 12))).toBeNull();
  });
  it('serve: até 8 MB, JPG/PNG, quadrada (folga de 2%), 300 px de lado ou mais — cada recusa com a frase', () => {
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 800 }, 1000)).toBeNull();
    expect(problemaDaFoto({ tipo: 'jpeg', largura: 800, altura: 815 }, 1000)).toBeNull();
    expect(ehQuadrada(800, 830)).toBe(false);
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 600 }, 1000)).toMatch(/800 × 600 px e o iFood pede foto quadrada/);
    expect(problemaDaFoto({ tipo: 'png', largura: 200, altura: 200 }, 1000)).toMatch(/pede 300 px de lado ou mais/);
    expect(problemaDaFoto(null, 1000)).toMatch(/não é JPG nem PNG/);
    expect(problemaDaFoto({ tipo: 'png', largura: 800, altura: 800 }, LIMITE_FOTO_IFOOD + 1)).toMatch(/8,0 MB e o iFood aceita até 8 MB/);
  });
  it('o data-URI e a chave: a mesma foto dá a mesma chave (8–100 caracteres); outra foto, outra chave', () => {
    const a = png(400, 400);
    expect(dataUriDaFoto({ tipo: 'png', largura: 400, altura: 400 }, a)).toBe(`data:image/png;base64,${a.toString('base64')}`);
    const k = chaveDaFoto('p1', a);
    expect(k).toBe(chaveDaFoto('p1', Buffer.from(a)));
    expect(k).not.toBe(chaveDaFoto('p1', png(401, 401)));
    expect(k).not.toBe(chaveDaFoto('p2', a));
    expect(k.length).toBeGreaterThanOrEqual(8);
    expect(k.length).toBeLessThanOrEqual(100);
  });
});
