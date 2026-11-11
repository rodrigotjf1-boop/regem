/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "CONFERIR COM OS APPS" (R3 F4a; mig 405) — as regras puras: o cardápio de cada app no formato do Regem, a comparação pelo
 * código PDV com as situações do protótipo (`mockups/regem-conciliacao-ifood.html`, "Conferir com os apps") e quando ler.
 * Nada aqui fala com banco ou rede: o serviço lê, estas funções decidem.
 */

export const CANAIS_CONFERIDOS = ['ifood', '99food'] as const;
export type CanalConferido = (typeof CANAIS_CONFERIDOS)[number];
export const ehCanalConferido = (v: unknown): v is CanalConferido => v === 'ifood' || v === '99food';

export type TipoConferido = 'item' | 'opcao';
export const ehTipoConferido = (v: unknown): v is TipoConferido => v === 'item' || v === 'opcao';

/** Uma leitura automática por dia, no máximo (regra do protótipo: nada de leitura de minuto em minuto). */
export const LEITURA_AUTOMATICA_HORAS = 24;
/** A leitura que falhou espera isto antes de a tela tentar sozinha de novo (o botão tenta na hora). */
export const ESPERA_DEPOIS_DO_ERRO_MIN = 15;
/** "Ler agora" logo depois de uma leitura: devolve a que acabou de chegar (dois cliques, duas telas). */
export const LIDO_HA_POUCO_SEG = 30;
/** A vez de quem lê vence nisto (o processo morreu no meio da leitura). */
export const VEZ_DE_LER_VENCE_MIN = 2;

/** Um item ou uma opção do app, já no formato do Regem — o que a leitura guarda (sem foto, sem segredo). */
export type DoApp = {
  /** O id dentro do app: a opção do iFood (id da opção), o item da 99 (`app_item_id`); item do iFood: a posição. */
  id: string;
  /** O código PDV no app (`null` = sem código). Na 99 é o `app_item_id`. */
  pdv: string | null;
  nome: string;
  /** A categoria (item) ou os grupos de complemento em que a opção aparece. */
  grupos: string[];
  /** Em reais. A opção da 99 tem um preço por grupo; o item, um só. */
  precos: number[];
  /** iFood: o "de" da promoção de/por (o preço é o "por"). */
  promoDe: number | null;
  pausado: boolean;
  /** A foto no app (R3 F6): `imagem` no Orzuni, `head_img` na 99; `null` = sem foto lá; ausente = leitura de antes da F6. */
  imagem?: string | null;
};
export type LeituraDoApp = { itens: DoApp[]; opcoes: DoApp[] };
const foto = (v: unknown): string | null => {
  const s = texto(v);
  return /^https?:\/\//i.test(s) ? s : null;
};

/** O lado do Regem: o produto (item) ou a opção, com o preço daquele app. */
export type DoRegem = {
  id: string;
  nome: string;
  codigo: string | null;
  /** O preço do app no Regem (`preco_ifood` / `preco_99`); `null` = em branco (o Regem não mexe no preço de lá). */
  preco: number | null;
  /** "Está no iFood" / "Está na 99" (só o produto; a opção não tem). */
  marcado: boolean;
  ativo: boolean;
};

export type Situacao = 'soApp' | 'soRegem' | 'preco' | 'naoLiga' | 'igual' | 'ignorada';
export type Motivo =
  | 'semCodigo'
  | 'repetidoNoApp'
  | 'repetidoNoRegem'
  | 'semCodigoNoRegem'
  | 'semPrecoNoRegem'
  | 'precoDiferente'
  | 'precosDiferentesNosGrupos'
  | null;

