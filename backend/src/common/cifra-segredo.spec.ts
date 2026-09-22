import { randomBytes } from 'node:crypto';
import {
  ChaveSegredosAusente,
  chaveSegredosDisponivel,
  cifrar,
  decifrar,
  decifrarBytes,
} from './cifra-segredo';

// A cifra dos segredos fiscais (certificado A1, senha, CSC). O que precisa ser verdade:
// ida e volta funciona, o texto guardado não revela o segredo, dado alterado é RECUSADO
// (e não devolvido como lixo), chave de outra máquina não abre, e sem chave nada acontece.

describe('cifra de segredos', () => {
  const original = process.env.SEGREDOS_CHAVE;
  const chaveA = randomBytes(32).toString('base64');
  const chaveB = randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env.SEGREDOS_CHAVE = chaveA;
  });
  afterAll(() => {
    if (original === undefined) delete process.env.SEGREDOS_CHAVE;
    else process.env.SEGREDOS_CHAVE = original;
  });

  it('ida e volta com texto e com bytes', () => {
    expect(decifrar(cifrar('senha-do-certificado'))).toBe('senha-do-certificado');
    const pfx = randomBytes(9478); // o tamanho do .pfx real
    expect(decifrarBytes(cifrar(pfx)).equals(pfx)).toBe(true);
  });

  it('o valor guardado NÃO contém o segredo e muda a cada vez (IV aleatório)', () => {
    const csc = 'AAAABBBB-CCCC-DDDD-EEEE-FFFF00001111';
    const a = cifrar(csc);
    const b = cifrar(csc);
    expect(a).not.toContain(csc);
    expect(Buffer.from(a.slice(3), 'base64').toString('latin1')).not.toContain(csc);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('um byte alterado no banco faz a leitura FALHAR (GCM autentica)', () => {
    const c = cifrar('segredo');
    const buf = Buffer.from(c.slice(3), 'base64');
    buf[buf.length - 1] ^= 0x01;
    expect(() => decifrar(`v1:${buf.toString('base64')}`)).toThrow(/não foi possível abrir/i);
  });

  it('valor cifrado com a chave de OUTRA máquina não abre', () => {
    const daNuvem = cifrar('certificado da loja');
    process.env.SEGREDOS_CHAVE = chaveB; // outra máquina
    expect(() => decifrar(daNuvem)).toThrow(/chave diferente/i);
  });

  it('sem chave, nada é cifrado nem lido — e a tela consegue saber antes', () => {
    const c = cifrar('x');
    delete process.env.SEGREDOS_CHAVE;
    expect(chaveSegredosDisponivel()).toBe(false);
    expect(() => cifrar('x')).toThrow(ChaveSegredosAusente);
    expect(() => decifrar(c)).toThrow(ChaveSegredosAusente);
  });

  it('chave de tamanho errado é recusada com instrução de como gerar', () => {
    process.env.SEGREDOS_CHAVE = Buffer.from('curta').toString('base64');
    expect(chaveSegredosDisponivel()).toBe(false);
    expect(() => cifrar('x')).toThrow(/32 bytes/);
  });

  it('a mensagem de erro nunca carrega o segredo', () => {
    process.env.SEGREDOS_CHAVE = chaveA;
    const c = cifrar('SEGREDO-QUE-NAO-PODE-VAZAR');
    process.env.SEGREDOS_CHAVE = chaveB;
    try {
      decifrar(c);
      throw new Error('deveria ter falhado');
    } catch (e: any) {
      expect(String(e.message)).not.toContain('SEGREDO-QUE-NAO-PODE-VAZAR');
      expect(String(e.message)).not.toContain(chaveA);
      expect(String(e.message)).not.toContain(chaveB);
    }
  });

  it('formato desconhecido é recusado', () => {
    expect(() => decifrar('texto-puro-antigo')).toThrow(/formato desconhecido/);
  });
});
