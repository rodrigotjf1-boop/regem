import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import { alergenosDoProduto, marcacaoGravada, type AlergenosDoProduto, type MarcacaoDeAlergenos } from '../../common/alergenos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LEITURA DOS ALÉRGENOS DO CARDÁPIO (D2, 18/11/2026 — a regra em `common/alergenos.ts`). Uma consulta por empresa,
// set-based (nunca uma por produto): as folhas de cada produto — os insumos da ficha técnica (sub-receitas e o insumo
// "feito na loja" sem marcação própria descem pela ficha deles; as linhas só de delivery ou só de balcão são embalagem e
// ficam fora), o item de revenda do produto sem ficha e, no combo sem ficha, as folhas dos produtos que ele leva.
// Quem chama: o cardápio online (o bloco da página do produto), a busca do robô, a conferência de Cadastros › Cardápio
// e a gaveta do produto (A6). Empresa sem nenhuma marcação = mapa vazio, sem a consulta grande.

export type FolhaDoProduto = { nome: string; itemId: string | null; marcacao: MarcacaoDeAlergenos | null };
export type AlergenosLidos = AlergenosDoProduto & { folhas: FolhaDoProduto[]; ajuste: MarcacaoDeAlergenos | null };

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
/** Profundidade máxima da árvore da ficha (a mesma da busca do robô). A linha que ficaria por abrir vira folha "não conferida". */
const NIVEL_MAX = 5;

/** A empresa já marcou algum alérgeno (insumo ou produto)? Sem isso, nada a ler: o cardápio fica como é hoje. */
export async function empresaTemAlergenos(db: DrizzleDB, tenantId: string): Promise<boolean> {
  const r = await db.execute(sql`
    select (exists (select 1 from item_estoque where tenant_id = ${tenantId}::uuid and alergenos is not null and deleted_at is null)
         or exists (select 1 from produto where tenant_id = ${tenantId}::uuid and alergenos_ajuste is not null and deleted_at is null)) as tem`);
  return linhasDe(r)[0]?.tem === true;
}

/**
 * Os alérgenos de cada produto da empresa (ou só dos `produtoIds`). `sempre` = lê mesmo sem nenhuma marcação (a conferência
 * e a gaveta mostram "não informado" com o que falta); sem ele, a empresa que nunca marcou recebe o mapa vazio.
 */
