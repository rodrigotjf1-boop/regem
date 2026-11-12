// O TURNO ABERTO HÁ MAIS DE 24 HORAS (pedido do dono, 12/11/2026): o servidor diz há quantas horas o turno está aberto e
// se passou do limite (`backend/src/common/turno.ts`); a tela mostra e pede o fechamento. Regras puras (check:turno).

/** "há 30 horas" até 47 h; depois, "há 2 dias". */
export function idadeDoTurnoEmTexto(horas: number): string {
  const h = Math.max(0, Math.floor(Number(horas) || 0));
  if (h < 48) return `há ${h} ${h === 1 ? 'hora' : 'horas'}`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** Quando o turno abriu: só a hora no turno de hoje; com a data no turno antigo ("03/09 09:04"). */
export function aberturaDoTurno(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === agora.toDateString()) return hora;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}
