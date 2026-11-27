import {
  DIAS_DO_AVISO_DO_FERIADO,
  TEXTOS_DO_FERIADO,
  botoesDoFeriado,
  diaDoAvisoDoFeriado,
  lerBotaoDoFeriado,
  situacaoDoFeriadoChegando,
  textoDoAviso,
} from './mister-avisos.regras';
import { deveEscrever } from './mister-avisos-escritos';

// H2b dos dias especiais (protótipo `mockups/regem-dias-especiais.html`, "No Mister"): o aviso "Feriado chegando" — 10 dias
// antes de um feriado sem resposta, às 10h, com "Fechada", "Horário normal" e "Outro horário", texto fixo (sem IA).
describe('Mister — o aviso "Feriado chegando"', () => {
  it('o dia do aviso vira às 10h da loja; a janela é de 10 dias', () => {
    // 15/12 às 09:59 em São Paulo (12:59 UTC): ainda o dia 14; às 10:00, o 15.
    expect(diaDoAvisoDoFeriado(new Date('2026-12-15T12:59:00Z'))).toBe('2026-12-14');
    expect(diaDoAvisoDoFeriado(new Date('2026-12-15T13:00:00Z'))).toBe('2026-12-15');
    expect(DIAS_DO_AVISO_DO_FERIADO).toBe(10);
  });

  it('a mensagem do protótipo, com o horário que vale até responder; a chave é a do feriado (sai quando a loja responde)', () => {
    const s = situacaoDoFeriadoChegando({ tenantId: 't1', chave: 'regra:feriado:natal:2026', data: '2026-12-25', nome: 'Natal', normal: '18:00 às 00:00' });
    expect(s).toMatchObject({ tipo: 'feriado_chegando', unidadeId: null, chave: 'feriado:regra:feriado:natal:2026' });
    expect(textoDoAviso(s)).toBe('📅 Sexta, 25/12, é Natal.\n\nComo a loja fica nesse dia? Até você responder, vale o horário de sexta (18:00 às 00:00).');
    // Sem lembrete: o marco é a data do feriado (não muda de um dia para o outro).
    expect(s.dados).toMatchObject({ marco: '2026-12-25', chave: 'regra:feriado:natal:2026', data: '2026-12-25', nome: 'Natal' });
    // O dia fechado na semana: "(fechada)".
    expect(situacaoDoFeriadoChegando({ tenantId: 't1', chave: 'escala:x:2026-12-28', data: '2026-12-28', nome: 'Feriado da cidade', normal: null }).detalhe).toContain('vale o horário de segunda (fechada).');
  });

  it('os três botões vão e voltam com a chave; botão estranho não é deste aviso', () => {
    const b = botoesDoFeriado('calendario:11111111-1111-4111-8111-111111111111:2026-12-02');
    expect(b.map((x) => x.titulo)).toEqual(['Fechada', 'Horário normal', 'Outro horário']);
    for (const x of b) expect(x.titulo.length).toBeLessThanOrEqual(20); // o limite do botão do WhatsApp
    expect(b.map((x) => lerBotaoDoFeriado(x.id))).toEqual([
      { acao: 'fechada', chave: 'calendario:11111111-1111-4111-8111-111111111111:2026-12-02' },
      { acao: 'normal', chave: 'calendario:11111111-1111-4111-8111-111111111111:2026-12-02' },
      { acao: 'outro', chave: 'calendario:11111111-1111-4111-8111-111111111111:2026-12-02' },
    ]);
    expect(botoesDoFeriado('')).toEqual([]);
    expect(botoesDoFeriado("x'; drop")).toEqual([]);
    expect(lerBotaoDoFeriado('ped:chegou:11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(lerBotaoDoFeriado('fer:x:regra:feriado:natal:2026')).toBeNull();
  });

  it('texto fixo: nunca escrito pela IA, mesmo com o grupo "Na loja" ligado', () => {
    expect(deveEscrever('feriado_chegando', 'abriu', ['loja', 'servidor', 'fiscal', 'mister'])).toBe(false);
    expect(deveEscrever('pedido_atrasado', 'abriu', ['loja'])).toBe(true);
    expect(TEXTOS_DO_FERIADO.outro('sexta, 25/12', 'Natal')).toContain('peço o seu PIN');
  });
});
