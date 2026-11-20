import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { SQL, sql } from 'drizzle-orm';
import { AuthUser } from '../../auth/auth-user';
import { ModoDoBoleto, documentosNaInstalacao, notasNaInstalacao } from '../../common/documento-por-foto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PERFIS_DO_ATENDENTE, PerfilDoAtendente } from '../cardapio/perfis-do-atendente';
import { midiaNaInstalacao } from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AJUSTES DA CONVERSA DO MISTER por empresa (mig 440; versão 3 do protótipo, "Avisos e relatórios › Conversa").
// O primeiro é o dos documentos por foto (M3a, parte 3): ligar a leitura e o jeito de lançar o boleto. Sem linha salva,
// vale o padrão (ligado, "sozinho se o código confere"). Só o presidente muda (o controlador). Só na nuvem: no servidor
// da loja a tabela não existe (lê como o padrão).
//
// Versão 4, M4a (mig 447; protótipo `mockups/regem-mister-jeito-memoria.html`, aprovado em 18/11/2026): o JEITO do
// Mister — o perfil (as mesmas chaves do atendente virtual), o "Jeito da empresa" (uma frase de até 300 letras) e os
// grupos de aviso escritos pelo Mister com o contexto (usados na M4c). Padrão: "Como hoje", sem jeito, nenhum grupo —
// nada muda até o presidente escolher. Salvar grava SÓ os campos que vieram (o ausente mantém o salvo — V16), na mesma
// instrução, sem ler antes para escrever tudo de volta.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703' || e?.cause?.code === '42P01' || e?.cause?.code === '42703';

export const MODOS_DO_BOLETO: readonly ModoDoBoleto[] = ['sozinho', 'perguntar'];
/** Os grupos de aviso que o Mister pode escrever com o contexto (os grupos da parte "Avisos e relatórios"). */
export const GRUPOS_DE_AVISO_ESCRITO = ['loja', 'servidor', 'fiscal', 'mister'] as const;
export type GrupoDeAvisoEscrito = (typeof GRUPOS_DE_AVISO_ESCRITO)[number];
/** O "Jeito da empresa" cabe nisto (uma linha só — a mesma conta da restrição da mig 447). */
export const JEITO_DO_MISTER_MAX = 300;

export interface ConversaDoMister {
  documentosLigado: boolean;
  documentosModo: ModoDoBoleto;
  perfil: PerfilDoAtendente;
  jeito: string | null;
  avisosEscritos: GrupoDeAvisoEscrito[];
  /** M4d (mig 452): o "fica de olho" e os lembretes pela conversa — nasce desligado. */
  ficaDeOlho: boolean;
  /**
   * Versão 5, M5e (mig 461): "Como mandar o resumo" — o texto vai sempre; os botões "📄 PDF" e "📊 Ver gráficos" (o
   * padrão do protótipo), o PDF junto, o link junto, ou só o texto. Só vale com a versão 5 ligada (`MISTER_MIDIA`).
   */
  resumoEntrega: FormaDeEntregaDoResumo;
}
/** As formas de mandar o resumo (a mesma lista da restrição da mig 461). */
export const FORMAS_DE_ENTREGA_DO_RESUMO = ['botoes', 'pdf', 'link', 'texto'] as const;
export type FormaDeEntregaDoResumo = (typeof FORMAS_DE_ENTREGA_DO_RESUMO)[number];
export const CONVERSA_PADRAO: ConversaDoMister = { documentosLigado: true, documentosModo: 'sozinho', perfil: 'hoje', jeito: null, avisosEscritos: [], ficaDeOlho: false, resumoEntrega: 'botoes' };

/** O jeito como vai ao banco e às instruções: uma linha, espaços apertados; vazio vira null. */
export const jeitoLimpo = (v: unknown): string | null => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t ? t : null;
};

