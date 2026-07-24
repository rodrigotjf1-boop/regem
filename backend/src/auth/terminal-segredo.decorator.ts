import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Segredo do PC pareado (mig 142), enviado no header `X-Terminal-Secret`.
// Anda junto com o `X-Terminal-Id`: o id diz QUEM é, o segredo PROVA. Sem ele,
// qualquer usuário logado podia trocar o id no localStorage e assumir o caixa
// de outro terminal da empresa.
export const TerminalSegredo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers['x-terminal-secret'];
    const v = Array.isArray(h) ? h[0] : h;
    return typeof v === 'string' && v ? v : null;
  },
);
