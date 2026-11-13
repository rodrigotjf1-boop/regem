import { decidirSincronizacao, PAPEL_DAS_AUTOMATICAS, papelDoModelo, type ModeloLocal } from './modelos-por-conta';
import {
  MODELO_ANIV_PARABENS,
  MODELO_ANIV_PRESENTE,
  MODELO_CASHBACK,
  MODELO_VOLTA_CUPOM,
  MODELO_VOLTA_LEMBRETE,
  PAPEL,
} from '../relacionamento/relacionamento.service';

// OS MODELOS E A CONTA DE CADA UM (ERR-458, 13/11/2026): com o principal e o marketing em contas da Meta diferentes, o
// "Sincronizar" lia só a do marketing — os avisos novos ficavam "em análise" para sempre e os antigos seguiam "aprovado"
// quando a conta do principal mudou, e o envio voltava #132001 ("o modelo não existe").

describe('modelos — o número que envia cada um', () => {
  it('aviso do pedido (com evento) e utilidade: principal; campanha: marketing', () => {
    expect(papelDoModelo({ nome: 'pedido_chegando', categoria: 'UTILITY', evento: 'chegando' })).toBe('principal');
    expect(papelDoModelo({ nome: 'pedido_em_producao', categoria: 'MARKETING', evento: 'confirmado' })).toBe('principal'); // reclassificado: segue no principal
    expect(papelDoModelo({ nome: 'algum_aviso', categoria: 'UTILITY', evento: null })).toBe('principal');
    expect(papelDoModelo({ nome: 'cupom_desconto', categoria: 'MARKETING', evento: null })).toBe('marketing');
  });

  it('as automáticas pelo papel do relacionamento — o cashback no principal mesmo reclassificado como marketing', () => {
    expect(papelDoModelo({ nome: 'cashback_vencendo', categoria: 'MARKETING', evento: null })).toBe('principal');
    expect(papelDoModelo({ nome: 'volta_lembrete', categoria: 'MARKETING', evento: null })).toBe('marketing');
    // a lista daqui e a do relacionamento (quem ENVIA) não podem divergir
    const doRelacionamento: Record<string, string> = {
      [MODELO_CASHBACK]: PAPEL.cashback,
      [MODELO_ANIV_PRESENTE]: PAPEL.aniversario,
      [MODELO_ANIV_PARABENS]: PAPEL.aniversario,
      [MODELO_VOLTA_CUPOM]: PAPEL.volta,
      [MODELO_VOLTA_LEMBRETE]: PAPEL.volta,
    };
    expect(PAPEL_DAS_AUTOMATICAS).toEqual(doRelacionamento);
  });
});

describe('modelos — a sincronização confere cada um na conta do número que o envia', () => {
  const aviso = (id: string, nome: string, status: string, evento = 'chegando'): ModeloLocal => ({ id, nome, idioma: 'pt_BR', categoria: 'UTILITY', status, evento });
  const campanha = (id: string, nome: string, status: string): ModeloLocal => ({ id, nome, idioma: 'pt_BR', categoria: 'MARKETING', status, evento: null });
  const remoto = (nome: string, status: string, categoria = 'UTILITY') => ({ nome, idioma: 'pt_BR', status, categoria });

  it('o caso de 13/11: aviso "em análise" aprovado na conta do principal sai como aprovado — a do marketing não conta', () => {
    const mudancas = decidirSincronizacao([aviso('a', 'pedido_chegando', 'pendente')], {
      principal: [remoto('pedido_chegando', 'APPROVED')],
      marketing: [],
    });
    expect(mudancas).toEqual([{ id: 'a', status: 'aprovado' }]);
  });

  it('aviso "aprovado" que só existe na conta do marketing volta a rascunho (no envio, a Meta recusaria com #132001)', () => {
    const mudancas = decidirSincronizacao([aviso('b', 'pedido_em_producao', 'aprovado', 'confirmado')], {
      principal: [],
      marketing: [remoto('pedido_em_producao', 'APPROVED')],
    });
    expect(mudancas).toEqual([{ id: 'b', status: 'rascunho' }]);
  });

  it('campanha na conta do marketing; a categoria que a Meta deu é gravada; o que não mudou não grava', () => {
    const mudancas = decidirSincronizacao(
      [campanha('c', 'cupom_desconto', 'pendente'), campanha('d', 'novidade_cardapio', 'aprovado'), aviso('e', 'cashback_vencendo', 'pendente', '')],
      {
        principal: [remoto('cashback_vencendo', 'APPROVED', 'MARKETING')],
        marketing: [remoto('cupom_desconto', 'REJECTED', 'MARKETING'), remoto('novidade_cardapio', 'APPROVED', 'MARKETING')],
      },
    );
    expect(mudancas).toEqual([
      { id: 'c', status: 'rejeitado' },
      { id: 'e', status: 'aprovado', categoria: 'MARKETING' },
    ]);
  });

  it('a lista de uma conta não veio: nada daquele papel muda; rascunho que não está lá continua rascunho', () => {
    expect(decidirSincronizacao([aviso('f', 'pedido_chegando', 'aprovado')], { principal: null, marketing: [] })).toEqual([]);
    expect(decidirSincronizacao([aviso('g', 'pedido_sem_contato', 'rascunho', 'sem_contato')], { principal: [], marketing: [] })).toEqual([]);
    // status desconhecido da Meta (ex.: IN_APPEAL) não vira nada
    expect(decidirSincronizacao([aviso('h', 'pedido_chegando', 'pendente')], { principal: [remoto('pedido_chegando', 'IN_APPEAL')] })).toEqual([]);
  });

  it('uma conta só (principal e marketing iguais): tudo se acha nela, como antes', () => {
    const lista = [remoto('pedido_chegando', 'APPROVED'), remoto('cupom_desconto', 'APPROVED', 'MARKETING')];
    const mudancas = decidirSincronizacao([aviso('i', 'pedido_chegando', 'pendente'), campanha('j', 'cupom_desconto', 'pendente')], {
      principal: lista,
      marketing: lista,
    });
    expect(mudancas).toEqual([
      { id: 'i', status: 'aprovado' },
      { id: 'j', status: 'aprovado' },
    ]);
  });
});
