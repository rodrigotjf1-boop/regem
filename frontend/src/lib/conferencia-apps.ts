// "CONFERIR COM OS APPS" (R3 F4a; mig 405; protótipo `mockups/regem-conciliacao-ifood.html`): as regras PURAS da tela —
// os nomes de cada app nas frases, o selo e a frase de cada situação, o que entra no "Usar os preços do app" e a busca.
// Sem import: o `check:catalogo` transpila este arquivo sozinho e confere os casos.

export type CanalConferido = 'ifood' | '99food';
export type TipoConferido = 'item' | 'opcao';
export type SituacaoConferida = 'soApp' | 'soRegem' | 'preco' | 'naoLiga' | 'igual' | 'ignorada';
export type MotivoConferido =
  | 'semCodigo'
  | 'repetidoNoApp'
  | 'repetidoNoRegem'
  | 'semCodigoNoRegem'
  | 'semPrecoNoRegem'
  | 'precoDiferente'
  | 'precosDiferentesNosGrupos'
  | null;

/** Uma linha da conferência (o servidor compara; a tela só mostra e filtra). */
export type LinhaConferida = {
  chave: string;
  tipo: TipoConferido;
  nome: string;
  pdv: string | null;
  grupos: string[];
  precos: number[];
  promoDe: number | null;
  pausado: boolean | null;
  /** A foto no app (F6); `null` = sem foto lá; ausente = leitura antiga. */
  imagem?: string | null;
  regem: { id: string; nome: string; preco: number | null; ativo: boolean } | null;
  ligaPeloId: boolean;
  situacao: SituacaoConferida;
  motivo: MotivoConferido;
  outros: string[];
};

export type EstadoDaConferencia = 'ok' | 'lendo' | 'semLeitura' | 'semLigacao' | 'semConexao';
export type RespostaDaConferencia = {
  loja: { id: string; nome: string } | null;
  canal: CanalConferido;
  canais: Record<CanalConferido, { ligado: boolean; motivo: string | null; pendentes: number | null }>;
  estado: EstadoDaConferencia;
  motivo: string | null;
  lendoAgora: boolean;
  lidoEm: string | null;
  erro: string | null;
  erroEm: string | null;
  itens: LinhaConferida[];
  opcoes: LinhaConferida[];
};

/** Os nomes de cada app nas frases ("no iFood", "da 99", "pelo Orzuni"…). */
export const APP: Record<CanalConferido, { nome: string; o: string; no: string; do: string; ao: string; pelo: string; marca: string }> = {
  ifood: { nome: 'iFood', o: 'o iFood', no: 'no iFood', do: 'do iFood', ao: 'ao iFood', pelo: 'pelo Orzuni', marca: 'Está no iFood' },
  '99food': { nome: '99', o: 'a 99', no: 'na 99', do: 'da 99', ao: 'à 99', pelo: 'pela integração da 99', marca: 'Está na 99' },
};

export const reais = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O preço do app na linha: um só, a faixa (opção com preços diferentes nos grupos) ou nada. */
export function precoNoApp(l: LinhaConferida): string {
  if (!l.precos.length) return '—';
  if (l.precos.length === 1) return reais(l.precos[0]);
  return `${reais(l.precos[0])} a ${reais(l.precos[l.precos.length - 1])}`;
}

export const pendente = (l: LinhaConferida) => l.situacao !== 'igual' && l.situacao !== 'ignorada';

