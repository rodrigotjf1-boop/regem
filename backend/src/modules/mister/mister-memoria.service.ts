import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  ItemDaMemoria,
  LIMITE_DA_EMPRESA,
  LIMITE_DA_PESSOA,
  OrigemDaMemoria,
  acharPeloTrecho,
  conferirMemoria,
  faltaParaCaber,
  letrasUsadas,
  usoEmLetras,
} from './mister-memoria';
import { pessoaVale } from './mister-vinculo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A MEMÓRIA DO MISTER (versão 4, fase M4b, mig 449 — as regras em `mister-memoria.ts`). Grava, troca e esquece as
// anotações da empresa e de cada pessoa, pela tela (só o presidente) e pela conversa (a ferramenta `lembrar`).
//  • O limite de letras é conferido e a anotação gravada na MESMA transação, com a trava da empresa (V98): dois "lembra
//    que…" ao mesmo tempo não passam do limite.
//  • Quem pode: o presidente, tudo da empresa; pela conversa, cada pessoa anota da empresa e anota, troca e esquece o
//    que é DELA; trocar e esquecer o que é da empresa, só o presidente (decisão 5 do protótipo).
//  • Só pessoas que ainda valem (a régua do vínculo, `pessoaVale`) aparecem na tela; quem desliga o WhatsApp do Mister
//    perde a memória dela junto (o apagar mora no `desligarPessoa` do vínculo — importar este serviço lá fecharia um ciclo).
//  • Só na nuvem: sem a 449 (ou no servidor da loja), nada se lê e nada se grava — a conversa segue sem memória.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
/** A chave da trava de transação da memória (o par com o resumo da empresa). */
const TRAVA_DA_MEMORIA = 449;

export type QuemMexe = { tenantId: string; colaboradorId: string; presidente: boolean; origem: OrigemDaMemoria };
/** Sobre quem é a anotação: a empresa (null) ou uma pessoa (o id). */
export type Sobre = string | null;

export type Resultado = { ok: true; item: ItemDaMemoria; uso: string } | { ok: false; erro: string; anotadas?: string[] };

const ITEM = sql`id::text as id, colaborador_id::text as "colaboradorId", texto, origem,
  to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "criadoEm"`;