/** O que a tela manda. Cada campo é opcional (ausente mantém o salvo — V16); presente, tem de ser válido (V15). */
export function conferirConversa(dto: unknown): Partial<ConversaDoMister> | { erro: string } {
  const d = (dto ?? {}) as any;
  const fora: Partial<ConversaDoMister> = {};
  if (d.documentosLigado !== undefined) {
    if (typeof d.documentosLigado !== 'boolean') return { erro: 'Lançar documentos por foto: diga se fica ligado ou desligado.' };
    fora.documentosLigado = d.documentosLigado;
  }
  if (d.documentosModo !== undefined) {
    if (!MODOS_DO_BOLETO.includes(d.documentosModo)) return { erro: 'Escolha como lançar o boleto.' };
    fora.documentosModo = d.documentosModo;
  }
  if (d.perfil !== undefined) {
    if (!(PERFIS_DO_ATENDENTE as readonly string[]).includes(d.perfil)) return { erro: 'Escolha um dos perfis da lista.' };
    fora.perfil = d.perfil;
  }
  if (d.jeito !== undefined) {
    if (d.jeito !== null && typeof d.jeito !== 'string') return { erro: 'O jeito da empresa é um texto.' };
    const j = jeitoLimpo(d.jeito);
    if (j && j.length > JEITO_DO_MISTER_MAX) return { erro: `O jeito da empresa cabe em ${JEITO_DO_MISTER_MAX} letras.` };
    fora.jeito = j;
  }
  if (d.avisosEscritos !== undefined) {
    if (!Array.isArray(d.avisosEscritos) || d.avisosEscritos.some((g: unknown) => !(GRUPOS_DE_AVISO_ESCRITO as readonly unknown[]).includes(g)))
      return { erro: 'Escolha os grupos de aviso da lista.' };
    fora.avisosEscritos = GRUPOS_DE_AVISO_ESCRITO.filter((g) => d.avisosEscritos.includes(g));
  }
  if (d.ficaDeOlho !== undefined) {
    // V15: liga/desliga só com booleano de verdade (nunca `!!dto.campo`).
    if (typeof d.ficaDeOlho !== 'boolean') return { erro: '"Fica de olho" e lembretes: diga se fica ligado ou desligado.' };
    fora.ficaDeOlho = d.ficaDeOlho;
  }
  if (d.resumoEntrega !== undefined) {
    if (!(FORMAS_DE_ENTREGA_DO_RESUMO as readonly unknown[]).includes(d.resumoEntrega)) return { erro: 'Escolha como mandar o resumo.' };
    fora.resumoEntrega = d.resumoEntrega;
  }
  if (!Object.keys(fora).length) return { erro: 'Nada para salvar.' };
  return fora;
}

/** A coluna de cada campo e o valor como vai ao banco. */
const COLUNA: Record<keyof ConversaDoMister, { coluna: string; valor: (v: any) => SQL }> = {
  documentosLigado: { coluna: 'documentos_ligado', valor: (v) => sql`${v}` },
  documentosModo: { coluna: 'documentos_modo', valor: (v) => sql`${v}` },
  perfil: { coluna: 'perfil', valor: (v) => sql`${v}` },
  jeito: { coluna: 'jeito', valor: (v) => sql`${v}` },
  // O array do JS, no `sql` do Drizzle, vira LISTA de parâmetros (um "record"), não um text[] (LIC-074, ERR-520): vai como
  // UM parâmetro (`sql.param`), que o `pg` converte em array — inclusive o vazio.
  avisosEscritos: { coluna: 'avisos_escritos', valor: (v) => sql`${sql.param(v)}::text[]` },
  ficaDeOlho: { coluna: 'fica_de_olho', valor: (v) => sql`${v}` },
  resumoEntrega: { coluna: 'resumo_entrega', valor: (v) => sql`${v}` },
};

/**
 * As colunas lidas, da migration mais nova para a mais velha: sem a coluna de uma (42703 — a migration ainda não entrou),
 * lê as da anterior. Nunca devolver o padrão de um campo que está salvo (o "perguntar" dos documentos, o perfil).
 */
const LEITURAS = [
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo"`,
];
const semColuna = (e: any) => e?.code === '42703' || e?.cause?.code === '42703';

