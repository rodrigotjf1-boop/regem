import { ACOES, conferirAcao } from './mister-acoes';
import { conferirContagem, MAX_CONTADOS, resumoDaContagem } from './mister-acoes-contagem';
import { instanteDeSaoPaulo } from '../../common/pedido-agendado';

// Versão 9, O3: a contagem do estoque pela conversa (puro). A lista, o serviço e o ajuste em `mister-pg.teste-spec.ts`.

const AGORA = instanteDeSaoPaulo('2026-11-24T20:00')!;

describe('Mister · O3 — a contagem do estoque', () => {
  it('é de botão, pela permissão "editar" do Estoque (as rotas de iniciar e salvar)', () => {
    expect(ACOES.contar_estoque).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'editar', prazoMin: 10 });
  });

  it('cada item com o nome e a quantidade (zero vale: contou e não tinha); a medida pela lista do estoque; a lista quando dita', () => {
    expect(conferirAcao('contar_estoque', { listaDeContagem: ' Semanal ', contados: [{ insumo: ' Bacon  em tiras ', quantidade: 12.3456, medida: 'quilos' }, { insumo: 'Tomate', quantidade: 0 }] }, AGORA)).toEqual({
      parametros: {
        acao: 'contar_estoque',
        lista: 'Semanal',
        contados: [
          { insumo: 'Bacon em tiras', quantidade: 12.346, medida: 'kg' },
          { insumo: 'Tomate', quantidade: 0, medida: null },
        ],
      },
      resumo: '',
    });
  });

  it('recusa: nada contado, nome curto, quantidade negativa ou em texto, medida desconhecida, o mesmo insumo duas vezes, mais que o teto', () => {
    const ruins: Record<string, unknown>[] = [
      {},
      { contados: [] },
      { contados: [{ insumo: 'B', quantidade: 1 }] },
      { contados: [{ insumo: 'Bacon', quantidade: -1 }] },
      { contados: [{ insumo: 'Bacon', quantidade: '12' }] },
      { contados: [{ insumo: 'Bacon', quantidade: 1, medida: 'xpto' }] },
      { contados: [{ insumo: 'Bacon', quantidade: 1 }, { insumo: 'bacon', quantidade: 2 }] },
      { contados: Array.from({ length: MAX_CONTADOS + 1 }, (_, i) => ({ insumo: `Item ${i}`, quantidade: 1 })) },
    ];
    for (const en of ruins) expect(conferirContagem(en)).toHaveProperty('erro');
  });

  it('o resumo: cada item com o contado, o que o sistema tem e o ajuste; o que fica sem contar', () => {
    const itens = [
      { nome: 'Bacon em tiras', unidade: 'kg', contado: 12, saldo: 10 },
      { nome: 'Batata 7mm', unidade: 'caixa', contado: 30, saldo: 32.5 },
      { nome: 'Cebola', unidade: 'kg', contado: 4, saldo: 4 },
    ];
    expect(resumoDaContagem('Semanal', itens, 5)).toBe(
      'Lançar a contagem "Semanal" em Estoque › Contagem:\n' +
        '• Bacon em tiras: 12 kg (o sistema tem 10 kg: ajuste de +2 kg)\n' +
        '• Batata 7mm: 30 caixa (o sistema tem 32,5 caixa: ajuste de −2,5 caixa)\n' +
        '• Cebola: 4 kg (o sistema tem 4 kg: sem ajuste)\n' +
        'Os outros 2 itens da lista ficam sem contar. O ajuste vale pela diferença para o que o sistema tiver na hora de lançar.',
    );
    expect(resumoDaContagem('Semanal', itens.slice(0, 1), 2)).toContain('O outro item da lista fica sem contar.');
    expect(resumoDaContagem('Semanal', itens.slice(0, 1), 1)).not.toContain('sem contar');
  });
});
