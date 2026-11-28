import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloService } from '../modulo/modulo.service';
import { pessoaVale } from './mister-vinculo.service';
import { gerarPdfDoInsumo, PlanoDoPdfDoInsumo } from './relatorio-insumo-pdf';
import { gerarPdfDoResumo } from './relatorio-resumo-pdf';
import { PlanoDoResumo, ehPlanoDoResumo } from './grafico/plano-do-resumo';
import {
  TETO_DE_LINKS_VIVOS,
  TEXTOS_DO_LINK_PUBLICO,
  VALIDADE_DO_LINK_DIAS,
  VistaDoLinkPublico,
  diaMesDe,
  ehCodigoPublico,
  ehPlanoDoRelatorio,
  enderecoDoLinkPublico,
  planoTemVenda,
} from './mister-link-publico';

/* eslint-disable @typescript-eslint/no-explicit-any */

// M3c — O LINK PARA ENCAMINHAR (mig 443; decisão 7 da versão 3 do protótipo `mockups/regem-mister.html`). O presidente
// pede na conversa; o Mister guarda a FOTO do relatório (o plano do PDF) e devolve um endereço que abre SEM login — para
// a contabilidade, um sócio, quem não tem usuário. Só leitura, 7 dias, com a criação e a primeira abertura na auditoria.
//
// A porta pública confere a régua do acesso a cada abertura (V75): o link vivo (não vencido, não cancelado), a empresa
// viva, quem pediu ainda presidente e ativo, o módulo Mister ligado e a função ligada na instalação. Qualquer falha é o
// mesmo 404, com a mesma frase.
//
// NASCE DESLIGADO: só com `MISTER_LINK_PUBLICO=1`. Desligar a variável fecha também os links que já saíram.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const resumoDoCodigo = (codigo: string) => createHash('sha256').update(codigo).digest('hex');
const baseDoApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
/** A chave da trava de transação do teto (o par com o resumo da empresa; a auditoria usa o 0). */
const TRAVA_DO_TETO = 443;

/** O link de um relatório por insumo (M3c, o presidente pede) ou de um resumo (versão 5, M5e, o "📊 Ver gráficos"). */
export type NovoLinkPublico =
  | {
      tipo?: 'insumo';
      /** A loja do relatório; null = todas as lojas (ou a loja única). */
      unidadeId: string | null;
      titulo: string;
      nomeDoPdf: string;
      plano: PlanoDoPdfDoInsumo;
    }
  | { tipo: 'resumo' | 'grafico'; unidadeId: string | null; titulo: string; nomeDoPdf: string; plano: PlanoDoResumo };

/** Rodada 7, MIS-F-10: quem emitiu ainda vê o que o link mostra? (A loja do link entre as dele; "todas" só sem loja presa; R$ só com valores.) */
export function acessoAindaVale(
  e: Awaited<ReturnType<EscopoDeQuemEmitiu>>,
  l: { unidadeId: string | null; tipo: string; plano: any },
): boolean {
  if (!e || e.semLoja) return false;
  if (!e.lojaUnica) {
    if (l.unidadeId && !e.lojas.some((x) => x.id === l.unidadeId)) return false;
    if (!l.unidadeId && e.presa) return false;
  } else if (l.unidadeId && e.lojas.length && !e.lojas.some((x) => x.id === l.unidadeId)) return false;
  if ((l.tipo === 'resumo' || l.tipo === 'grafico') && l.plano?.semValores === false && !e.verValores) return false;
  if (l.tipo === 'insumo' && !e.verValores) return false;
  return true;
}

/** O plano guardado tem a forma do tipo dele? (Outra forma não abre e não nasce.) */
// O resumo e o gráfico da conversa usam o plano do resumo; o tipo da linha e o do plano têm de casar.
const planoVale = (tipo: unknown, plano: unknown): boolean =>
  tipo === 'resumo' || tipo === 'grafico'
    ? ehPlanoDoResumo(plano) && (plano.tipo === 'grafico') === (tipo === 'grafico')
    : tipo === 'insumo' && ehPlanoDoRelatorio(plano);

/** O acesso de AGORA de quem emitiu o link (as lojas que vê, se está preso a uma, se vê valores) — ou null se não fala mais. */
export type EscopoDeQuemEmitiu = (
  tenantId: string,
  colaboradorId: string,
) => Promise<{ lojas: { id: string }[]; lojaUnica: boolean; presa: string | null; semLoja: boolean; verValores: boolean } | null>;

