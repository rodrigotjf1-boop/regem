import { SetMetadata } from '@nestjs/common';

// ROTAS QUE A CREDENCIAL DE UM INTEGRADOR PODE USAR (fase 0 da credencial própria do GoGeM, 14/10/2026).
//
// A credencial do GoGeM é o token de um equipamento `servidor_local` (mig 290) e passa pelo mesmo
// `SyncTokenGuard` do servidor da loja — que também abre o sincronismo inteiro (`/sync/pull`,
// `/sync/snapshot`, `/sync/restore`, `/sync/push`): a cópia de todos os dados da empresa. O GoGeM
// só precisa de cinco rotas. Na nuvem, a credencial de integrador passa SÓ nas rotas marcadas com
// este decorador; o resto responde 403 (lista do que pode, não do que não pode: rota nova nasce
// fechada para ela). O servidor da loja não é afetado: ele nunca é credencial de integrador.
export const ACEITA_INTEGRADOR = 'regem:aceitaIntegrador';

/** A credencial de um integrador (GoGeM) pode chamar esta rota. */
export const AceitaIntegrador = () => SetMetadata(ACEITA_INTEGRADOR, true);