@Injectable()
export class MisterMemoriaService {
  private readonly logger = new Logger(MisterMemoriaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** As anotações de um dono (a empresa = null, ou uma pessoa), na ordem em que foram feitas. */
  private async doDono(db: any, tenantId: string, sobre: Sobre): Promise<ItemDaMemoria[]> {
    return linhas(
      await db.execute(sql`
        select ${ITEM} from mister_memoria
         where tenant_id = ${tenantId}::uuid
           and ${sobre ? sql`colaborador_id = ${sobre}::uuid` : sql`colaborador_id is null`}
         order by criado_em, id`),
    ) as ItemDaMemoria[];
  }

  /** O que entra na conversa desta pessoa: o da empresa e o dela. Sem a 449, nada (a conversa segue sem memória). */
  async paraAConversa(tenantId: string, colaboradorId: string): Promise<{ empresa: ItemDaMemoria[]; pessoa: ItemDaMemoria[] }> {
    try {
      const [empresa, pessoa] = await Promise.all([this.doDono(this.db, tenantId, null), this.doDono(this.db, tenantId, colaboradorId)]);
      return { empresa, pessoa };
    } catch (e: any) {
      if (semTabela(e)) return { empresa: [], pessoa: [] };
      throw e;
    }
  }

  /** A tela (só o presidente): o da empresa e o de cada pessoa que ainda vale, com o uso de letras. */
  async daTela(tenantId: string) {
    try {
      const itens = linhas(
        await this.db.execute(sql`
          select ${ITEM},
                 -- Quem disse ou escreveu (a tela mostra "Anotado na conversa com Ana"); só o nome, da mesma empresa.
                 (select a.nome from colaborador a where a.id = m.anotado_por and a.tenant_id = m.tenant_id) as "anotadoPor"
            from mister_memoria m
           where m.tenant_id = ${tenantId}::uuid
             and (m.colaborador_id is null or exists (
                   select 1 from colaborador c
                     left join funcao f on f.id = c.funcao_id
                     left join perfil_acesso p on p.id = c.perfil_acesso_id
                     join empresa emp on emp.id = c.tenant_id
                    where c.id = m.colaborador_id and c.tenant_id = m.tenant_id and ${pessoaVale()}))
           order by m.criado_em, m.id`),
      ) as (ItemDaMemoria & { anotadoPor: string | null })[];
      const pessoas = linhas(
        await this.db.execute(sql`
          select c.id::text as id, c.nome
            from colaborador c
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            join empresa emp on emp.id = c.tenant_id
            join mister_vinculo g on g.tenant_id = c.tenant_id and g.colaborador_id = c.id and g.ligado_em is not null
           where c.tenant_id = ${tenantId}::uuid and ${pessoaVale()}
           order by c.nome`),
      ) as { id: string; nome: string }[];
      const daEmpresa = itens.filter((i) => !i.colaboradorId);
      const dePessoas = itens.filter((i) => i.colaboradorId);
      const nomes = new Map(pessoas.map((p) => [p.id, p.nome]));
      return {
        disponivel: true,
        limites: { empresa: LIMITE_DA_EMPRESA, pessoa: LIMITE_DA_PESSOA },
        empresa: { itens: daEmpresa, letras: letrasUsadas(daEmpresa) },
        pessoas: [...new Set(dePessoas.map((i) => i.colaboradorId as string))].map((id) => {
          const dela = dePessoas.filter((i) => i.colaboradorId === id);
          return { colaboradorId: id, nome: nomes.get(id) ?? 'Pessoa sem o WhatsApp ligado', itens: dela, letras: letrasUsadas(dela) };
        }),
        // Para "Sobre" da gaveta: quem tem o WhatsApp ligado ao Mister.
        pessoasLigadas: pessoas,
      };
    } catch (e: any) {
      if (semTabela(e)) return { disponivel: false, limites: { empresa: LIMITE_DA_EMPRESA, pessoa: LIMITE_DA_PESSOA }, empresa: { itens: [], letras: 0 }, pessoas: [], pessoasLigadas: [] };
      throw e;
    }
  }

  /**
   * Anota (a tela ou a conversa). Conferência do texto antes de tudo (V86); o limite e a gravação na mesma transação, com
   * a trava da empresa. O texto igual a um que já existe para o mesmo dono não duplica: devolve o que existe.
   */
  async anotar(quem: QuemMexe, sobre: Sobre, texto: unknown): Promise<Resultado> {
    const c = conferirMemoria(texto);
    if ('erro' in c) return { ok: false, erro: c.erro };
    if (sobre && sobre !== quem.colaboradorId && !quem.presidente) return { ok: false, erro: 'Só o presidente anota sobre outra pessoa.' };
    // Rodada 7, MIS-E-05 (ERR-656): a memória da EMPRESA entra na conversa de todos (decisão 5 do protótipo: o presidente vê e
    // muda tudo; o gerente cuida da dele). Antes, o gerente anotava nela pela conversa — e a nota dele passava a valer para o
    // presidente e para os relatórios.
    if (!sobre && !quem.presidente) return { ok: false, erro: 'Só o presidente anota na memória da empresa. Posso anotar só para você (a sua memória).' };
    const limite = sobre ? LIMITE_DA_PESSOA : LIMITE_DA_EMPRESA;
    try {
      const r = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quem.tenantId}), ${TRAVA_DA_MEMORIA})`);
        if (sobre && !(await this.pessoaDaEmpresa(tx, quem.tenantId, sobre))) return { ok: false as const, erro: 'Essa pessoa não é desta empresa.' };
        const atuais = await this.doDono(tx, quem.tenantId, sobre);
        const igual = atuais.find((i) => i.texto === c.texto);
        if (igual) return { ok: true as const, item: igual, uso: usoEmLetras(letrasUsadas(atuais), limite) };
        const falta = faltaParaCaber(atuais, c.texto, limite);
        if (falta) return { ok: false as const, erro: `A memória está cheia (${usoEmLetras(letrasUsadas(atuais), limite)}): faltam ${falta} letras. Junte duas parecidas ou esqueça uma.`, anotadas: atuais.map((i) => i.texto) };
        const [item] = linhas(
          await tx.execute(sql`
            insert into mister_memoria (tenant_id, colaborador_id, texto, origem, anotado_por)
            values (${quem.tenantId}::uuid, ${sobre}::uuid, ${c.texto}, ${quem.origem}, ${quem.colaboradorId}::uuid)
            returning ${ITEM}`),
        ) as ItemDaMemoria[];
        return { ok: true as const, item, uso: usoEmLetras(letrasUsadas(atuais) + c.texto.length, limite) };
      });
      if (r.ok) await this.auditar(quem, 'mister_memoria_anotada', r.item.id, { sobre: sobre ? 'pessoa' : 'empresa', origem: quem.origem, letras: r.item.texto.length });
      return r;
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'A memória do Mister ainda não está disponível.' };
      throw e;
    }
  }

  /** Troca o texto de uma anotação (pelo id — a tela — ou pelo trecho — a conversa). Mesmas conferências do anotar. */
  async trocar(quem: QuemMexe, alvo: { id: string } | { sobre: Sobre; trecho: unknown }, texto: unknown): Promise<Resultado> {
    const c = conferirMemoria(texto);
    if ('erro' in c) return { ok: false, erro: c.erro };
    try {
      const r = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quem.tenantId}), ${TRAVA_DA_MEMORIA})`);
        const achado = await this.achar(tx, quem, alvo);
        if ('erro' in achado) return { ok: false as const, erro: achado.erro };
        const limite = achado.colaboradorId ? LIMITE_DA_PESSOA : LIMITE_DA_EMPRESA;
        const outros = (await this.doDono(tx, quem.tenantId, achado.colaboradorId)).filter((i) => i.id !== achado.id);
        const falta = faltaParaCaber(outros, c.texto, limite);
        if (falta) return { ok: false as const, erro: `Não cabe (${usoEmLetras(letrasUsadas(outros), limite)} sem esta): faltam ${falta} letras.` };
        const [item] = linhas(
          await tx.execute(sql`
            update mister_memoria set texto = ${c.texto}, atualizado_em = clock_timestamp()
             where id = ${achado.id}::uuid and tenant_id = ${quem.tenantId}::uuid
            returning ${ITEM}`),
        ) as ItemDaMemoria[];
        if (!item) return { ok: false as const, erro: 'Essa anotação não existe mais.' };
        return { ok: true as const, item, uso: usoEmLetras(letrasUsadas(outros) + c.texto.length, limite) };
      });
      if (r.ok) await this.auditar(quem, 'mister_memoria_trocada', r.item.id, { origem: quem.origem, letras: r.item.texto.length });
      return r;
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'A memória do Mister ainda não está disponível.' };
      throw e;
    }
  }

  /** Esquece uma anotação (pelo id ou pelo trecho). Não dá para desfazer; a auditoria guarda que foi esquecida. */
  async esquecer(quem: QuemMexe, alvo: { id: string } | { sobre: Sobre; trecho: unknown }): Promise<Resultado> {
    try {
      const r = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${quem.tenantId}), ${TRAVA_DA_MEMORIA})`);
        const achado = await this.achar(tx, quem, alvo);
        if ('erro' in achado) return { ok: false as const, erro: achado.erro };
        const [item] = linhas(
          await tx.execute(sql`delete from mister_memoria where id = ${achado.id}::uuid and tenant_id = ${quem.tenantId}::uuid returning ${ITEM}`),
        ) as ItemDaMemoria[];
        if (!item) return { ok: false as const, erro: 'Essa anotação não existe mais.' };
        const restam = await this.doDono(tx, quem.tenantId, item.colaboradorId);
        return { ok: true as const, item, uso: usoEmLetras(letrasUsadas(restam), item.colaboradorId ? LIMITE_DA_PESSOA : LIMITE_DA_EMPRESA) };
      });
      if (r.ok) await this.auditar(quem, 'mister_memoria_esquecida', r.item.id, { origem: quem.origem });
      return r;
    } catch (e: any) {
      if (semTabela(e)) return { ok: false, erro: 'A memória do Mister ainda não está disponível.' };
      throw e;
    }
  }

  /** A tela: o resultado vira 4xx com a frase (nunca 500 por regra de negócio). */
  static paraATela(r: Resultado) {
    if (!r.ok) throw new BadRequestException(r.erro);
    return { item: r.item, uso: r.uso };
  }
  static naoAchada(): never {
    throw new NotFoundException('Essa anotação não existe mais.');
  }

  // ───────────────────────────── por dentro ─────────────────────────────

  private async pessoaDaEmpresa(tx: any, tenantId: string, colaboradorId: string): Promise<boolean> {
    return linhas(await tx.execute(sql`select 1 from colaborador where id = ${colaboradorId}::uuid and tenant_id = ${tenantId}::uuid`)).length > 0;
  }

  /**
   * A anotação a trocar ou esquecer, com a permissão: pelo id (a tela, só o presidente) ou pelo trecho entre as do dono
   * pedido (a conversa). O que é da empresa, só o presidente troca ou esquece; o que é de uma pessoa, ela ou o presidente.
   */
  private async achar(tx: any, quem: QuemMexe, alvo: { id: string } | { sobre: Sobre; trecho: unknown }): Promise<ItemDaMemoria | { erro: string }> {
    let item: ItemDaMemoria | undefined;
    if ('id' in alvo) {
      if (!/^[0-9a-f-]{36}$/i.test(String(alvo.id ?? ''))) return { erro: 'Essa anotação não existe mais.' };
      [item] = linhas(await tx.execute(sql`select ${ITEM} from mister_memoria where id = ${alvo.id}::uuid and tenant_id = ${quem.tenantId}::uuid`)) as ItemDaMemoria[];
      if (!item) return { erro: 'Essa anotação não existe mais.' };
    } else {
      const achado = acharPeloTrecho(await this.doDono(tx, quem.tenantId, alvo.sobre), alvo.trecho);
      if ('erro' in achado) return achado;
      item = achado;
    }
    if (!quem.presidente && item.colaboradorId !== quem.colaboradorId)
      return { erro: item.colaboradorId ? 'Você só mexe no que é seu.' : 'O que é da empresa, só o presidente troca ou esquece.' };
    return item;
  }

  private async auditar(quem: QuemMexe, acao: string, id: string, detalhe: Record<string, unknown>) {
    // A auditoria guarda o QUE aconteceu (quem, sobre quem, quantas letras) — nunca o texto anotado.
    await this.auditoria
      ?.registrar({ tenantId: quem.tenantId, atorId: quem.colaboradorId, atorPerfil: quem.presidente ? 'presidente' : 'gerente', tipo: 'config', acao, entidadeTipo: 'mister_memoria', entidadeId: id, detalhe, origem: quem.origem === 'conversa' ? 'mister' : 'web' } as any)
      .catch((e: any) => this.logger.warn(`mister: a auditoria da memória falhou — ${e?.message ?? e}`));
  }
}
