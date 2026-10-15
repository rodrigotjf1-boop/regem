import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ESTADO DA IMPRESSORA PELA REDE (edge/impressora-estado.mjs, fase 1 da central de impressão).
// Antes, "impresso" era "os bytes chegaram": bobina que acabava no meio passava como impressa, e os
// cupons seguintes iam para uma impressora sem papel. Agora a impressora é consultada (DLE EOT)
// antes e depois de cada cupom. Os cenários rodam em Node puro contra uma impressora FALSA que
// responde como uma térmica ESC/POS (impressora-estado.cenarios.mjs) — o módulo é ESM e este jest
// é CommonJS.

jest.setTimeout(60_000);

describe('estado da impressora de rede (DLE EOT)', () => {
  let r: any;
  beforeAll(() => {
    const p = spawnSync(process.execPath, [join(__dirname, 'impressora-estado.cenarios.mjs')], {
      encoding: 'utf8',
      timeout: 50_000,
    });
    if (p.status !== 0) throw new Error(`cenários falharam: ${p.stderr || p.error}`);
    r = JSON.parse(p.stdout.trim().split('\n').pop()!);
  });

  it('pronta: imprime tudo e confirma que continuou pronta', () => {
    expect(r.pronta).toMatchObject({ saiu: true, informa: true, estado: 'pronta' });
    expect(r.pronta.impressos).toBeGreaterThan(500);
  });

  it('sem papel ANTES: não manda nada (o cupom espera, não se perde)', () => {
    expect(r.semPapelAntes).toMatchObject({ saiu: false, motivo: 'nao_pronta', estado: 'sem_papel' });
    expect(r.semPapelAntes.impressos).toBe(0);
  });

  it('tampa aberta e erro de guilhotina ANTES: não manda nada, com o motivo', () => {
    expect(r.tampaAntes).toMatchObject({ saiu: false, motivo: 'nao_pronta', estado: 'tampa_aberta' });
    expect(r.corteAntes).toMatchObject({ saiu: false, motivo: 'nao_pronta', estado: 'erro' });
    expect(r.corteAntes.detalhe).toMatch(/guilhotina|papel preso/);
    expect(r.tampaAntes.impressos + r.corteAntes.impressos).toBe(0);
  });

  it('o papel acaba NO MEIO do cupom: interrompido (volta inteiro, marcado)', () => {
    expect(r.acabaNoMeio).toMatchObject({ saiu: false, motivo: 'interrompido', estado: 'sem_papel' });
  });

  it('papel acabando: imprime (é aviso, não parada) e informa', () => {
    expect(r.papelAcabando).toMatchObject({ saiu: true, informa: true, estado: 'papel_acabando' });
  });

  it('impressora que não informa estado: imprime como sempre', () => {
    expect(r.naoInforma).toMatchObject({ saiu: true, informa: false });
    expect(r.naoInforma.impressos).toBeGreaterThan(500);
  });

  it('desligada (não aceita conexão): rejeita — a fila trata como "não recebeu"', () => {
    expect(r.desligada.rejeitou).toBeTruthy();
  });

  it('bytes que não são resposta de estado são ignorados; o tempo de conferência tem piso e teto', () => {
    expect(r.puras).toEqual({ byteValido: true, byteInvalido: false, lixoIgnorado: 'pronta', tempoMin: 800, tempoMax: 4000 });
  });
});
