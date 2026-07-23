import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthUser } from './auth-user';

// UUID nulo: usado como "unidade inexistente" (fail-closed). Nenhuma unidade real
// tem este id, então `unidade_id = NIL` casa com zero linhas — o usuário mal
// configurado não vê a rede inteira por engano.
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

// Unidade selecionada no seletor global (header `X-Unidade-Id`), já resolvida com RBAC:
//  - usuário com unidade fixa (execução/supervisão/gerente de loja): SEMPRE a própria
//    unidade — o header é ignorado, ele não enxerga outras lojas;
//  - presidente/C&O (sem unidade fixa): a unidade do header, ou `null` = "todas as lojas";
//  - qualquer outro perfil SEM unidade (config incompleta): fail-closed = NIL_UUID,
//    nunca "rede toda" — só o presidente pode ver mais de uma loja.
// A segurança do tenant continua nas queries (todo where filtra `tenant_id`), então um
// id forjado só devolve vazio — nunca vaza dados de outro tenant.
export const UnidadeAtual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    // Rede com UMA unidade só: filtrar não separa nada e ainda esconde registros
    // antigos sem unidade. `null` aqui = "todas", que nesse caso é a única loja.
    // (marcado pelo UnidadeUnicaInterceptor)
    if (req.unidadeUnica) return null;
    if (user?.unidadeId) return user.unidadeId; // travado na própria unidade
    if (user?.categoria === 'presidente') {
      const h = req.headers['x-unidade-id'];
      const v = Array.isArray(h) ? h[0] : h;
      return typeof v === 'string' && v && v !== 'todas' ? v : null; // rede ou unidade do header
    }
    return NIL_UUID; // não-presidente sem unidade: não enxerga nada da rede
  },
);
