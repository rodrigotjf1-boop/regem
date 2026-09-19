import { generateKeyPairSync, sign } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { DistribuicaoService } from './distribuicao.service';
import { mensagemV1, mensagemV2 } from '../../common/update-assinatura';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O console só publica release que as lojas vão ACEITAR (ERR-046): as duas assinaturas são
// obrigatórias e conferidas com a chave pública antes do insert. Antes a assinatura era
// opcional e sem conferência (a nuvem tinha 1.14.0 e 1.18.0 publicadas sem assinatura).
describe('publicar release no console da distribuição', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const antes = process.env.EDGE_UPDATE_PUBLIC_KEY;
  beforeAll(() => {
    process.env.EDGE_UPDATE_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.EDGE_UPDATE_PUBLIC_KEY;
    else process.env.EDGE_UPDATE_PUBLIC_KEY = antes;
  });

  const v = '1.30.0';
  const sha = 'd'.repeat(64);
  const url = 'https://storage/regem-edge-1.30.0.zip';
  const exp = new Date(Date.now() + 30 * 86400000).toISOString();
  const s1 = sign(null, Buffer.from(mensagemV1(v, sha, url)), privateKey).toString('base64');
  const s2 = sign(null, Buffer.from(mensagemV2(v, sha, url, exp)), privateKey).toString('base64');
  const valido = { versao: v, url, sha256: sha, assinatura: s1, assinaturaV2: s2, expiraEm: exp };

  const montar = () => {
    const execute = jest.fn(async (_q: any) => ({ rows: [{ n: 1 }] }));
    const svc = new DistribuicaoService({ execute } as any, {} as any, { registrar: async () => {} } as any);
    (svc as any).auditar = jest.fn(async () => {});
    return { svc, execute };
  };

  it('aceita release com as duas assinaturas válidas (100% por padrão)', async () => {
    const { svc, execute } = montar();
    await expect(svc.publicarRelease(valido, { nome: 'Dir' })).resolves.toMatchObject({ ok: true, percentual: 100 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sem assinatura v1', { assinatura: '' }],
    ['sem assinatura v2', { assinaturaV2: '' }],
    ['sem validade', { expiraEm: '' }],
    ['validade vencida', { expiraEm: new Date(Date.now() - 1000).toISOString() }],
    ['v1 de outra versão', { assinatura: sign(null, Buffer.from(mensagemV1('1.30.1', sha, url)), privateKey).toString('base64') }],
    ['v2 com validade diferente da assinada', { expiraEm: new Date(Date.now() + 60 * 86400000).toISOString() }],
    ['URL http', { url: 'http://storage/regem-edge-1.30.0.zip' }],
    ['versão fora do formato', { versao: '1.30' }],
    ['percentual acima de 100', { percentual: 101 }],
    ['loja piloto que não é uuid', { lojasPiloto: ['abc'] }],
  ])('recusa: %s (nada é gravado)', async (_nome, troca) => {
    const { svc, execute } = montar();
    await expect(svc.publicarRelease({ ...valido, ...troca }, { nome: 'Dir' })).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('ajustar: campo ausente mantém; liga/desliga exige true/false', async () => {
    const execute = jest.fn(async (q: any) => {
      const texto = JSON.stringify(q);
      if (texto.includes('select versao, percentual')) {
        return { rows: [{ versao: v, percentual: 25, lojasPiloto: [], pausado: false, recolhido: false }] };
      }
      return { rows: [] };
    });
    const svc = new DistribuicaoService({ execute } as any, {} as any, { registrar: async () => {} } as any);
    (svc as any).auditar = jest.fn(async () => {});
    const id = '0f8c8f3a-3b52-4f0e-9f64-2a0a7a1c9e11';
    await expect(svc.ajustarRelease(id, { pausado: true }, {})).resolves.toMatchObject({ percentual: 25, pausado: true, recolhido: false });
    await expect(svc.ajustarRelease(id, { recolhido: 'sim' }, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
