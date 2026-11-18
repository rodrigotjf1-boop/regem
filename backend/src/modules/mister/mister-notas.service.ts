import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { hojeISO } from '../../common/data';
import { Conversao, fatorParaEstoque } from '../../common/conversao-unidade';
import { custosMediosNaLoja, lojaDeControle } from '../../common/custo-loja';
import {
  FRASES_DA_NOTA,
  ItemNoMister,
  NotaNoMister,
  chaveDoDePara,
  conferirNota,
  custosQueMudaram,
  fatorDoTexto,
  instrucoesDaNota,
  lerLeituraDaNota,
  proximaPendencia,
  sugerirInsumos,
} from '../../common/nota-por-foto';
import { RECURSO_DO_DOCUMENTO, notasNaInstalacao } from '../../common/documento-por-foto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EstoqueService } from '../estoque/estoque.service';
import { normalizarUnidade } from '../estoque/unidades';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { RecebimentoService } from '../recebimento/recebimento.service';
import { QuemMandou, QuemTocou } from './mister-entrada.service';
import { MisterNumeroService } from './mister-numero.service';
import { Resposta } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRAZO_DA_NOTA_MS = 60_000;
/** Quantos insumos a sugestão olha (o cadastro inteiro de uma loja cabe). */
const MAX_INSUMOS = 3000;

/** O toque na escolha do insumo de um item: "doc:ni:<documento>:<item>:<0|1|2 = sugestão | n = cadastrar novo | f = fora>". */
export function lerEscolhaDoItem(botaoId: unknown): { documentoId: string; indice: number; escolha: '0' | '1' | '2' | 'n' | 'f' } | null {
  const m = /^doc:ni:([0-9a-f-]{36}):(\d{1,2}):(0|1|2|n|f)$/i.exec(String(botaoId ?? ''));
  return m && UUID.test(m[1]) ? { documentoId: m[1], indice: Number(m[2]), escolha: m[3].toLowerCase() as any } : null;
}

/**
 * A NOTA DO FORNECEDOR POR FOTO NO MISTER (M3b parte 2; versão 3 do protótipo, conversa 12, decisão 2: sempre mostra e
 * pergunta antes, porque mexe no estoque e no custo da ficha).
 *
 * O documento chega pelo serviço dos documentos (a primeira leitura disse "nota"). Daqui: a IA lê o DANFE (os itens,
 * as parcelas), o código confere (a chave pelo dígito, os itens e as parcelas somando o total), e cada item vai para um
 * insumo do estoque — pela memória do fornecedor (`mister_de_para`), ou perguntando ("é o Bacon em tiras que já existe,
 * ou cadastro um novo?") e, quando a unidade da nota não chega à do estoque, "1 CX tem quantos kg?". Tudo resolvido, o
 * resumo e "Lançar": a entrada pelo MESMO recebimento da tela (Estoque › Recebimento, o custo médio, os lotes) e a conta a
 * pagar pelo TOTAL da nota, uma por parcela, pelo MESMO serviço do Financeiro. Nunca lança sem o "Lançar".
 *
 * NASCE DESLIGADO: só com `MISTER_NOTAS=1` (além do `MISTER_DOCUMENTOS=1`); desligado, a nota segue com a frase de antes.
 */
@Injectable()
export class MisterNotasService {
  private readonly logger = new Logger('MisterNotas');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly ia: IaEmpresaService,
    private readonly recebimento: RecebimentoService,
    private readonly financeiro: FinanceiroService,
    private readonly estoque: EstoqueService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** A nota por foto está ligada nesta instalação? (A regra mora em `notasNaInstalacao`: a tela lê a mesma.) */
  ligadas(): boolean {
    return notasNaInstalacao();
  }

  // ───────────────────────────── a foto da nota ──────────────────────────

