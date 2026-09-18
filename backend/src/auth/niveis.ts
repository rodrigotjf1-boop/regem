import { SetMetadata, applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';

// NÍVEIS DE ACESSO — os ÚNICOS valores de `AuthUser.categoria` (perfil_acesso.nivel ??
// funcao.categoria, enum categoria_hierarquia) + 'suporte' (técnico da distribuição, tratado
// como gerente no RolesGuard).
//
// Por que existe: 14 rotas usavam `@Roles(..., 'atendente')` e 3 travas de autorização testavam
// `atorPerfil === 'atendente'` — nível que NÃO existe. Reproduzido (set/2026): o operador de caixa
// (execução, com permissão de PDV) levava 403 ao abrir o caixa e listar as formas de pagamento, e
// qualquer um com a permissão "mesas" cancelava venda e removia item SEM a liberação do presidente.
// `auth/niveis.spec.ts` recusa qualquer @Roles com valor fora desta lista.
export const NIVEIS = ['presidente', 'gerente', 'supervisao', 'execucao'] as const;
export type Nivel = (typeof NIVEIS)[number];

/** Gerente para cima (inclui o suporte, que o RolesGuard trata como gerente). */
export function ehGestor(categoria?: string | null): boolean {
  return categoria === 'presidente' || categoria === 'gerente' || categoria === 'suporte';
}

// Rota de OPERAÇÃO DE CAIXA (abrir, consultar, movimentar, fechar, formas de pagamento): todos
// os níveis entram; supervisão e execução precisam da permissão `perm` do perfil (padrão 'pdv').
// Presidente e gerente seguem como antes (sem exigir a permissão — não tira acesso de ninguém).
export const PERM_OPERADOR = 'perm_operador';
export const OperadorDeCaixa = (perm = 'pdv') =>
  applyDecorators(Roles(...NIVEIS), SetMetadata(PERM_OPERADOR, perm));