export async function lerAlergenosDoCardapio(
  db: DrizzleDB,
  tenantId: string,
  opcoes: { produtoIds?: string[]; sempre?: boolean } = {},
): Promise<Map<string, AlergenosLidos>> {
  const resultado = new Map<string, AlergenosLidos>();
  if (opcoes.produtoIds && !opcoes.produtoIds.length) return resultado;
  if (!opcoes.sempre && !(await empresaTemAlergenos(db, tenantId))) return resultado;
  // Com a lista: os produtos pedidos E os componentes dos combos deles (o ajuste do componente entra na herança do combo).
  const pedidos = opcoes.produtoIds ? sql.join(opcoes.produtoIds.map((id) => sql`${id}::uuid`), sql`, `) : null;
  const filtro = pedidos
    ? sql`and (p.id in (${pedidos}) or p.id in (select x.componente_produto_id from produto_combo_item x
                                               where x.tenant_id = ${tenantId}::uuid and x.combo_produto_id in (${pedidos})))`
    : sql``;
  // Os produtos (com o ajuste) e os combos: o combo sem ficha herda dos produtos que leva (que entram na leitura).
  const [prodsR, combosR] = await Promise.all([
    db.execute(sql`
      select p.id, p.nome, p.ficha_id, p.item_id, p.alergenos_ajuste
        from produto p
       where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null ${filtro}`),
    db.execute(sql`
      select pci.combo_produto_id, pci.componente_produto_id, c.nome as componente_nome
        from produto_combo_item pci
        join produto c on c.id = pci.componente_produto_id and c.tenant_id = pci.tenant_id
       where pci.tenant_id = ${tenantId}::uuid and c.deleted_at is null`),
  ]);
  const prods = linhasDe(prodsR);
  const componentes = new Map<string, Array<{ id: string; nome: string }>>();
  for (const r of linhasDe(combosR)) {
    const id = String(r.combo_produto_id);
    componentes.set(id, [...(componentes.get(id) ?? []), { id: String(r.componente_produto_id), nome: String(r.componente_nome ?? '') }]);
  }
  // Os ids que precisam das folhas: os produtos pedidos e os componentes dos combos deles.
  const ids = new Set<string>(prods.map((p) => String(p.id)));
  for (const p of prods) for (const c of componentes.get(String(p.id)) ?? []) ids.add(c.id);
  if (!ids.size) return resultado;
  const listaIds = sql.join([...ids].map((id) => sql`${id}::uuid`), sql`, `);

  const [folhasR, extrasR] = await Promise.all([
    // A árvore da ficha: a linha com sub-receita desce pela sub-receita; a linha com insumo "feito na loja" (item com ficha)
    // SEM marcação própria desce pela ficha dele. O resto é folha.
    db.execute(sql`
      with recursive arvore as (
        select p.id as produto_id, fi.item_id, fi.sub_ficha_id, fi.insumo_nome, 0 as nivel
          from produto p
          join ficha_ingrediente fi on fi.ficha_id = p.ficha_id and fi.tenant_id = p.tenant_id
         where p.tenant_id = ${tenantId}::uuid and p.id in (${listaIds}) and p.ficha_id is not null
           and fi.deleted_at is null and not fi.somente_delivery and not fi.somente_balcao
        union all
        select a.produto_id, fi.item_id, fi.sub_ficha_id, fi.insumo_nome, a.nivel + 1
          from arvore a
          left join item_estoque ie on ie.id = a.item_id and ie.tenant_id = ${tenantId}::uuid
          join ficha_ingrediente fi
            on fi.tenant_id = ${tenantId}::uuid
           and fi.ficha_id = coalesce(a.sub_ficha_id, case when ie.alergenos is null then ie.ficha_id end)
         where a.nivel < ${NIVEL_MAX} and fi.deleted_at is null and not fi.somente_delivery and not fi.somente_balcao
      )
      select a.produto_id, a.item_id, a.sub_ficha_id, a.nivel, coalesce(ie.nome, a.insumo_nome) as nome,
             ie.alergenos, ie.ficha_id as item_ficha_id,
             exists (select 1 from ficha_ingrediente x
                      where x.tenant_id = ${tenantId}::uuid and x.deleted_at is null
                        and not x.somente_delivery and not x.somente_balcao
                        and x.ficha_id = coalesce(a.sub_ficha_id, case when ie.alergenos is null then ie.ficha_id end)) as abre
        from arvore a
        left join item_estoque ie on ie.id = a.item_id and ie.tenant_id = ${tenantId}::uuid`),
    // O produto de revenda (sem ficha, ligado a um item do estoque): a folha é o próprio item.
    db.execute(sql`
      select p.id as produto_id, ie.id as item_id, ie.nome, ie.alergenos
        from produto p
        join item_estoque ie on ie.id = p.item_id and ie.tenant_id = p.tenant_id
       where p.tenant_id = ${tenantId}::uuid and p.id in (${listaIds}) and p.ficha_id is null`),
  ]);
  const folhas = new Map<string, FolhaDoProduto[]>();
  const por = (produtoId: string, f: FolhaDoProduto) => folhas.set(produtoId, [...(folhas.get(produtoId) ?? []), f]);
  for (const r of linhasDe(folhasR)) {
    // A linha que abre (sub-receita, ou insumo feito na loja sem marcação com ficha que tem linhas) não é folha — os filhos
    // dela são; no nível máximo, o que ainda abriria fica como folha não conferida (nunca "não contém" por falta de leitura).
    if (r.abre === true && Number(r.nivel) < NIVEL_MAX) continue;
    const abriria = r.abre === true;
    por(String(r.produto_id), {
      nome: String(r.nome ?? 'insumo sem nome'),
      itemId: r.item_id ? String(r.item_id) : null,
      marcacao: abriria ? null : marcacaoGravada(r.alergenos),
    });
  }
  for (const r of linhasDe(extrasR))
    por(String(r.produto_id), { nome: String(r.nome ?? 'item sem nome'), itemId: String(r.item_id), marcacao: marcacaoGravada(r.alergenos) });

  const ajustes = new Map<string, MarcacaoDeAlergenos | null>(prods.map((p) => [String(p.id), marcacaoGravada(p.alergenos_ajuste)]));
  for (const p of prods) {
    const id = String(p.id);
    let doProduto = folhas.get(id) ?? [];
    // O combo sem ficha: as folhas dos produtos que leva (com o ajuste de cada um, que só soma); o componente sem folhas usa
    // o ajuste dele como marcação — conferido, responde; senão é uma folha não conferida com o nome dele.
    if (!doProduto.length && !p.ficha_id && componentes.has(id)) {
      doProduto = (componentes.get(id) ?? []).flatMap((c) => {
        const ajusteDoComponente = ajustes.get(c.id) ?? null;
        const dele = folhas.get(c.id);
        if (!dele?.length) return [{ nome: c.nome, itemId: null, marcacao: ajusteDoComponente }];
        // Componente com folhas: o ajuste dele só soma — entra como folha conferida só pelo que diz (contém/pode conter).
        return ajusteDoComponente
          ? [...dele, { nome: c.nome, itemId: null, marcacao: { ...ajusteDoComponente, conferido: true, gluten: null, lactose: null } }]
          : dele;
      });
    }
    const ajuste = ajustes.get(id) ?? null;
    resultado.set(id, { ...alergenosDoProduto(doProduto, ajuste), folhas: doProduto, ajuste });
  }
  return resultado;
}
