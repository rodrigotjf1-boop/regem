import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import {
  DadosDoLancamento,
  FRASES_DO_DOCUMENTO,
  MODELO_DO_DOCUMENTO_PADRAO,
  ModoDoBoleto,
  RECURSO_DO_DOCUMENTO,
  decidirDocumento,
  instrucoesDoDocumento,
  lerLeituraDaFoto,
} from '../../common/documento-por-foto';
import { MAX_BYTES_DA_FOTO, mimeDaFoto } from '../../common/foto-do-cliente';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { MidiaDoMister, MisterEntradaService, QuemMandou, QuemTocou } from './mister-entrada.service';
import { MisterNumeroService } from './mister-numero.service';
import { Resposta } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PREFIXO_DO_BOTAO = 'doc:';
const PRAZO_DA_IA_MS = 40_000;
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AcaoDoBotao = 'lancar' | 'outra' | 'desfazer';
/** "doc:<ação>:<id do documento>". */
export function lerBotaoDoDocumento(botaoId: unknown): { acao: AcaoDoBotao; documentoId: string } | null {
  const m = /^doc:(lancar|outra|desfazer):(.+)$/.exec(String(botaoId ?? ''));
  return m && UUID.test(m[2]) ? { acao: m[1] as AcaoDoBotao, documentoId: m[2] } : null;
}
const botao = (acao: AcaoDoBotao, id: string, titulo: string) => ({ id: `${PREFIXO_DO_BOTAO}${acao}:${id}`, titulo });

/**
 * OS DOCUMENTOS POR FOTO DO MISTER (M3a, mig 439 — versão 3 do protótipo aprovada em 17/11/2026, conversas 11 a 13).
 *
 * O presidente manda a foto (ou o PDF) de um boleto ou conta pelo WhatsApp do Mister. Daqui: baixar (a credencial da
 * distribuição), a IA ler (o modelo mais forte, pela porta ÚNICA da IA da empresa, com o medidor no recurso
 * `mister_documento`), o código conferir (`decidirDocumento` → `lerBoleto`) e:
 *   · lançar sozinho (o boleto bancário conferido, de fornecedor cadastrado) — com "Desfazer";
 *   · perguntar "Lanço?" (conta de consumo, sem código, fornecedor novo) — "Lançar" / "Mandar outra foto";
 *   · pedir outra foto, ou dizer que não é documento, ou que a nota é da próxima parte.
 * A conta a pagar sai pelo MESMO `FinanceiroService.criar` da tela (com `origem: 'mister'`), e o "Desfazer" é o MESMO
 * `cancelar` (só a conta ainda em aberto). Uma leitura por foto (a entrada já não repete a mensagem; o índice no `wamid`
 * também segura). A foto não é guardada.
 *
 * NASCE DESLIGADO: só com `MISTER_DOCUMENTOS=1` na nuvem (o dono liga). Desligado, a foto segue como antes ("só leio
 * texto"). Por enquanto só o presidente lança (como a autorização das propostas).
 */
@Injectable()
export class MisterDocumentosService implements OnModuleInit {
  private readonly logger = new Logger('MisterDocumentos');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly ia: IaEmpresaService,
    private readonly financeiro: FinanceiroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** A foto e os botões chegam pela entrada do WhatsApp, que mora no módulo de baixo. */
  onModuleInit(): void {
    this.entrada?.registrarDocumento((quem, midia, wamid) => this.receber(quem, midia, wamid));
    this.entrada?.registrarBotao(PREFIXO_DO_BOTAO, (botaoId, quem) => this.responderBotao(botaoId, quem));
  }

  /** A leitura de documentos está ligada nesta nuvem? */
  ligado(): boolean {
    return !ehServidorLocal() && process.env.MISTER_DOCUMENTOS === '1';
  }

  modelo(): string {
    return String(process.env.MISTER_DOCUMENTOS_MODELO ?? '').trim() || MODELO_DO_DOCUMENTO_PADRAO;
  }

  /** O jeito de lançar o boleto conferido. O ajuste por empresa entra com a parte "Documentos" (M3a.3); até lá, o padrão aprovado. */
  protected async modoDoBoleto(_tenantId: string): Promise<ModoDoBoleto> {
    return 'sozinho';
  }

  // ───────────────────────────── a foto ──────────────────────────