/** `"A", "B" e "C"`. */
export function listaE(nomes: string[]): string {
  const q = nomes.map((n) => `"${n}"`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} e ${q[q.length - 1]}` : (q[0] ?? '');
}

/** As situações (fichas) de cada vista, na ordem do protótipo. "Só no Regem" só nos itens. */
export function situacoesDa(canal: CanalConferido, tipo: TipoConferido): { k: SituacaoConferida; rotulo: string; tom?: 'aviso' | 'critico' }[] {
  const s: { k: SituacaoConferida; rotulo: string; tom?: 'aviso' | 'critico' }[] = [
    { k: 'soApp', rotulo: `Só ${APP[canal].no}`, tom: 'critico' },
    { k: 'soRegem', rotulo: 'Só no Regem', tom: 'aviso' },
    { k: 'preco', rotulo: 'Preço diferente', tom: 'aviso' },
    { k: 'naoLiga', rotulo: 'Não dá para ligar', tom: 'critico' },
    { k: 'igual', rotulo: 'Iguais' },
    { k: 'ignorada', rotulo: 'Ignoradas' },
  ];
  return tipo === 'item' ? s : s.filter((x) => x.k !== 'soRegem');
}

/** O selo e a frase da situação da linha (as frases do protótipo). */
export function seloDa(l: LinhaConferida, canal: CanalConferido): { tom: 'ok' | 'aviso' | 'critico' | 'neutro'; rotulo: string; frase: string } {
  const a = APP[canal];
  const venda = canal === 'ifood' ? 'a venda pelo iFood' : 'a venda pela 99';
  switch (l.situacao) {
    case 'soApp':
      return {
        tom: 'critico',
        rotulo: `Só ${a.no}`,
        frase:
          l.tipo === 'item'
            ? `Item sem produto no Regem com este código: ${venda} não baixa o estoque.`
            : 'Complemento sem opção no Regem com este código: não é cobrado nem baixa o estoque pelo Regem.',
      };
    case 'soRegem':
      return {
        tom: 'aviso',
        rotulo: 'Só no Regem',
        frase:
          l.motivo === 'semCodigoNoRegem'
            ? `"${l.nome}" está marcado "${a.marca}", mas não tem código PDV no Regem: não liga ${a.ao}.`
            : `"${l.nome}" está marcado "${a.marca}", mas ${a.o} não tem item com o código ${l.pdv}.`,
      };
    case 'preco':
      if (l.motivo === 'semPrecoNoRegem') return { tom: 'aviso', rotulo: 'Sem preço no Regem', frase: `No Regem o preço ${a.do} está em branco.` };
      if (l.motivo === 'precosDiferentesNosGrupos')
        return { tom: 'aviso', rotulo: 'Preço diferente', frase: `${a.nome}: ${precoNoApp(l)}, conforme o grupo · Regem ${reais(l.regem?.preco)}` };
      return { tom: 'aviso', rotulo: 'Preço diferente', frase: `${a.nome} ${precoNoApp(l)} · Regem ${reais(l.regem?.preco)}` };
    case 'naoLiga':
      if (l.motivo === 'semCodigo')
        return {
          tom: 'critico',
          rotulo: 'Sem código',
          frase:
            canal === 'ifood' && l.tipo === 'opcao'
              ? 'Sem código PDV no iFood (o código que o Orzuni gera não liga a nada).'
              : `${l.tipo === 'item' ? 'O item' : 'O complemento'} não tem código PDV ${a.no}.`,
        };
      if (l.motivo === 'repetidoNoRegem')
        return {
          tom: 'critico',
          rotulo: 'Código repetido no Regem',
          frase: `O código ${l.pdv} está em ${l.outros.length} ${l.tipo === 'item' ? 'produtos' : 'opções'} do Regem: ${listaE(l.outros)}.`,
        };
      return {
        tom: 'critico',
        rotulo: 'Código repetido',
        frase: `O código ${l.pdv} está em ${l.outros.length + 1} ${l.tipo === 'item' ? 'itens' : 'complementos'} ${a.do}: ${listaE([l.nome, ...l.outros])}.`,
      };
    case 'ignorada':
      return { tom: 'neutro', rotulo: 'Ignorada', frase: 'Fica fora das contagens até você desfazer.' };
    default:
      return { tom: 'ok', rotulo: 'Igual', frase: l.ligaPeloId ? 'Liga pelo id do produto (exportado sem código PDV); preço igual.' : 'Código e preço iguais.' };
  }
}

/** Entra no "Usar os preços do app (N)": preço diferente, preenchido no Regem e UM preço no app (decisão 3 do protótipo). */
export const entraNoUsarEmMassa = (l: LinhaConferida) =>
  l.situacao === 'preco' && l.motivo === 'precoDiferente' && l.regem?.preco != null && l.precos.length === 1;

/** A busca: nome no app, código e nome no Regem, sem acento nem caixa. */
export function bateNaBusca(l: LinhaConferida, busca: string): boolean {
  const s = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const b = s(busca.trim());
  return !b || s(`${l.nome} ${l.pdv ?? ''} ${l.regem?.nome ?? ''}`).includes(b);
}

// ── F4b: criar no Regem, ligar a um produto, corrigir o código ─────────────────────────────────────────────────

/** O produto do Regem como a lista da Gestão do catálogo traz (só o que a ligação precisa). */
export type ProdutoParaLigar = {
  id: string;
  nome: string;
  codigo?: string | null;
  categoriaNome?: string | null;
  noIfood?: boolean;
  na99?: boolean;
};

/** O que acontece ao ligar `p` à linha `l` do app (a gaveta mostra antes de confirmar — decisão 4 do protótipo). */
export function efeitoDeLigar(p: ProdutoParaLigar, l: LinhaConferida, canal: CanalConferido): { tom: 'critico' | 'info'; frases: string[] } {
  const a = APP[canal];
  const outro: CanalConferido = canal === 'ifood' ? '99food' : 'ifood';
  const codigo = (p.codigo ?? '').trim();
  const marcadoNoOutro = outro === 'ifood' ? p.noIfood === true : p.na99 === true;
  const frases: string[] = [];
  if (codigo) {
    frases.push(`O código de "${p.nome}" passa de ${codigo} para ${l.pdv}.`);
    frases.push(`Os pedidos que chegarem com o código ${codigo} (dos apps, do totem ou de outro canal) não ligam mais a este produto.`);
    if (marcadoNoOutro) frases.push(`${APP[outro].nome === '99' ? 'Na 99' : 'No iFood'}, ele passa a ligar ao item de código ${l.pdv} de lá.`);
  } else {
    frases.push(`"${p.nome}" ganha o código ${l.pdv} e passa a ser marcado "${a.marca}": a venda ${canal === 'ifood' ? 'pelo iFood' : 'pela 99'} baixa o estoque dele.`);
  }
  frases.push(
    l.precos.length === 1
      ? `O preço ${a.do} no Regem fica o de lá (${reais(l.precos[0])})${l.pausado ? ' e ele fica pausado, como lá' : ''}: nada muda ${a.no}.`
      : `O preço ${a.do} no Regem fica como está${l.pausado ? ' e ele fica pausado, como lá' : ''}: nada muda ${a.no}.`,
  );
  return { tom: codigo ? 'critico' : 'info', frases };
}

/** "Corrigir o código": o código digitado é de qual item do app? Só o item "só no app" pode receber o produto. */
export function itemDoCodigo(
  itens: LinhaConferida[],
  codigo: string,
  canal: CanalConferido,
): { linha: LinhaConferida | null; frase: string } {
  const a = APP[canal];
  const c = codigo.trim();
  if (!c) return { linha: null, frase: `Digite o código: a tela diz qual item ${a.do} ele é.` };
  const l = itens.find((x) => x.pdv === c && x.situacao !== 'soRegem');
  if (!l) return { linha: null, frase: `Nenhum item ${a.do} tem esse código.` };
  const preco = l.precos.length ? ` (${precoNoApp(l)})` : '';
  if (l.situacao === 'soApp') return { linha: l, frase: `É "${l.nome}" ${a.no}${preco}.` };
  if (l.situacao === 'ignorada') return { linha: null, frase: `É "${l.nome}" ${a.no}, mas a linha está ignorada: desfaça o "Ignorar" antes.` };
  if (l.situacao === 'naoLiga') return { linha: null, frase: `É "${l.nome}" ${a.no}, mas o código está repetido lá.` };
  return { linha: null, frase: `É "${l.nome}" ${a.no}, que já liga a "${l.regem?.nome ?? l.nome}" do Regem.` };
}

/** Preço digitado ("29,90", "R$ 29.90") → número com 2 casas; `null` = não dá para ler. */
export function precoDigitado(v: string): number | null {
  const s = v.replace(/R\$\s*/i, '').trim();
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s.replace(',', '.')) * 100) / 100;
}

export type BaixaDoCriar = 'ficha' | 'item' | 'combo' | 'nada';
export type FormCriar = {
  nome: string;
  categoriaId: string;
  precoRegem: string;
  ondeRegem: boolean;
  ondeIfood: boolean;
  onde99: boolean;
  baixa: BaixaDoCriar;
  fichaId: string;
  itemId: string;
  itemUnidade: string;
  combo: { componenteProdutoId: string; quantidade: string }[];
};

/**
 * O formulário do "Criar no Regem" com o que vem do app (o protótipo: o app de onde veio marcado; o Regem não). A categoria
 * do Regem com o mesmo nome da do app já vem escolhida (sem acento nem caixa).
 */
export function formDeCriar(l: LinhaConferida, canal: CanalConferido, categorias: { id: string; nome: string }[] = []): FormCriar {
  const preco = l.precos.length === 1 ? l.precos[0] : null;
  const s = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const doApp = l.grupos[0] ? s(l.grupos[0]) : '';
  return {
    nome: l.nome,
    categoriaId: (doApp && categorias.find((c) => s(c.nome) === doApp)?.id) || '',
    precoRegem: preco == null ? '' : preco.toFixed(2).replace('.', ','),
    ondeRegem: false,
    ondeIfood: canal === 'ifood',
    onde99: canal === '99food',
    baixa: 'ficha',
    fichaId: '',
    itemId: '',
    itemUnidade: '',
    combo: [{ componenteProdutoId: '', quantidade: '1' }],
  };
}

/**
 * O pedido de criar o produto (`POST /produtos`) a partir do item do app — ou o motivo de não dar. O código e o preço do
 * app vêm da linha (não se editam); a pausa do app vem junto; o Regem desmarcado = fora do balcão e do cardápio digital.
 */
export function pedidoDeCriar(
  f: FormCriar,
  l: LinhaConferida,
  canal: CanalConferido,
  ligados: { comIfood: boolean; com99: boolean },
): { ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string } {
  const nome = f.nome.trim();
  if (!nome) return { ok: false, erro: 'Dê um nome ao produto.' };
  if (!l.pdv) return { ok: false, erro: 'O item do app não tem código PDV.' };
  // A mesma exigência do servidor (`exigirCategoria` na criação do produto).
  if (!f.categoriaId) return { ok: false, erro: 'Escolha a categoria no Regem: ela organiza o produto no cardápio digital e no balcão.' };
  const precoRegem = f.precoRegem.trim() === '' ? (f.ondeRegem ? null : 0) : precoDigitado(f.precoRegem);
  if (precoRegem == null) return { ok: false, erro: 'Digite o preço no Regem (ex.: 29,90).' };
  if (f.baixa === 'ficha' && !f.fichaId) return { ok: false, erro: 'Escolha a ficha técnica (ou outra forma de baixar o estoque).' };
  if (f.baixa === 'item' && !f.itemId) return { ok: false, erro: 'Escolha o item de estoque (ou outra forma de baixar o estoque).' };
  const combo = f.combo.filter((c) => c.componenteProdutoId);
  if (f.baixa === 'combo' && !combo.length) return { ok: false, erro: 'Escolha ao menos um produto do combo.' };
  const precoApp = l.precos.length === 1 ? l.precos[0].toFixed(2) : null;
  return {
    ok: true,
    corpo: {
      nome,
      codigo: l.pdv,
      categoriaId: f.categoriaId,
      tipo: f.baixa === 'combo' ? 'combo' : 'simples',
      precoVenda: precoRegem,
      fichaId: f.baixa === 'ficha' ? f.fichaId : null,
      itemId: f.baixa === 'item' ? f.itemId : null,
      itemUnidade: f.baixa === 'item' ? f.itemUnidade || null : null,
      controlaEstoque: f.baixa !== 'nada',
      combo:
        f.baixa === 'combo'
          ? combo.map((c) => ({ componenteProdutoId: c.componenteProdutoId, quantidade: Number(String(c.quantidade).replace(',', '.')) || 1 }))
          : [],
      disponivelBalcao: f.ondeRegem,
      disponivelCardapio: f.ondeRegem,
      canaisPausados: l.pausado ? [canal] : [],
      ...(ligados.comIfood ? { noIfood: f.ondeIfood, precoIfood: canal === 'ifood' && f.ondeIfood ? precoApp : null } : {}),
      ...(ligados.com99 ? { na99: f.onde99, preco99: canal === '99food' && f.onde99 ? precoApp : null } : {}),
    },
  };
}

// ── F4c: criar a opção do complemento no Regem ───────────────────────────────────────────────────────────────

export type BaixaDaOpcao = 'item' | 'ficha' | 'produto' | 'nada';
export type FormCriarOpcao = { nome: string; baixa: BaixaDaOpcao; fichaId: string; itemId: string; itemUnidade: string; produtoRefId: string };

/** O formulário do "Criar a opção no Regem" (o adicional comum é um item de estoque: bacon, cheddar). */
export function formDeCriarOpcao(l: LinhaConferida): FormCriarOpcao {
  return { nome: l.nome, baixa: 'item', fichaId: '', itemId: '', itemUnidade: '', produtoRefId: '' };
}

/**
 * O pedido de criar a opção do catálogo (`POST /produtos/opcoes`) a partir do complemento do app — ou o motivo de não dar.
 * A opção só cobra e baixa com o código PDV, "Controlar estoque" e a ligação (V49): o código vem do app e a ligação é a
 * escolhida (ficha, item de estoque ou produto do Regem); "não baixa" desliga o "Controlar estoque". O preço do iFood vai no
 * pedido; o da 99 e a pausa do app, depois (as rotas de preço e pausa por canal da opção).
 */
export function pedidoDeCriarOpcao(
  f: FormCriarOpcao,
  l: LinhaConferida,
  canal: CanalConferido,
  ligados: { comIfood: boolean },
): { ok: true; corpo: Record<string, unknown>; preco99: string | null; pausar: boolean } | { ok: false; erro: string } {
  const nome = f.nome.trim();
  if (!nome) return { ok: false, erro: 'Dê um nome à opção.' };
  if (!l.pdv) return { ok: false, erro: 'O complemento do app não tem código PDV.' };
  if (f.baixa === 'item' && !f.itemId) return { ok: false, erro: 'Escolha o item de estoque (ou outra forma de baixar o estoque).' };
  if (f.baixa === 'ficha' && !f.fichaId) return { ok: false, erro: 'Escolha a ficha técnica (ou outra forma de baixar o estoque).' };
  if (f.baixa === 'produto' && !f.produtoRefId) return { ok: false, erro: 'Escolha o produto do Regem (ou outra forma de baixar o estoque).' };
  const preco = l.precos.length === 1 ? l.precos[0].toFixed(2) : null;
  const tipo = f.baixa === 'ficha' ? 'ficha' : f.baixa === 'item' ? 'insumo' : 'simples';
  return {
    ok: true,
    corpo: {
      nome,
      codigoPdv: l.pdv,
      tipo,
      fichaId: f.baixa === 'ficha' ? f.fichaId : null,
      itemId: f.baixa === 'item' ? f.itemId : null,
      itemUnidade: f.baixa === 'item' ? f.itemUnidade || null : null,
      produtoRefId: f.baixa === 'produto' ? f.produtoRefId : null,
      controlaEstoque: f.baixa !== 'nada',
      ...(canal === 'ifood' && ligados.comIfood && preco != null ? { precoIfood: preco } : {}),
    },
    preco99: canal === '99food' ? preco : null,
    pausar: l.pausado === true,
  };
}

// ── F6: as fotos ─────────────────────────────────────────────────────────────────────────────────────────────

/** A foto do produto em cada app, pela última leitura: endereço, `null` (sem foto lá) ou ausente (não lido / não liga). */
export type FotosDoProduto = Partial<Record<CanalConferido, string | null>>;
export type FotosDaLoja = { canais: Record<CanalConferido, { lidoEm: string; porProduto: Record<string, string | null> } | null> };

/** As fotos de um produto nos apps (só os apps com leitura e em que o produto liga). */
export function fotosDoProduto(f: FotosDaLoja | null, produtoId: string): FotosDoProduto {
  const r: FotosDoProduto = {};
  for (const c of ['ifood', '99food'] as const) {
    const m = f?.canais[c]?.porProduto;
    if (m && produtoId in m) r[c] = m[produtoId];
  }
  return r;
}

/** A situação da foto num app: falta lá (o Regem tem), só lá (o Regem não tem) — ou nada a dizer. */
export function situacaoDaFoto(temNoRegem: boolean, noApp: string | null | undefined): 'faltaNoApp' | 'soNoApp' | null {
  if (noApp === undefined) return null;
  if (noApp === null) return 'faltaNoApp';
  return temNoRegem ? null : 'soNoApp';
}

/** A 99 pede de 150 a 3000 px de lado (protótipo, "Fotos"). */
export const medidaParaA99 = (w: number, h: number) => Math.min(w, h) >= 150 && Math.max(w, h) <= 3000;

/**
 * O iFood (pela porta do Orzuni, R3 F6b): quadrada (folga de 2% do maior lado) e com 300 px de lado ou mais — a MESMA
 * regra do servidor (`orzuni-foto.regras.ts`, V74), que confere de novo pelos bytes antes de mandar.
 */
export const medidaParaOIfood = (w: number, h: number) => Math.min(w, h) >= 300 && Math.abs(w - h) <= 0.02 * Math.max(w, h);

/** O maior lado da cópia enquadrada que vai ao iFood (o app mostra a foto pequena; menos peso). */
export const LADO_DA_COPIA_IFOOD = 1200;
const LIMITE_FOTO_IFOOD = 8_000_000;

/**
 * R3 F6c — o recorte da foto que NÃO serve ao iFood como está: o quadrado do centro (o lado menor), reduzido a até
 * 1200 px. `null` quando o lado menor não chega a 300 px (aumentar a foto só a deixaria borrada).
 */
export function recorteCentral(w: number, h: number, max = LADO_DA_COPIA_IFOOD): { sx: number; sy: number; lado: number; saida: number } | null {
  const lado = Math.min(w, h);
  if (!(lado >= 300)) return null;
  return { sx: Math.floor((w - lado) / 2), sy: Math.floor((h - lado) / 2), lado, saida: Math.min(lado, max) };
}

/**
 * A foto que vai ao iFood (R3 F6c): a do Regem COMO ESTÁ quando já serve (JPG ou PNG, quadrada, 300 px ou mais, até
 * 8 MB, com endereço público) — `{}`, o servidor baixa a original; senão, a CÓPIA enquadrada (quadrado do centro, JPG),
 * feita aqui no navegador (que já desenha a foto na orientação certa e abre WEBP) — `{ imagem }`. A foto do Regem não muda.
 */
export async function prepararFotoParaOIfood(url: string): Promise<{ imagem?: string } | { erro: string }> {
  let blob: Blob;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (!r.ok) throw new Error(String(r.status));
    blob = await r.blob();
  } catch {
    return { erro: 'Não deu para ler a foto do Regem agora. Tente de novo em instantes.' };
  }
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return { erro: 'O navegador não abriu a foto do Regem: troque-a por uma JPG ou PNG.' };
  }
  const { width: w, height: h } = bmp;
  const serveComoEsta = /^https:\/\//i.test(url) && ['image/jpeg', 'image/png'].includes(blob.type) && medidaParaOIfood(w, h) && blob.size <= LIMITE_FOTO_IFOOD;
  if (serveComoEsta) {
    bmp.close();
    return {};
  }
  const r = recorteCentral(w, h);
  if (!r) {
    bmp.close();
    return { erro: `A foto tem ${w} × ${h} px e o iFood pede 300 px de lado ou mais: use uma maior.` };
  }
  const canvas = document.createElement('canvas');
  canvas.width = r.saida;
  canvas.height = r.saida;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bmp.close();
    return { erro: 'O navegador não conseguiu enquadrar a foto.' };
  }
  // Fundo branco: o PNG com transparência vira JPG sem fundo preto.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, r.saida, r.saida);
  ctx.drawImage(bmp, r.sx, r.sy, r.lado, r.lado, 0, 0, r.saida, r.saida);
  bmp.close();
  const jpg: Blob | null = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
  if (!jpg) return { erro: 'O navegador não conseguiu enquadrar a foto.' };
  const imagem: string = await new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => falha(leitor.error);
    leitor.readAsDataURL(jpg);
  });
  return { imagem };
}

/** "Lido do iFood hoje às 14:30" / "em 10/11 às 09:12" (hora de Brasília). */
export function quandoLido(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'ainda não lido';
  const d = new Date(iso);
  const tz = { timeZone: 'America/Sao_Paulo' } as const;
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', tz);
  const hora = d.toLocaleTimeString('pt-BR', { ...tz, hour: '2-digit', minute: '2-digit' });
  return dia(d) === dia(agora) ? `hoje às ${hora}` : `em ${dia(d).slice(0, 5)} às ${hora}`;
}
