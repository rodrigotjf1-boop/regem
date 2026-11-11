// A ROTA DA COZINHA (auditoria do KDS de 11/11/2026, onda 2 — R3, R7, R9, R11; mig 410; protótipo aprovado,
// `mockups/regem-kds-cozinha.html`, aba 2). Regras puras (sem banco): a ordem das etapas de uma loja, montada pelo "vai
// para" de cada KDS quando a loja ainda não salvou uma, e a conferência do que a tela manda salvar.
//
// • Etapa = uma coluna da rota: um ou mais KDS (mais de um = preparo em paralelo), com um nome opcional.
// • Quem move o cartão é o "vai para" de cada KDS (`equipamento.proximo_kds_id`): ele só pode apontar para um KDS de uma
//   etapa DEPOIS da dele — assim a rota nunca fica em círculo. O KDS de DESPACHO só fica na última etapa e não manda o
//   pedido a ninguém. A TV de senhas e a tela de entrega não são etapa (não entram aqui).
// • KDS ligado que não está em etapa nenhuma = "fora da rota": termina nele mesmo, com os produtos dele.

export type EtapaDaRota = { nome: string; kds: string[] };
export type KdsDaRota = { id: string; escopo: string | null; ativo: boolean; proximoKdsId: string | null };
export const NOME_DA_ETAPA_MAX = 40;
export const ETAPAS_MAX = 12;

const ehDespacho = (k: KdsDaRota | undefined) => k?.escopo === 'despacho';

/**
 * A chave da loja na rota guardada (`kds_cor_config.rota` da linha da EMPRESA: {"<id da loja>": [etapas]}). Empresa sem loja
 * nenhuma: "empresa".
 */
export const chaveDaRota = (loja: string | null | undefined) => loja || 'empresa';

/**
 * A ordem montada pelo "vai para" (a loja que ainda não salvou a rota): cada KDS ligado fica na etapa da maior distância
 * desde o começo da corrente; o KDS que ninguém manda e que não manda a ninguém fica na primeira; o despacho, na última.
 */
export function rotaPeloVaiPara(kds: KdsDaRota[]): EtapaDaRota[] {
  const ligados = kds.filter((k) => k.ativo);
  const ids = new Set(ligados.map((k) => k.id));
  const nivel = new Map<string, number>();
  const visitar = (id: string, n: number, caminho: Set<string>) => {
    if (caminho.has(id)) return; // círculo antigo: para (a conferência do salvar recusa círculo)
    if ((nivel.get(id) ?? -1) >= n) return;
    nivel.set(id, n);
    const k = ligados.find((x) => x.id === id);
    const prox = k?.proximoKdsId;
    if (prox && ids.has(prox)) visitar(prox, n + 1, new Set([...caminho, id]));
  };
  const recebem = new Set(ligados.map((k) => k.proximoKdsId).filter((x): x is string => !!x && ids.has(x)));
  for (const k of ligados) if (!recebem.has(k.id)) visitar(k.id, 0, new Set());
  for (const k of ligados) if (!nivel.has(k.id)) visitar(k.id, 0, new Set()); // sobrou só círculo
  const ultimo = Math.max(0, ...[...nivel.values()]);
  const despachos = ligados.filter(ehDespacho);
  const fim = despachos.length && ligados.some((k) => !ehDespacho(k)) ? Math.max(ultimo, 1) : ultimo;
  const etapas: EtapaDaRota[] = Array.from({ length: fim + 1 }, () => ({ nome: '', kds: [] }));
  for (const k of ligados) etapas[ehDespacho(k) ? fim : Math.min(nivel.get(k.id) ?? 0, fim)].kds.push(k.id);
  return etapas.filter((e) => e.kds.length);
}

/**
 * A rota salva da loja, limpa: só KDS que existem (ligados ou desligados — o desligado aparece pulado no meio), sem
 * repetir, sem etapa vazia, nome aparado. Sem rota salva (ou nada sobrando dela), a ordem pelo "vai para".
 */
