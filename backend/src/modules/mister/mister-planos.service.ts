import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { horaNoFuso } from '../../common/data';
import { uuidDeChave } from '../../common/id-deterministico';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TEXTOS_DAS_ACOES } from './mister-acoes';
import { MisterAcoesService } from './mister-acoes.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import {
  FilhoDoPlano,
  LIMITES_DO_PLANO,
  ParametrosDoPlano,
  PassoDoPlano,
  PREFIXO_DO_PLANO,
  PROCEDIMENTO_DO_PLANO,
  RESULTADO_DO_PLANO_TROCADO,
  TEXTOS_DO_PLANO,
  botaoDeDeixar,
  botaoDeTentar,
  botoesDoPlano,
  desfechosDoPlano,
  lerBotaoDoPlano,
  lerPassos,
  mensagensDoPlano,
  nivelDaAcao,
  passosQueNaoSeRefazem,
  proximoDoPlano,
  textoDoFimDoPlano,
  textoDoPlano,
} from './mister-plano';
import { MisterPropostasService } from './mister-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VÁRIAS TAREFAS NUM PEDIDO (versão 7, V7c; `mister-plano.ts` tem as regras). A ferramenta `propor_plano` confere cada passo
// pela MESMA `preparar` de `propor_acao` e grava o plano. O toque em "Fazer os três" passa pelo MESMO `responder` das
// propostas (uma vez só, só de quem pediu, com a sessão com PIN). Aqui cada passo vira a proposta filha da ação dele, com o id
// fixo pelo plano, pelo número e pela tentativa (o índice único de `mister_proposta` não deixa criar duas), e executa pelo
// MESMO `executar`. Sem migration: o procedimento é texto e o andamento fica nas filhas.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

interface PlanoLido {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  situacao: string;
  parametros: ParametrosDoPlano;
}

