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
   * Versão 5, M5e (mig 462): "Como mandar o resumo" — o texto vai sempre; os botões "📄 PDF" e "📊 Ver gráficos" (o
   * padrão do protótipo), o PDF junto, o link junto, ou só o texto. Só vale com a versão 5 ligada (`MISTER_MIDIA`).
   */
  resumoEntrega: FormaDeEntregaDoResumo;
  /**
   * Versão 5, M5c (mig 462): "Responder em áudio" — quando a pessoa manda áudio, a resposta vai em texto e também numa nota
   * de voz (a voz do Google, pelo DMS Graph). Nasce desligado; só vale com a versão 5 ligada (`MISTER_MIDIA`).
   */
  responderAudio: boolean;
  /**
   * Versão 6, M6d (mig 476): a sessão com PIN — com ela ligada, os valores em reais, os dados de pessoas e as ações de botão
   * pedem o PIN pelo link, que vale por estas horas. null = desligado (o padrão).
   */
  pinACadaH: HorasDoPin | null;
  /**
   * Versão 7, V7e (mig 490, decisão V7-7): "Análises mais profundas" — a resposta depois de uma análise com dados usa o modelo
   * maior; o resto continua no de sempre. Nasce desligada; só o presidente muda (a rota).
   */
  analisesProfundas: boolean;
  /**
   * Versão 7, V7d (mig 493, decisões V7-4 a V7-6): "Voz com emoção" — a resposta em áudio acompanha o tom de quem fala. Nasce
   * desligada, só o presidente muda e só vale com "Responder em áudio" ligado. O tom em si nunca é gravado.
   */
  vozComEmocao: boolean;
  /**
   * Versão 9, O1 (mig 501, decisões V9-1 e V9-2): "Ligar as linhas pela IA" — nota, cupom e lista ligados ao estoque pela IA, com as
   * dúvidas juntas numa mensagem. Nasce desligado (custo, regra do dono de 20/11); só o presidente muda.
   */
  ligarPelaIa: boolean;
  /**
   * Versão 9, O6 (mig 502; o dono: "intercalar Haiku e Sonnet"): "IA mais forte nas tarefas" — com um cupom, uma nota ou uma lista em
   * andamento, a resposta usa o modelo maior; no resto, o de sempre. Nasce desligado; só o presidente muda.
   */
  iaForteNasTarefas: boolean;
  /**
   * Versão 9, O2 (mig 503, decisão V9-4): "Aprender o modelo de cada fornecedor" — o resumo da nota diz o que o modelo do
   * fornecedor já conhecia e o que mudou, e a lista usa e grava os apelidos da empresa. Sem custo; nasce desligado (recurso novo);
   * só o presidente muda. A memória do fornecedor de antes (mig 441) não depende dele.
   */
  aprenderModelos: boolean;
  /**
   * Versão 10, C9 (mig 506): "A IA escreve as respostas" — o "feito" e o "não deu" das ações saem escritos pela IA, no jeito da
   * empresa, com os números do Regem (a frase fixa de reserva). Nasce desligado (custo, regra do dono de 20/11); só o presidente muda.
   */
  respostasEscritas: boolean;
  /** Versão 10, C7 (mig 508): "Aprender pela tarefa feita" — a tarefa confirmada vira exemplo da empresa. Sem custo; nasce desligado. */
  aprenderTarefas: boolean;
}
/** As horas que o PIN da sessão vale (a escolha do presidente). */
export const HORAS_DO_PIN = [6, 12, 24] as const;
export type HorasDoPin = (typeof HORAS_DO_PIN)[number];
/** As formas de mandar o resumo (a mesma lista da restrição da mig 462). */
export const FORMAS_DE_ENTREGA_DO_RESUMO = ['botoes', 'pdf', 'link', 'texto'] as const;
export type FormaDeEntregaDoResumo = (typeof FORMAS_DE_ENTREGA_DO_RESUMO)[number];
export const CONVERSA_PADRAO: ConversaDoMister = {
  documentosLigado: true,
  documentosModo: 'sozinho',
  perfil: 'hoje',
  jeito: null,
  avisosEscritos: [],
  ficaDeOlho: false,
  resumoEntrega: 'botoes',
  responderAudio: false,
  pinACadaH: null,
  analisesProfundas: false,
  vozComEmocao: false,
  ligarPelaIa: false,
  iaForteNasTarefas: false,
  aprenderModelos: false,
  respostasEscritas: false,
  aprenderTarefas: false,
};

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
  if (d.responderAudio !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.responderAudio !== 'boolean') return { erro: 'Responder em áudio: diga se fica ligado ou desligado.' };
    fora.responderAudio = d.responderAudio;
  }
  if (d.pinACadaH !== undefined) {
    // M6d: 6, 12 ou 24 horas, ou null (desligado) — nada além disso.
    if (d.pinACadaH !== null && !(HORAS_DO_PIN as readonly unknown[]).includes(d.pinACadaH)) return { erro: 'Pedir o PIN: escolha 6, 12 ou 24 horas, ou desligado.' };
    fora.pinACadaH = d.pinACadaH;
  }
  if (d.analisesProfundas !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.analisesProfundas !== 'boolean') return { erro: 'Análises mais profundas: diga se fica ligado ou desligado.' };
    fora.analisesProfundas = d.analisesProfundas;
  }
  if (d.vozComEmocao !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.vozComEmocao !== 'boolean') return { erro: 'Voz com emoção: diga se fica ligada ou desligada.' };
    fora.vozComEmocao = d.vozComEmocao;
  }
  if (d.ligarPelaIa !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.ligarPelaIa !== 'boolean') return { erro: 'Ligar as linhas pela IA: diga se fica ligado ou desligado.' };
    fora.ligarPelaIa = d.ligarPelaIa;
  }
  if (d.iaForteNasTarefas !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.iaForteNasTarefas !== 'boolean') return { erro: 'IA mais forte nas tarefas: diga se fica ligada ou desligada.' };
    fora.iaForteNasTarefas = d.iaForteNasTarefas;
  }
  if (d.aprenderModelos !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.aprenderModelos !== 'boolean') return { erro: 'Aprender o modelo de cada fornecedor: diga se fica ligado ou desligado.' };
    fora.aprenderModelos = d.aprenderModelos;
  }
  if (d.respostasEscritas !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.respostasEscritas !== 'boolean') return { erro: 'A IA escreve as respostas: diga se fica ligado ou desligado.' };
    fora.respostasEscritas = d.respostasEscritas;
  }
  if (d.aprenderTarefas !== undefined) {
    // V15: liga/desliga só com booleano de verdade.
    if (typeof d.aprenderTarefas !== 'boolean') return { erro: 'Aprender pela tarefa feita: diga se fica ligado ou desligado.' };
    fora.aprenderTarefas = d.aprenderTarefas;
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
  responderAudio: { coluna: 'responder_audio', valor: (v) => sql`${v}` },
  pinACadaH: { coluna: 'pin_a_cada_h', valor: (v) => sql`${v}::int` },
  analisesProfundas: { coluna: 'analises_profundas', valor: (v) => sql`${v}::boolean` },
  vozComEmocao: { coluna: 'voz_com_emocao', valor: (v) => sql`${v}::boolean` },
  ligarPelaIa: { coluna: 'ligar_pela_ia', valor: (v) => sql`${v}::boolean` },
  iaForteNasTarefas: { coluna: 'ia_forte_nas_tarefas', valor: (v) => sql`${v}::boolean` },
  aprenderModelos: { coluna: 'aprender_modelos', valor: (v) => sql`${v}::boolean` },
  respostasEscritas: { coluna: 'respostas_escritas', valor: (v) => sql`${v}::boolean` },
  aprenderTarefas: { coluna: 'aprender_tarefas', valor: (v) => sql`${v}::boolean` },
};

