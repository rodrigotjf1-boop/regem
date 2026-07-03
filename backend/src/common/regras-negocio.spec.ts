import {
  custoMedioPonderado,
  saldoLedger,
  proximaData,
  resolverColaboradorTarefa,
  comRetryUnico,
  escopoPermiteSetor,
  qtdBaixaExplosao,
  minutosNaFaixaNoturna,
  fatorHoraExtra,
} from './regras-negocio';

// helper: monta um timestamp UTC a partir da hora LOCAL do Brasil (UTC−3).
function brLocal(dataISO: string, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Date.parse(`${dataISO}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
}

describe('custoMedioPonderado (CMP no recebimento)', () => {
  it('estoque zerado assume o custo da entrada', () => {
    expect(custoMedioPonderado(0, 0, 10, 5)).toBe(5);
  });
  it('saldo existente pondera custo antigo e novo', () => {
    // 10 un a R$4 + 10 un a R$6 → R$5
    expect(custoMedioPonderado(10, 4, 10, 6)).toBe(5);
    // 30 a R$2 + 10 a R$6 → (60+60)/40 = 3
    expect(custoMedioPonderado(30, 2, 10, 6)).toBe(3);
  });
  it('item sem custo informado não altera o custo médio', () => {
    expect(custoMedioPonderado(10, 4, 5, null)).toBe(4);
  });
  it('saldo negativo é tratado como base 0', () => {
    expect(custoMedioPonderado(-5, 9, 10, 7)).toBe(7);
  });
  // logica-negocio §7 caso 1: sequência de 3 entradas bate com o cálculo manual.
  it('sequência de 3 entradas confere', () => {
    let cm = 0;
    let saldo = 0;
    cm = custoMedioPonderado(saldo, cm, 10, 2); saldo += 10; // → 2
    cm = custoMedioPonderado(saldo, cm, 10, 4); saldo += 10; // → 3
    cm = custoMedioPonderado(saldo, cm, 20, 6); saldo += 20; // → 4,5
    expect(cm).toBeCloseTo(4.5, 6);
  });
});

// §7 caso 2 — explosão de ficha (a não-duplicação por refId é garantida pelo
// índice único no banco; ficha cíclica é N/A sem fichas aninhadas no schema).
describe('qtdBaixaExplosao (explosão de ficha)', () => {
  it('baixa qtd_liquida × fc × qtdProduzida ÷ rendimento', () => {
    expect(qtdBaixaExplosao(4.5, 1.15, 2, 10)).toBeCloseTo((4.5 * 1.15 * 2) / 10, 9);
  });
  it('produzir a ficha inteira (qtd=rendimento) consome a receita cheia', () => {
    expect(qtdBaixaExplosao(3, 1, 10, 10)).toBe(3);
  });
  it('rendimento inválido não divide por zero', () => {
    expect(qtdBaixaExplosao(2, 1, 1, 0)).toBe(2);
  });
});

// §7 caso 8 — estorno neutraliza saldo (e, por consequência, o CMV do período).
describe('minutosNaFaixaNoturna (jornada §3, hora local BR 22h–5h)', () => {
  it('turno 18h→23h tem 60 min noturnos (22h–23h)', () => {
    expect(
      minutosNaFaixaNoturna(brLocal('2026-07-01', '18:00'), brLocal('2026-07-01', '23:00')),
    ).toBe(60);
  });
  it('turno diurno 08h→17h não tem noturno', () => {
    expect(
      minutosNaFaixaNoturna(brLocal('2026-07-01', '08:00'), brLocal('2026-07-01', '17:00')),
    ).toBe(0);
  });
  it('vira a madrugada 21h→06h = 7h noturnas (22h→05h)', () => {
    expect(
      minutosNaFaixaNoturna(brLocal('2026-07-01', '21:00'), brLocal('2026-07-02', '06:00')),
    ).toBe(7 * 60);
  });
});

describe('fatorHoraExtra (50% dia útil, 100% domingo/feriado)', () => {
  it('dia útil → 0.5', () => expect(fatorHoraExtra(false)).toBe(0.5));
  it('domingo/feriado → 1.0', () => expect(fatorHoraExtra(true)).toBe(1.0));
});

describe('estorno neutraliza o efeito líquido', () => {
  it('saída + entrada inversa de mesma qtd → saldo zero', () => {
    expect(
      saldoLedger([
        { tipo: 'saida', quantidade: 7 },
        { tipo: 'entrada', quantidade: 7 },
      ]),
    ).toBe(0);
  });
});

describe('saldoLedger (saldo derivado do ledger)', () => {
  it('soma entrada, subtrai saída, aplica ajuste sinalizado', () => {
    expect(
      saldoLedger([
        { tipo: 'entrada', quantidade: 10 },
        { tipo: 'saida', quantidade: 3 },
        { tipo: 'ajuste', quantidade: -2 },
        { tipo: 'entrada', quantidade: '5' },
      ]),
    ).toBe(10); // 10 -3 -2 +5
  });
  it('sem movimentos é zero', () => {
    expect(saldoLedger([])).toBe(0);
  });
});

describe('proximaData (recorrência de títulos)', () => {
  it('semanal soma 7 dias', () => {
    expect(proximaData('2026-07-03', 'semanal')).toBe('2026-07-10');
  });
  it('quinzenal soma 15 dias', () => {
    expect(proximaData('2026-07-03', 'quinzenal')).toBe('2026-07-18');
  });
  it('mensal soma 1 mês', () => {
    expect(proximaData('2026-07-03', 'mensal')).toBe('2026-08-03');
  });
  it('nenhuma ou sem base retorna null', () => {
    expect(proximaData('2026-07-03', 'nenhuma')).toBeNull();
    expect(proximaData(null, 'mensal')).toBeNull();
  });
});

describe('resolverColaboradorTarefa (late-binding tarefa→escala)', () => {
  it('override explícito vence a alocação', () => {
    expect(resolverColaboradorTarefa('c_override', 'c_escala')).toBe('c_override');
  });
  it('sem override usa quem está na escala', () => {
    expect(resolverColaboradorTarefa(null, 'c_escala')).toBe('c_escala');
  });
  it('sem override e sem alocação resolve para ninguém', () => {
    expect(resolverColaboradorTarefa(null, null)).toBeNull();
    expect(resolverColaboradorTarefa(undefined, undefined)).toBeNull();
  });
});

describe('escopoPermiteSetor (RBAC por setor)', () => {
  it('supervisor NÃO lê dados de outro setor', () => {
    expect(escopoPermiteSetor('supervisao', 'setor_A', 'setor_B')).toBe(false);
  });
  it('supervisor lê dados do próprio setor', () => {
    expect(escopoPermiteSetor('supervisao', 'setor_A', 'setor_A')).toBe(true);
  });
  it('supervisor sem setor definido não acessa recurso de setor', () => {
    expect(escopoPermiteSetor('supervisao', null, 'setor_A')).toBe(false);
  });
  it('gerente e presidente não têm restrição de setor', () => {
    expect(escopoPermiteSetor('gerente', null, 'setor_B')).toBe(true);
    expect(escopoPermiteSetor('presidente', 'setor_A', 'setor_B')).toBe(true);
  });
});

describe('comRetryUnico (retry do NSR na colisão de unique)', () => {
  it('repete na violação 23505 e depois conclui', async () => {
    let n = 0;
    const r = await comRetryUnico(async () => {
      n++;
      if (n < 3) throw { code: '23505' };
      return `ok-tentativa-${n}`;
    });
    expect(r).toBe('ok-tentativa-3');
    expect(n).toBe(3);
  });
  it('propaga erro que não é 23505', async () => {
    await expect(
      comRetryUnico(async () => {
        throw { code: '23502' };
      }),
    ).rejects.toMatchObject({ code: '23502' });
  });
  it('estoura as tentativas e propaga a última 23505', async () => {
    let n = 0;
    await expect(
      comRetryUnico(async () => {
        n++;
        throw { code: '23505' };
      }, 3),
    ).rejects.toMatchObject({ code: '23505' });
    expect(n).toBe(3);
  });
});
