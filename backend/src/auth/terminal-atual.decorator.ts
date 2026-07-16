import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Terminal de PDV pareado no PC (header `X-Terminal-Id`). Devolve o id cru (sync);
// quem consome resolve terminal→unidade no serviço (validando tenant + tipo 'pdv'
// + ativo via `EquipamentoService.terminalUnidade`). null quando não há terminal.
export const TerminalAtual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers['x-terminal-id'];
    const v = Array.isArray(h) ? h[0] : h;
    return typeof v === 'string' && v ? v : null;
  },
);
