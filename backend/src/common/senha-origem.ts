// SENHA POR ORIGEM (mig 275) — balcão `B-12`, delivery `D-07`.
//
// A senha era um contador só por loja. Quando a internet cai, os dois lados seguem
// atendendo — o PDV local no balcão e a NUVEM no delivery (ela assume a loja depois de
// 3 minutos sem sinal) — e cada um incrementa o seu contador até os dois baterem no mesmo
// número. Duas senhas 47 no mesmo dia, uma em cada balcão de entrega.
//
// Separar a sequência por origem resolve sem ninguém precisar conversar: cada lado só
// mexe na própria faixa. É imune a queda de luz, queda de internet, oscilação, restauração
// e servidor duplicado — e ainda fica mais claro para quem chama a senha.
//
// ⚠️ Prefixo é de UMA letra e faz parte do que o cliente lê no cupom e no painel. Mudar as
// letras muda o que está impresso na mão do cliente naquele dia.

export const PREFIXO_BALCAO = 'B'; // PDV, mesa avulsa, totem — nasce na loja
export const PREFIXO_DELIVERY = 'D'; // cardápio online e marketplaces — nasce na nuvem

// Como a senha é escrita em qualquer lugar (cupom, KDS, painel, comprovante).
// Sem prefixo (pedido anterior à mig 275) devolve só o número, como sempre foi.
export function rotuloSenha(senha?: number | string | null, prefixo?: string | null): string {
  if (senha == null || senha === '') return '';
  const p = (prefixo ?? '').trim();
  return p ? `${p}-${senha}` : String(senha);
}

/** A origem da senha por extenso, na via IMPRESSA (pedido do dono, 16/11/2026). */
export const ORIGEM_DA_SENHA: Record<string, string> = { [PREFIXO_BALCAO]: 'BALCÃO', [PREFIXO_DELIVERY]: 'DELIVERY' };

/**
 * A senha como sai na VIA IMPRESSA — "SENHA 5 - BALCÃO", "SENHA 9 - DELIVERY" (pedido do dono, 16/11/2026: "SENHA B - 5"
 * era difícil de entender; o número e o canal por extenso). As telas (KDS, TV de senhas, PDV) seguem com o rótulo curto
 * (`rotuloSenha`). Sem prefixo (pedido anterior à mig 275), só "SENHA 5". Vazio = sem senha.
 */
export function senhaNaVia(senha?: number | string | null, prefixo?: string | null): string {
  if (senha == null || senha === '') return '';
  const origem = ORIGEM_DA_SENHA[(prefixo ?? '').trim().toUpperCase()];
  return origem ? `SENHA ${senha} - ${origem}` : `SENHA ${senha}`;
}
