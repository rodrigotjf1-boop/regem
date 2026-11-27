import type { DiaEspecialDoHorario } from '../../common/horario-da-data';
import { conferirDiaEspecial, linhaDoAtendente, situacaoDosDiasEspeciais, textoDoAviso } from './dias-especiais';
import { situacaoAgoraParaAsInstrucoes } from './situacao-agora';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os dias especiais (H1, mig 512; protótipo `mockups/regem-dias-especiais.html`, aprovado em 27/11/2026).
const HOJE = '2026-12-20';
const esp = (e: Partial<DiaEspecialDoHorario>): DiaEspecialDoHorario => ({
  data: '2026-12-25', dataFim: null, nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null, conjunto: 'todos', avisoAntes: true, ...e,
});
const em = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-03:00`);

describe('conferir o dia especial (o que a tela manda)', () => {
  it('fechada: o padrão liga o aviso e a pausa; o nome é aparado', () => {
    const r: any = conferirDiaEspecial({ data: '2026-12-25', nome: '  Natal  ', funcionamento: 'fechada' }, HOJE);
    expect(r).toEqual({
      ok: true,
      v: { data: '2026-12-25', dataFim: null, nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null, conjunto: 'todos', avisoAntes: true, pausarCanais: true, feriadoChave: null },
    });
  });

  it('outro horário: exige as duas horas e o aviso nasce desligado (decisão 6); horário normal não avisa nem pausa', () => {
    expect(conferirDiaEspecial({ data: '2026-12-24', nome: 'Véspera', funcionamento: 'horario' }, HOJE)).toEqual({ ok: false, erro: 'Escolha a hora em que abre e a hora em que fecha.' });
    expect(conferirDiaEspecial({ data: '2026-12-24', nome: 'Véspera', funcionamento: 'horario', abre: '18:00', fecha: '18:00' }, HOJE)).toMatchObject({ ok: false });
    const r: any = conferirDiaEspecial({ data: '2026-12-24', nome: 'Véspera', funcionamento: 'horario', abre: '18:00', fecha: '21:00' }, HOJE);
    expect(r.v).toMatchObject({ abre: '18:00', fecha: '21:00', avisoAntes: false, pausarCanais: true });
    const n: any = conferirDiaEspecial({ data: '2026-12-31', nome: 'Réveillon', funcionamento: 'normal', avisoAntes: true }, HOJE);
    expect(n.v).toMatchObject({ funcionamento: 'normal', avisoAntes: false, pausarCanais: false, abre: null });
  });

  it('as recusas: passado, data inválida, "até" antes do dia, período longo, nome vazio ou longo, liga/desliga fora de true/false', () => {
    const base = { nome: 'Natal', funcionamento: 'fechada' };
    expect(conferirDiaEspecial({ ...base, data: '2026-12-19' }, HOJE)).toEqual({ ok: false, erro: 'Escolha hoje ou um dia à frente.' });
    expect(conferirDiaEspecial({ ...base, data: '2026-02-30' }, HOJE)).toEqual({ ok: false, erro: 'Escolha o dia.' });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', dataFim: '2026-12-24' }, HOJE)).toMatchObject({ ok: false });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', dataFim: '2027-03-01' }, HOJE)).toEqual({ ok: false, erro: 'O período pode ter até 60 dias.' });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', nome: '   ' }, HOJE)).toMatchObject({ ok: false });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', nome: 'x'.repeat(41) }, HOJE)).toMatchObject({ ok: false });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', funcionamento: 'aberta' }, HOJE)).toMatchObject({ ok: false });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', avisoAntes: 'sim' }, HOJE)).toMatchObject({ ok: false });
    expect(conferirDiaEspecial({ ...base, data: '2026-12-25', conjunto: 'mesa' }, HOJE)).toMatchObject({ ok: false });
    // o "até" igual ao dia vira um dia só; hoje vale
    expect((conferirDiaEspecial({ ...base, data: HOJE, dataFim: HOJE }, HOJE) as any).v.dataFim).toBeNull();
  });
});

describe('o que o cliente e o atendente leem', () => {
  it('o aviso: o dia, o período e o outro horário (com a madrugada)', () => {
    expect(textoDoAviso(esp({}))).toBe('Sexta, 25/12, estaremos fechados (Natal).');
    expect(textoDoAviso(esp({ data: '2027-01-12', dataFim: '2027-01-14', nome: 'Reforma da cozinha' }))).toBe('De 12/01 a 14/01, estaremos fechados (Reforma da cozinha).');
    expect(textoDoAviso(esp({ data: '2026-12-24', nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00' }))).toBe(
      'Quinta, 24/12, abriremos das 18:00 às 21:00 (Véspera de Natal).',
    );
    expect(textoDoAviso(esp({ funcionamento: 'horario', abre: '20:00', fecha: '02:00' }))).toContain('das 20:00 às 02:00 do dia seguinte');
  });

  it('a situação: hoje, o aviso só nos 3 dias antes (e só com o aviso ligado), e o "horário normal" fora da lista', () => {
    const lista = [
      esp({}),
      esp({ data: '2026-12-24', nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00', avisoAntes: false }),
      esp({ data: '2026-12-31', nome: 'Réveillon', funcionamento: 'normal' }),
    ];
    const s20 = situacaoDosDiasEspeciais(lista, em('2026-12-20', '19:00'));
    expect(s20.hoje).toBeNull();
    expect(s20.aviso).toBeNull(); // 25/12 está a 5 dias; a véspera não avisa
    expect(s20.proximos.map((p) => p.nome)).toEqual(['Natal', 'Véspera de Natal']);
    const s22 = situacaoDosDiasEspeciais(lista, em('2026-12-22', '19:00'));
    expect(s22.aviso).toEqual({ data: '2026-12-25', nome: 'Natal', texto: 'Sexta, 25/12, estaremos fechados (Natal).' });
    const s25 = situacaoDosDiasEspeciais(lista, em('2026-12-25', '19:00'));
    expect(s25.hoje).toEqual({ nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null });
    expect(s25.aviso).toBeNull();
  });

  it('o atendente: a linha de cada dia e, nas instruções, a regra do feriado sem resposta (decisão 3)', () => {
    expect(linhaDoAtendente({ data: '2026-12-25', dataFim: null, nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null, conjunto: 'todos' })).toBe('Sexta, 25/12 (Natal) — fechada');
    expect(linhaDoAtendente({ data: '2026-12-24', dataFim: null, nome: 'Véspera', funcionamento: 'horario', abre: '18:00', fecha: '21:00', conjunto: 'entrega' })).toBe(
      'Quinta, 24/12 (Véspera) — das 18:00 às 21:00 (só a entrega)',
    );
    const menu: any = {
      tipos: { delivery: true },
      abertoPorTipo: { entrega: false },
      proximaAbertura: { entrega: 'sáb 18:00' },
      loja: { pagamentos: ['entrega'] },
      diasEspeciais: situacaoDosDiasEspeciais([esp({})], em('2026-12-25', '19:00')),
    };
    const t = situacaoAgoraParaAsInstrucoes(menu, null, em('2026-12-25', '19:00'));
    expect(t).toContain('- Hoje é dia especial (Natal): a loja não abre hoje.');
    expect(t).toContain('- Dias especiais (nestas datas vale este horário, não o da semana): Sexta, 25/12 (Natal) — fechada.');
    expect(t).toContain('Feriado ou data que não está aqui: vale o horário daquele dia da semana.');
    const sem = situacaoAgoraParaAsInstrucoes({ ...menu, diasEspeciais: undefined }, null, em('2026-12-25', '19:00'));
    expect(sem).toContain('Nenhum dia especial nos próximos 30 dias');
  });
});
