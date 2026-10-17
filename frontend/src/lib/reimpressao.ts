// Onde a reimpressão saiu, para o aviso da tela. Ela sai num lugar só — a impressora escolhida, a do
// PC que pediu ou onde a via saiu antes — e o servidor devolve qual (`impressoras`, ERR-247).
export function ondeSaiu(res: unknown): string {
  const lista = (res as { impressoras?: unknown } | null | undefined)?.impressoras;
  return Array.isArray(lista) && lista.length ? ` Saiu na impressora ${lista.join(', ')}.` : '';
}
