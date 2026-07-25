import { SetMetadata } from '@nestjs/common';
import type { Permissoes } from './permissoes';

// Exige uma permissão do perfil de acesso. Formas:
//   @RequirePerm('financeiro')            → toggle de área (boolean)
//   @RequirePerm('ponto', 'criar')        → ação de módulo (ver/criar/editar/excluir)
export const REQUIRE_PERM = 'require_perm';
// Chaves booleanas do catálogo (tudo em Permissoes menos os módulos CRUD).
export type PermBool = Exclude<keyof Permissoes, 'ponto' | 'estoque' | 'escalas'>;
export type PermSpec =
  | { modulo: PermBool }
  | { modulo: 'ponto' | 'estoque' | 'escalas'; acao: 'ver' | 'criar' | 'editar' | 'excluir' };

export const RequirePerm = (modulo: string, acao?: string) =>
  SetMetadata(REQUIRE_PERM, { modulo, acao } as PermSpec);