  /** A foto que a primeira leitura disse ser nota: lê os itens, confere e começa a conversa. */
  async receber(quem: QuemMandou, wamid: string | null, bloco: any, modelo: string): Promise<void> {
    let saida: string;
    try {
      const r = await this.ia.pedir(quem.tenantId, {
        recurso: RECURSO_DO_DOCUMENTO,
        modelo,
        maxTokens: 3000,
        system: instrucoesDaNota(),
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Leia esta nota fiscal.' }] }],
        prazoMs: PRAZO_DA_NOTA_MS,
      });
      saida = r.texto;
    } catch (e: any) {
      this.logger.warn(`nota de ${quem.tenantId.slice(0, 8)}: a IA não leu (${e instanceof FalhaDaIa ? e.motivo : e?.message ?? e})`);
      await this.falar(quem.telefone, { texto: 'Para ler a foto eu preciso da IA, e ela está parada agora. Tente de novo mais tarde.' });
      return;
    }
    const leitura = lerLeituraDaNota(saida);
    const problemas = leitura ? conferirNota(leitura) : (['ilegivel'] as const);
    if (!leitura || problemas.length) {
      await this.gravar(quem, wamid, 'recusado', leitura ? problemas.join(',') : 'leitura_fora_do_formato', null, null);
      await this.falar(quem.telefone, { texto: FRASES_DA_NOTA.problema([...problemas]) });
      return;
    }

    const fornecedorId = await this.fornecedorPeloCnpj(quem.tenantId, leitura.emitenteCnpj);
    const insumos = await this.insumos(quem.tenantId);
    const memoria = await this.memoria(quem.tenantId, leitura.emitenteCnpj, leitura.itens.map(chaveDoDePara));
    const conversoes = await this.conversoes(quem.tenantId, [...new Set([...memoria.values()].map((m) => m.itemId).filter(Boolean))] as string[]);
    const itens: ItemNoMister[] = leitura.itens.map((it) => {
      const lembrado = memoria.get(chaveDoDePara(it));
      if (lembrado && !lembrado.itemId) return { ...it, insumoId: null, insumoNome: null, unidadeDoEstoque: null, fator: null, estado: 'fora', sugestoes: [] };
      const insumo = lembrado ? insumos.find((x) => x.id === lembrado.itemId) : undefined;
      if (insumo) {
        const fator = lembrado!.fator ?? fatorParaEstoque(it.unidade, insumo.unidadeMedida, conversoes.get(insumo.id) ?? []);
        return { ...it, insumoId: insumo.id, insumoNome: insumo.nome, unidadeDoEstoque: insumo.unidadeMedida, fator, estado: fator == null ? 'fator' : 'ligado', sugestoes: [] };
      }
      const sugestoes = sugerirInsumos(it.descricao, insumos).map((s) => ({ id: s.id, nome: s.nome }));
      return { ...it, insumoId: null, insumoNome: null, unidadeDoEstoque: null, fator: null, estado: 'item', sugestoes };
    });
    const nota: NotaNoMister = {
      chave: leitura.chave,
      numero: leitura.numero,
      emitenteNome: leitura.emitenteNome,
      emitenteCnpj: leitura.emitenteCnpj,
      valorTotalCentavos: leitura.valorTotalCentavos!,
      duplicatas: leitura.duplicatas,
      itens,
    };
    const pend = proximaPendencia(nota);
    const id = await this.gravar(quem, wamid, pend ? 'falta' : 'confirmar', pend ? `${pend.tipo}:${pend.indice}` : 'itens_ligados', nota, fornecedorId);
    if (!id) return;
    await this.seguir(quem.telefone, id, nota);
  }

  // ───────────────────────────── as respostas ──────────────────────────

