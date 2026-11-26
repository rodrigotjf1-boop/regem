import { conferirRespostaEscrita, instrucoesDaRespostaEscrita } from './mister-resposta-escrita';
import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';

// Versão 10, C9: o "feito" e o "não deu" escritos pela IA (puro). A conferência decide se vai o texto dela ou a frase fixa do
// Regem. O caminho com o banco (o ajuste "A IA escreve as respostas", a IA de mentira, o prazo) em `mister-pg.teste-spec.ts`.

const FIXO = '✅ Feito às 14:33. Lancei a entrada de 10 kg de "Bacon fatiado" em Estoque › Produtos. O saldo ficou em 14 kg.';

describe('C9 · a resposta escrita pela IA', () => {
  it('passa: as mesmas palavras-chave e todos os números, do jeito dela', () => {
    const t = 'Pronto, às 14:33 entraram os 10 kg de "Bacon fatiado" em Estoque › Produtos. Agora são 14 kg.';
    expect(conferirRespostaEscrita(t, FIXO)).toEqual({ texto: t });
  });
  it('não passa: número novo, número que sumiu ou número reformatado', () => {
    expect(conferirRespostaEscrita('Pronto, às 14:33 entraram 10 kg de "Bacon fatiado" em Estoque › Produtos. Agora são 14 kg, dá para 3 dias.', FIXO)).toEqual({ motivo: 'numero_novo' });
    expect(conferirRespostaEscrita('Pronto, entraram 10 kg de "Bacon fatiado" em Estoque › Produtos. Agora são 14 kg.', FIXO)).toEqual({ motivo: 'numero_sumiu' });
    expect(conferirRespostaEscrita('Lancei a conta de R$ 1240,00.', 'Lancei a conta de R$ 1.240,00.')).toEqual({ motivo: 'numero_novo' });
  });
  it('não passa: o caminho do menu ou o que está entre aspas mudou; link que o Regem não mandou', () => {
    expect(conferirRespostaEscrita('Pronto, às 14:33 entraram 10 kg de "Bacon fatiado" no estoque. Agora são 14 kg.', FIXO)).toEqual({ motivo: 'menu' });
    expect(conferirRespostaEscrita('Pronto, às 14:33 entraram 10 kg de bacon em Estoque › Produtos. Agora são 14 kg.', FIXO)).toEqual({ motivo: 'aspas' });
    expect(conferirRespostaEscrita('Feito às 14:33: 10 kg de "Bacon fatiado" em Estoque › Produtos, 14 kg. Veja em https://x.y', FIXO)).toEqual({ motivo: 'link' });
  });
  it('não passa: vazio ou longo demais; o negrito do WhatsApp não atrapalha a conferência', () => {
    expect(conferirRespostaEscrita('   ', FIXO)).toEqual({ motivo: 'vazio' });
    expect(conferirRespostaEscrita(`${FIXO} ${'muito bom '.repeat(80)}`, FIXO)).toEqual({ motivo: 'longo' });
    expect(conferirRespostaEscrita('Feito às 14:33! Entraram *10 kg* de "Bacon fatiado" em *Estoque › Produtos*; o saldo é 14 kg.', FIXO)).toHaveProperty('texto');
  });
  it('o ajuste nasce desligado e só aceita booleano de verdade (V15)', () => {
    expect(CONVERSA_PADRAO.respostasEscritas).toBe(false);
    expect(conferirConversa({ respostasEscritas: true })).toEqual({ respostasEscritas: true });
    expect(conferirConversa({ respostasEscritas: 'sim' })).toHaveProperty('erro');
    expect(conferirConversa({ respostasEscritas: 1 })).toHaveProperty('erro');
  });
  it('as instruções levam o jeito da empresa por último e as regras dos números', () => {
    const i = instrucoesDaRespostaEscrita(['- Tom: direto, sem gíria.']);
    expect(i).toContain('Mantenha TODOS os números exatamente como estão');
    expect(i).toContain('variando as palavras');
    expect(i.trim().endsWith('- Tom: direto, sem gíria.')).toBe(true);
    expect(instrucoesDaRespostaEscrita([])).not.toContain('O JEITO DESTA EMPRESA');
  });
});
