import { BadRequestException } from '@nestjs/common';

// Escopos do token de integração por loja (contrato Regem → Liame v1, `docs/integracoes/regem.md`
// do Liame). Cada rota confere o seu; o que o token não tem volta 403. A lista é a MESMA do
// `check` da tabela (mig 295): escopo fora dela nem chega a ser gravado.
export const ESCOPOS_INTEGRACAO = [
  'pedidos.ler',
  'clientes.telefone.ler',
  'custos.ler',
  'clientes.anonimizacao.ler',
  'cupons.ler',
  'cupons.uso.ler',
  'cupons.criar',
] as const;

export type EscopoIntegracao = (typeof ESCOPOS_INTEGRACAO)[number];

/** O que cada escopo libera, em pt-BR (tela do console). */
export const ROTULO_ESCOPO: Record<EscopoIntegracao, string> = {
  'pedidos.ler': 'Vendas confirmadas e canceladas, itens, canal e cupom usado',
  'clientes.telefone.ler': 'Id e telefone do cliente no pedido (nunca de marketplace)',
  'custos.ler': 'Custo por item (só se quem autorizou vê valores em R$)',
  'clientes.anonimizacao.ler': 'Avisos de cliente que pediu para ser esquecido',
  'cupons.ler': 'Cupons da loja, com regra e validade',
  'cupons.uso.ler': 'Usos de cupom (sem dado do cliente)',
  'cupons.criar': 'Criar e desativar cupom (só pelo Action Service do Liame)',
};

export function ehEscopoIntegracao(v: unknown): v is EscopoIntegracao {
  return typeof v === 'string' && (ESCOPOS_INTEGRACAO as readonly string[]).includes(v);
}

/**
 * Lista de escopos vinda de fora (console): ao menos um, todos conhecidos, sem repetição.
 * Desconhecido → 400 listando o que não existe (nunca vira "um escopo padrão").
 */
export function validarEscopos(v: unknown): EscopoIntegracao[] {
  if (!Array.isArray(v) || !v.length) {
    throw new BadRequestException('Escolha ao menos um escopo para o token.');
  }
  const invalidos = v.filter((e) => !ehEscopoIntegracao(e)).map((e) => String(e));
  if (invalidos.length) {
    throw new BadRequestException(`Escopo desconhecido: ${invalidos.join(', ')}.`);
  }
  // Na ordem do contrato, sem repetição.
  return ESCOPOS_INTEGRACAO.filter((e) => v.includes(e));
}