export type Linha = {
  /** A chave do "Ignorar" (estável entre leituras): `pdv:<código>`, `pdv:<código>|<nome>`, `app:<id>`, `nome:<nome>` ou `regem:<id>`. */
  chave: string;
  tipo: TipoConferido;
  /** O nome no app (ou no Regem, na linha "só no Regem"). */
  nome: string;
  pdv: string | null;
  grupos: string[];
  /** Os preços distintos no app, em reais (vazio na linha "só no Regem"). */
  precos: number[];
  promoDe: number | null;
  /** Pausado no app (`null` na linha "só no Regem"). */
  pausado: boolean | null;
  /** A foto no app (R3 F6); `null` = sem foto lá; ausente = leitura de antes da F6 ou linha "só no Regem". */
  imagem?: string | null;
  regem: { id: string; nome: string; preco: number | null; ativo: boolean } | null;
  /** Na 99, o item sem código liga pelo id do produto (o "Exportar catálogo" manda o id quando falta o código). */
  ligaPeloId: boolean;
  situacao: Situacao;
  /** O porquê da situação, quando não é "igual" (a tela escreve a frase). Linha ignorada guarda o motivo de antes. */
  motivo: Motivo;
  /** Os outros nomes com o mesmo código (código repetido). */
  outros: string[];
};

// ── ler os apps ─────────────────────────────────────────────────────────────────────────────────────────────

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const codigoDe = (v: unknown): string | null => {
  const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : texto(v);
  return s ? s : null;
};
const numero = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const duasCasas = (n: number) => Math.round(n * 100) / 100;
const centavos = (n: number) => Math.round(n * 100);

/** Para comparar nomes: sem acento, sem caixa, espaços juntados. */
export function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const pausadoNoIfood = (s: unknown) => s === 'pausado' || s === 'UNAVAILABLE';

/**
 * O cardápio do iFood pelo Orzuni (`cardapio_listar` → `{ itens }`; `complementos_listar` → `{ grupos }`, contrato em
 * `Orzuni/docs/porta-mcp.md`, "Saída das leituras"). A MESMA opção (mesmo código e mesmo nome) em vários grupos vira uma
 * linha só, com os grupos e os preços dela — no iFood o preço do complemento é um por código (R2b). `null` = a resposta não
 * tem a lista (o serviço trata como falha da leitura).
 */
export function leituraDoIfood(cardapio: unknown, complementos: unknown): LeituraDoApp | null {
  const brutos = (cardapio as any)?.itens;
  const grupos = (complementos as any)?.grupos;
  if (!Array.isArray(brutos) || !Array.isArray(grupos)) return null;
  const itens: DoApp[] = brutos.map((it: any, i: number) => {
    const preco = numero(it?.preco);
    const de = numero(it?.promo?.de);
    const categoria = texto(it?.categoria);
    return {
      id: `i${numero(it?.ordem) ?? i}`,
      pdv: codigoDe(it?.pdv),
      nome: texto(it?.nome) || 'Sem nome',
      grupos: categoria ? [categoria] : [],
      precos: preco == null ? [] : [duasCasas(preco)],
      promoDe: de == null ? null : duasCasas(de),
      pausado: pausadoNoIfood(it?.status),
      imagem: foto(it?.imagem),
    };
  });
  const porChave = new Map<string, DoApp>();
  for (const g of grupos) {
    const grupo = texto(g?.nome);
    for (const o of Array.isArray(g?.opcoes) ? g.opcoes : []) {
      const pdv = codigoDe(o?.pdv);
      const nome = texto(o?.nome) || 'Sem nome';
      const id = codigoDe(o?.id) ?? `${grupo}|${nome}`;
      const chave = pdv ? `${pdv}\u0000${normalizar(nome)}` : `id\u0000${id}`;
      const preco = numero(o?.preco);
      const ja = porChave.get(chave);
      if (ja) {
        if (grupo && !ja.grupos.includes(grupo)) ja.grupos.push(grupo);
        if (preco != null) ja.precos.push(duasCasas(preco));
        ja.pausado = ja.pausado || pausadoNoIfood(o?.status);
        ja.imagem = ja.imagem ?? foto(o?.imagem);
        continue;
      }
      porChave.set(chave, {
        id,
        pdv,
        nome,
        grupos: grupo ? [grupo] : [],
        precos: preco == null ? [] : [duasCasas(preco)],
        promoDe: null,
        pausado: pausadoNoIfood(o?.status),
        imagem: foto(o?.imagem),
      });
    }
  }
  return { itens, opcoes: [...porChave.values()] };
}

