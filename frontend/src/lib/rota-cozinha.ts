// A ROTA DA COZINHA — as regras da tela (Configurações › Rota da cozinha; onda 2 da auditoria do KDS, mig 410; protótipo
// aprovado `mockups/regem-kds-cozinha.html`, aba 2). Puras (sem React nem API): o `npm run check:rota-cozinha` as confere
// e prova que toda edição que a tela aceita passa na conferência do servidor (`backend/src/common/rota-kds.ts`).
//
// • As etapas (colunas) são a ORDEM da rota: numeradas pela posição, nome opcional. Dois KDS na mesma etapa = paralelo.
// • Quem move o cartão é o "vai para" de cada KDS: ele só aponta para um KDS de uma etapa DEPOIS da dele. Depois de cada
//   mudança, o que ficou para trás volta ao primeiro KDS da etapa seguinte; na última etapa, termina ali. Nada em círculo.
// • O despacho fica sempre na última etapa e não manda a ninguém. A TV de senhas não é etapa: fica sempre no fim.

export type KdsDaRota = {
  id: string;
  nome: string;
  escopo: string | null;
  ativo: boolean;
  proximoKdsId: string | null;
  unidadeId?: string | null;
  imprimeAoAvancar?: boolean;
  imprimeNoStatus?: string | null;
  impressoraDestinoId?: string | null;
  impressora?: string | null;
  produtos?: number;
};
export type Etapa = { nome: string; kds: string[] };
export type Rota = {
  loja: string | null;
  etapas: Etapa[];
  kds: KdsDaRota[];
  tvs: { id: string; nome: string }[];
  estacoes: boolean;
  padrao: { id: string; nome: string } | null;
  duplicados: { produto: string; kds: string[] }[];
  editavel: boolean;
  motivo: string | null;
};
/** A ordem sendo editada: as etapas, o "vai para" de cada KDS, quem a pessoa marcou "termina aqui" e os ligados fora. */
export type Edicao = { etapas: Etapa[]; vai: Record<string, string | null>; termina: Record<string, boolean>; fora: string[] };
export type Movimento = { tipo: 'antes' } | { tipo: 'depois' } | { tipo: 'junto'; etapa: number } | { tipo: 'nova'; pos: number };

export const NOME_DA_ETAPA_MAX = 40; // o mesmo do servidor
export const ETAPAS_MAX = 12; // o mesmo do servidor

/** Quando o KDS imprime ao avançar, em palavras (`imprime_no_status`). */
export const IMPRIME_QUANDO: Record<string, string> = {
  recebido: 'ao receber o pedido',
  preparo: 'ao iniciar (em preparo)',
  pronto: 'ao ficar pronto',
  entregue: 'ao despachar',
};

export const ehDespacho = (k: KdsDaRota | undefined) => k?.escopo === 'despacho';
export const nomeDaEtapa = (e: Etapa, i: number) => e.nome.trim() || `Etapa ${i + 1}`;
export const naRota = (etapas: Etapa[], id: string) => etapas.some((e) => e.kds.includes(id));
export const idxDe = (etapas: Etapa[], id: string) => etapas.findIndex((e) => e.kds.includes(id));
const copia = (ed: Edicao): Edicao => ({
  etapas: ed.etapas.map((e) => ({ nome: e.nome, kds: [...e.kds] })),
  vai: { ...ed.vai },
  termina: { ...ed.termina },
  fora: [...ed.fora],
});
const porId = (kds: KdsDaRota[]) => new Map(kds.map((k) => [k.id, k]));

/**
 * O próximo KDS de verdade (a mesma regra do servidor, `common/fluxo-kds.ts` › `proximoEfetivo`): segue o "vai para"
 * pulando o desligado; o que não está na lista (a tela de entrega, um KDS de outra loja) vale como "termina aqui".
 */
export function proximoDeVerdade(kds: KdsDaRota[], id: string): string | null {
  const m = porId(kds);
  const vistos = new Set([id]);
  let atual = m.get(id)?.proximoKdsId ?? null;
  while (atual && !vistos.has(atual)) {
    vistos.add(atual);
    const k = m.get(atual);
    if (!k) return null;
    if (k.ativo) return atual;
    atual = k.proximoKdsId ?? null;
  }
  return null;
}

/** Os KDS ligados que mandam o pedido para `id` (pela corrente de verdade). */
export const recebeDe = (kds: KdsDaRota[], id: string) => kds.filter((k) => k.id !== id && k.ativo && proximoDeVerdade(kds, k.id) === id);

/** Começa a edição a partir da rota salva: o "vai para" de cada KDS e quem já termina antes da última etapa. */
export function iniciarEdicao(rota: Pick<Rota, 'etapas' | 'kds'>): Edicao {
  const ed: Edicao = { etapas: rota.etapas.map((e) => ({ nome: e.nome, kds: [...e.kds] })), vai: {}, termina: {}, fora: [] };
  for (const k of rota.kds) {
    ed.vai[k.id] = k.proximoKdsId ?? null;
    const i = idxDe(ed.etapas, k.id);
    if (i < 0 && k.ativo) ed.fora.push(k.id);
    if (i >= 0 && !k.proximoKdsId && !ehDespacho(k) && i < ed.etapas.length - 1) ed.termina[k.id] = true;
  }
  return ajustarVai(ed, rota.kds);
}