@Injectable()
export class MisterPlanosService implements OnModuleInit {
  private readonly logger = new Logger('MisterPlanos');
  private rodando = false;
  /** Os planos andando NESTE processo; `true` = pediram outra volta enquanto esta rodava. Entre processos, valem as gravações condicionais. */
  private readonly andando = new Map<string, boolean>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    private readonly acoes: MisterAcoesService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarPlano((e, en, loja) => this.propor(e, en, loja));
    this.propostas.registrarPlano((id) => this.avancar(id));
    this.entrada?.registrarBotao(PREFIXO_DO_PLANO, (botaoId, quem) => this.tocou(botaoId, quem));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /** A ferramenta `propor_plano`. Nunca lança: o erro vira a frase que volta à IA. Nada acontece antes do botão. */
  async propor(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    try {
      if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return recusa(TEXTOS_DAS_ACOES.soGestor);
      const lidos = lerPassos(en.passos);
      if ('erro' in lidos) return recusa(lidos.erro);
      if (this.numero && (await this.numero.ler()).provedor === 'evolution') return recusa(TEXTOS_DO_PLANO.semBotao);
      const passos: PassoDoPlano[] = [];
      const alvos = new Set<string>();
      for (const [i, entrada] of lidos.passos.entries()) {
        const p = await this.acoes.preparar(e, entrada, loja);
        if ('erro' in p) return recusa(`Passo ${i + 1}: ${p.erro}`);
        const chave = `${p.acao}:${p.alvo}`;
        if (alvos.has(chave)) return recusa(`Passo ${i + 1}: ${TEXTOS_DO_PLANO.repetido}`);
        alvos.add(chave);
        passos.push({ n: i + 1, acao: p.acao, nivel: p.def.nivel, resumo: p.resumo, entrada, alvo: p.alvo });
      }
      const parametros: ParametrosDoPlano = { colaboradorId: e.colaboradorId, nivel: e.nivel, loja, tentativa: 1, passos };
      const [p] = linhas(
        await this.db.execute(sql`
          insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
          values (${e.tenantId}::uuid, ${loja.atual}::uuid, ${randomUUID()}::uuid, ${PROCEDIMENTO_DO_PLANO}, ${JSON.stringify(parametros)}::jsonb, 'botao',
                  clock_timestamp() + make_interval(mins => ${LIMITES_DO_PLANO.prazoMin}::int))
          returning id::text as id`),
      );
      await this.ficarSoComOMaisNovo(e);
      return {
        ok: true,
        dados: {
          oQueVouFazer: textoDoPlano(passos),
          botao: botoesDoPlano(p.id, passos.length)[0].titulo,
          siga: 'Diga em uma frase o que vai fazer. O plano numerado e o botão chegam logo abaixo: não repita a lista. Nada é feito antes do toque, e o passo de PIN pede o PIN pelo link. Não diga que fez.',
        },
        mensagens: mensagensDoPlano(p.id, passos),
      };
    } catch (err: any) {
      if (semTabela(err)) return recusa('As ações do Mister ainda não estão disponíveis neste servidor.');
      this.logger.error(`o plano não foi proposto: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui preparar o plano agora.');
    }
  }

  /** Um plano aberto por pessoa: fica o mais novo. Uma instrução só, depois do insert (com dois juntos, sobra um). */
  private async ficarSoComOMaisNovo(e: EscopoDoMister): Promise<void> {
    await this.db.execute(sql`
      update mister_proposta x
         set situacao = 'recusada', concluida_em = now(), resultado = ${RESULTADO_DO_PLANO_TROCADO}
        from (select id from mister_proposta
               where tenant_id = ${e.tenantId}::uuid and procedimento = ${PROCEDIMENTO_DO_PLANO} and situacao = 'proposta'
                 and parametros ->> 'colaboradorId' = ${e.colaboradorId}
               order by criada_em desc, id desc limit 1) n
       where x.tenant_id = ${e.tenantId}::uuid and x.procedimento = ${PROCEDIMENTO_DO_PLANO} and x.situacao = 'proposta'
         and x.parametros ->> 'colaboradorId' = ${e.colaboradorId} and x.id <> n.id`);
  }

  // ───────────────────────────── andar ─────────────────────────────

  /**
   * Faz o que der do plano, na ordem, e para no primeiro passo que precisa esperar (o PIN). Pode ser chamada de vários lugares
   * (o toque, o fim de um passo, a rotina): cada passo só nasce uma vez e só executa uma vez, pelas gravações condicionais.
   */
  async avancar(id: string): Promise<void> {
    if (this.andando.has(id)) {
      this.andando.set(id, true);
      return;
    }
    this.andando.set(id, false);
    try {
      do {
        this.andando.set(id, false);
        await this.umaVolta(id);
      } while (this.andando.get(id));
    } finally {
      this.andando.delete(id);
    }
  }

  private async umaVolta(id: string): Promise<void> {
    // Cada passo gasta no máximo duas voltas (nascer e executar); o teto só impede um laço sem fim.
    for (let i = 0; i < LIMITES_DO_PLANO.maximo * 3 + 2; i++) {
      const plano = await this.ler(id);
      if (!plano || plano.situacao !== 'executando') return;
      const filhos = await this.filhos(plano);
      const d = proximoDoPlano(plano.parametros.passos.length, plano.parametros.tentativa, filhos, Date.now(), passosQueNaoSeRefazem(plano.parametros.passos, filhos));
      if (d.tipo === 'esperar') return;
      if (d.tipo === 'fechar') return this.fechar(plano, filhos);
      if (d.tipo === 'parado') {
        await this.db.execute(sql`
          update mister_proposta set situacao = 'nao_deu', resultado = ${TEXTOS_DO_PLANO.naoConfirmou}, concluida_em = now()
           where id = ${d.filhoId}::uuid and situacao = 'executando'`);
      } else if (d.tipo === 'executar') {
        // null = outra volta pegou este passo; quando ele terminar, o plano é chamado de novo.
        if ((await this.propostas.executar(d.filhoId)) === null) return;
      } else {
        await this.iniciarPasso(plano, d.n);
      }
    }
  }

  private async ler(id: string): Promise<PlanoLido | null> {
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", situacao, parametros
          from mister_proposta where id = ${id}::uuid and procedimento = ${PROCEDIMENTO_DO_PLANO}`),
    );
    return p ?? null;
  }

  /** O id fixo da filha: o índice único (aviso, procedimento) garante um passo só por tentativa. */
  private idDoPasso(planoId: string, n: number, tentativa: number): string {
    return uuidDeChave('mister:plano:', planoId, ':', String(n), ':', String(tentativa));
  }