  /** O toque na escolha do insumo de um item. Devolve false quando o documento não é das empresas de quem tocou. */
  async escolher(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const e = lerEscolhaDoItem(botaoId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!e || !empresas.length) return false;
    const resultado = await this.db.transaction(async (tx: any) => {
      const [d] = linhas(
        await tx.execute(sql`
          select id::text as id, tenant_id::text as "tenantId", situacao, tipo, fornecedor_id::text as "fornecedorId", dados
            from mister_documento
           where id = ${e.documentoId}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})
           for update`),
      );
      if (!d || d.tipo !== 'nota') return { achou: false } as const;
      const v = quem.vinculos.find((x) => x.tenantId === d.tenantId)!;
      if (v.nivel !== 'presidente') return { achou: true, resposta: { texto: 'Lançar nota por foto, por enquanto, é só com o presidente.' } } as const;
      const nota: NotaNoMister | undefined = d.dados?.nota;
      const it = nota?.itens?.[e.indice];
      if (d.situacao !== 'falta' || !nota || !it || it.estado !== 'item') return { achou: true, resposta: { texto: 'Este item já foi respondido.' } } as const;

      if (e.escolha === 'f') {
        Object.assign(it, { estado: 'fora', insumoId: null, insumoNome: null, unidadeDoEstoque: null, fator: null });
      } else {
        let insumo: { id: string; nome: string; unidadeMedida: string } | null = null;
        if (e.escolha === 'n') {
          try {
            const novo: any = await this.estoque.createItem(
              d.tenantId,
              { nome: it.descricao, unidadeMedida: normalizarUnidade(it.unidade ?? '') ?? 'unidade', ...(d.fornecedorId ? { fornecedorIds: [d.fornecedorId] } : {}) } as any,
              null,
              { colaboradorId: v.colaboradorId, categoria: 'presidente' },
            );
            insumo = { id: novo.id, nome: novo.nome, unidadeMedida: novo.unidadeMedida };
          } catch (err: any) {
            const msg = err instanceof BadRequestException ? String((err.getResponse() as any)?.message ?? err.message) : 'não deu para cadastrar';
            return { achou: true, resposta: { texto: `Não consegui cadastrar o "${it.descricao}": ${msg}` } } as const;
          }
        } else {
          const s = it.sugestoes[Number(e.escolha)];
          if (!s) return { achou: true, resposta: { texto: 'Este item já foi respondido.' } } as const;
          const [x] = linhas(
            await tx.execute(sql`
              select id::text as id, nome, unidade_medida as "unidadeMedida" from item_estoque
               where id = ${s.id}::uuid and tenant_id = ${d.tenantId}::uuid and deleted_at is null`),
          );
          if (!x) return { achou: true, resposta: { texto: `O "${s.nome}" não está mais no estoque.` } } as const;
          insumo = x;
        }
        const conv = (await this.conversoes(d.tenantId, [insumo!.id], tx)).get(insumo!.id) ?? [];
        const fator = fatorParaEstoque(it.unidade, insumo!.unidadeMedida, conv);
        Object.assign(it, { insumoId: insumo!.id, insumoNome: insumo!.nome, unidadeDoEstoque: insumo!.unidadeMedida, fator, estado: fator == null ? 'fator' : 'ligado' });
      }
      await this.lembrar(tx, d.tenantId, nota.emitenteCnpj, it, v.colaboradorId);
      const pend = proximaPendencia(nota);
      await tx.execute(sql`
        update mister_documento
           set dados = jsonb_set(dados, '{nota}', ${JSON.stringify(nota)}::jsonb), situacao = ${pend ? 'falta' : 'confirmar'},
               motivo = ${pend ? `${pend.tipo}:${pend.indice}` : 'itens_ligados'}, atualizado_em = clock_timestamp()
         where id = ${d.id}::uuid`);
      return { achou: true, seguir: { id: d.id, nota } } as const;
    });
    if (!resultado.achou) return false;
    if ('resposta' in resultado && resultado.resposta) await this.falar(quem.telefone, resultado.resposta);
    if ('seguir' in resultado && resultado.seguir) await this.seguir(quem.telefone, resultado.seguir.id, resultado.seguir.nota);
    return true;
  }

  /** O texto que responde "1 CX tem quantos kg?". Só a nota desta pessoa esperando um fator, dos últimos 30 minutos. */
  async responderFator(quem: QuemMandou, texto: string): Promise<boolean> {
    const fator = fatorDoTexto(texto);
    if (fator == null) return false;
    const resultado = await this.db.transaction(async (tx: any) => {
      const [d] = linhas(
        await tx.execute(sql`
          select id::text as id, dados, motivo from mister_documento
           where tenant_id = ${quem.tenantId}::uuid and colaborador_id = ${quem.colaboradorId}::uuid and tipo = 'nota'
             and situacao = 'falta' and motivo like 'fator:%' and atualizado_em > clock_timestamp() - interval '30 minutes'
           order by atualizado_em desc limit 1
           for update`),
      );
      const nota: NotaNoMister | undefined = d?.dados?.nota;
      const indice = Number(String(d?.motivo ?? '').split(':')[1]);
      const it = nota?.itens?.[indice];
      if (!d || !nota || !it || it.estado !== 'fator') return null;
      Object.assign(it, { fator, estado: 'ligado' });
      await this.lembrar(tx, quem.tenantId, nota.emitenteCnpj, it, quem.colaboradorId);
      const pend = proximaPendencia(nota);
      await tx.execute(sql`
        update mister_documento
           set dados = jsonb_set(dados, '{nota}', ${JSON.stringify(nota)}::jsonb), situacao = ${pend ? 'falta' : 'confirmar'},
               motivo = ${pend ? `${pend.tipo}:${pend.indice}` : 'itens_ligados'}, atualizado_em = clock_timestamp()
         where id = ${d.id}::uuid`);
      return { id: d.id as string, nota };
    });
    if (!resultado) return false;
    await this.seguir(quem.telefone, resultado.id, resultado.nota);
    return true;
  }

