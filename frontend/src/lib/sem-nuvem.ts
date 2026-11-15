// A FAIXA "SEM CONEXÃO COM A NUVEM" do servidor da loja (F1.4 do docs/plano-mister.md; protótipo
// mockups/regem-dependencias-e-qualidade.html, vista "Loja sem internet"). O servidor diz desde quando não fala com a
// nuvem (`semConexaoDesde`, na resposta da presença do PC); aqui só o texto.

/** Quanto tempo o "✅ voltou" fica na tela. */
export const VOLTOU_FICA_MS = 60_000;

/** Minutos inteiros desde um instante (nunca negativo). */
export function minutosDesde(iso: string, agora: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((agora - t) / 60_000));
}

/** "12 min", "1 h", "2 h 05 min". */
export function rotuloDeMinutos(min: number): string {
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

export const TEXTO_SEM_NUVEM = {
  titulo: (min: number | null) => `📡 O servidor da loja está sem conexão com a nuvem${min === null ? '' : ` há ${rotuloDeMinutos(min)}`}`,
  detalhe:
    'Em geral é a internet da loja. A venda no balcão, nas mesas e na cozinha continua normal e sobe para a nuvem quando a conexão voltar. Enquanto isso, os pedidos do iFood, da 99 e do cardápio digital não chegam, e o Mister não manda avisos pelo WhatsApp.',
  conferir: [
    'Abra um site qualquer num PC da loja: se não abrir, a internet da loja caiu.',
    'Confira o roteador (as luzes) e o cabo de rede do servidor.',
    'Se a internet está boa e a faixa continua, chame o suporte da DMS.',
  ],
  voltou: (min: number) => `✅ A conexão com a nuvem voltou · ficou ${rotuloDeMinutos(min)} fora`,
  voltouDetalhe: 'Os pedidos do iFood, da 99 e do cardápio voltaram a chegar, e o que foi vendido aqui já está subindo para a nuvem.',
};
