import { createHash, randomBytes } from 'node:crypto';

// O BILHETE DE UMA LEITURA (Mister, versão 10, fase C3 — "ler qualquer tela"; `docs/plano-mister.md` § "C3").
//
// Para o Mister ler uma tela do Regem "como se a pessoa abrisse a tela", ele chama a PRÓPRIA API por dentro do servidor
// (127.0.0.1), com este bilhete no cabeçalho `x-regem-bilhete`. O `JwtAuthGuard` troca o bilhete pela pessoa, lida no
// banco NA HORA, e daí em diante valem as mesmas travas da tela: o perfil (`@Roles`), as permissões (`@RequirePerm`), os
// módulos ligados, a loja (`@UnidadeAtual`) e o filtro da empresa em toda consulta.
//
//  • O bilhete vale UMA chamada, por 30 segundos, para UM caminho exato (com a consulta) e UM método — GET na leitura (C3); na
//    tarefa (C4), POST/PUT/PATCH com o resumo do corpo EXATO que o Mister mandou. O primeiro uso o gasta, dê certo ou não. São
//    32 bytes aleatórios: não se adivinha, e só existe na memória deste processo.
//  • Não é sessão nem token: não abre o tempo real, não entra em "Sair", não serve em outro servidor. No servidor da loja
//    (onde o Mister não roda) a lista fica vazia, e quem mandar o cabeçalho recebe 401.
//  • O limite de chamadas conta o bilhete pela empresa (`mister:<empresa>`), não pelo IP 127.0.0.1 que todas dividiriam.

export const CABECALHO_DO_BILHETE = 'x-regem-bilhete';
export const VALIDADE_DO_BILHETE_MS = 30_000;
/** Bilhetes vivos ao mesmo tempo, somadas todas as empresas (cada um dura no máximo 30 s). */
export const BILHETES_NO_MAXIMO = 5_000;

export interface Bilhete {
  tenantId: string;
  colaboradorId: string;
  /** O caminho exato que o bilhete abre, como a requisição chega (`/api/v1/estoque/itens?x=1`). */
  caminho: string;
  /**
   * C4 (fazer uma tarefa): o método que o bilhete abre (sem ele, GET) e o resumo (sha-256) do corpo EXATO que o Mister mandou —
   * a escrita só passa com o mesmo método, o mesmo caminho e o mesmo corpo.
   */
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  corpoHash?: string | null;
  vence: number;
}

/** O resumo do corpo como o guarda o vê (o JSON do objeto que a API recebeu — o mesmo texto que o Mister mandou). */
export const resumoDoCorpo = (corpo: unknown): string => createHash('sha256').update(JSON.stringify(corpo ?? {})).digest('hex');

const bilhetes = new Map<string, Bilhete>();
const FORMATO = /^[0-9a-f]{64}$/;

function limparVencidos(agora: number): void {
  for (const [id, b] of bilhetes) if (b.vence <= agora) bilhetes.delete(id);
}

/** Emite o bilhete de uma leitura. Lança se houver bilhetes demais vivos (quem chama responde "não consegui ler agora"). */
export function emitirBilhete(b: Omit<Bilhete, 'vence'>, agora = Date.now()): string {
  if (bilhetes.size >= 100) limparVencidos(agora);
  if (bilhetes.size >= BILHETES_NO_MAXIMO) throw new Error('bilhetes_demais');
  const id = randomBytes(32).toString('hex');
  bilhetes.set(id, {
    tenantId: b.tenantId,
    colaboradorId: b.colaboradorId,
    caminho: b.caminho,
    metodo: b.metodo ?? 'GET',
    corpoHash: b.metodo && b.metodo !== 'GET' ? (b.corpoHash ?? null) : null,
    vence: agora + VALIDADE_DO_BILHETE_MS,
  });
  return id;
}

/** O valor do cabeçalho, se veio (o primeiro, se vier repetido). */
export function cabecalhoDoBilhete(req: { headers?: Record<string, unknown> } | undefined): string | undefined {
  const h = req?.headers?.[CABECALHO_DO_BILHETE];
  const v = Array.isArray(h) ? h[0] : h;
  return v === undefined ? undefined : String(v);
}

/** O bilhete vivo, SEM gastar (o limite de chamadas, que roda antes do guarda, usa para escolher o balde). */
export function espiarBilhete(id: unknown, agora = Date.now()): Bilhete | null {
  if (typeof id !== 'string' || !FORMATO.test(id)) return null;
  const b = bilhetes.get(id);
  if (!b) return null;
  if (b.vence <= agora) {
    bilhetes.delete(id);
    return null;
  }
  return b;
}

/**
 * Gasta o bilhete (sempre, dê certo ou não) e o devolve só se o método e o caminho são exatamente os dele — e, na escrita (C4),
 * o corpo que chegou tem o mesmo resumo do que o Mister mandou.
 */
export function consumirBilhete(id: unknown, metodo: unknown, caminho: unknown, agora = Date.now(), corpo?: unknown): Bilhete | null {
  const b = espiarBilhete(id, agora);
  if (!b) return null;
  bilhetes.delete(id as string);
  const esperado = b.metodo ?? 'GET';
  if (String(metodo ?? '').toUpperCase() !== esperado || String(caminho ?? '') !== b.caminho) return null;
  if (esperado !== 'GET' && (!b.corpoHash || resumoDoCorpo(corpo) !== b.corpoHash)) return null;
  return b;
}

/** Só para os testes. */
export function bilhetesVivos(): number {
  return bilhetes.size;
}
