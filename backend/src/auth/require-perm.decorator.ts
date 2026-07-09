import { SetMetadata } from '@nestjs/common';

// Exige uma permissão do perfil de acesso. Formas:
//   @RequirePerm('financeiro')            → toggle de módulo (boolean)
//   @RequirePerm('ponto', 'criar')        → ação de módulo (ver/criar/editar/excluir)
export const REQUIRE_PERM = 'require_perm';
export type PermSpec =
  | { modulo: 'ver_financeiro' | 'financeiro' | 'fiscal' }
  | { modulo: 'ponto' | 'estoque'; acao: 'ver' | 'criar' | 'editar' | 'excluir' };

export const RequirePerm = (modulo: string, acao?: string) =>
  SetMetadata(REQUIRE_PERM, { modulo, acao } as PermSpec);