/**
 * O cardápio da 99 (doc 1961 `GET /v3/item/item/list`, o `data`): preços em CENTAVOS; `status` 1 = disponível, 2 =
 * indisponível. Na 99 o complemento é um item (com "vende separado" falso) que entra nos grupos com um preço por grupo
 * (`modifier_groups[].app_mg_items`): vira OPÇÃO, com cada grupo e o preço dela ali. O item vendido sozinho
 * (`is_sold_separately` verdadeiro, ou ausente) é ITEM — e se ele também está num grupo, aparece nas duas listas (no
 * Regem são o produto e a opção, cada um com o seu código). O item fora de qualquer grupo e que não se vende sozinho fica
 * nas opções sem grupo.
 */
export function leituraDa99(data: unknown): LeituraDoApp | null {
  const d = data as any;
  if (!Array.isArray(d?.items)) return null;
  const categoria = new Map<string, string>();
  for (const c of Array.isArray(d?.categories) ? d.categories : []) {
    const nome = texto(c?.category_name);
    for (const id of Array.isArray(c?.app_item_ids) ? c.app_item_ids : []) {
      const k = codigoDe(id);
      if (k && nome && !categoria.has(k)) categoria.set(k, nome);
    }
  }
  const emGrupos = new Map<string, { grupos: string[]; precos: number[] }>();
  for (const g of Array.isArray(d?.modifier_groups) ? d.modifier_groups : []) {
    const grupo = texto(g?.modifier_group_name);
    for (const mi of Array.isArray(g?.app_mg_items) ? g.app_mg_items : []) {
      const k = codigoDe(mi?.app_item_id);
      if (!k) continue;
      const e = emGrupos.get(k) ?? { grupos: [], precos: [] };
      if (grupo && !e.grupos.includes(grupo)) e.grupos.push(grupo);
      const p = numero(mi?.price);
      if (p != null) e.precos.push(duasCasas(p / 100));
      emGrupos.set(k, e);
    }
  }
  const itens: DoApp[] = [];
  const opcoes: DoApp[] = [];
  for (const it of d.items as any[]) {
    const id = codigoDe(it?.app_item_id);
    if (!id) continue;
    const preco = numero(it?.price);
    const base = {
      id,
      pdv: id,
      nome: texto(it?.item_name) || 'Sem nome',
      promoDe: null,
      pausado: numero(it?.status) === 2,
      imagem: foto(it?.head_img),
    };
    const sozinho = it?.is_sold_separately !== false;
    if (sozinho) {
      const cat = categoria.get(id);
      itens.push({ ...base, grupos: cat ? [cat] : [], precos: preco == null ? [] : [duasCasas(preco / 100)] });
    }
    const g = emGrupos.get(id);
    if (g) opcoes.push({ ...base, grupos: g.grupos, precos: g.precos.length ? g.precos : preco == null ? [] : [duasCasas(preco / 100)] });
    else if (!sozinho) opcoes.push({ ...base, grupos: [], precos: preco == null ? [] : [duasCasas(preco / 100)] });
  }
  return { itens, opcoes };
}

// ── comparar ────────────────────────────────────────────────────────────────────────────────────────────────

const ORDEM: Record<Situacao, number> = { naoLiga: 0, soApp: 1, soRegem: 2, preco: 3, igual: 4, ignorada: 5 };
const distintos = (precos: number[]) => [...new Set(precos.map(centavos))].map((c) => c / 100).sort((a, b) => a - b);

