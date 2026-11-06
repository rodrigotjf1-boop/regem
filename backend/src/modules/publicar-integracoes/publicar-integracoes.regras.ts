import { CLIENTES_INTEGRACAO } from '../integracao-api/escopos';

// "PUBLICAR NAS INTEGRAÇÕES" (pedido do dono de 06/11/2026): um botão só, no Cardápio, no lugar do "Publicar no GoGeM"
// de Configurações › Equipamentos. Cada integração que usa o cardápio vira uma LINHA, com a frase já em palavras do
// lojista — o servidor decide o que a tela mostra (nada de regra repetida no front):
//   - iFood (pelo Orzuni): AUTOMÁTICO — preço e pausa vão sozinhos pela fila (mig 370). A linha conta o que está a
//     caminho e o que deu problema; o botão não manda nada ao iFood.
//   - GoGeM (totem): busca o cardápio sozinho de tempos em tempos; o botão manda na hora (`GogemPublishService`).
//   - Quem lê cardápio ou fichas pela porta de integração (Farol, aplicativo parceiro): avisado SOZINHO quando muda
//     (mig 316); o botão pede para ler de novo, pela MESMA fila que os gatilhos usam.
// O Liame não lê o cardápio (pedidos, clientes, custos e cupons) — não aparece.

export type Tom = 'ok' | 'atencao' | 'problema' | 'neutro';
export type ModoDaLinha = 'automatico' | 'ao_publicar';

export type LinhaIntegracao = {
  chave: string;
  rotulo: string;
  modo: ModoDaLinha;
  tom: Tom;
  frase: string;
  /** Itens com problema (no máximo 5), já com o motivo. */
  detalhes?: string[];
};

export type SituacaoIntegracoes = {
  linhas: LinhaIntegracao[];
  /** Há o que o botão faça (GoGeM ou quem recebe aviso). Só iFood: a janela só mostra a situação. */
  podePublicar: boolean;
  /** Servidor da loja sem a nuvem agora: a tela diz isso, em vez de "nenhuma integração" (V37). */
  semConexao: boolean;
};

/** Escopos de quem lê o cardápio e as fichas pela porta (o aviso da mig 316 depende deles — V51). */
export const ESCOPOS_DO_CARDAPIO = ['catalogo.ler', 'fichas.ler'] as const;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dataHora = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const v = new Date(d);
  return Number.isNaN(v.getTime())
    ? null
    : v.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ── iFood ───────────────────────────────────────────────────────────────────────────────

export type ProblemaIfood = { nome: string | null; situacao: string; resultado: string | null; oQue: 'preco' | 'pausa' };
export type FilaIfood = { aCaminho: number; comProblema: number; problemas: ProblemaIfood[] };

/** O motivo de um envio com problema, como a tela do produto diz ("Último envio ao iFood"). */
export function motivoDoProblema(p: Pick<ProblemaIfood, 'situacao' | 'resultado'>): string {
  if (p.situacao === 'desistiu') return 'não enviado (o iFood não respondeu por 24 h)';
  if (p.resultado === 'nao_encontrado') return 'o código PDV não existe no iFood desta loja';
  if (p.resultado === 'recusado') return 'recusado pelo iFood';
  if (p.resultado === 'parcial') return 'aplicado em parte';
  return 'com problema';
}

export function linhaDoIfood(f: FilaIfood): LinhaIntegracao {
  const base = 'Vai sozinho: preço e pausa chegam ao iFood em segundos, sem precisar publicar.';
  const partes: string[] = [];
  if (f.aCaminho > 0) partes.push(`${plural(f.aCaminho, 'envio a caminho', 'envios a caminho')}.`);
  if (f.comProblema > 0)
    partes.push(`${plural(f.comProblema, 'item com problema', 'itens com problema')} — veja "Último envio ao iFood" no produto.`);
  const tom: Tom = f.comProblema > 0 ? 'problema' : f.aCaminho > 0 ? 'atencao' : 'ok';
  const linha: LinhaIntegracao = {
    chave: 'ifood',
    rotulo: 'iFood',
    modo: 'automatico',
    tom,
    frase: partes.length ? `${base} ${partes.join(' ')}` : `${base} Tudo em dia.`,
  };
  if (f.problemas.length)
    linha.detalhes = f.problemas
      .slice(0, 5)
      .map((p) => `${p.nome ?? 'Item apagado'} (${p.oQue === 'preco' ? 'preço' : 'pausa'}): ${motivoDoProblema(p)}`);
  return linha;
}