/**
 * As colunas lidas, da migration mais nova para a mais velha: sem a coluna de uma (42703 — a migration ainda não entrou),
 * lê as da anterior. Nunca devolver o padrão de um campo que está salvo (o "perguntar" dos documentos, o perfil).
 */
const LEITURAS = [
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao", ligar_pela_ia as "ligarPelaIa", ia_forte_nas_tarefas as "iaForteNasTarefas", aprender_modelos as "aprenderModelos", respostas_escritas as "respostasEscritas", aprender_tarefas as "aprenderTarefas"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao", ligar_pela_ia as "ligarPelaIa", ia_forte_nas_tarefas as "iaForteNasTarefas", aprender_modelos as "aprenderModelos", respostas_escritas as "respostasEscritas"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao", ligar_pela_ia as "ligarPelaIa", ia_forte_nas_tarefas as "iaForteNasTarefas", aprender_modelos as "aprenderModelos"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao", ligar_pela_ia as "ligarPelaIa", ia_forte_nas_tarefas as "iaForteNasTarefas"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao", ligar_pela_ia as "ligarPelaIa"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas", voz_com_emocao as "vozComEmocao"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH", analises_profundas as "analisesProfundas"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio", pin_a_cada_h as "pinACadaH"`,
  sql`documentos_ligado as "documentosLigado", documentos_modo as "documentosModo", perfil, jeito, avisos_escritos as "avisosEscritos", fica_de_olho as "ficaDeOlho", resumo_entrega as "resumoEntrega", responder_audio as "responderAudio"`,
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
        responderAudio: l.responderAudio === true,
        pinACadaH: (HORAS_DO_PIN as readonly unknown[]).includes(Number(l.pinACadaH)) ? (Number(l.pinACadaH) as HorasDoPin) : null,
        analisesProfundas: l.analisesProfundas === true,
        vozComEmocao: l.vozComEmocao === true,
        ligarPelaIa: l.ligarPelaIa === true,
        iaForteNasTarefas: l.iaForteNasTarefas === true,
        aprenderModelos: l.aprenderModelos === true,
        respostasEscritas: l.respostasEscritas === true,
        aprenderTarefas: l.aprenderTarefas === true,
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
