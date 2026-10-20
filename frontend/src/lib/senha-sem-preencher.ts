// Senha nunca é preenchida pelo navegador. O Regem roda em PC compartilhado da loja (caixa, delivery,
// KDS, ponto) e o Edge/Chrome punham sozinhos a senha salva de quem entrou antes — no login e em
// qualquer campo de senha (autorização do gestor, PIN, token de integração, senha do colaborador
// novo). Em campo de senha o navegador ignora `autocomplete="off"`; o valor que ele respeita para
// não preencher é `new-password` (MDN, atributo autocomplete). Regra conferida em `npm run check:senhas`.
export function autoCompleteDoCampo(type: string | undefined, autoComplete: string | undefined): string | undefined {
  if (type !== 'password') return autoComplete;
  return !autoComplete || autoComplete === 'off' ? 'new-password' : autoComplete;
}
