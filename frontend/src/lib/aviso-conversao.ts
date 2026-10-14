import { conversoesSoltas, proporcaoFixa, type Conversao } from '@/lib/conversao-unidade';

// O que há de errado (ou sobrando) em cada linha de conversão, dito na própria linha antes de salvar —
// no cadastro do produto do estoque e no rendimento da ficha técnica (mig 319):
//  • quilo e grama, litro e ml o sistema converte sozinho — a linha que repete a medida não é
//    necessária, e a que a contradiz (unidades trocadas) o servidor recusa;
//  • a que não chega à unidade principal por caminho nenhum não é usada em lugar nenhum.

export type AvisoDaConversao = { tom: 'erro' | 'aviso' | 'info'; texto: string };

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Um aviso por linha (índice), ou `null` quando a linha está certa ou ainda incompleta. */
export function avisosDasConversoes(unidadePrincipal: string, conversoes: Conversao[]): (AvisoDaConversao | null)[] {
  const soltas = new Set(conversoesSoltas(unidadePrincipal, conversoes));
  return conversoes.map((c, i) => {
    const fixa = c.unidadeDe && c.unidadePara && c.unidadeDe !== c.unidadePara ? proporcaoFixa(c.unidadeDe, c.unidadePara) : null;
    if (fixa != null) {
      const conta = `1 ${c.unidadeDe} = ${num(fixa)} ${c.unidadePara}`;
      return Number(c.fator) > 0 && Math.abs(Number(c.fator) / fixa - 1) > 1e-9
        ? { tom: 'erro', texto: `${conta}, e o sistema já faz essa conta sozinho. Remova esta linha.` }
        : { tom: 'info', texto: `O sistema já sabe que ${conta}. Esta linha não é necessária.` };
    }
    return soltas.has(i)
      ? { tom: 'aviso', texto: `Esta conversão não se liga a ${unidadePrincipal || 'unidade'}, a unidade principal, e não vai ser usada. Ligue uma das duas unidades à principal em outra linha.` }
      : null;
  });
}

/** Classes de cada tom (tokens do tema). */
export const TOM_DO_AVISO: Record<AvisoDaConversao['tom'], string> = {
  erro: 'bg-destructive/10 font-medium text-destructive',
  aviso: 'border-l-4 border-warn bg-warn/10 text-foreground',
  info: 'bg-info/10 text-foreground',
};