/**
 * Compara o app com o Regem pelo código PDV (o código do produto no Regem = o código do item no app; a opção, pelo
 * `codigo_pdv`). As situações e a ordem de quem vence seguem o protótipo:
 * ignorada > não dá para ligar (sem código, código repetido no app ou no Regem) > só no app > preço diferente > igual;
 * e, só nos itens, "só no Regem" = o produto marcado "Está no <app>" que o app não tem.
 * Na 99, o item cujo `app_item_id` é o id de um produto do Regem (exportado sem código) liga pelo id.
 */
export function comparar(o: {
  canal: CanalConferido;
  tipo: TipoConferido;
  doApp: DoApp[];
  doRegem: DoRegem[];
  ignorados: ReadonlySet<string>;
}): Linha[] {
  const { canal, tipo } = o;
  const porCodigo = new Map<string, DoRegem[]>();
  const porId = new Map<string, DoRegem>();
  for (const r of o.doRegem) {
    porId.set(r.id, r);
    const c = codigoDe(r.codigo);
    if (!c) continue;
    const l = porCodigo.get(c) ?? [];
    l.push(r);
    porCodigo.set(c, l);
  }
  // O mesmo código em mais de uma linha do app = código repetido (as opções já vêm juntadas por código e nome).
  const nomesPorPdv = new Map<string, string[]>();
  for (const a of o.doApp) {
    if (!a.pdv) continue;
    const l = nomesPorPdv.get(a.pdv) ?? [];
    l.push(a.nome);
    nomesPorPdv.set(a.pdv, l);
  }

  const vistosNoRegem = new Set<string>();
  const linhas: Linha[] = [];
  for (const a of o.doApp) {
    const doMesmoCodigo = a.pdv ? nomesPorPdv.get(a.pdv) ?? [] : [];
    const repetido = doMesmoCodigo.length > 1;
    const chave = !a.pdv
      ? tipo === 'opcao'
        ? `app:${a.id}`
        : `nome:${normalizar(a.nome)}`
      : repetido
        ? `pdv:${a.pdv}|${normalizar(a.nome)}`
        : `pdv:${a.pdv}`;
    let candidatos: DoRegem[] = a.pdv ? porCodigo.get(a.pdv) ?? [] : [];
    let ligaPeloId = false;
    if (!candidatos.length && a.pdv && canal === '99food' && tipo === 'item') {
      const r = porId.get(a.pdv);
      if (r) {
        candidatos = [r];
        ligaPeloId = true;
      }
    }
    for (const r of candidatos) vistosNoRegem.add(r.id);
    const precos = distintos(a.precos);
    const r = candidatos.length === 1 ? candidatos[0] : null;
    let situacao: Situacao;
    let motivo: Motivo = null;
    let outros: string[] = [];
    if (!a.pdv) {
      situacao = 'naoLiga';
      motivo = 'semCodigo';
    } else if (repetido) {
      situacao = 'naoLiga';
      motivo = 'repetidoNoApp';
      const eu = doMesmoCodigo.indexOf(a.nome);
      outros = doMesmoCodigo.filter((_, i) => i !== eu);
    } else if (!candidatos.length) {
      situacao = 'soApp';
    } else if (candidatos.length > 1) {
      situacao = 'naoLiga';
      motivo = 'repetidoNoRegem';
      outros = candidatos.map((c) => c.nome);
    } else if (r!.preco == null) {
      situacao = 'preco';
      motivo = 'semPrecoNoRegem';
    } else if (precos.some((p) => centavos(p) !== centavos(r!.preco!))) {
      situacao = 'preco';
      motivo = precos.length > 1 ? 'precosDiferentesNosGrupos' : 'precoDiferente';
    } else {
      situacao = 'igual';
    }
    if (o.ignorados.has(chave)) situacao = 'ignorada';
    linhas.push({
      chave,
      tipo,
      nome: a.nome,
      pdv: a.pdv,
      grupos: a.grupos,
      precos,
      promoDe: a.promoDe,
      pausado: a.pausado,
      ...(a.imagem !== undefined ? { imagem: a.imagem } : {}),
      regem: r ? { id: r.id, nome: r.nome, preco: r.preco, ativo: r.ativo } : null,
      ligaPeloId,
      situacao,
      motivo,
      outros,
    });
  }

  // Só nos itens: o produto marcado "Está no <app>" (e ativo) que o app não tem.
  if (tipo === 'item') {
    for (const r of o.doRegem) {
      if (!r.marcado || !r.ativo || vistosNoRegem.has(r.id)) continue;
      const codigo = codigoDe(r.codigo);
      const chave = `regem:${r.id}`;
      linhas.push({
        chave,
        tipo,
        nome: r.nome,
        pdv: codigo,
        grupos: [],
        precos: [],
        promoDe: null,
        pausado: null,
        regem: { id: r.id, nome: r.nome, preco: r.preco, ativo: r.ativo },
        ligaPeloId: false,
        situacao: o.ignorados.has(chave) ? 'ignorada' : 'soRegem',
        motivo: !codigo && canal === 'ifood' ? 'semCodigoNoRegem' : null,
        outros: [],
      });
    }
  }

  return linhas.sort(
    (x, y) =>
      ORDEM[x.situacao] - ORDEM[y.situacao] ||
      (x.grupos[0] ?? '').localeCompare(y.grupos[0] ?? '', 'pt-BR') ||
      x.nome.localeCompare(y.nome, 'pt-BR'),
  );
}