  /**
   * "Lançar": a passagem condicional "confirmar" → "lancado" (o toque repetido não lança de novo), a entrada pelo
   * recebimento da tela (criado e confirmado, sem a conta pela soma dos itens) e as contas a pagar pelo total da nota, uma
   * por parcela. Se algo falhar no meio, o documento volta a "confirmar" e a pessoa fica sabendo.
   */
  async lancar(documentoId: string, tenantId: string, colaboradorId: string, unidadeId: string | null): Promise<Resposta> {
    const [d] = linhas(
      await this.db.execute(sql`
        update mister_documento set situacao = 'lancado', respondido_em = now(), atualizado_em = clock_timestamp()
         where id = ${documentoId}::uuid and tenant_id = ${tenantId}::uuid and tipo = 'nota' and situacao = 'confirmar'
        returning dados, fornecedor_id::text as "fornecedorId"`),
    );
    const nota: NotaNoMister | undefined = d?.dados?.nota;
    if (!d || !nota) return { texto: 'Esta nota já foi respondida.' };
    const loja = unidadeId ?? (await this.lojaUnica(tenantId));
    let recebimentoId: string | null = null;
    const titulos: string[] = [];
    // M3b.3: o custo médio de cada insumo ANTES da entrada (a mesma leitura das telas: o da loja, ou o do cadastro).
    // Numa consulta só, e nunca derruba o lançamento: sem a leitura, a resposta sai sem a linha do custo.
    const ligados = [...new Map(nota.itens.filter((it) => it.estado === 'ligado' && it.insumoId).map((it) => [it.insumoId as string, it])).values()];
    const lerCustos = () =>
      lojaDeControle(this.db, tenantId, loja)
        .then((controle) => custosMediosNaLoja(this.db, tenantId, ligados.map((it) => it.insumoId as string), controle))
        .catch(() => null);
    const antes = await lerCustos();
    try {
      const itens = nota.itens
        .filter((it) => it.estado === 'ligado' && it.insumoId && it.fator)
        .map((it) => {
          const quantidade = Math.round(it.quantidade * (it.fator as number) * 10000) / 10000;
          const totalReais = (it.valorTotalCentavos ?? Math.round((it.valorUnitarioCentavos ?? 0) * it.quantidade)) / 100;
          return { itemId: it.insumoId as string, qtdEsperada: quantidade, qtdRecebida: quantidade, custoUnitario: quantidade > 0 ? Math.round((totalReais / quantidade) * 10000) / 10000 : undefined };
        });
      if (itens.length) {
        const rec: any = await this.recebimento.create(
          tenantId,
          {
            fornecedorId: d.fornecedorId ?? undefined,
            unidadeId: loja ?? undefined,
            data: hojeISO(),
            vencimento: nota.duplicatas[0]?.vencimento,
            notaRef: nota.numero ?? undefined,
            obs: `Lançada por foto pelo Mister${nota.chave ? ` · chave ${nota.chave}` : ''}`,
            itens,
          } as any,
          null,
        );
        recebimentoId = rec.id;
        await this.recebimento.confirmar(tenantId, colaboradorId, 'presidente', rec.id, null, { semConta: true });
      }
      const parcelas = nota.duplicatas.length ? nota.duplicatas : [{ vencimento: null as string | null, valorCentavos: nota.valorTotalCentavos }];
      for (const [k, p] of parcelas.entries()) {
        const t: any = await this.financeiro.criar(
          tenantId,
          colaboradorId,
          'presidente',
          {
            tipo: 'pagar',
            descricao: `NF ${nota.numero ?? 's/n'} · ${nota.emitenteNome ?? 'fornecedor'}${parcelas.length > 1 ? ` (${k + 1}/${parcelas.length})` : ''}`.slice(0, 200),
            valor: p.valorCentavos / 100,
            vencimento: p.vencimento ?? undefined,
            fornecedorId: d.fornecedorId ?? undefined,
            categoria: 'fornecedor',
          } as any,
          loja,
          { origem: 'mister' },
        );
        titulos.push(t.id);
      }
    } catch (e: any) {
      this.logger.error(`nota ${documentoId}: o lançamento parou no meio — ${e?.message ?? e}`, e?.stack);
      await this.db.execute(sql`
        update mister_documento set situacao = 'confirmar', respondido_em = null, recebimento_id = ${recebimentoId}::uuid,
               titulo_id = ${titulos[0] ?? null}::uuid, atualizado_em = clock_timestamp()
         where id = ${documentoId}::uuid and situacao = 'lancado'`);
      return { texto: `Não consegui lançar a nota agora${recebimentoId ? ' (a entrada no estoque já foi feita: confira em Estoque › Recebimento)' : ''}. Tente de novo em instantes.` };
    }
    await this.db.execute(sql`
      update mister_documento set recebimento_id = ${recebimentoId}::uuid, titulo_id = ${titulos[0] ?? null}::uuid, atualizado_em = clock_timestamp()
       where id = ${documentoId}::uuid`);
    await this.auditoria
      ?.registrar({ tenantId, atorId: colaboradorId, atorPerfil: 'presidente', tipo: 'mister', acao: 'mister_nota_lancada', entidadeTipo: 'mister_documento', entidadeId: documentoId, detalhe: { recebimento: recebimentoId, titulos } } as any)
      .catch(() => undefined);
    // M3b.3: o custo que mudou com a entrada (o protótipo: "O quilo da carne 56 g passou de R$ 31,90 para R$ 33,00").
    const depois = antes ? await lerCustos() : null;
    const mudancas: Array<{ insumo: string; unidade: string; antes: number; depois: number }> = [];
    for (const it of ligados) {
      const a = antes?.get(it.insumoId as string);
      const c = depois?.get(it.insumoId as string);
      if (a != null && c != null) mudancas.push({ insumo: it.insumoNome ?? '', unidade: it.unidadeDoEstoque ?? 'unidade', antes: a, depois: c });
    }
    return { texto: FRASES_DA_NOTA.lancada(nota, titulos.length, custosQueMudaram(mudancas)) };
  }

