import { FEITO_MAX, PEDIDO_MAX, chaveDoAprendizado, escolherExemplos, linhasDosExemplos, podeAprender, textoAprendido } from './mister-aprendizado';
import { PROCEDIMENTO_DA_TAREFA } from './mister-tarefas';

// Versão 10, C7: as regras puras do "Aprender pela tarefa feita" (o que vira exemplo, o texto guardado, a chave e a escolha).

describe('aprender pela tarefa feita (C7)', () => {
  it('só as ações e a tarefa pelo mapa viram exemplo; o que leva valor da empresa, a imagem e o banco não', () => {
    expect(podeAprender('pausar_canal')).toBe(true);
    expect(podeAprender(PROCEDIMENTO_DA_TAREFA)).toBe(true);
    for (const p of ['informar_saldo', 'informar_folha', 'informar_custo_campanha', 'criar_imagem', 'classificar_banco']) expect(podeAprender(p)).toBe(false);
    expect(podeAprender('reiniciar_impressora_que_nao_existe')).toBe(false);
    expect(podeAprender('')).toBe(false);
  });

  it('o texto guardado sai sem e-mail e sem número de telefone, numa linha e cortado', () => {
    const t = textoAprendido('faz o pedido\n\n do Felipão, me liga 21 98765-4321 ou dono@loja.com.br', PEDIDO_MAX);
    expect(t).not.toContain('loja.com.br');
    expect(t).not.toContain('98765');
    expect(t).not.toContain('\n');
    expect(t.startsWith('faz o pedido do Felipão')).toBe(true);
    expect(textoAprendido('a'.repeat(2000), FEITO_MAX)).toHaveLength(FEITO_MAX);
    expect(textoAprendido(undefined, PEDIDO_MAX)).toBe('');
  });

  it('a mesma tarefa pedida com as mesmas palavras, em outra ordem, dá a mesma chave; outra tarefa, outra chave', () => {
    const a = chaveDoAprendizado('pausar_canal', 'pausa o cardápio meia hora');
    expect(chaveDoAprendizado('pausar_canal', 'meia hora pausa o cardápio')).toBe(a);
    expect(chaveDoAprendizado('reabrir_canal', 'pausa o cardápio meia hora')).not.toBe(a);
    expect(chaveDoAprendizado('pausar_canal', 'pausa o balcão meia hora')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{40}$/);
  });

  it('a escolha: pelo menos 2 palavras em comum, as mais parecidas primeiro, no máximo 3', () => {
    const lista = [
      { id: '1', pedido: 'pausa o cardápio meia hora', feito: 'Pausar o cardápio digital.', atualizadoEm: '2026-11-20T10:00:00Z' },
      { id: '2', pedido: 'faz o pedido do Felipão com o que está abaixo do mínimo', feito: 'Criar o pedido ao Felipão.', atualizadoEm: '2026-11-21T10:00:00Z' },
      { id: '3', pedido: 'pausa o cardápio e o iFood meia hora, cozinha cheia', feito: 'Pausar o cardápio digital e o iFood.', atualizadoEm: '2026-11-22T10:00:00Z' },
      { id: '4', pedido: 'pausa o cardápio', feito: 'Pausar.', atualizadoEm: '2026-11-23T10:00:00Z' },
      { id: '5', pedido: 'cardápio pausado meia hora', feito: 'Pausar o cardápio.', atualizadoEm: '2026-11-24T10:00:00Z' },
    ];
    const e = escolherExemplos('pausa o cardápio meia hora que a cozinha está cheia', lista);
    expect(e).toHaveLength(3);
    expect(e[0].id).toBe('3');
    expect(e.map((x) => x.id)).not.toContain('2');
    expect(escolherExemplos('quanto vendi ontem?', lista)).toEqual([]);
    expect(escolherExemplos('', lista)).toEqual([]);
  });

  it('as linhas no bloco da conversa: a data em que aprendeu, o pedido e o feito; sem valores para quem não os vê', () => {
    const ex = [{ id: '1', pedido: 'paga o boleto de R$ 1.250,00 da Ambev', feito: 'Lançar a conta de R$ 1.250,00 em Bebidas.', atualizadoEm: '2026-11-25T15:00:00Z' }];
    expect(linhasDosExemplos([], true)).toEqual([]);
    const com = linhasDosExemplos(ex, true);
    expect(com).toHaveLength(2);
    expect(com[0]).toContain('nunca faça sem ele');
    expect(com[0]).toContain('Mister › O que aprendi');
    expect(com[1]).toBe('  1) (aprendido em 25/11) Pedido: "paga o boleto de R$ 1.250,00 da Ambev" → Feito: Lançar a conta de R$ 1.250,00 em Bebidas.');
    const sem = linhasDosExemplos(ex, false);
    expect(sem[1]).not.toContain('1.250');
    expect(sem[1]).toContain('R$ (oculto)');
  });
});