/**
 * Depois de cada mudança: o "vai para" de cada KDS aponta para uma etapa DEPOIS da dele (o que ficou para trás, ou na
 * mesma etapa, volta ao primeiro KDS da etapa seguinte); quem a pessoa marcou "termina aqui" continua terminando; na
 * última etapa, termina aqui. O despacho e os de fora da rota terminam. O desligado fora da rota não entra.
 */
export function ajustarVai(ed: Edicao, kds: KdsDaRota[]): Edicao {
  const m = porId(kds);
  ed.etapas.forEach((e, i) =>
    e.kds.forEach((id) => {
      if (ehDespacho(m.get(id))) {
        ed.vai[id] = null;
        return;
      }
      const alvo = ed.vai[id] ?? null;
      const ia = alvo ? idxDe(ed.etapas, alvo) : -1;
      if (alvo && ia > i) return;
      if (!alvo && ed.termina[id]) return;
      ed.vai[id] = i < ed.etapas.length - 1 ? ed.etapas[i + 1].kds[0] : null;
    }),
  );
  for (const id of ed.fora) ed.vai[id] = null;
  return ed;
}

const tirarDe = (ed: Edicao, id: string) => ed.etapas.forEach((e) => (e.kds = e.kds.filter((x) => x !== id)));
const limpar = (ed: Edicao) => (ed.etapas = ed.etapas.filter((e) => e.kds.length));

/** Move um KDS: para antes ou depois (troca de etapa com a vizinha, ou abre uma etapa só dele), junto de outra etapa, ou numa etapa nova. */
export function mover(ed0: Edicao, id: string, mov: Movimento, kds: KdsDaRota[]): Edicao {
  const ed = copia(ed0);
  const i = idxDe(ed.etapas, id);
  if (i < 0) return ed0;
  if (mov.tipo === 'junto') {
    const et = ed.etapas[mov.etapa];
    if (!et || et.kds.includes(id)) return ed0;
    tirarDe(ed, id);
    et.kds.push(id);
  } else if (mov.tipo === 'nova') {
    const nova: Etapa = { nome: '', kds: [] };
    ed.etapas.splice(Math.max(0, Math.min(mov.pos, ed.etapas.length)), 0, nova);
    tirarDe(ed, id);
    nova.kds.push(id);
  } else {
    const antes = mov.tipo === 'antes';
    if (ed.etapas[i].kds.length > 1) return mover(ed0, id, { tipo: 'nova', pos: antes ? i : i + 1 }, kds);
    const j = antes ? i - 1 : i + 1;
    if (j < 0 || j >= ed.etapas.length) return ed0;
    [ed.etapas[i], ed.etapas[j]] = [ed.etapas[j], ed.etapas[i]];
  }
  limpar(ed);
  return ajustarVai(ed, kds);
}

/** Tira o KDS da rota: ele passa a terminar nele mesmo, com os produtos dele. */
export function tirar(ed0: Edicao, id: string, kds: KdsDaRota[]): Edicao {
  const ed = copia(ed0);
  if (idxDe(ed.etapas, id) < 0) return ed0;
  tirarDe(ed, id);
  limpar(ed);
  if (!ed.fora.includes(id)) ed.fora.push(id);
  delete ed.termina[id];
  return ajustarVai(ed, kds);
}

/** Põe na rota um KDS ligado que estava fora: entra na etapa 1 (a pessoa move depois). */
export function incluir(ed0: Edicao, id: string, kds: KdsDaRota[]): Edicao {
  const ed = copia(ed0);
  if (!ed.fora.includes(id)) return ed0;
  ed.fora = ed.fora.filter((x) => x !== id);
  if (!ed.etapas.length) ed.etapas.push({ nome: '', kds: [] });
  ed.etapas[0].kds.push(id);
  delete ed.termina[id];
  ed.vai[id] = null;
  return ajustarVai(ed, kds);
}

/** O "vai para" escolhido na lista do bloco (vazio = termina aqui). */
export function escolherVai(ed0: Edicao, id: string, alvo: string | null, kds: KdsDaRota[]): Edicao {
  const ed = copia(ed0);
  ed.vai[id] = alvo || null;
  if (alvo) delete ed.termina[id];
  else ed.termina[id] = true;
  return ajustarVai(ed, kds);
}

export function renomear(ed0: Edicao, i: number, nome: string): Edicao {
  const ed = copia(ed0);
  if (ed.etapas[i]) ed.etapas[i].nome = nome.trim().slice(0, NOME_DA_ETAPA_MAX);
  return ed;
}

