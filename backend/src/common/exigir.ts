import { BadRequestException } from '@nestjs/common';

// Campo LIGA/DESLIGA obrigatório. `!!dto?.campo` transformava AUSENTE em `false`: reproduzido
// (set/2026) que um corpo vazio DESBLOQUEAVA o acesso do técnico (`suporte/bloquear`), desativava
// uma forma de pagamento, tirava a liberação de caixa/cancelamento e mudava o modo do totem —
// sem erro. Ausente ou fora de true/false → 400 com o nome do campo.
// (Consentimentos — "ausente = não" — continuam `=== true`: aí o padrão seguro é o falso.)
export function exigirBooleano(valor: unknown, campo: string): boolean {
  if (valor === true || valor === 'true') return true;
  if (valor === false || valor === 'false') return false;
  throw new BadRequestException(`Informe "${campo}" (true ou false).`);
}