  // ───────────────────────────── por dentro ──────────────────────────

  /** A próxima pergunta, ou o resumo com "Lançar". */
  private async seguir(telefone: string, id: string, nota: NotaNoMister): Promise<void> {
    const pend = proximaPendencia(nota);
    if (!pend) {
      await this.falar(telefone, {
        texto: FRASES_DA_NOTA.resumo(nota),
        botoes: [
          { id: `doc:lancar:${id}`, titulo: 'Lançar' },
          { id: `doc:outra:${id}`, titulo: 'Cancelar' },
        ],
      });
      return;
    }
    const it = nota.itens[pend.indice];
    if (pend.tipo === 'fator') {
      await this.falar(telefone, { texto: FRASES_DA_NOTA.perguntaFator(it) });
      return;
    }
    const botoes = [
      ...(it.sugestoes[0] ? [{ id: `doc:ni:${id}:${pend.indice}:0`, titulo: `É o ${it.sugestoes[0].nome}` }] : []),
      { id: `doc:ni:${id}:${pend.indice}:n`, titulo: 'Cadastrar novo' },
      { id: `doc:ni:${id}:${pend.indice}:f`, titulo: 'Fora do estoque' },
    ];
    await this.falar(telefone, { texto: FRASES_DA_NOTA.perguntaItem(it), botoes });
  }

  /** Grava a nota (uma vez por foto). */
  private async gravar(quem: QuemMandou, wamid: string | null, situacao: string, motivo: string, nota: NotaNoMister | null, fornecedorId: string | null): Promise<string | null> {
    const [l] = linhas(
      await this.db.execute(sql`
        insert into mister_documento (tenant_id, unidade_id, colaborador_id, telefone_final, wamid, tipo, situacao, motivo,
                                      valor_centavos, vencimento, beneficiario, fornecedor_id, dados)
        values (${quem.tenantId}::uuid, ${quem.unidadeId}::uuid, ${quem.colaboradorId}::uuid, ${quem.telefone.slice(-4)}, ${wamid},
                'nota', ${situacao}, ${motivo}, ${nota?.valorTotalCentavos ?? null}, ${nota?.duplicatas[0]?.vencimento ?? null}::date,
                ${nota?.emitenteNome ?? null}, ${fornecedorId}::uuid, ${JSON.stringify(nota ? { nota } : {})}::jsonb)
        on conflict (wamid) where wamid is not null do nothing
        returning id::text as id`),
    );
    return l?.id ?? null;
  }