  private async filhos(p: PlanoLido): Promise<FilhoDoPlano[]> {
    const ids: string[] = [];
    for (const passo of p.parametros.passos) for (let t = 1; t <= p.parametros.tentativa; t++) ids.push(this.idDoPasso(p.id, passo.n, t));
    const lidos = linhas(
      await this.db.execute(sql`
        select id::text as id, situacao, resultado, executada_em as "executadaEm", (parametros ->> 'passo')::int as n, (parametros ->> 'tentativa')::int as tentativa
          from mister_proposta
         where aviso_id in (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)}) and tenant_id = ${p.tenantId}::uuid and parametros ->> 'planoId' = ${p.id}`),
    );
    return lidos.map((f) => ({
      id: f.id,
      n: Number(f.n),
      tentativa: Number(f.tentativa),
      situacao: String(f.situacao),
      resultado: f.resultado ?? null,
      executadaEm: f.executadaEm ? new Date(f.executadaEm).getTime() : null,
    }));
  }

  private async telefoneDe(tenantId: string, colaboradorId: string): Promise<string | null> {
    const [v] = linhas(
      await this.db.execute(sql`
        select telefone from mister_vinculo
         where tenant_id = ${tenantId}::uuid and colaborador_id = ${colaboradorId}::uuid and ligado_em is not null and telefone is not null`),
    );
    return v?.telefone ? String(v.telefone) : null;
  }

  /** A loja do plano, se a pessoa ainda pode agir nela (o gerente pode ter mudado de loja desde a pergunta). */
  private lojaQueVale(e: EscopoDoMister, loja: ParametrosDoPlano['loja']): ParametrosDoPlano['loja'] | null {
    if (e.presa) return loja.atual === e.presa ? loja : null;
    return loja.atual && !e.lojas.some((l) => l.id === loja.atual) ? null : loja;
  }

  /**
   * Faz o passo nascer: confere tudo de novo pela MESMA `preparar` (o estado e a permissão podem ter mudado desde a pergunta) e
   * grava a filha. De botão, já autorizada pelo toque no plano; de PIN, esperando o PIN pelo link. A recusa vira o desfecho dele.
   */
  private async iniciarPasso(plano: PlanoLido, n: number): Promise<void> {
    const { colaboradorId, tentativa, passos } = plano.parametros;
    const passo = passos[n - 1];
    const avisoId = this.idDoPasso(plano.id, n, tentativa);
    const marca = { planoId: plano.id, passo: n, tentativa };
    const telefone = await this.telefoneDe(plano.tenantId, colaboradorId);
    const e = telefone ? await this.ferramentas.escopo(plano.tenantId, colaboradorId, telefone) : null;
    let erro: string | null = null;
    let p: Awaited<ReturnType<MisterAcoesService['preparar']>> | null = null;
    if (!e) erro = TEXTOS_DO_PLANO.semAcesso;
    else {
      const loja = this.lojaQueVale(e, plano.parametros.loja);
      if (!loja) erro = TEXTOS_DO_PLANO.outraLoja;
      else {
        try {
          p = await this.acoes.preparar(e, passo.entrada, loja);
          if ('erro' in p) erro = p.erro;
          // O mesmo nome pode ter passado a apontar para outro produto, conta ou pedido: a pessoa autorizou o que viu.
          else if (p.alvo !== passo.alvo) erro = TEXTOS_DO_PLANO.alvoMudou;
        } catch (err: any) {
          this.logger.error(`o passo ${n} do plano ${plano.id} não foi preparado: ${String(err?.message ?? err).slice(0, 200)}`, err?.stack);
          erro = 'não consegui preparar este passo. Nada foi feito.';
        }
      }
    }
    if (erro || !p || 'erro' in p) {
      await this.db.execute(sql`
        insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, situacao, vence_em, concluida_em, resultado)
        values (${plano.tenantId}::uuid, ${plano.unidadeId}::uuid, ${avisoId}::uuid, ${passo.acao}, ${JSON.stringify({ colaboradorId, nivel: plano.parametros.nivel, ...marca })}::jsonb,
                ${nivelDaAcao(passo.acao)}, 'nao_deu', now(), now(), ${String(erro ?? 'não consegui preparar este passo.').slice(0, 400)})
        on conflict (aviso_id, procedimento) do nothing`);
      return;
    }
    const pin = p.def.nivel === 'pin';
    const final = String(telefone).slice(-4);
    const [nova] = linhas(
      await this.db.execute(sql`
        insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, situacao, vence_em, respondida_em, autorizada_por, telefone_final)
        values (${plano.tenantId}::uuid, ${p.unidadeId}::uuid, ${avisoId}::uuid, ${p.acao}, ${JSON.stringify({ ...p.parametros, ...marca })}::jsonb, ${p.def.nivel},
                ${pin ? 'proposta' : 'autorizada'}, clock_timestamp() + make_interval(mins => ${p.def.prazoMin}::int),
                ${pin ? null : new Date().toISOString()}::timestamptz, ${pin ? null : colaboradorId}::uuid, ${pin ? null : final})
        on conflict (aviso_id, procedimento) do nothing
        returning id::text as id, vence_em as "venceEm"`),
    );
    if (!nova) return; // outra volta fez este passo nascer
    if (pin) {
      const texto = `Passo ${n} de ${passos.length}. ${TEXTOS_DAS_ACOES.linkDaAcao(p.resumo, horaNoFuso(new Date(nova.venceEm)))}`;
      await this.propostas.enviarLink(nova.id, colaboradorId, String(telefone), texto);
    } else {
      await this.auditar(plano.tenantId, colaboradorId, plano.parametros.nivel, 'mister_proposta_autorizada', nova.id, { procedimento: p.acao, plano: plano.id, passo: n, final });
    }
  }

