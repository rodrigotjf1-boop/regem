import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { chaveDoApelido, type UltimaVez } from './mister-compra-modelos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS MODELOS DE COMPRA E OS APELIDOS (versão 9, fase O2; mig 503; protótipo `mockups/regem-mister-v9.html`, "Na loja › Modelos de
// compra"). O modelo de um fornecedor é a memória que a nota por foto já guardava (mig 441: este produto deste fornecedor é tal
// insumo), agora com o nome do produto, a última quantidade, o último preço e quantas vezes veio; o apelido é o nome que a empresa
// usa para um insumo, para qualquer fornecedor. Aqui a leitura e as mudanças da tela (só o presidente, pela rota) e o que a nota
// e a lista gravam. Tudo por empresa: nenhuma consulta sem `tenant_id`.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O fornecedor do modelo é o CNPJ como a nota leu (só dígitos). */
const FORNECEDOR = /^\d{8,14}$/;
const MAX_FATOR = 100_000;
export const PARADO_DIAS = 60;
export const MAX_MODELOS = 200;
export const MAX_LINHAS_DO_MODELO = 300;
export const MAX_APELIDOS = 500;

export interface ModeloNaLista {
  fornecedor: string;
  nome: string;
  produtos: number;
  /** Produtos ligados a um insumo que saiu do estoque: o próximo cupom pergunta de novo. */
  comDuvida: number;
  vezes: number;
  usadoEm: string | null;
  parado: boolean;
}
export interface LinhaDoModelo {
  chave: string;
  descricao: string | null;
  itemId: string | null;
  itemNome: string | null;
  unidadeDoEstoque: string | null;
  insumoSumiu: boolean;
  fator: number | null;
  unidadeNota: string | null;
  ultimaQuantidade: number | null;
  ultimoPrecoCentavos: number | null;
  usadoEm: string | null;
}
export interface ApelidoNaLista {
  chave: string;
  texto: string;
  itemId: string;
  itemNome: string | null;
  insumoSumiu: boolean;
  vezes: number;
  atualizadoEm: string;
}
/** O que a nota lançada traz de um produto (para a última vez do modelo). */
export interface ProdutoDaNota {
  chave: string;
  descricao: string;
  quantidade: number;
  valorUnitarioCentavos: number | null;
}

const numeroOuNull = (v: unknown) => (v == null ? null : Number(v));
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