@Injectable()
export class MisterLinkPublicoService {
  private readonly logger = new Logger('MisterLinkPublico');
  private escopoDe: EscopoDeQuemEmitiu | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() private readonly modulos?: ModuloService,
  ) {}

  /** Rodada 7, MIS-F-10: quem resolve o acesso de agora (o serviço das ferramentas, com o `escopoDaTela`). */
  registrarEscopo(fn: EscopoDeQuemEmitiu): void {
    this.escopoDe = fn;
  }

  /** A função está ligada nesta instalação? (Desligada: nenhum link nasce e nenhum abre.) */
  ligado(): boolean {
    return process.env.MISTER_LINK_PUBLICO === '1';
  }

  /**
   * Cria o link de um relatório. Quem chama já conferiu que é o presidente e leu o relatório no escopo dele. O teto de
   * links vivos da empresa é conferido e reservado na MESMA transação, com a trava da empresa (V98): dois pedidos ao
   * mesmo tempo não passam do teto. Só o resumo do código vai para o banco; o código inteiro volta UMA vez, no endereço.
   */
  async criar(quem: { tenantId: string; colaboradorId: string }, novo: NovoLinkPublico): Promise<{ url: string; vence: Date } | { erro: string }> {
    if (!this.ligado()) return { erro: TEXTOS_DO_LINK_PUBLICO.desligado };
    const tipo = novo.tipo ?? 'insumo';
    if (!planoVale(tipo, novo.plano)) {
      this.logger.error(`o plano do relatório "${novo.titulo}" não tem a forma esperada: o link não foi criado`);
      return { erro: TEXTOS_DO_LINK_PUBLICO.falhou };
    }
    const codigo = randomBytes(24).toString('base64url');
    let criado: { id: string; venceEm: string } | null;
    try {
      criado = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quem.tenantId}), ${TRAVA_DO_TETO})`);
        const [{ n }] = linhas(
          await tx.execute(sql`
            select count(*)::int as n from mister_link_publico
             where tenant_id = ${quem.tenantId}::uuid and revogado_em is null and vence_em > now()`),
        );
        if (Number(n) >= TETO_DE_LINKS_VIVOS) return null;
        const [l] = linhas(
          await tx.execute(sql`
            insert into mister_link_publico (tenant_id, unidade_id, criado_por, tipo, titulo, nome_do_pdf, plano, link_hash, vence_em)
            values (${quem.tenantId}::uuid, ${novo.unidadeId}::uuid, ${quem.colaboradorId}::uuid, ${tipo}, ${novo.titulo.slice(0, 300)},
                    ${novo.nomeDoPdf.slice(0, 120)}, ${JSON.stringify(novo.plano)}::jsonb, ${resumoDoCodigo(codigo)},
                    clock_timestamp() + ${VALIDADE_DO_LINK_DIAS}::int * interval '1 day')
            returning id::text as id, vence_em as "venceEm"`),
        );
        return l as { id: string; venceEm: string };
      });
    } catch (e: any) {
      if (semTabela(e)) return { erro: TEXTOS_DO_LINK_PUBLICO.desligado };
      this.logger.error(`o link do relatório "${novo.titulo}" não foi criado — ${e?.message ?? e}`, e?.stack);
      return { erro: TEXTOS_DO_LINK_PUBLICO.falhou };
    }
    if (!criado) return { erro: TEXTOS_DO_LINK_PUBLICO.teto };
    const vence = new Date(criado.venceEm);
    await this.auditar(quem.tenantId, quem.colaboradorId, 'mister_link_publico_criado', criado.id, { relatorio: novo.titulo, valeAte: vence.toISOString() }, 'whatsapp');
    return { url: enderecoDoLinkPublico(baseDoApp(), codigo), vence };
  }

  /** O presidente cancela os links vivos da empresa (pela conversa). Devolve quantos deixaram de valer. */
  async cancelarTodos(quem: { tenantId: string; colaboradorId: string }): Promise<number> {
    let cancelados: any[];
    try {
      cancelados = linhas(
        await this.db.execute(sql`
          update mister_link_publico set revogado_em = now()
           where tenant_id = ${quem.tenantId}::uuid and revogado_em is null and vence_em > now()
          returning id::text as id`),
      );
    } catch (e: any) {
      if (semTabela(e)) return 0;
      throw e;
    }
    if (cancelados.length)
      await this.auditar(quem.tenantId, quem.colaboradorId, 'mister_link_publico_cancelado', cancelados[0].id, { quantos: cancelados.length }, 'whatsapp');
    return cancelados.length;
  }

  /** A página abriu: o relatório como foi guardado. Cada abertura conta; a primeira fica na auditoria. */
  async ver(codigo: unknown): Promise<VistaDoLinkPublico> {
    const l = await this.linha(codigo);
    await this.contarAcesso(l, 'pagina');
    const vence = new Date(l.venceEm);
    const comum = { empresa: String(l.empresa ?? ''), nomeDoPdf: String(l.nomeDoPdf), valeAte: vence.toISOString(), valeAteDia: diaMesDe(vence) };
    // Versão 5, M5e: o resumo (os números, os gráficos e a atenção) tem a página dele.
    if (l.tipo === 'resumo' || l.tipo === 'grafico') return { ...comum, tipo: 'resumo', plano: l.plano };
    return { ...comum, tipo: 'insumo', plano: l.plano, comVenda: planoTemVenda(l.plano) };
  }

  /** O PDF do relatório guardado (o MESMO plano da página). */
  async pdf(codigo: unknown): Promise<{ pdf: Buffer; nome: string }> {
    const l = await this.linha(codigo);
    await this.contarAcesso(l, 'pdf');
    const pdf = l.tipo === 'resumo' || l.tipo === 'grafico' ? await gerarPdfDoResumo(l.plano, String(l.nomeDoPdf)) : await gerarPdfDoInsumo(l.plano, String(l.nomeDoPdf));
    return { pdf, nome: String(l.nomeDoPdf) };
  }

  /**
   * A linha do link, com a régua de "acesso vale" (V75). Código que não é de link, que não existe, vencido, cancelado, de
   * empresa apagada, de quem deixou de ser presidente ou com o módulo desligado: 404 com a mesma frase.
   */
  private async linha(codigo: unknown): Promise<any> {
    const fora = () => new NotFoundException(TEXTOS_DO_LINK_PUBLICO.naoVale);
    if (!this.ligado() || !ehCodigoPublico(codigo)) throw fora();
    let l: any;
    try {
      [l] = linhas(
        await this.db.execute(sql`
          select k.id::text as id, k.tenant_id::text as "tenantId", k.unidade_id::text as "unidadeId", k.tipo, k.titulo, k.nome_do_pdf as "nomeDoPdf",
                 k.plano, k.vence_em as "venceEm", emp.nome as empresa, k.criado_por::text as "criadoPor"
            from mister_link_publico k
            join empresa emp on emp.id = k.tenant_id
            join colaborador c on c.id = k.criado_por and c.tenant_id = k.tenant_id
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
           where k.link_hash = ${resumoDoCodigo(codigo)} and k.revogado_em is null and k.vence_em > now()
             and ${pessoaVale()}
             -- O link para encaminhar (insumo) é do presidente; o do resumo e o do gráfico (M5e), de quem pediu: presidente ou gerente.
             and (case when k.tipo in ('resumo', 'grafico') then coalesce(p.nivel, f.categoria::text) in ('presidente', 'gerente')
                       else coalesce(p.nivel, f.categoria::text) = 'presidente' end)`),
      );
    } catch (e: any) {
      if (semTabela(e)) throw fora();
      throw e;
    }
    if (!l || !planoVale(l.tipo, l.plano)) throw fora();
    if (this.modulos && !(await this.modulos.ativo(l.tenantId, l.unidadeId ?? null, 'mister'))) throw fora();
    // Rodada 7, MIS-F-10 (ERR-658): o relatório é uma FOTO de quando saiu — abre só se quem o emitiu ainda vê o que ele
    // mostra: a loja dele (viva) ou todas, e os valores quando o relatório os traz. Mudou de loja, perdeu os valores ou a loja
    // foi apagada: o mesmo 404.
    if (this.escopoDe && !acessoAindaVale(await this.escopoDe(l.tenantId, l.criadoPor), l)) throw fora();
    return l;
  }

  private async contarAcesso(l: any, por: 'pagina' | 'pdf'): Promise<void> {
    const [r] = linhas(
      await this.db.execute(sql`
        update mister_link_publico
           set acessos = acessos + 1, ultimo_acesso_em = now(), aberto_em = coalesce(aberto_em, now())
         where id = ${l.id}::uuid
        returning acessos`),
    );
    if (Number(r?.acessos) === 1) await this.auditar(l.tenantId, null, 'mister_link_publico_aberto', l.id, { relatorio: l.titulo, por }, 'link');
  }

  private async auditar(tenantId: string, atorId: string | null, acao: string, linkId: string, detalhe: Record<string, unknown>, origem: 'whatsapp' | 'link'): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil: atorId ? 'presidente' : undefined, tipo: 'mister', acao, entidadeTipo: 'mister_link_publico', entidadeId: linkId, detalhe, origem } as any)
      .catch((e: any) => this.logger.warn(`a auditoria do link ${linkId} falhou — ${e?.message ?? e}`));
  }
}