  /** Fecha o plano (uma vez só) e diz o que entrou e o que não entrou. */
  private async fechar(plano: PlanoLido, filhos: FilhoDoPlano[]): Promise<void> {
    const { colaboradorId, tentativa, passos, nivel } = plano.parametros;
    const desfechos = desfechosDoPlano(passos, filhos);
    const { texto, faltou } = textoDoFimDoPlano(desfechos);
    const [fechou] = linhas(
      await this.db.execute(sql`
        update mister_proposta set situacao = ${faltou ? 'nao_deu' : 'feita'}, resultado = ${texto.slice(0, 400)}, concluida_em = now()
         where id = ${plano.id}::uuid and situacao = 'executando' and (parametros ->> 'tentativa')::int = ${tentativa}
        returning id`),
    );
    if (!fechou) return;
    await this.auditar(plano.tenantId, colaboradorId, nivel, faltou ? 'mister_proposta_nao_deu' : 'mister_proposta_feita', plano.id, {
      procedimento: PROCEDIMENTO_DO_PLANO,
      feitos: desfechos.filter((d) => d.feito).map((d) => d.n),
      naoEntraram: desfechos.filter((d) => !d.feito).map((d) => d.n),
    });
    const telefone = await this.telefoneDe(plano.tenantId, colaboradorId);
    if (!telefone) return;
    if (!faltou) return this.dizer(telefone, texto);
    const naoRefazer = passosQueNaoSeRefazem(passos, filhos);
    const faltam = desfechos.filter((d) => !d.feito);
    const refazem = faltam.filter((d) => !naoRefazer.has(d.n)).length;
    if (!refazem) return this.dizer(telefone, `${texto}\n\n${TEXTOS_DO_PLANO.naoRepito}`);
    const pergunta = refazem < faltam.length ? TEXTOS_DO_PLANO.perguntaDeNovoEmParte : TEXTOS_DO_PLANO.perguntaDeNovo;
    const botoes = [
      { id: botaoDeTentar(plano.id, tentativa), titulo: 'Tentar de novo' },
      { id: botaoDeDeixar(plano.id, tentativa), titulo: 'Deixar assim' },
    ];
    const semBotao = !this.numero || (await this.numero.ler()).provedor === 'evolution';
    if (semBotao) return this.dizer(telefone, `${texto}\n\nSe ainda precisar, me peça de novo o que não entrou.`);
    const junto = `${texto}\n\n${pergunta}`;
    if (junto.length <= LIMITES_DO_PLANO.cabeComBotao) return this.dizer(telefone, junto, botoes);
    await this.dizer(telefone, texto);
    await this.dizer(telefone, pergunta, botoes);
  }