// ── GoGeM ───────────────────────────────────────────────────────────────────────────────

export function linhaDoGogem(): LinhaIntegracao {
  return {
    chave: 'gogem',
    rotulo: 'GoGeM (totem)',
    modo: 'ao_publicar',
    tom: 'neutro',
    frase: 'Busca o cardápio sozinho a cada poucos minutos. Publicar manda as mudanças na hora.',
  };
}

/** O resultado do "Publicar" no GoGeM, para a linha. */
export function linhaDoGogemPublicado(r: { ok: true; alterados?: number } | { erro: string }): LinhaIntegracao {
  if ('erro' in r) return { ...linhaDoGogem(), tom: 'problema', frase: r.erro };
  const frase =
    r.alterados == null
      ? 'Publicado: o GoGeM recebeu o pedido e atualiza o totem agora.'
      : r.alterados === 0
        ? 'Publicado: o totem já estava em dia.'
        : `Publicado: ${plural(r.alterados, 'produto atualizado', 'produtos atualizados')} no totem.`;
  return { ...linhaDoGogem(), tom: 'ok', frase };
}

// ── Quem lê pela porta (Farol, parceiro) ────────────────────────────────────────────────

export type LeitorDaPorta = {
  cliente: string;
  /** Tem endereço de aviso registrado e não pausado. */
  comAviso: boolean;
  /** Algum registro pausado (falhou por dias, ou o destino disse que a conexão acabou). */
  pausado: boolean;
  ultimoAviso: Date | string | null;
};

export const rotuloDoCliente = (cliente: string): string => CLIENTES_INTEGRACAO[cliente]?.rotulo ?? 'Aplicativo parceiro';

export function linhaDoLeitor(l: LeitorDaPorta, pedido = false): LinhaIntegracao {
  const chave = `porta:${l.cliente}`;
  const rotulo = rotuloDoCliente(l.cliente);
  if (l.pausado && !l.comAviso)
    return {
      chave,
      rotulo,
      modo: 'automatico',
      tom: 'problema',
      frase: 'O aviso está pausado (o endereço deles parou de responder). Peça para refazerem a conexão no Regem.',
    };
  if (!l.comAviso)
    return { chave, rotulo, modo: 'automatico', tom: 'neutro', frase: 'Lê o cardápio direto do Regem quando precisa: não há o que enviar.' };
  if (pedido)
    return {
      chave,
      rotulo,
      modo: 'automatico',
      tom: 'ok',
      frase: 'Pedido para ler de novo enviado: o aviso sai em até 1 minuto.',
    };
  const ultimo = dataHora(l.ultimoAviso);
  return {
    chave,
    rotulo,
    modo: 'automatico',
    tom: 'ok',
    frase: `Avisado sozinho quando o cardápio ou as fichas mudam (em até 1 minuto).${ultimo ? ` Último aviso: ${ultimo}.` : ''}`,
  };
}

/** A fonte que não deu para ler agora (a tela separa "não tem" de "não li" — V37). */
export const linhaNaoLida = (chave: string, rotulo: string): LinhaIntegracao => ({
  chave,
  rotulo,
  modo: 'automatico',
  tom: 'problema',
  frase: 'Não deu para ler a situação agora. Tente de novo em instantes.',
});

/** A ordem das linhas: iFood, GoGeM, depois quem lê pela porta (por nome). */
export function ordenarLinhas(linhas: LinhaIntegracao[]): LinhaIntegracao[] {
  const peso = (l: LinhaIntegracao) => (l.chave === 'ifood' ? 0 : l.chave.startsWith('gogem') ? 1 : 2);
  return [...linhas].sort((a, b) => peso(a) - peso(b) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'));
}

/** O botão faz algo: GoGeM ligado, ou alguém recebe aviso pela porta. */
export const podePublicar = (linhas: LinhaIntegracao[], leitores: LeitorDaPorta[]): boolean =>
  linhas.some((l) => l.chave === 'gogem') || leitores.some((l) => l.comAviso);

/** O resumo do "Publicar" para o aviso da tela (uma frase). */
export function resumoDoPublicar(linhas: LinhaIntegracao[]): string {
  const falhas = linhas.filter((l) => l.tom === 'problema' && l.modo === 'ao_publicar');
  if (falhas.length) return `Publicado, menos em: ${falhas.map((l) => l.rotulo).join(', ')}.`;
  return 'Publicado nas integrações.';
}