/** O despacho (se está na rota) está na última etapa? */
export function despachoNoFim(ed: Edicao, kds: KdsDaRota[]): boolean {
  const m = porId(kds);
  return ed.etapas.every((e, i) => i === ed.etapas.length - 1 || !e.kds.some((id) => ehDespacho(m.get(id))));
}
/** Mover assim deixa a rota salvável (o despacho continua no fim)? Para marcar onde pode soltar. */
export const valeMover = (ed: Edicao, id: string, mov: Movimento, kds: KdsDaRota[]) => despachoNoFim(mover(ed, id, mov, kds), kds);

/** Os KDS que o bloco pode escolher no "vai para": os de uma etapa depois da dele, com o número da etapa. */
export function opcoesDoVai(ed: Edicao, id: string): { id: string; etapa: number }[] {
  const i = idxDe(ed.etapas, id);
  return ed.etapas.slice(i + 1).flatMap((e, d) => e.kds.map((x) => ({ id: x, etapa: i + 2 + d })));
}

/** O que vai ao servidor: as etapas (nome aparado) e o "vai para" dos KDS que estão na rota. */
export function paraSalvar(ed: Edicao): { etapas: Etapa[]; vai: Record<string, string | null> } {
  const vai: Record<string, string | null> = {};
  for (const e of ed.etapas) for (const id of e.kds) vai[id] = ed.vai[id] ?? null;
  return { etapas: ed.etapas.map((e) => ({ nome: e.nome.trim(), kds: [...e.kds] })), vai };
}

/** O que muda em cada KDS (para o diálogo de salvar) e os motivos que impedem salvar (os mesmos do servidor). */
export function resumoDaEdicao(rota: Pick<Rota, 'etapas' | 'kds'>, ed: Edicao): { linhas: { quem: string; texto: string }[]; motivos: string[] } {
  const m = porId(rota.kds);
  const nome = (id: string) => m.get(id)?.nome ?? 'KDS';
  const motivos: string[] = [];
  if (!ed.etapas.length) motivos.push('A rota precisa de pelo menos um KDS.');
  if (ed.etapas.length > ETAPAS_MAX) motivos.push(`A rota tem no máximo ${ETAPAS_MAX} etapas.`);
  ed.etapas.forEach((e, i) =>
    e.kds.forEach((id) => {
      if (ehDespacho(m.get(id)) && i !== ed.etapas.length - 1)
        motivos.push(`O ${nome(id)} é o despacho e só pode ficar na última etapa: hoje está na etapa ${i + 1} de ${ed.etapas.length}.`);
    }),
  );
  const desc = (k: KdsDaRota, vai: string | null, dentro: boolean) =>
    !dentro ? 'fora da rota (termina nele)' : ehDespacho(k) ? 'termina aqui (despacho)' : vai ? `vai para ${nome(vai)}` : 'termina aqui';
  const linhas: { quem: string; texto: string }[] = [];
  for (const k of rota.kds) {
    const a0 = idxDe(rota.etapas, k.id);
    const a1 = idxDe(ed.etapas, k.id);
    if (a0 < 0 && a1 < 0) continue;
    const antes = desc(k, k.proximoKdsId ?? null, a0 >= 0);
    const depois = desc(k, ed.vai[k.id] ?? null, a1 >= 0);
    if (antes !== depois)
      linhas.push({
        quem: k.nome,
        texto: `${antes} → ${depois}${a1 >= 0 && a0 !== a1 ? ` (etapa ${a1 + 1})` : ''}${a1 < 0 ? '; os produtos continuam nele' : ''}`,
      });
    else if (a0 !== a1) linhas.push({ quem: k.nome, texto: `etapa ${a0 + 1} → etapa ${a1 + 1} (o "vai para" não muda)` });
  }
  const nomes = (et: Etapa[]) => et.map((e, i) => `${i + 1} · ${nomeDaEtapa(e, i)}`).join(', ');
  if (nomes(ed.etapas) !== nomes(rota.etapas)) linhas.push({ quem: 'Etapas', texto: `${nomes(rota.etapas)} → ${nomes(ed.etapas)}` });
  return { linhas, motivos: [...new Set(motivos)] };
}

/** Os passos de um caminho (`passos` = ids dos KDS, na ordem), com o que cada KDS faz ao avançar. */
export function passosDoCaminho(kds: KdsDaRota[], etapas: Etapa[], passos: string[]): { nome: string; detalhe: string; despacho: boolean }[] {
  const m = porId(kds);
  return passos.map((id) => {
    const k = m.get(id);
    if (!k) return { nome: 'KDS', detalhe: 'de fora da lista', despacho: false };
    const detalhe = k.imprimeAoAvancar
      ? `imprime ${IMPRIME_QUANDO[k.imprimeNoStatus ?? 'pronto'] ?? 'ao avançar'}${k.impressora ? ` · ${k.impressora}` : ''}`
      : ehDespacho(k)
        ? 'vê o pedido inteiro'
        : !naRota(etapas, id)
          ? 'fora da rota: termina aqui'
          : 'só avança';
    return { nome: k.nome, detalhe, despacho: ehDespacho(k) };
  });
}