@Injectable()
export class MisterCompraModelosService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly conversa?: MisterConversaConfigService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** "Aprender o modelo de cada fornecedor" ligado para a empresa (sem o serviço ou sem a coluna: desligado, nada muda). */
  async ligado(tenantId: string): Promise<boolean> {
    if (!this.conversa) return false;
    return this.conversa.daEmpresa(tenantId).then(
      (c) => c.aprenderModelos === true,
      () => false,
    );
  }

  // ───────────────────────────── a tela (Mister › Modelos de compra) ─────────────────────────────

  /** Os modelos da empresa (um por fornecedor) e quantos apelidos ela tem. */
  async listar(tenantId: string): Promise<{ ligado: boolean; modelos: ModeloNaLista[]; apelidos: number; limite: number }> {
    const modelos = linhas(
      await this.db.execute(sql`
        select d.fornecedor_cnpj as fornecedor,
               coalesce((select f.nome from fornecedor f
                          where f.tenant_id = d.tenant_id and f.deleted_at is null
                            and regexp_replace(coalesce(f.cnpj, ''), '[^0-9]', '', 'g') = d.fornecedor_cnpj
                          order by f.nome limit 1),
                        max(d.fornecedor_nome)) as nome,
               count(*)::int as produtos,
               count(*) filter (where d.item_id is not null and not exists (
                 select 1 from item_estoque i where i.id = d.item_id and i.tenant_id = d.tenant_id and i.deleted_at is null))::int as "comDuvida",
               coalesce(max(d.vezes), 0)::int as vezes,
               max(coalesce(d.usado_em, d.atualizado_em)) as "usadoEm"
          from mister_de_para d
         where d.tenant_id = ${tenantId}::uuid
         group by d.tenant_id, d.fornecedor_cnpj
         order by max(coalesce(d.usado_em, d.atualizado_em)) desc nulls last
         limit ${MAX_MODELOS}`),
    );
    const [ap] = linhas(await this.db.execute(sql`select count(*)::int as n from mister_apelido where tenant_id = ${tenantId}::uuid`));
    const limiteParado = Date.now() - PARADO_DIAS * 86_400_000;
    return {
      ligado: await this.ligado(tenantId),
      modelos: modelos.map((m) => ({
        fornecedor: String(m.fornecedor),
        nome: m.nome ? String(m.nome) : `CNPJ ${m.fornecedor}`,
        produtos: Number(m.produtos),
        comDuvida: Number(m.comDuvida),
        vezes: Number(m.vezes),
        usadoEm: iso(m.usadoEm),
        parado: !!m.usadoEm && new Date(m.usadoEm).getTime() < limiteParado,
      })),
      apelidos: Number(ap?.n ?? 0),
      limite: MAX_MODELOS,
    };
  }

  /** Cada produto do modelo de um fornecedor: a que insumo vai, a conversão e a última vez. */
  async detalhe(tenantId: string, fornecedor: string): Promise<{ fornecedor: string; nome: string; linhas: LinhaDoModelo[] }> {
    if (!FORNECEDOR.test(String(fornecedor))) throw new BadRequestException('Fornecedor inválido.');
    const ls = linhas(
      await this.db.execute(sql`
        select d.chave, d.descricao, d.item_id::text as "itemId", i.nome as "itemNome", i.unidade_medida as "unidadeDoEstoque",
               (d.item_id is not null and i.id is null) as "insumoSumiu", d.fator, d.unidade_nota as "unidadeNota",
               d.ultima_quantidade as "ultimaQuantidade", d.ultimo_preco_centavos as "ultimoPrecoCentavos",
               coalesce(d.usado_em, d.atualizado_em) as "usadoEm", d.fornecedor_nome as "fornecedorNome"
          from mister_de_para d
          left join item_estoque i on i.id = d.item_id and i.tenant_id = d.tenant_id and i.deleted_at is null
         where d.tenant_id = ${tenantId}::uuid and d.fornecedor_cnpj = ${fornecedor}
         order by (d.item_id is null), coalesce(d.descricao, d.chave)
         limit ${MAX_LINHAS_DO_MODELO}`),
    );
    if (!ls.length) throw new NotFoundException('Este fornecedor não tem modelo.');
    const [f] = linhas(
      await this.db.execute(sql`
        select nome from fornecedor
         where tenant_id = ${tenantId}::uuid and deleted_at is null and regexp_replace(coalesce(cnpj, ''), '[^0-9]', '', 'g') = ${fornecedor}
         order by nome limit 1`),
    );
    return {
      fornecedor,
      nome: f?.nome ?? ls.find((l) => l.fornecedorNome)?.fornecedorNome ?? `CNPJ ${fornecedor}`,
      linhas: ls.map((l) => ({
        chave: String(l.chave),
        descricao: l.descricao ?? null,
        itemId: l.itemId ?? null,
        itemNome: l.itemNome ?? null,
        unidadeDoEstoque: l.unidadeDoEstoque ?? null,
        insumoSumiu: l.insumoSumiu === true,
        fator: numeroOuNull(l.fator),
        unidadeNota: l.unidadeNota ?? null,
        ultimaQuantidade: numeroOuNull(l.ultimaQuantidade),
        ultimoPrecoCentavos: numeroOuNull(l.ultimoPrecoCentavos),
        usadoEm: iso(l.usadoEm),
      })),
    };
  }

  /**
   * "Mudar" um produto do modelo: outro insumo (com a conversão, se a pessoa disser) ou "fora do estoque" (`itemId: null`). O
   * insumo é conferido na empresa (e vivo). Grava quem mudou; o próximo cupom do fornecedor já vem assim.
   */
  async mudarLinha(tenantId: string, atorId: string, atorPerfil: string, fornecedor: string, corpo: any): Promise<{ ok: true }> {
    const chave = String(corpo?.chave ?? '');
    if (!FORNECEDOR.test(String(fornecedor)) || !chave || chave.length > 120) throw new BadRequestException('Produto inválido.');
    const itemId = corpo?.itemId === null ? null : String(corpo?.itemId ?? '');
    if (itemId !== null && !UUID.test(itemId)) throw new BadRequestException('Escolha o insumo do estoque ou "fora do estoque".');
    let fator: number | null = null;
    if (corpo?.fator !== undefined && corpo?.fator !== null && corpo?.fator !== '') {
      fator = Number(corpo.fator);
      if (!Number.isFinite(fator) || fator <= 0 || fator > MAX_FATOR) throw new BadRequestException('A conversão é um número maior que zero.');
    }
    if (itemId === null && fator !== null) throw new BadRequestException('Fora do estoque não tem conversão.');
    if (itemId) {
      const [i] = linhas(await this.db.execute(sql`select 1 from item_estoque where id = ${itemId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`));
      if (!i) throw new BadRequestException('Este insumo não está no seu estoque.');
    }
    const r = linhas(
      await this.db.execute(sql`
        update mister_de_para set item_id = ${itemId}::uuid, fator = ${fator}::numeric, alterado_por = ${atorId}::uuid, atualizado_em = now()
         where tenant_id = ${tenantId}::uuid and fornecedor_cnpj = ${fornecedor} and chave = ${chave}
         returning chave`),
    );
    if (!r.length) throw new NotFoundException('Este produto não está mais no modelo.');
    await this.auditar(tenantId, atorId, atorPerfil, 'mister_modelo_mudado', { fornecedor, chave, item: itemId, fator });
    return { ok: true };
  }

  /** "Esquecer": um produto (`chave`; o próximo cupom pergunta de novo) ou o modelo inteiro do fornecedor (`tudo: true`, dito). */
  async esquecer(tenantId: string, atorId: string, atorPerfil: string, fornecedor: string, corpo: any): Promise<{ esquecidos: number }> {
    if (!FORNECEDOR.test(String(fornecedor))) throw new BadRequestException('Fornecedor inválido.');
    // O modelo inteiro só com o pedido explícito: um corpo sem a chave por engano não apaga tudo.
    const chave = corpo?.tudo === true ? null : String(corpo?.chave ?? '');
    if (chave !== null && (!chave || chave.length > 120)) throw new BadRequestException('Diga o produto ou "tudo".');
    const r = linhas(
      await this.db.execute(sql`
        delete from mister_de_para
         where tenant_id = ${tenantId}::uuid and fornecedor_cnpj = ${fornecedor} ${chave !== null ? sql`and chave = ${chave}` : sql``}
         returning chave`),
    );
    if (r.length) await this.auditar(tenantId, atorId, atorPerfil, chave ? 'mister_modelo_produto_esquecido' : 'mister_modelo_esquecido', { fornecedor, chave, produtos: r.length });
    return { esquecidos: r.length };
  }

  /** Os apelidos da empresa: o nome, o insumo e quantas vezes valeu. */
  async apelidos(tenantId: string): Promise<{ apelidos: ApelidoNaLista[]; limite: number }> {
    const ls = linhas(
      await this.db.execute(sql`
        select a.chave, a.texto, a.item_id::text as "itemId", i.nome as "itemNome", (i.id is null) as "insumoSumiu", a.vezes, a.atualizado_em as "atualizadoEm"
          from mister_apelido a
          left join item_estoque i on i.id = a.item_id and i.tenant_id = a.tenant_id and i.deleted_at is null
         where a.tenant_id = ${tenantId}::uuid
         order by a.atualizado_em desc
         limit ${MAX_APELIDOS}`),
    );
    return {
      apelidos: ls.map((a) => ({ chave: String(a.chave), texto: String(a.texto), itemId: String(a.itemId), itemNome: a.itemNome ?? null, insumoSumiu: a.insumoSumiu === true, vezes: Number(a.vezes), atualizadoEm: iso(a.atualizadoEm) as string })),
      limite: MAX_APELIDOS,
    };
  }

  /** Muda o insumo de um apelido (o insumo conferido na empresa). */
  async mudarApelido(tenantId: string, atorId: string, atorPerfil: string, corpo: any): Promise<{ ok: true }> {
    const chave = String(corpo?.chave ?? '');
    const itemId = String(corpo?.itemId ?? '');
    if (!chave || chave.length > 120) throw new BadRequestException('Apelido inválido.');
    if (!UUID.test(itemId)) throw new BadRequestException('Escolha o insumo do estoque.');
    const [i] = linhas(await this.db.execute(sql`select 1 from item_estoque where id = ${itemId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`));
    if (!i) throw new BadRequestException('Este insumo não está no seu estoque.');
    const r = linhas(
      await this.db.execute(sql`
        update mister_apelido set item_id = ${itemId}::uuid, alterado_por = ${atorId}::uuid, atualizado_em = clock_timestamp()
         where tenant_id = ${tenantId}::uuid and chave = ${chave} returning chave`),
    );
    if (!r.length) throw new NotFoundException('Este apelido não existe mais.');
    await this.auditar(tenantId, atorId, atorPerfil, 'mister_apelido_mudado', { chave, item: itemId });
    return { ok: true };
  }

  async esquecerApelido(tenantId: string, atorId: string, atorPerfil: string, corpo: any): Promise<{ esquecidos: number }> {
    const chave = String(corpo?.chave ?? '');
    if (!chave || chave.length > 120) throw new BadRequestException('Apelido inválido.');
    const r = linhas(await this.db.execute(sql`delete from mister_apelido where tenant_id = ${tenantId}::uuid and chave = ${chave} returning chave`));
    if (r.length) await this.auditar(tenantId, atorId, atorPerfil, 'mister_apelido_esquecido', { chave });
    return { esquecidos: r.length };
  }

  // ───────────────────────────── o que a nota e a lista usam e gravam ─────────────────────────────

  /** A última vez de cada produto do modelo do fornecedor (para o "Mudou:" do resumo). */
  async ultimasVezes(tenantId: string, fornecedor: string | null, chaves: string[]): Promise<Map<string, UltimaVez>> {
    const m = new Map<string, UltimaVez>();
    if (!fornecedor || !chaves.length) return m;
    const ls = linhas(
      await this.db.execute(sql`
        select chave, ultima_quantidade as q, ultimo_preco_centavos as p from mister_de_para
         where tenant_id = ${tenantId}::uuid and fornecedor_cnpj = ${fornecedor} and chave in (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`),
    );
    for (const l of ls) m.set(String(l.chave), { ultimaQuantidade: numeroOuNull(l.q), ultimoPrecoCentavos: numeroOuNull(l.p) });
    return m;
  }

  /**
   * A nota lançada vira a "última vez" dos produtos que o modelo tem (uma instrução, pela lista inteira): o nome como o fornecedor
   * escreve, a quantidade, o preço unitário, mais uma vez e quando. Produto que o modelo não tem não é criado aqui (quem cria é a
   * resposta da pessoa ou a ligação pela IA). Falhou: só o registro fica para trás; o lançamento já foi feito.
   */
  async registrarNota(tenantId: string, fornecedor: string | null, fornecedorNome: string | null, produtos: ProdutoDaNota[]): Promise<void> {
    if (!fornecedor || !produtos.length) return;
    const unicos = [...new Map(produtos.map((p) => [p.chave, p])).values()];
    await this.db.execute(sql`
      update mister_de_para d
         set descricao = x.descricao, fornecedor_nome = coalesce(${fornecedorNome}, d.fornecedor_nome), ultima_quantidade = x.quantidade,
             ultimo_preco_centavos = x.preco, vezes = d.vezes + 1, usado_em = now()
        from jsonb_to_recordset(${JSON.stringify(unicos.map((p) => ({ chave: p.chave, descricao: String(p.descricao).slice(0, 200), quantidade: p.quantidade, preco: p.valorUnitarioCentavos })))}::jsonb)
             as x(chave text, descricao text, quantidade numeric, preco bigint)
       where d.tenant_id = ${tenantId}::uuid and d.fornecedor_cnpj = ${fornecedor} and d.chave = x.chave`);
  }

  /** Os apelidos que valem para os nomes da lista: chave → o insumo. */
  async acharApelidos(tenantId: string, textos: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    const chaves = [...new Set(textos.map(chaveDoApelido).filter((c): c is string => !!c))];
    if (!chaves.length) return m;
    const ls = linhas(
      await this.db.execute(sql`
        select chave, item_id::text as "itemId" from mister_apelido
         where tenant_id = ${tenantId}::uuid and chave in (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`),
    );
    for (const l of ls) m.set(String(l.chave), String(l.itemId));
    return m;
  }

  /**
   * Grava os apelidos confirmados (uma instrução para a lista inteira; o novo vence, e o mesmo insumo soma uma vez). A chave já vem
   * de `viraApelido` (o nome diferente do cadastro).
   */
  async gravarApelidos(tenantId: string, atorId: string | null, pares: Array<{ chave: string; texto: string; itemId: string }>): Promise<void> {
    const unicos = [...new Map(pares.filter((p) => p.chave && UUID.test(p.itemId)).map((p) => [p.chave, p])).values()];
    if (!unicos.length) return;
    await this.db.execute(sql`
      insert into mister_apelido (tenant_id, chave, texto, item_id, vezes, alterado_por)
      select ${tenantId}::uuid, x.chave, x.texto, x.item_id, 1, ${atorId}::uuid
        from jsonb_to_recordset(${JSON.stringify(unicos.map((p) => ({ chave: p.chave.slice(0, 120), texto: String(p.texto).slice(0, 80), item_id: p.itemId })))}::jsonb)
             as x(chave text, texto text, item_id uuid)
       where length(x.chave) between 2 and 120
      on conflict (tenant_id, chave) do update
        set texto = excluded.texto,
            vezes = case when mister_apelido.item_id = excluded.item_id then mister_apelido.vezes + 1 else 1 end,
            item_id = excluded.item_id, alterado_por = excluded.alterado_por, atualizado_em = clock_timestamp()`);
  }

  private async auditar(tenantId: string, atorId: string, atorPerfil: string, acao: string, detalhe: Record<string, unknown>) {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil, tipo: 'mister', acao, entidadeTipo: 'mister_de_para', entidadeId: null, origem: 'web', detalhe } as any)
      .catch(() => undefined);
  }
}
