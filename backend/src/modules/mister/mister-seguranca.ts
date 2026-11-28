import type { NotaDaSaida } from './mister-agente.regras';
import { CODIGOS_ERRADOS_JANELA_MIN, CODIGOS_ERRADOS_MAX } from './mister.regras';

// A SEGURANÇA DO MISTER no console (o Sentinela do prompt do dono, parte 1; F5 do docs/plano-mister.md; protótipo
// mockups/regem-mister-sentinela-mentor.html, vista "Console › Mister › Segurança"). As proteções já agem sozinhas no
// servidor — o filtro de saída, o calar do código errado, a régua de quem fala com o Mister. Aqui só se CONTA o que elas
// fizeram, com o que o servidor já anota: nunca o telefone, o texto, o código digitado ou o que a consulta trouxe.
// Sem IA nesta parte. As regras puras: os desfechos que contam, o texto de cada nota e o "Pede atenção".

/** Os desfechos da entrada (`mister_mensagem.desfecho`) que são das proteções. */
export const DESFECHOS_DA_SEGURANCA = ['codigo_nao_vale', 'codigos_demais', 'codigo_calado', 'codigo_repetido', 'numero_de_outra_pessoa', 'sem_acesso', 'fixa', 'fixa_calada'] as const;
export type DesfechoDaSeguranca = (typeof DESFECHOS_DA_SEGURANCA)[number];

/** As notas do filtro de saída (`mister_pergunta.conferencia`), como o console mostra, na ordem do cartão. */
export const NOTA_NA_SEGURANCA: Record<NotaDaSaida, string> = {
  segredo: 'segredo tirado',
  link_tirado: 'link tirado',
  valor_sem_origem: 'valor em reais sem origem (anotado)',
  cortada: 'resposta cortada pelo tamanho',
  vazia: 'resposta vazia',
};

/** "1 hora" / "30 min": a janela do código errado como se diz numa frase. */
export function janelaEmPalavras(min: number): string {
  if (min % 60 === 0) return min === 60 ? '1 hora' : `${min / 60} horas`;
  return `${min} min`;
}

export interface SegredoTirado {
  empresa: string;
  quando: string;
  consultas: string[];
}

export interface Atencao {
  nivel: 'critico' | 'atencao';
  texto: string;
}

/**
 * O "Pede atenção", por regra: cada segredo tirado da resposta é crítico (com a consulta, a empresa e a hora — nunca o
 * segredo); telefone calado por código errado é atenção. Até 3 segredos por nome; os outros, somados.
 */
export function pedeAtencao(segredos: SegredoTirado[], totalDeSegredos: number, telefonesCalados: number): Atencao[] {
  const itens: Atencao[] = [];
  for (const s of segredos.slice(0, 3)) {
    const consultas = s.consultas.length ? s.consultas.map((c) => c.replace(/_/g, ' ')).join(', ') : 'nenhuma consulta';
    itens.push({ nivel: 'critico', texto: `Uma resposta saiu sem algo parecido com uma chave de acesso (o filtro de saída tirou). Conferir qual consulta trouxe esse dado: ${consultas} · ${s.empresa} · ${s.quando}.` });
  }
  const resto = totalDeSegredos - Math.min(3, segredos.length);
  if (resto > 0) itens.push({ nivel: 'critico', texto: `E mais ${resto} ${resto === 1 ? 'resposta' : 'respostas'} com segredo tirado no período.` });
  if (telefonesCalados > 0)
    itens.push({
      nivel: 'atencao',
      texto: `${telefonesCalados} ${telefonesCalados === 1 ? 'telefone foi calado' : 'telefones foram calados'} por ${janelaEmPalavras(CODIGOS_ERRADOS_JANELA_MIN)} depois de ${CODIGOS_ERRADOS_MAX} códigos errados seguidos para ligar ao Mister.`,
    });
  return itens;
}
