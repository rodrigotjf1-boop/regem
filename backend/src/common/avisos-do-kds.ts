// OS AVISOS QUE CADA KDS RECEBE (auditoria do KDS de 11/11/2026, onda 2 — A13; protótipo aprovado pelo dono,
// `mockups/regem-kds-cozinha.html`, aba 3). Um tipo por origem do aviso; cada tela de KDS liga e desliga os seus, e a
// escolha fica no servidor (`kds_tela_ajuste.avisos`, mig 408) — vale para qualquer aparelho que opere aquele KDS.
//
// • "Pedido cancelado" e "Pedido alterado" não desligam: a cozinha precisa saber para não fazer (ficam fora daqui).
// • Decisão do dono (a recomendada): os AVISOS DE GESTÃO (compra recebida, contagem, fechamento do ponto) nascem
//   desligados nas telas de PREPARO e ligados no despacho; o "Cliente chegou" também é do despacho e do balcão.
// • Loja com um KDS só (nenhum KDS cadastrado, o caso mais comum): a tela é de preparo e de entrega ao mesmo tempo — sem
//   os de gestão, com o resto.
// A tela (`frontend/src/lib/kds-fila.ts`) tem a MESMA regra; o check:kds compara as duas.

export const TIPOS_DE_AVISO = ['loja', 'farol', 'pausa', 'estoque', 'chegou', 'gestao'] as const;
export type TipoDeAviso = (typeof TIPOS_DE_AVISO)[number];
export type AvisosDoKds = Record<TipoDeAviso, boolean>;

export const ehTipoDeAviso = (t: unknown): t is TipoDeAviso => (TIPOS_DE_AVISO as readonly string[]).includes(t as string);

/** O padrão de cada tipo de tela: `escopo` do KDS ('producao', 'despacho', 'entrega', 'avisos'); sem KDS = loja de um KDS só. */
export function avisosPadrao(escopo: string | null | undefined): AvisosDoKds {
  const tudo: AvisosDoKds = { loja: true, farol: true, pausa: true, estoque: true, chegou: true, gestao: true };
  if (escopo == null || escopo === '') return { ...tudo, gestao: false };
  if (escopo === 'producao') return { ...tudo, gestao: false, chegou: false };
  return tudo;
}

/** O que a tela recebe: o salvo (só os tipos conhecidos, só verdadeiro/falso) por cima do padrão do tipo de tela. */
export function avisosDoKds(escopo: string | null | undefined, salvo: unknown): AvisosDoKds {
  const r = avisosPadrao(escopo);
  if (salvo && typeof salvo === 'object' && !Array.isArray(salvo)) {
    for (const t of TIPOS_DE_AVISO) {
      const v = (salvo as Record<string, unknown>)[t];
      if (v === true || v === false) r[t] = v;
    }
  }
  return r;
}

/**
 * O que veio da tela para salvar: um verdadeiro/falso para cada tipo (V15 — nada de `!!`); tipo desconhecido ou valor que
 * não é verdadeiro/falso recusa com o motivo. Tipo ausente fica como está (V16).
 */
export function lerAvisosDoKds(dto: unknown): { ok: true; avisos: Partial<AvisosDoKds> } | { ok: false; erro: string } {
  const corpo = (dto as any)?.avisos;
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, erro: 'Mande os avisos desta tela.' };
  const avisos: Partial<AvisosDoKds> = {};
  for (const [k, v] of Object.entries(corpo)) {
    if (k === 'cancelado' || k === 'alterado') return { ok: false, erro: 'Cancelado e alterado não desligam: a cozinha precisa saber.' };
    if (!ehTipoDeAviso(k)) return { ok: false, erro: `Aviso desconhecido: ${k}.` };
    if (v !== true && v !== false) return { ok: false, erro: `O aviso "${k}" precisa ser ligado ou desligado.` };
    avisos[k] = v;
  }
  return { ok: true, avisos };
}