  /** Guarda a resposta do item no de-para do fornecedor (a próxima nota já vem ligada). */
  private async lembrar(tx: any, tenantId: string, cnpj: string | null, it: ItemNoMister, atorId: string): Promise<void> {
    if (!cnpj || (it.estado !== 'ligado' && it.estado !== 'fora' && it.estado !== 'fator')) return;
    await tx.execute(sql`
      insert into mister_de_para (tenant_id, fornecedor_cnpj, chave, item_id, fator, unidade_nota, alterado_por, atualizado_em)
      values (${tenantId}::uuid, ${cnpj}, ${chaveDoDePara(it)}, ${it.insumoId}::uuid, ${it.estado === 'ligado' ? it.fator : null}, ${it.unidade}, ${atorId}::uuid, now())
      on conflict (tenant_id, fornecedor_cnpj, chave) do update
        set item_id = excluded.item_id, fator = coalesce(excluded.fator, case when mister_de_para.item_id is not distinct from excluded.item_id then mister_de_para.fator end),
            unidade_nota = excluded.unidade_nota, alterado_por = excluded.alterado_por, atualizado_em = now()`);
  }

  private async memoria(tenantId: string, cnpj: string | null, chaves: string[]): Promise<Map<string, { itemId: string | null; fator: number | null }>> {
    const m = new Map<string, { itemId: string | null; fator: number | null }>();
    if (!cnpj || !chaves.length) return m;
    const lidas = linhas(
      await this.db.execute(sql`
        select chave, item_id::text as "itemId", fator from mister_de_para
         where tenant_id = ${tenantId}::uuid and fornecedor_cnpj = ${cnpj} and chave in (${sql.join(chaves.map((c) => sql`${c}`), sql`, `)})`),
    );
    for (const l of lidas) m.set(l.chave, { itemId: l.itemId ?? null, fator: l.fator != null ? Number(l.fator) : null });
    return m;
  }

  private async insumos(tenantId: string): Promise<Array<{ id: string; nome: string; nomeComercial: string | null; unidadeMedida: string }>> {
    return linhas(
      await this.db.execute(sql`
        select id::text as id, nome, nome_comercial as "nomeComercial", unidade_medida as "unidadeMedida" from item_estoque
         where tenant_id = ${tenantId}::uuid and deleted_at is null
         order by nome limit ${MAX_INSUMOS}`),
    );
  }

  private async conversoes(tenantId: string, itens: string[], tx: any = this.db): Promise<Map<string, Conversao[]>> {
    const m = new Map<string, Conversao[]>();
    if (!itens.length) return m;
    const lidas = linhas(
      await tx.execute(sql`
        select item_id::text as "itemId", unidade_de as "unidadeDe", fator, unidade_para as "unidadePara" from item_conversao
         where tenant_id = ${tenantId}::uuid and item_id in (${sql.join(itens.map((i) => sql`${i}::uuid`), sql`, `)})`),
    );
    for (const l of lidas) m.set(l.itemId, [...(m.get(l.itemId) ?? []), { unidadeDe: l.unidadeDe, fator: l.fator, unidadePara: l.unidadePara }]);
    return m;
  }

  private async fornecedorPeloCnpj(tenantId: string, cnpj: string | null): Promise<string | null> {
    if (!cnpj) return null;
    const [f] = linhas(
      await this.db.execute(sql`
        select id::text as id from fornecedor
         where tenant_id = ${tenantId}::uuid and deleted_at is null and regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${cnpj}
         order by created_at limit 1`),
    );
    return f?.id ?? null;
  }

  /** A empresa de uma loja só: a entrada vai para ela (o presidente sem loja escolhida). Mais de uma: a rede (null). */
  private async lojaUnica(tenantId: string): Promise<string | null> {
    const lojas = linhas(await this.db.execute(sql`select id::text as id from unidade where tenant_id = ${tenantId}::uuid and deleted_at is null limit 2`));
    return lojas.length === 1 ? lojas[0].id : null;
  }

  private async falar(telefone: string, r: Resposta): Promise<void> {
    try {
      await this.numero.enviar(telefone, r);
    } catch (e: any) {
      this.logger.warn(`a resposta da nota não saiu para ***${telefone.slice(-4)} — ${e?.message ?? e}`);
    }
  }
}
