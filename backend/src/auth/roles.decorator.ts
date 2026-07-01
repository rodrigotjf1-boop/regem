import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Restringe um endpoint às categorias informadas. Ex.: @Roles('presidente','gerente')
export const Roles = (...categorias: string[]) =>
  SetMetadata(ROLES_KEY, categorias);