  // ───────────────────────────── tentar de novo ─────────────────────────────

  /** "Tentar de novo" (só o que não entrou, pelo mesmo caminho) ou "Deixar assim". `false` = não é botão de plano desta pessoa. */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoPlano(botaoId);
    if (!b || !quem.vinculos.length) return false;
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", parametros
          from mister_proposta
         where id = ${b.planoId}::uuid and procedimento = ${PROCEDIMENTO_DO_PLANO}
           and tenant_id in (${sql.join(quem.vinculos.map((v) => sql`${v.tenantId}::uuid`), sql`, `)})`),
    );
    if (!p) return false;
    const v = quem.vinculos.find((x) => x.tenantId === p.tenantId)!;
    if (v.colaboradorId !== String(p.parametros?.colaboradorId ?? '')) {
      await this.dizer(quem.telefone, TEXTOS_DAS_ACOES.naoDisponivel);
      return true;
    }
    const naTentativa = sql`situacao = 'nao_deu' and (parametros ->> 'tentativa')::int = ${b.tentativa} and coalesce(parametros ->> 'deixado', '') <> 'true'`;
    if (b.acao === 'deixar') {
      const [m] = linhas(
        await this.db.execute(sql`update mister_proposta set parametros = parametros || '{"deixado": true}'::jsonb where id = ${p.id}::uuid and ${naTentativa} returning id`),
      );
      await this.dizer(quem.telefone, m ? TEXTOS_DO_PLANO.deixado : TEXTOS_DO_PLANO.tentativaNaoVale);
      return true;
    }
    if (await this.propostas.sessaoPendente(p.tenantId, v.colaboradorId, quem.telefone)) return true;
    // Uma vez só: o segundo toque não acha mais a situação nem a tentativa.
    const [m] = linhas(
      await this.db.execute(sql`
        update mister_proposta
           set situacao = 'executando', concluida_em = null, resultado = null,
               parametros = jsonb_set(parametros, '{tentativa}', to_jsonb(${b.tentativa + 1}::int))
         where id = ${p.id}::uuid and ${naTentativa}
           and concluida_em > now() - make_interval(mins => ${LIMITES_DO_PLANO.tentarDeNovoMin}::int)
        returning id`),
    );
    if (!m) {
      await this.dizer(quem.telefone, TEXTOS_DO_PLANO.tentativaNaoVale);
      return true;
    }
    await this.auditar(p.tenantId, v.colaboradorId, v.nivel, 'mister_plano_tentou_de_novo', p.id, { tentativa: b.tentativa + 1 });
    await this.dizer(quem.telefone, TEXTOS_DO_PLANO.tentando);
    void this.avancar(p.id).catch((e) => this.logger.error(`o plano ${p.id} não andou — ${e?.message ?? e}`));
    return true;
  }

  // ───────────────────────────── a rotina ─────────────────────────────

  /** Retoma o plano que parou no meio (o processo reiniciou, o PIN venceu). Só na nuvem. */
  @Cron('*/30 * * * * *')
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      const abertos = linhas(
        await this.db.execute(sql`
          select id::text as id from mister_proposta
           where situacao = 'executando' and procedimento = ${PROCEDIMENTO_DO_PLANO}
           order by vence_em limit 50`),
      );
      for (const p of abertos) await this.avancar(p.id).catch((e) => this.logger.warn(`o plano ${p.id} não andou — ${e?.message ?? e}`));
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a rotina dos planos falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  // ───────────────────────────── apoio ─────────────────────────────

  private async dizer(telefone: string, texto: string, botoes?: { id: string; titulo: string }[]): Promise<void> {
    try {
      await this.numero?.enviar(telefone, botoes?.length ? { texto, botoes } : { texto });
    } catch (e: any) {
      this.logger.warn(`a mensagem do plano não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }

  private async auditar(tenantId: string, atorId: string, atorPerfil: string, acao: string, propostaId: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria
      ?.registrar({ tenantId, atorId, atorPerfil, tipo: 'mister', acao, entidadeTipo: 'mister_proposta', entidadeId: propostaId, detalhe, origem: 'whatsapp' } as any)
      .catch((e: any) => this.logger.warn(`a auditoria do plano falhou — ${e?.message ?? e}`));
  }
}
