// SENHA POR ORIGEM (mig 275) — balcão `B-12`, delivery `D-07`.
//
// A senha era um contador só por loja. Com a internet da loja fora, os dois lados seguem
// atendendo (o PDV local no balcão, a nuvem no delivery) e cada um incrementa o seu até
// baterem no mesmo número — duas senhas 47 no mesmo dia. Cada origem passou a numerar a
// própria sequência, e o prefixo faz parte do que o cliente lê no cupom e no painel.

// Como a senha aparece em qualquer tela. Pedido anterior à mudança (sem origem gravada)
// continua só com o número, como sempre foi.
export function rotuloSenha(senha?: number | string | null, prefixo?: string | null): string {
  if (senha == null || senha === '') return '';
  const p = (prefixo ?? '').trim();
  return p ? `${p}-${senha}` : String(senha);
}

// Busca do KDS: o operador digita "12" (só o número) ou "d12"/"D-12" (com a origem).
// As duas formas encontram o pedido, e digitar a origem separa B-12 de D-12.
export function senhaCasa(digitado: string, senha?: number | string | null, prefixo?: string | null): boolean {
  if (senha == null || senha === '') return false;
  const alvo = String(senha);
  const p = (prefixo ?? '').trim().toUpperCase();
  const busca = digitado.trim().toUpperCase().replace(/\s|-/g, '');
  if (!busca) return false;
  if (busca === alvo) return true; // só o número: casa com qualquer origem
  return !!p && busca === `${p}${alvo}`;
}