@Injectable()
export class MisterConversaConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** Os ajustes que valem para a empresa (o salvo, ou o padrão). */
  async daEmpresa(tenantId: string): Promise<ConversaDoMister> {
    try {
      let l: any;
      for (let i = 0; ; i++) {
        try {
          [l] = linhas(await this.db.execute(sql`select ${LEITURAS[i]} from mister_conversa_config where tenant_id = ${tenantId}::uuid`));
          break;
        } catch (e: any) {
          // Sem as colunas desta migration: lê as da anterior (as da 440 sempre existem quando a tabela existe).
          if (!semColuna(e) || i === LEITURAS.length - 1) throw e;
        }
      }
      if (!l) return { ...CONVERSA_PADRAO, avisosEscritos: [] };
      const avisos = Array.isArray(l.avisosEscritos) ? l.avisosEscritos : [];
      return {
        documentosLigado: l.documentosLigado !== false,
        documentosModo: MODOS_DO_BOLETO.includes(l.documentosModo) ? l.documentosModo : CONVERSA_PADRAO.documentosModo,
        perfil: (PERFIS_DO_ATENDENTE as readonly string[]).includes(l.perfil) ? l.perfil : 'hoje',
        jeito: jeitoLimpo(l.jeito),
        avisosEscritos: GRUPOS_DE_AVISO_ESCRITO.filter((g) => avisos.includes(g)),
        ficaDeOlho: l.ficaDeOlho === true,
        resumoEntrega: (FORMAS_DE_ENTREGA_DO_RESUMO as readonly unknown[]).includes(l.resumoEntrega) ? l.resumoEntrega : CONVERSA_PADRAO.resumoEntrega,
      };
    } catch (e: any) {
      // Sem a 440 (a migration ainda não entrou, ou o servidor da loja): o padrão, que não muda nada.
      if (semTabela(e)) return { ...CONVERSA_PADRAO, avisosEscritos: [] };
      throw e;
    }
  }

  /**
   * O que a tela mostra: os ajustes da empresa e se a função está ligada NESTA instalação (a variável que o dono liga —
   * a mesma regra que os serviços usam). A tela Resumo diz "em breve" quando ela ainda não está ligada.
   */
  async daTela(tenantId: string): Promise<{ conversa: ConversaDoMister; disponivel: { documentos: boolean; notas: boolean; resumoEmArquivo: boolean } }> {
    return { conversa: await this.daEmpresa(tenantId), disponivel: { documentos: documentosNaInstalacao(), notas: notasNaInstalacao(), resumoEmArquivo: midiaNaInstalacao() } };
  }

  /**
   * Salva o que veio numa instrução só: a linha nova nasce com o padrão nos campos que não vieram; a que já existe muda só
   * os campos que vieram (dois presidentes salvando partes diferentes ao mesmo tempo não apagam um ao outro). Audita o
   * antes e o depois.
   */
  async salvar(user: AuthUser, dto: unknown) {
    const r = conferirConversa(dto);
    if ('erro' in r) throw new BadRequestException(r.erro);
    const antes = await this.daEmpresa(user.tenantId);
    const campos = Object.keys(r) as (keyof ConversaDoMister)[];
    const colunas = campos.map((c) => sql.raw(COLUNA[c].coluna));
    const valores = campos.map((c) => COLUNA[c].valor(r[c]));
    const atualizar = campos.map((c) => sql.raw(`${COLUNA[c].coluna} = excluded.${COLUNA[c].coluna}`));
    await this.db.execute(sql`
      insert into mister_conversa_config (tenant_id, ${sql.join(colunas, sql`, `)}, alterado_por, atualizado_em)
      values (${user.tenantId}::uuid, ${sql.join(valores, sql`, `)}, ${user.colaboradorId}::uuid, now())
      on conflict (tenant_id) do update
         set ${sql.join(atualizar, sql`, `)}, alterado_por = excluded.alterado_por, atualizado_em = now()`);
    const depois = await this.daEmpresa(user.tenantId);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'mister_conversa_alterada',
      entidadeTipo: 'mister_conversa_config',
      entidadeId: user.tenantId,
      detalhe: { antes, depois },
    });
    // O mesmo formato da leitura (`daTela`), sem ler de novo: o salvo e o que está ligado nesta instalação.
    return { conversa: depois, disponivel: { documentos: documentosNaInstalacao(), notas: notasNaInstalacao(), resumoEmArquivo: midiaNaInstalacao() } };
  }
}
