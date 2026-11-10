/* eslint-disable @typescript-eslint/no-explicit-any */

// COMO O ENTREGADOR LIGA PARA O CLIENTE (pedido do dono, 09/11/2026). Regra única do servidor; o app só disca:
//  • iFood — o iFood não passa o celular do cliente: manda a CENTRAL (0800) e o LOCALIZADOR do pedido
//    (`customer.phone.number` + `customer.phone.localizer`, conferido na nuvem em 09/11: 305 de 305 pedidos). A gravação
//    da central pede o localizador; o app disca a central com o localizador "em espera" e o celular pergunta se manda os
//    números quando a gravação pedir.
//  • 99 e os demais — o celular do cliente, direto (decisão do dono, 09/11: "na 99 não precisamos usar a central"). A 99
//    manda "+55 21…": o número com DDI vai com o "+" (sem ele, "5521…" não completa no Brasil — era o que o app discava).
// Sem número de verdade (vazio, mascarado "000****1406" depois que a 99 protege o dado), não há o que discar: null.

export type Ligacao = {
  /** 'central' = ligar para a central e informar o localizador (iFood); 'direto' = o celular do cliente. */
  tipo: 'direto' | 'central';
  /** O número a discar: com "+" quando tem DDI; a central do iFood, como veio (0800…). */
  numero: string;
  /** Só na central: o código que a gravação pede. */
  localizador: string | null;
  /** Só na central: até quando o localizador vale (o iFood informa), em ISO. */
  validoAte: string | null;
};

const rawObj = (raw: unknown): any => {
  if (raw && typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
};

/** O número para discar direto, ou null. "+55 21 99876-5432" → "+5521998765432"; "21998765432" → "21998765432". */
export function numeroParaDiscar(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s || s.includes('*')) return null; // mascarado pela plataforma: não liga para ninguém
  const d = s.replace(/\D/g, '');
  if (d.length < 8 || d.length > 15) return null;
  // Com DDI: veio com "+" ou tem o 55 do Brasil na frente de um número com DDD (12 ou 13 dígitos).
  if (s.startsWith('+') || (d.startsWith('55') && (d.length === 12 || d.length === 13))) return `+${d}`;
  return d;
}

export function ligacaoDoPedido(p: { canal?: unknown; clienteTelefone?: unknown; raw?: unknown }): Ligacao | null {
  if (String(p.canal ?? '') === 'ifood') {
    const fone = rawObj(p.raw)?.customer?.phone ?? {};
    const central = String(fone?.number ?? p.clienteTelefone ?? '').replace(/\D/g, '');
    const localizador = String(fone?.localizer ?? '').replace(/\D/g, '');
    if (central.length >= 8 && localizador) {
      const ate = fone?.localizerExpiration ? new Date(fone.localizerExpiration) : null;
      return {
        tipo: 'central',
        numero: central,
        localizador,
        validoAte: ate && !Number.isNaN(ate.getTime()) ? ate.toISOString() : null,
      };
    }
  }
  const numero = numeroParaDiscar(p.clienteTelefone);
  return numero ? { tipo: 'direto', numero, localizador: null, validoAte: null } : null;
}