export function rotaDaLoja(salva: unknown, kds: KdsDaRota[]): EtapaDaRota[] {
  const existe = new Set(kds.map((k) => k.id));
  if (!Array.isArray(salva)) return rotaPeloVaiPara(kds);
  const vistos = new Set<string>();
  const etapas: EtapaDaRota[] = [];
  for (const e of salva) {
    const lista = Array.isArray((e as any)?.kds) ? (e as any).kds.map(String) : [];
    const ok = lista.filter((id: string) => existe.has(id) && !vistos.has(id));
    ok.forEach((id: string) => vistos.add(id));
    if (ok.length) etapas.push({ nome: String((e as any)?.nome ?? '').trim().slice(0, NOME_DA_ETAPA_MAX), kds: ok });
  }
  return etapas.length ? etapas : rotaPeloVaiPara(kds);
}

/**
 * Confere a rota que a tela manda salvar e o "vai para" de cada KDS. Devolve os motivos da recusa (vazio = vale), com o
 * nome do KDS — a tela mostra a mesma lista antes de salvar.
 */
export function conferirRota(
  etapas: unknown,
  vai: unknown,
  kds: KdsDaRota[],
  nomeDe: (id: string) => string,
): { motivos: string[]; etapas: EtapaDaRota[]; vai: Record<string, string | null> } {
  const motivos: string[] = [];
  const porId = new Map(kds.map((k) => [k.id, k]));
  const lista: EtapaDaRota[] = [];
  if (!Array.isArray(etapas) || !etapas.length) motivos.push('A rota precisa de pelo menos um KDS.');
  else if (etapas.length > ETAPAS_MAX) motivos.push(`A rota tem no máximo ${ETAPAS_MAX} etapas.`);
  const onde = new Map<string, number>();
  (Array.isArray(etapas) ? etapas : []).forEach((e: any, i: number) => {
    const nome = String(e?.nome ?? '').trim();
    if (nome.length > NOME_DA_ETAPA_MAX) motivos.push(`O nome da etapa ${i + 1} passa de ${NOME_DA_ETAPA_MAX} letras.`);
    const ids = Array.isArray(e?.kds) ? e.kds.map(String) : [];
    if (!ids.length) motivos.push(`A etapa ${i + 1} está vazia.`);
    for (const id of ids) {
      if (!porId.has(id)) motivos.push('Algum KDS da rota não é desta loja ou foi excluído. Abra a rota de novo.');
      else if (onde.has(id)) motivos.push(`O ${nomeDe(id)} está em duas etapas.`);
      else onde.set(id, i);
    }
    lista.push({ nome: nome.slice(0, NOME_DA_ETAPA_MAX), kds: ids });
  });
  const ultima = lista.length - 1;
  for (const [id, i] of onde) {
    if (ehDespacho(porId.get(id)) && i !== ultima)
      motivos.push(`O ${nomeDe(id)} é o despacho e só pode ficar na última etapa: hoje está na etapa ${i + 1} de ${lista.length}.`);
  }
  // O "vai para" de cada KDS: só para um KDS de uma etapa DEPOIS da dele; o despacho e o que está fora da rota terminam.
  const v: Record<string, string | null> = {};
  const pedido = vai && typeof vai === 'object' && !Array.isArray(vai) ? (vai as Record<string, unknown>) : {};
  for (const k of kds) {
    const alvo = pedido[k.id] === undefined ? null : pedido[k.id] === null || pedido[k.id] === '' ? null : String(pedido[k.id]);
    const i = onde.get(k.id);
    // O KDS desligado fora da rota não entra na edição (a tela não o mostra): o "vai para" dele fica como está (V16).
    if (i === undefined && !k.ativo) {
      v[k.id] = k.proximoKdsId ?? null;
      continue;
    }
    if (alvo === null) {
      v[k.id] = null;
      continue;
    }
    if (i === undefined) motivos.push(`O ${nomeDe(k.id)} está fora da rota: ele termina nele mesmo.`);
    else if (ehDespacho(k)) motivos.push(`O ${nomeDe(k.id)} é o despacho: ele não manda o pedido para outro KDS.`);
    else if (!porId.has(alvo)) motivos.push(`O "vai para" do ${nomeDe(k.id)} não é um KDS desta loja.`);
    else if ((onde.get(alvo) ?? -1) <= i)
      motivos.push(`O ${nomeDe(k.id)} só pode mandar o pedido para um KDS de uma etapa depois da dele (escolheu o ${nomeDe(alvo)}).`);
    v[k.id] = alvo;
  }
  return { motivos: [...new Set(motivos)], etapas: lista, vai: v };
}
