/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESUMO QUE O ROBÔ FAZ DO CASO (Onda 1, PR 4 — o "2A" do protótipo `mockups/regem-central-atendimento.html`): quem
// pega o caso lê, de cara, o motivo, como o cliente está, o que ele quer e o que o robô já fez — sem rolar a conversa.
// Vem de dois jeitos, para não depender de reimportar o fluxo do n8n: os campos próprios (`motivo`, `quer`, `jaFez`,
// `humor`), quando o fluxo os manda; ou as linhas "Motivo: … / Quer: … / Já fiz: …" que as instruções pedem na
// `mensagem` (robo-instrucoes.ts). O campo próprio vence a linha. Fica em `atendimento_chamado.detalhe.robo`.

export type ResumoDoRobo = {
  motivo: string | null;
  quer: string | null;
  jaFez: string | null;
  /** 'chateado' quando o robô marcou urgente (ou disse que o cliente está chateado); 'calmo' só quando ele disse. */
  humor: 'chateado' | 'calmo' | null;
};

const LIMITE = 300;

const texto = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, LIMITE) : null;
};

/** O rótulo como o robô escreve → a chave do resumo. */
function chaveDo(rotulo: string): keyof Omit<ResumoDoRobo, 'humor'> {
  const r = rotulo.toLowerCase();
  if (r.startsWith('motivo')) return 'motivo';
  if (r.includes('quer')) return 'quer';
  return 'jaFez';
}

/**
 * As linhas "Motivo: … / Quer: … / Já fiz: …" de dentro da mensagem — uma por linha ou todas numa linha só ("Motivo: X.
 * Quer: Y. Já fiz: Z."). O valor vai até o próximo rótulo; repetido, vale o primeiro.
 */
export function lerResumoDaMensagem(mensagem: unknown): Partial<Record<keyof Omit<ResumoDoRobo, 'humor'>, string>> {
  const s = String(mensagem ?? '');
  const re = /(^|[\s;.|/•*-])(motivo|o cliente quer|quer|o rob[oô] j[aá] fez|j[aá] fiz|j[aá] fez)\s*:/gi;
  const achados: Array<{ chave: keyof Omit<ResumoDoRobo, 'humor'>; inicio: number; valor: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) achados.push({ chave: chaveDo(m[2]), inicio: m.index + m[1].length, valor: re.lastIndex });
  const r: Partial<Record<keyof Omit<ResumoDoRobo, 'humor'>, string>> = {};
  achados.forEach((a, i) => {
    const fim = i + 1 < achados.length ? achados[i + 1].inicio : s.length;
    const v = texto(s.slice(a.valor, fim).replace(/[\s;.|/•*-]+$/, ''));
    if (v && !r[a.chave]) r[a.chave] = v;
  });
  return r;
}

/** O resumo do caso: os campos próprios, senão as linhas da mensagem. Sem motivo, sem "quer" e sem "já fiz": nenhum. */
export function resumoDoRobo(dto: any, urgente: boolean): ResumoDoRobo | null {
  const lido = lerResumoDaMensagem(dto?.mensagem);
  const humorDito = typeof dto?.humor === 'string' ? dto.humor.trim().toLowerCase() : '';
  const humor: ResumoDoRobo['humor'] =
    urgente || ['chateado', 'irritado', 'bravo', 'nervoso'].includes(humorDito) ? 'chateado' : humorDito === 'calmo' ? 'calmo' : null;
  const r: ResumoDoRobo = {
    motivo: texto(dto?.motivo) ?? lido.motivo ?? null,
    quer: texto(dto?.quer) ?? lido.quer ?? null,
    jaFez: texto(dto?.jaFez) ?? lido.jaFez ?? null,
    humor,
  };
  return r.motivo || r.quer || r.jaFez ? r : null;
}