  async receber(quem: QuemMandou, midia: MidiaDoMister, wamid: string | null): Promise<boolean> {
    if (!this.ligado()) return false;
    const tipo = midia.tipo === 'imagem' ? mimeDaFoto(midia.mime) : String(midia.mime ?? '').toLowerCase().startsWith('application/pdf') ? 'application/pdf' : null;
    // Figurinha, áudio, planilha: não é com os documentos (segue como antes).
    if (!tipo) return false;
    if (quem.nivel !== 'presidente') {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.soPresidente });
      return true;
    }
    if (!(await this.ia.temAcesso(quem.tenantId))) {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.semIa });
      return true;
    }
    const arquivo = await this.numero.baixarMidia(midia.id);
    if (!arquivo || !arquivo.buffer.length || arquivo.buffer.length > MAX_BYTES_DA_FOTO) {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto('ilegivel') });
      return true;
    }

    let texto: string;
    try {
      const bloco =
        tipo === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.buffer.toString('base64') } }
          : { type: 'image', source: { type: 'base64', media_type: tipo, data: arquivo.buffer.toString('base64') } };
      const r = await this.ia.pedir(quem.tenantId, {
        recurso: RECURSO_DO_DOCUMENTO,
        modelo: this.modelo(),
        maxTokens: 400,
        system: instrucoesDoDocumento(),
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Leia este documento.' }] }],
        prazoMs: PRAZO_DA_IA_MS,
      });
      texto = r.texto;
    } catch (e: any) {
      this.logger.warn(`documento de ${quem.tenantId.slice(0, 8)}: a IA não leu (${e instanceof FalhaDaIa ? e.motivo : e?.message ?? e})`);
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.semIa });
      return true;
    }

    const leitura = lerLeituraDaFoto(texto);
    if (!leitura) {
      await this.registrar(quem, wamid, { tipo: 'outro', situacao: 'recusado', motivo: 'leitura_fora_do_formato' });
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto('ilegivel') });
      return true;
    }
    const fornecedor = await this.fornecedorDe(quem.tenantId, leitura.cnpj, leitura.beneficiario);
    const decisao = decidirDocumento(leitura, !!fornecedor, await this.modoDoBoleto(quem.tenantId));

    switch (decisao.acao) {
      case 'nota':
        await this.registrar(quem, wamid, { tipo: 'nota', situacao: 'recusado', motivo: 'nota' });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.nota });
        return true;
      case 'nao_e_documento':
        await this.registrar(quem, wamid, { tipo: 'outro', situacao: 'recusado', motivo: 'nao_e_documento' });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.naoEDocumento });
        return true;
      case 'outra_foto':
        await this.registrar(quem, wamid, { tipo: leitura.tipo, situacao: 'recusado', motivo: decisao.porque });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.outraFoto(decisao.porque) });
        return true;
      case 'perguntar':
        await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'falta', motivo: decisao.falta.join(','), dados: decisao.dados, fornecedorId: fornecedor });
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.perguntar(decisao.falta) });
        return true;
      case 'confirmar': {
        const id = await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'confirmar', motivo: decisao.porque, dados: decisao.dados, fornecedorId: fornecedor });
        if (!id) return true;
        await this.falar(quem.telefone, {
          texto: FRASES_DO_DOCUMENTO.confirmar(decisao.dados, decisao.porque),
          botoes: [botao('lancar', id, 'Lançar'), botao('outra', id, 'Mandar outra foto')],
        });
        return true;
      }
      case 'lancar': {
        const id = await this.registrar(quem, wamid, { tipo: decisao.dados.tipo, situacao: 'confirmar', motivo: 'sozinho', dados: decisao.dados, fornecedorId: fornecedor });
        if (!id) return true;
        const titulo = await this.lancar(id, quem.tenantId, quem.colaboradorId, quem.unidadeId);
        if (!titulo) {
          // Não lançou (a conta a pagar foi recusada): fica para a pessoa decidir.
          await this.falar(quem.telefone, {
            texto: FRASES_DO_DOCUMENTO.confirmar(decisao.dados, 'modo'),
            botoes: [botao('lancar', id, 'Lançar'), botao('outra', id, 'Mandar outra foto')],
          });
          return true;
        }
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.lancado(decisao.dados), botoes: [botao('desfazer', id, 'Desfazer')] });
        return true;
      }
    }
  }

  // ───────────────────────────── os botões ──────────────────────────

  async responderBotao(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoDocumento(botaoId);
    const empresas = quem.vinculos.map((v) => v.tenantId);
    if (!b || !empresas.length) return false;
    const d = await this.documentoDoBotao(b.documentoId, empresas);
    if (!d) return false;
    const v = quem.vinculos.find((x) => x.tenantId === d.tenantId)!;
    if (v.nivel !== 'presidente') {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.soPresidente });
      return true;
    }

    if (b.acao === 'lancar') {
      if (d.situacao !== 'confirmar') {
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.jaRespondido });
        return true;
      }
      const titulo = await this.lancar(d.id, d.tenantId, v.colaboradorId, d.unidadeId ?? null);
      if (!titulo) {
        await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.jaRespondido });
        return true;
      }
      const [dados] = linhas(await this.db.execute(sql`select dados from mister_documento where id = ${d.id}::uuid`));
      await this.falar(quem.telefone, {
        texto: `Lancei nas contas a pagar${dados?.dados?.vencimento ? `, para ${String(dados.dados.vencimento).slice(8, 10)}/${String(dados.dados.vencimento).slice(5, 7)}` : ''}.`,
        botoes: [botao('desfazer', d.id, 'Desfazer')],
      });
      return true;
    }

    if (b.acao === 'outra') {
      const [mudou] = linhas(
        await this.db.execute(sql`
          update mister_documento set situacao = 'recusado', motivo = 'outra_foto', respondido_em = now(), atualizado_em = clock_timestamp()
           where id = ${d.id}::uuid and situacao = 'confirmar' returning id`),
      );
      await this.falar(quem.telefone, { texto: mudou ? 'Certo: manda a outra foto, com o documento inteiro, de perto e com luz.' : FRASES_DO_DOCUMENTO.jaRespondido });
      return true;
    }

    // Desfazer: só o lançado, e só com a conta a pagar ainda em aberto (o MESMO cancelamento da tela).
    if (d.situacao !== 'lancado' || !d.tituloId) {
      await this.falar(quem.telefone, { texto: d.situacao === 'desfeito' ? FRASES_DO_DOCUMENTO.naoDaParaDesfazer : FRASES_DO_DOCUMENTO.jaRespondido });
      return true;
    }
    try {
      await this.financeiro.cancelar(d.tenantId, v.colaboradorId, 'presidente', d.tituloId, null);
    } catch {
      await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.naoDaParaDesfazer });
      return true;
    }
    await this.db.execute(sql`
      update mister_documento set situacao = 'desfeito', respondido_em = now(), atualizado_em = clock_timestamp()
       where id = ${d.id}::uuid and situacao = 'lancado'`);
    await this.auditar(d.tenantId, v.colaboradorId, 'mister_documento_desfeito', d.id, { titulo: d.tituloId });
    await this.falar(quem.telefone, { texto: FRASES_DO_DOCUMENTO.desfeito });
    return true;
  }

  // ───────────────────────────── por dentro ──────────────────────────

  /**
   * O documento do botão, só entre as empresas de quem tocou. A situação lida aqui é só para a resposta: quem garante o
   * "uma vez" é a passagem condicional do `lancar` (e o teste segura duas leituras juntas para provar isso).
   */
  protected async documentoDoBotao(documentoId: string, empresas: string[]): Promise<any | null> {
    const [d] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", situacao, titulo_id::text as "tituloId"
          from mister_documento
         where id = ${documentoId}::uuid and tenant_id in (${sql.join(empresas.map((t) => sql`${t}::uuid`), sql`, `)})`),
    );
    return d ?? null;
  }

  /**
   * Lança o documento como conta a pagar, uma vez: primeiro a passagem condicional "confirmar" → "lancado" (o toque
   * repetido e o de outro aparelho não passam), depois a conta pelo serviço da tela. Se a conta for recusada, o documento
   * volta a "confirmar". Devolve o id da conta, ou null.
   */
  private async lancar(documentoId: string, tenantId: string, colaboradorId: string, unidadeId: string | null): Promise<string | null> {
    const [d] = linhas(
      await this.db.execute(sql`
        update mister_documento set situacao = 'lancado', respondido_em = now(), atualizado_em = clock_timestamp()
         where id = ${documentoId}::uuid and tenant_id = ${tenantId}::uuid and situacao = 'confirmar'
        returning tipo, valor_centavos as "valorCentavos", vencimento::text as vencimento, beneficiario, fornecedor_id::text as "fornecedorId"`),
    );
    if (!d || d.valorCentavos == null) return null;
    try {
      const t: any = await this.financeiro.criar(
        tenantId,
        colaboradorId,
        'presidente',
        {
          tipo: 'pagar',
          descricao: `${d.tipo === 'conta' ? 'Conta' : 'Boleto'} · ${d.beneficiario ?? 'lançado por foto'}`.slice(0, 200),
          valor: Number(d.valorCentavos) / 100,
          vencimento: d.vencimento ?? undefined,
          fornecedorId: d.fornecedorId ?? undefined,
        } as any,
        unidadeId,
        { origem: 'mister' },
      );
      await this.db.execute(sql`update mister_documento set titulo_id = ${t.id}::uuid, atualizado_em = clock_timestamp() where id = ${documentoId}::uuid`);
      await this.auditar(tenantId, colaboradorId, 'mister_documento_lancado', documentoId, { titulo: t.id, valor: Number(d.valorCentavos) / 100 });
      return t.id;
    } catch (e: any) {
      this.logger.warn(`documento ${documentoId}: a conta a pagar foi recusada — ${e?.message ?? e}`);
      await this.db.execute(sql`update mister_documento set situacao = 'confirmar', respondido_em = null where id = ${documentoId}::uuid and situacao = 'lancado' and titulo_id is null`);
      return null;
    }
  }

  /** Grava o documento (uma vez por foto). Devolve o id, ou null quando a mesma foto já tinha sido lida. */
  private async registrar(
    quem: QuemMandou,
    wamid: string | null,
    r: { tipo: string; situacao: string; motivo: string; dados?: DadosDoLancamento; fornecedorId?: string | null },
  ): Promise<string | null> {
    const d = r.dados;
    const [linha] = linhas(
      await this.db.execute(sql`
        insert into mister_documento (tenant_id, unidade_id, colaborador_id, telefone_final, wamid, tipo, situacao, motivo,
                                      valor_centavos, vencimento, beneficiario, fornecedor_id, linha_digitavel, codigo_barras, dados)
        values (${quem.tenantId}::uuid, ${quem.unidadeId}::uuid, ${quem.colaboradorId}::uuid, ${quem.telefone.slice(-4)}, ${wamid},
                ${r.tipo}, ${r.situacao}, ${r.motivo}, ${d?.valorCentavos ?? null}, ${d?.vencimento ?? null}::date, ${d?.beneficiario ?? null},
                ${r.fornecedorId ?? null}::uuid, ${d?.boleto?.linhaDigitavel ?? null}, ${d?.boleto?.codigoDeBarras ?? null},
                ${JSON.stringify(d ? { origem: d.origem, vencimento: d.vencimento, cnpj: d.cnpj } : {})}::jsonb)
        on conflict (wamid) where wamid is not null do nothing
        returning id::text as id`),
    );
    return linha?.id ?? null;
  }

  /** O fornecedor cadastrado do beneficiário: pelo CNPJ, ou pelo nome igual (sem caixa e sem espaços a mais). */
  private async fornecedorDe(tenantId: string, cnpj: string | null, nome: string | null): Promise<string | null> {
    const doc = String(cnpj ?? '').replace(/\D/g, '') || null;
    const nomeLimpo = String(nome ?? '').trim().replace(/\s+/g, ' ').toLowerCase() || null;
    if (!doc && !nomeLimpo) return null;
    // No `sql` do Drizzle a barra vai dobrada ('\\D'), senão o Postgres recebe 'D'.
    const [f] = linhas(
      await this.db.execute(sql`
        select id::text as id, (regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${doc ?? ''}) as "peloCnpj"
          from fornecedor
         where tenant_id = ${tenantId}::uuid and deleted_at is null
           and ((${doc}::text is not null and regexp_replace(coalesce(cnpj, ''), '\\D', '', 'g') = ${doc}::text)
             or (${nomeLimpo}::text is not null and lower(regexp_replace(trim(nome), '\\s+', ' ', 'g')) = ${nomeLimpo}::text))
         order by 2 desc, created_at
         limit 1`),
    );
    return f?.id ?? null;
  }

  private async falar(telefone: string, resposta: Resposta): Promise<void> {
    try {
      await this.numero.enviar(telefone, resposta);
    } catch (e: any) {
      this.logger.warn(`a resposta do documento não saiu para ***${telefone.slice(-4)} — ${e?.message ?? e}`);
    }
  }

  private async auditar(tenantId: string, atorId: string, acao: string, documentoId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil: 'presidente', tipo: 'mister', acao, entidadeTipo: 'mister_documento', entidadeId: documentoId, detalhe } as any)
      .catch(() => undefined);
  }
}