/** Quantas linhas ainda pedem uma decisão (nem iguais nem ignoradas) — o "N a resolver" do botão de cada app. */
export const pendentes = (linhas: readonly Linha[]) => linhas.filter((l) => l.situacao !== 'igual' && l.situacao !== 'ignorada').length;

// ── as ações ─────────────────────────────────────────────────────────────────────────────────────────────────

export type PrecoAUsar = { chave: string; regemId: string; nome: string; de: number | null; para: number };
export type Recusa = { chave: string; motivo: string };

/**
 * "Usar o preço do app no Regem" (uma linha ou várias — a ação em massa do protótipo só existe nesta direção, decisão 3):
 * só a linha com preço diferente (ou em branco no Regem) e UM preço no app. Os preços vêm da última leitura guardada,
 * nunca da tela.
 */
export function precosParaUsar(linhas: readonly Linha[], chaves: readonly string[]): { usar: PrecoAUsar[]; recusas: Recusa[] } {
  const porChave = new Map(linhas.map((l) => [l.chave, l]));
  const usar: PrecoAUsar[] = [];
  const recusas: Recusa[] = [];
  for (const chave of new Set(chaves)) {
    const l = porChave.get(chave);
    if (!l) recusas.push({ chave, motivo: 'Não está na última leitura do app — leia de novo.' });
    else if (l.situacao !== 'preco' || !l.regem) recusas.push({ chave, motivo: `"${l.nome}" não está com o preço diferente.` });
    else if (l.precos.length !== 1)
      recusas.push({
        chave,
        motivo: l.precos.length ? `"${l.nome}" tem preços diferentes nos grupos do app — escolha o preço no lápis.` : `"${l.nome}" está sem preço no app.`,
      });
    else usar.push({ chave, regemId: l.regem.id, nome: l.regem.nome, de: l.regem.preco, para: l.precos[0] });
  }
  return { usar, recusas };
}

/** Quando ler o app: o botão sempre (salvo uma leitura de segundos atrás); sozinha, uma vez por dia, e não logo depois de um erro. */
export function precisaLer(o: { pediu: boolean; lidoEm: Date | null; erroEm: Date | null; agora: Date }): boolean {
  const desde = (d: Date | null) => (d ? o.agora.getTime() - d.getTime() : Number.POSITIVE_INFINITY);
  if (o.pediu) return desde(o.lidoEm) > LIDO_HA_POUCO_SEG * 1000;
  if (desde(o.erroEm) < ESPERA_DEPOIS_DO_ERRO_MIN * 60_000) return false;
  return desde(o.lidoEm) >= LEITURA_AUTOMATICA_HORAS * 3_600_000;
}
