import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { hojeISO, horaNoFuso } from '../../common/data';
import { pausaVigenteDoCanal, type CanalDaPausa } from '../../common/pausa-do-canal';
import { podeAcessar } from '../../auth/permissoes';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DeliveryService } from '../delivery/delivery.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { ProdutoService } from '../produto/produto.service';
import { TarefaInstanciaService } from '../tarefa/tarefa-instancia.service';
import { TarefaDefService } from '../tarefa/tarefa-def.service';
import { pedidoComoNoQuadro } from './mister-agente.regras';
import {
  ACOES,
  AcaoDoMister,
  CanalDoProduto,
  BOTOES_DA_IMAGEM,
  ParametrosDaAcao,
  type ProporcaoDaImagem,
  TEXTOS_DAS_ACOES,
  canaisDoProduto,
  conferirAcao,
  ehAcaoDoMister,
  imagemLigada,
  sigaDaAcao,
  nomeDoEstadoDaTarefa,
  nomesDosCanais,
  ondeOProduto,
  pedidoAndou,
  pedidoServe,
  produtoFicou,
  resumoDoPedido,
} from './mister-acoes';
import { EscopoDoMister, MisterFerramentasService, ResultadoDaFerramenta } from './mister-ferramentas.service';
import { MisterNumeroService } from './mister-numero.service';
import { botoesDaProposta } from './mister-procedimentos';
import { MisterPropostasService } from './mister-propostas.service';
import { GraphImagemService } from '../graph/graph-imagem.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS AÇÕES DO MISTER (versão 6, M6j; `mister-acoes.ts` tem o catálogo e as conferências). A ferramenta `propor_acao` confere
// a ação, a permissão do perfil (a MESMA da rota da tela) e o alvo, e grava a proposta de botão (`mister_proposta`, a mesma
// das F4.x) com QUEM pediu; o "Autorizar" dessa pessoa executa pelo MESMO serviço da tela e o efeito é conferido na hora,
// pelo estado que ficou. Sem migration: o procedimento da proposta é texto, e as ações entram no catálogo do código.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => ['42P01', '42703'].includes(e?.code) || ['42P01', '42703'].includes(e?.cause?.code);
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });
type AcaoDePedido = 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido';
/** O padrão do `ilike` (o mesmo da busca das regras: o texto sem `%`, `_` e barra). */
const comoTexto = (texto: string) => `%${texto.replace(/[%_\\]/g, '')}%`;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** Da busca, um só: o nome igual (sem acento e maiúscula) vence; senão, o único achado; senão, a pessoa escolhe. */
function escolherUm<T>(achados: any[], dito: string, nome: (a: any) => string, nenhum: string, varios: (nomes: string) => string, montar: (a: any) => T): T | { erro: string } {
  if (!achados.length) return { erro: nenhum };
  const iguais = achados.filter((a) => semAcento(nome(a)) === semAcento(dito));
  if (iguais.length === 1) return montar(iguais[0]);
  if (achados.length === 1) return montar(achados[0]);
  return { erro: varios(achados.map((a) => `"${nome(a)}"`).join(', ')) };
}
/** A frase de quem não tem a permissão da ação (a mesma da rota da tela). */
const semPermissaoDe = (p: 'delivery' | 'meu_dia' | 'loja' | 'checklist') =>
  p === 'meu_dia'
    ? TEXTOS_DAS_ACOES.semPermissaoTarefas
    : p === 'loja'
      ? TEXTOS_DAS_ACOES.semPermissaoLoja
      : p === 'checklist'
        ? TEXTOS_DAS_ACOES.semPermissaoChecklist
        : TEXTOS_DAS_ACOES.semPermissao;
const NOME_DA_SITUACAO: Record<string, string> = { novo: 'aguardando aceite', confirmado: 'em preparo', pronto: 'pronto', despachado: 'a caminho', concluido: 'concluído', entregue: 'entregue', cancelado: 'cancelado' };

@Injectable()
export class MisterAcoesService implements OnModuleInit {
  private readonly logger = new Logger('MisterAcoes');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly delivery?: DeliveryService,
    @Optional() private readonly pausa?: PausaDoCanalService,
    @Optional() private readonly auditoria?: AuditoriaService,
    // Lote 2: a tarefa e o produto pelos MESMOS serviços das telas (Tarefas; a pausa do produto no cadastro).
    @Optional() private readonly tarefas?: TarefaInstanciaService,
    @Optional() private readonly produtos?: ProdutoService,
    // Lote 3: a definição da tarefa (a primeira etapa do "Nova tarefa" da tela).
    @Optional() private readonly defs?: TarefaDefService,
    // M6l: a imagem pelo DMS Graph (módulo só da nuvem).
    @Optional() private readonly imagens?: GraphImagemService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarAcoes((e, en, loja) => this.propor(e, en, loja));
    this.propostas.registrarAcao((p) => this.executar(p));
  }

  // ───────────────────────────── propor ─────────────────────────────

  /** A ferramenta `propor_acao`. Nunca lança: o erro vira a frase que volta à IA. */
  async propor(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    try {
      if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return recusa(TEXTOS_DAS_ACOES.soGestor);
      const c = conferirAcao(en.acao, en);
      if ('erro' in c) return recusa(c.erro);
      const def = ACOES[c.parametros.acao];
      if (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, def.permissao)) return recusa(semPermissaoDe(def.permissao));
      if (c.parametros.acao === 'criar_imagem' && !imagemLigada()) return recusa(TEXTOS_DAS_ACOES.imagemDesligada);
      if (this.numero && (await this.numero.ler()).provedor === 'evolution') return recusa(TEXTOS_DAS_ACOES.semBotao);
      // A loja: a da conversa (o gerente, a dele); a empresa de uma loja só, ela.
      const lojas = loja.atual ? [loja.atual] : e.lojas.map((l) => l.id);
      if (!lojas.length && !e.lojaUnica) return recusa(TEXTOS_DAS_ACOES.semPermissao);
      let unidadeId: string | null = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
      let resumo = c.resumo;
      const parametros: Record<string, unknown> = { ...c.parametros, colaboradorId: e.colaboradorId, nivel: e.nivel };
      let alvo: string = c.parametros.acao;
      if (c.parametros.acao === 'aceitar_pedido' || c.parametros.acao === 'pedido_pronto' || c.parametros.acao === 'despachar_pedido') {
        const achado = await this.acharPedido(e.tenantId, c.parametros.numero, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in achado) return recusa(achado.erro);
        const fora = pedidoServe(c.parametros.acao, achado);
        if (fora) return recusa(fora);
        unidadeId = achado.unidadeId;
        parametros.pedidoId = achado.id;
        parametros.pedido = achado.nome;
        resumo = resumoDoPedido(c.parametros.acao, achado.nome);
        alvo = achado.id;
      } else if (c.parametros.acao === 'concluir_tarefa') {
        // Lote 2: a tarefa de HOJE (o dia da loja) pelo título, nas lojas da pessoa; a regra de foto da tela, já na pergunta.
        const t = await this.acharTarefa(e.tenantId, c.parametros.tarefa, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in t) return recusa(t.erro);
        if (t.estado === c.parametros.estado) return recusa(TEXTOS_DAS_ACOES.tarefaJaMarcada(nomeDoEstadoDaTarefa(t.estado)));
        if (this.tarefas && c.parametros.estado !== 'nao_feita') {
          const pol = await this.tarefas.politicaFoto(e.tenantId);
          if ((c.parametros.estado === 'feita' && pol.conclusao) || (c.parametros.estado === 'parcial' && pol.parcial)) return recusa(TEXTOS_DAS_ACOES.tarefaPedeFoto);
        }
        unidadeId = t.unidadeId;
        parametros.instanciaId = t.id;
        parametros.titulo = t.titulo;
        resumo = `Marcar a tarefa "${t.titulo}" como ${nomeDoEstadoDaTarefa(c.parametros.estado)}${c.parametros.justificativa ? ` (motivo: ${c.parametros.justificativa})` : ''}.`;
        alvo = t.id;
      } else if (c.parametros.acao === 'criar_tarefa') {
        // Lote 3: a loja da tarefa (a da conversa; a da empresa de uma loja só), a função pelo nome (a tela exige) e o
        // responsável, se dito, entre os ativos da loja.
        const u = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
        if (!u) return recusa(TEXTOS_DAS_ACOES.lojaDaTarefa);
        const f = await this.acharFuncao(e.tenantId, c.parametros.funcao);
        if ('erro' in f) return recusa(f.erro);
        let resp: { id: string; nome: string } | null = null;
        if (c.parametros.responsavel) {
          const r = await this.acharColaborador(e.tenantId, c.parametros.responsavel, u);
          if ('erro' in r) return recusa(r.erro);
          resp = r;
        }
        unidadeId = u;
        parametros.funcaoId = f.id;
        parametros.funcaoNome = f.nome;
        // `colaboradorId` é QUEM PEDIU (a régua do "Autorizar"): o responsável vai em outro campo.
        parametros.responsavelId = resp?.id ?? null;
        parametros.responsavelNome = resp?.nome ?? null;
        resumo = `Criar para hoje a tarefa "${c.parametros.titulo}"${c.parametros.horario ? ` às ${c.parametros.horario}` : ''}, da função ${f.nome}${resp ? `, para ${resp.nome}` : ', em aberto (sem responsável)'}.`;
        alvo = `${c.parametros.titulo}:${f.id}`;
      } else if (c.parametros.acao === 'pausar_produto' || c.parametros.acao === 'reativar_produto') {
        // Lote 2: o produto do cardápio pelo nome; sem canal dito, os canais em que ele está ("Pausar em todos" da tela).
        const pr = await this.acharProduto(e.tenantId, c.parametros.produto, e.lojaUnica && !loja.atual ? null : lojas);
        if ('erro' in pr) return recusa(pr.erro);
        const canais = c.parametros.canais ?? canaisDoProduto(pr);
        parametros.produtoId = pr.id;
        parametros.nome = pr.nome;
        parametros.canais = canais;
        resumo = `${c.parametros.acao === 'pausar_produto' ? 'Pausar' : 'Reativar'} "${pr.nome}" ${ondeOProduto(canais)}.`;
        alvo = pr.id;
      } else if ((c.parametros.acao === 'pausar_canal' || c.parametros.acao === 'reabrir_canal') && c.parametros.canais.includes('cardapio') && this.pausa) {
        // O cardápio digital é de cada loja: quem diz qual é o serviço da tela (o cadastro do cardápio), já na pergunta.
        try {
          const l = await this.pausa.lojaDoCardapio(e.tenantId, unidadeId);
          if (!l.tem) return recusa('Esta loja não tem cardápio digital para pausar.');
        } catch {
          return recusa('A empresa tem mais de um cardápio digital: diga de qual loja é a pausa.');
        }
      }
      // M6l: cada pedido de imagem é um alvo (o mesmo pedido repetido é a mesma proposta e não paga de novo).
      if (c.parametros.acao === 'criar_imagem') alvo = `${c.parametros.proporcao}:${c.parametros.pedido}`;
      const p = await this.gravar(e, c.parametros.acao, unidadeId, parametros, `${alvo}:${unidadeId ?? 'empresa'}`);
      if (!p) return recusa('Essa mesma ação já foi autorizada e está em andamento; o resultado chega na conversa.');
      return {
        ok: true,
        dados: {
          oQueVouFazer: resumo,
          siga: sigaDaAcao(c.parametros.acao),
        },
        mensagens: [
          c.parametros.acao === 'criar_imagem'
            ? { texto: TEXTOS_DAS_ACOES.perguntaDaImagem(resumo, def.prazoMin), botoes: botoesDaProposta(p, BOTOES_DA_IMAGEM) }
            : { texto: TEXTOS_DAS_ACOES.pergunta(resumo, def.prazoMin), botoes: botoesDaProposta(p) },
        ],
      };
    } catch (err: any) {
      if (semTabela(err)) return recusa('As ações do Mister ainda não estão disponíveis neste servidor.');
      this.logger.error(`a ação não foi proposta: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui preparar a ação agora.');
    }
  }

  /** O pedido pelo número do painel, nas lojas da pessoa, nas últimas 24 horas (a mesma busca do cancelamento). */
  private async acharPedido(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; unidadeId: string | null; status: string; tipo: string | null; nome: string } | { erro: string }> {
    if (!/^[A-Za-z0-9-]{1,40}$/.test(dito)) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
    const numeroDoDia = /^\d{1,9}$/.test(dito) ? Number(dito) : null;
    const achados = linhas(
      await this.db.execute(sql`
        select pe.id::text as id, pe.unidade_id::text as "unidadeId", pe.canal, pe.numero, pe.display_id as "displayId", pe.status, pe.tipo
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid and pe.deleted_at is null
           ${lojas ? sql`and (pe.unidade_id is null or pe.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and pe.criado_em > now() - interval '24 hours'
           and (pe.display_id = ${dito} ${numeroDoDia != null ? sql`or pe.numero = ${numeroDoDia}` : sql``})
         order by pe.criado_em desc
         limit 6`),
    );
    if (!achados.length) return { erro: TEXTOS_DAS_ACOES.naoAchado };
    const abertos = achados.filter((a) => a.status !== 'concluido');
    if (abertos.length > 1) return { erro: TEXTOS_DAS_ACOES.maisDeUm };
    const a = abertos[0] ?? achados[0];
    return { id: a.id, unidadeId: a.unidadeId ?? null, status: String(a.status), tipo: a.tipo ?? null, nome: pedidoComoNoQuadro(a) };
  }

  /**
   * Lote 2: a tarefa de HOJE (o dia da loja, `hojeISO()` — V46) pelo título, nas lojas da pessoa, sem as excluídas. O título
   * igual (sem acento e maiúscula) vence o que só contém; mais de uma, a pessoa escolhe.
   */
  private async acharTarefa(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; unidadeId: string | null; estado: string; titulo: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select i.id::text as id, i.unidade_id::text as "unidadeId", i.estado, d.titulo
          from tarefa_instancia i
          join tarefa_def d on d.id = i.tarefa_def_id and d.tenant_id = i.tenant_id
         where i.tenant_id = ${tenantId}::uuid and i.deleted_at is null and i.data = ${hojeISO()}::date
           ${lojas ? sql`and (i.unidade_id is null or i.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and d.titulo ilike ${comoTexto(dito)}
         order by d.titulo
         limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.titulo), TEXTOS_DAS_ACOES.tarefaNaoAchada, TEXTOS_DAS_ACOES.tarefasDemais, (a) => ({
      id: a.id,
      unidadeId: a.unidadeId ?? null,
      estado: String(a.estado),
      titulo: String(a.titulo),
    }));
  }

  /** Lote 3: a função pelo nome (a tela exige a função da tarefa), sem as excluídas. */
  private async acharFuncao(tenantId: string, dito: string): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select f.id::text as id, f.nome from funcao f
         where f.tenant_id = ${tenantId}::uuid and f.deleted_at is null and f.nome ilike ${comoTexto(dito)}
         order by f.nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.funcaoNaoAchada, TEXTOS_DAS_ACOES.funcoesDemais, (a) => ({ id: a.id, nome: String(a.nome) }));
  }

  /** Lote 3: o responsável pelo nome, entre os colaboradores ativos da loja (ou sem loja). */
  private async acharColaborador(tenantId: string, dito: string, unidadeId: string): Promise<{ id: string; nome: string } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select c.id::text as id, c.nome from colaborador c
         where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and c.status = 'ativo'
           and (c.unidade_id is null or c.unidade_id = ${unidadeId}::uuid) and c.nome ilike ${comoTexto(dito)}
         order by c.nome limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.responsavelNaoAchado, TEXTOS_DAS_ACOES.responsaveisDemais, (a) => ({ id: a.id, nome: String(a.nome) }));
  }

  /** Lote 2: o produto do cardápio pelo nome (ativo, sem os excluídos), da empresa ou das lojas da pessoa. */
  private async acharProduto(tenantId: string, dito: string, lojas: string[] | null): Promise<{ id: string; nome: string; noIfood: boolean; na99: boolean } | { erro: string }> {
    const achados = linhas(
      await this.db.execute(sql`
        select p.id::text as id, p.nome, coalesce(p.no_ifood, false) as "noIfood", coalesce(p.na_99, false) as "na99"
          from produto p
         where p.tenant_id = ${tenantId}::uuid and p.deleted_at is null and coalesce(p.ativo, true)
           ${lojas ? sql`and (p.unidade_id is null or p.unidade_id in (${sql.join(lojas.map((l) => sql`${l}::uuid`), sql`, `)}))` : sql``}
           and p.nome ilike ${comoTexto(dito)}
         order by p.nome
         limit 6`),
    );
    return escolherUm(achados, dito, (a) => String(a.nome), TEXTOS_DAS_ACOES.produtoNaoAchado, TEXTOS_DAS_ACOES.produtosDemais, (a) => ({
      id: a.id,
      nome: String(a.nome),
      noIfood: a.noIfood === true,
      na99: a.na99 === true,
    }));
  }

  /**
   * Grava a proposta de botão: uma por pessoa, ação e alvo (o "aviso" da linha é um id fixo pela chave — o índice único da 428
   * não deixa duas). Renova a que acabou (vencida, não autorizada, não deu ou feita: a mesma ação pode ser pedida de novo
   * depois); a autorizada e a executando não renovam (null).
   */
  private async gravar(e: EscopoDoMister, acao: AcaoDoMister, unidadeId: string | null, parametros: Record<string, unknown>, alvo: string): Promise<string | null> {
    const def = ACOES[acao];
    const avisoId = uuidDeChave('mister:acao:', e.tenantId, ':', e.colaboradorId, ':', acao, ':', alvo);
    await this.db.execute(sql`
      insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
      values (${e.tenantId}::uuid, ${unidadeId}::uuid, ${avisoId}::uuid, ${acao}, ${JSON.stringify(parametros)}::jsonb, ${def.nivel},
              clock_timestamp() + make_interval(mins => ${def.prazoMin}::int))
      on conflict (aviso_id, procedimento) do update
        set situacao = 'proposta', criada_em = clock_timestamp(), vence_em = excluded.vence_em, parametros = excluded.parametros,
            unidade_id = excluded.unidade_id, respondida_em = null, autorizada_por = null, telefone_final = null, executada_em = null,
            conferir_ate = null, concluida_em = null, resultado = null
        where mister_proposta.situacao in ('vencida', 'recusada', 'nao_deu', 'feita', 'proposta')`);
    const [p] = linhas(
      await this.db.execute(sql`
        select id::text as id from mister_proposta
         where aviso_id = ${avisoId}::uuid and procedimento = ${acao} and situacao = 'proposta' and vence_em > now()`),
    );
    return p?.id ?? null;
  }

  /**
   * M6l: a imagem pelo DMS Graph (a porta única do Regem, `GraphImagemService`, que nunca lança). A chave é a proposta: repetir
   * não paga de novo. Só é "feito" com a imagem ENTREGUE na conversa de quem pediu.
   */
  private async gerarImagem(
    p: { id: string; tenantId: string; autorizadaPor: string | null },
    a: { pedido: string; proporcao: ProporcaoDaImagem },
  ): Promise<{ feita: boolean; texto: string }> {
    if (!imagemLigada() || !this.imagens || !this.numero) return { feita: false, texto: 'a criação de imagem não está ligada. Nada foi gerado.' };
    const r = await this.imagens.criarImagem(p.tenantId, { descricao: a.pedido, proporcao: a.proporcao, formato: 'jpeg', chave: `mister:${p.id}` });
    if (!r.ok) return { feita: false, texto: r.mensagem.charAt(0).toLowerCase() + r.mensagem.slice(1) };
    const [v] = linhas(
      await this.db.execute(sql`
        select telefone from mister_vinculo
         where tenant_id = ${p.tenantId}::uuid and colaborador_id = ${p.autorizadaPor}::uuid and ligado_em is not null and telefone is not null`),
    );
    if (!v?.telefone) return { feita: false, texto: 'o seu WhatsApp não está mais ligado ao Mister. A imagem não foi enviada.' };
    try {
      await this.numero.enviarImagem(v.telefone, r.bytes, '', r.mimeType);
    } catch (err: any) {
      this.logger.warn(`a imagem da proposta ${p.id} não saiu pelo WhatsApp: ${String(err?.message ?? err).slice(0, 200)}`);
      return { feita: false, texto: 'a imagem foi gerada, mas não consegui mandar por aqui. Peça de novo.' };
    }
    const franquia = r.franquia ? ` São ${r.franquia.usados} de ${r.franquia.total} imagens neste mês.` : '';
    return { feita: true, texto: `A imagem está logo acima.${franquia} Para mudar, me diga o que trocar.` };
  }

  // ───────────────────────────── executar ─────────────────────────────

  /**
   * Executa a ação autorizada pelo MESMO serviço da tela, com a permissão conferida de novo (o perfil pode ter mudado desde a
   * pergunta) e confere o efeito pelo estado que ficou. Devolve o desfecho; quem grava "feita"/"não deu" e avisa a pessoa é
   * o serviço das propostas.
   */
  async executar(p: { id: string; tenantId: string; unidadeId: string | null; procedimento: string; parametros: any; autorizadaPor: string | null }): Promise<{ feita: boolean; texto: string }> {
    if (!ehAcaoDoMister(p.procedimento)) return { feita: false, texto: 'essa ação não existe mais. Nada foi feito.' };
    const quem = p.autorizadaPor;
    if (!quem || quem !== String(p.parametros?.colaboradorId ?? '')) return { feita: false, texto: 'a ação só vale com o "Autorizar" de quem pediu. Nada foi feito.' };
    const e = await this.ferramentas.escopoDaTela(p.tenantId, quem);
    const def = ACOES[p.procedimento];
    if (!e || (e.nivel !== 'presidente' && !podeAcessar(e.permissoes, def.permissao))) {
      const a = def.permissao === 'meu_dia' ? 'às Tarefas' : def.permissao === 'loja' ? 'ao cadastro dos produtos' : 'ao Delivery';
      return { feita: false, texto: `o seu perfil não dá mais acesso ${a}. Nada foi feito.` };
    }
    const parametros = p.parametros as ParametrosDaAcao & { pedidoId?: string; pedido?: string; instanciaId?: string; titulo?: string; produtoId?: string; nome?: string };
    const user: AuthUser = { tenantId: p.tenantId, colaboradorId: quem, categoria: e.nivel, unidadeId: e.nivel === 'presidente' ? null : (p.unidadeId ?? null), nome: e.nome ?? null } as AuthUser;
    const motivo = (err: any) => String(err?.response?.message ?? err?.message ?? 'o serviço recusou').slice(0, 240);
    try {
      if (parametros.acao === 'criar_imagem') return await this.gerarImagem(p, parametros);
      if (parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal') {
        if (!this.pausa) return { feita: false, texto: 'a pausa dos canais não está disponível agora. Nada foi feito.' };
        if (parametros.acao === 'pausar_canal') {
          await this.pausa.pausar(user, p.unidadeId, {
            canais: parametros.canais,
            motivo: parametros.motivo,
            motivoTexto: parametros.motivoTexto,
            tempo: parametros.minutos !== null ? { minutos: parametros.minutos } : { ate: parametros.ate },
            tempo99: parametros.fimDoDia ? { fimDoDia: true } : { minutos: parametros.minutos },
          } as any);
        } else {
          for (const canal of parametros.canais) await this.pausa.reabrir(user, p.unidadeId, canal);
        }
        return await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal');
      }
      if (parametros.acao === 'concluir_tarefa') {
        // Lote 2: o MESMO `concluir` da tela (a regra do motivo e da foto é dele) e a MESMA auditoria do controller.
        if (!this.tarefas) return { feita: false, texto: 'as tarefas não estão disponíveis agora. Nada foi feito.' };
        const id = String(parametros.instanciaId ?? '');
        await this.tarefas.concluir(p.tenantId, id, { estado: parametros.estado, motivo: parametros.justificativa ?? undefined } as any, quem);
        await this.auditoria
          ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'checklist', acao: 'concluiu_tarefa', entidadeTipo: 'tarefa_instancia', entidadeId: id, detalhe: { estado: parametros.estado }, origem: 'whatsapp' } as any)
          .catch(() => undefined);
        return await this.conferirTarefa(p.tenantId, id, parametros.estado, String(parametros.titulo ?? parametros.tarefa));
      }
      if (parametros.acao === 'criar_tarefa') {
        // Lote 3: as DUAS etapas da tela ("Nova tarefa"): a definição (`TarefaDefService.create`, com quem criou) e a tarefa
        // de hoje (`TarefaInstanciaService.instanciar`, com o responsável, se dito — senão o escalado ou em aberto).
        if (!this.defs || !this.tarefas) return { feita: false, texto: 'as tarefas não estão disponíveis agora. Nada foi feito.' };
        const x = parametros as any;
        const def: any = await this.defs.create(
          p.tenantId,
          { unidadeId: p.unidadeId, titulo: x.titulo, funcaoId: x.funcaoId, ...(x.horario ? { horario: x.horario } : {}), origem: 'avulsa' } as any,
          { id: quem, nivel: e.nivel },
        );
        await this.tarefas.instanciar(p.tenantId, { tarefaDefId: def.id, data: hojeISO(), ...(x.responsavelId ? { colaboradorResolvidoId: x.responsavelId } : {}) } as any);
        return await this.conferirTarefaCriada(p.tenantId, String(def.id), String(x.titulo));
      }
      if (parametros.acao === 'pausar_produto' || parametros.acao === 'reativar_produto') {
        // Lote 2: a MESMA pausa por canal da tela (`ProdutoService.pausaDoCanal`, que audita), um canal por vez.
        if (!this.produtos) return { feita: false, texto: 'o cadastro dos produtos não está disponível agora. Nada foi feito.' };
        const pausado = parametros.acao === 'pausar_produto';
        const canais = (parametros.canais ?? ['regem']) as CanalDoProduto[];
        for (const canal of canais) await this.produtos.pausaDoCanal(p.tenantId, String(parametros.produtoId ?? ''), canal, pausado, { id: quem, perfil: e.nivel });
        return await this.conferirProduto(p.tenantId, String(parametros.produtoId ?? ''), canais, pausado, String(parametros.nome ?? parametros.produto));
      }
      if (!this.delivery) return { feita: false, texto: 'o painel do Delivery não está disponível agora. Nada foi feito.' };
      const pedidoId = String(parametros.pedidoId ?? '');
      const pedido = String(parametros.pedido ?? 'do Mister');
      if (parametros.acao === 'aceitar_pedido') await this.delivery.aceitar(p.tenantId, quem, pedidoId);
      else if (parametros.acao === 'pedido_pronto') await this.delivery.avancar(p.tenantId, pedidoId, { de: 'confirmado' });
      else await this.delivery.despachar(p.tenantId, pedidoId);
      return await this.conferirPedido(p.tenantId, pedidoId, parametros.acao, pedido);
    } catch (err: any) {
      // A recusa do serviço (outra pessoa já mexeu, o canal não está disponível) vem antes de mudar o que ele recusa. Se o
      // efeito apareceu mesmo assim, a conferência diz o que foi FEITO.
      const depois =
        parametros.acao === 'pausar_canal' || parametros.acao === 'reabrir_canal'
          ? await this.conferirCanais(p.tenantId, p.unidadeId, parametros.canais, parametros.acao === 'pausar_canal')
          : parametros.acao === 'criar_tarefa'
            ? { feita: false, texto: '' } // a recusa da criação vem antes de gravar: o motivo dela é o desfecho
            : parametros.acao === 'concluir_tarefa'
            ? await this.conferirTarefa(p.tenantId, String(parametros.instanciaId ?? ''), parametros.estado, String(parametros.titulo ?? parametros.tarefa))
            : parametros.acao === 'pausar_produto' || parametros.acao === 'reativar_produto'
              ? await this.conferirProduto(p.tenantId, String(parametros.produtoId ?? ''), (parametros.canais ?? ['regem']) as CanalDoProduto[], parametros.acao === 'pausar_produto', String(parametros.nome ?? parametros.produto))
              : await this.conferirPedido(p.tenantId, String(parametros.pedidoId ?? ''), parametros.acao as AcaoDePedido, String(parametros.pedido ?? ''));
      if (depois.feita) return depois;
      return { feita: false, texto: TEXTOS_DAS_ACOES.recusado(motivo(err)) };
    } finally {
      await this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao: 'mister_acao', entidadeTipo: 'mister_proposta', entidadeId: p.id, origem: 'whatsapp', detalhe: { acao: p.procedimento } } as any)
        .catch(() => undefined);
    }
  }

  /** Os canais ficaram como a ação pediu? (a pausa que vale agora, da loja ou da empresa toda). */
  private async conferirCanais(tenantId: string, unidadeId: string | null, canais: CanalDaPausa[], pausados: boolean): Promise<{ feita: boolean; texto: string }> {
    const estado: { canal: CanalDaPausa; ate: Date | null }[] = [];
    for (const c of canais) {
      const v: any = await pausaVigenteDoCanal(this.db, tenantId, unidadeId, c);
      estado.push({ canal: c, ate: v?.ate ? new Date(v.ate) : null });
    }
    const certos = estado.filter((x) => (pausados ? !!x.ate : !x.ate));
    if (certos.length !== canais.length) {
      const faltam = estado.filter((x) => !certos.includes(x)).map((x) => x.canal);
      return { feita: false, texto: `${nomesDosCanais(faltam)} não ficou(aram) ${pausados ? 'pausado(s)' : 'aberto(s)'}. Confira no painel do Delivery.` };
    }
    if (!pausados) return { feita: true, texto: TEXTOS_DAS_ACOES.reaberto(nomesDosCanais(canais)) };
    const voltas = estado.map((x) => `${nomesDosCanais([x.canal])} até as ${horaNoFuso(x.ate!)}`).join('; ');
    return { feita: true, texto: `${TEXTOS_DAS_ACOES.pausado(nomesDosCanais(canais))} (${voltas}).` };
  }

  /** Lote 3: a tarefa nova está na lista de hoje? */
  private async conferirTarefaCriada(tenantId: string, defId: string, titulo: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(
      await this.db.execute(sql`
        select 1 as ok from tarefa_instancia
         where tenant_id = ${tenantId}::uuid and tarefa_def_id = ${defId}::uuid and data = ${hojeISO()}::date and deleted_at is null`),
    );
    return r ? { feita: true, texto: TEXTOS_DAS_ACOES.tarefaCriada(titulo) } : { feita: false, texto: TEXTOS_DAS_ACOES.tarefaNaoCriada(titulo) };
  }

  /** Lote 2: a tarefa ficou na situação pedida? */
  private async conferirTarefa(tenantId: string, id: string, estado: string, titulo: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(await this.db.execute(sql`select estado from tarefa_instancia where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!r) return { feita: false, texto: 'a tarefa não foi encontrada. Nada foi feito.' };
    if (String(r.estado) === estado) return { feita: true, texto: TEXTOS_DAS_ACOES.tarefaFeita(titulo, nomeDoEstadoDaTarefa(estado)) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.tarefaNaoFicou(titulo, nomeDoEstadoDaTarefa(String(r.estado))) };
  }

  /** Lote 2: o produto ficou pausado (ou no ar) em CADA canal pedido? */
  private async conferirProduto(tenantId: string, id: string, canais: CanalDoProduto[], pausado: boolean, nome: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(
      await this.db.execute(sql`
        select coalesce(disponivel_balcao, true) as "disponivelBalcao", coalesce(disponivel_cardapio, true) as "disponivelCardapio",
               coalesce(canais_pausados, '[]'::jsonb) as "canaisPausados"
          from produto where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`),
    );
    if (!r) return { feita: false, texto: 'o produto não foi encontrado. Nada foi feito.' };
    const certos = produtoFicou({ disponivelBalcao: r.disponivelBalcao === true, disponivelCardapio: r.disponivelCardapio === true, canaisPausados: Array.isArray(r.canaisPausados) ? r.canaisPausados : [] }, canais, pausado);
    if (certos.length === canais.length) return { feita: true, texto: TEXTOS_DAS_ACOES.produtoFeito(nome, pausado, ondeOProduto(canais)) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.produtoNaoFicou(nome, ondeOProduto(canais.filter((c) => !certos.includes(c)))) };
  }

  /** O pedido andou para a situação de depois da ação? */
  private async conferirPedido(tenantId: string, pedidoId: string, acao: AcaoDePedido, pedido: string): Promise<{ feita: boolean; texto: string }> {
    const [r] = linhas(await this.db.execute(sql`select status from pedido_externo where id = ${pedidoId}::uuid and tenant_id = ${tenantId}::uuid`));
    if (!r) return { feita: false, texto: 'o pedido não foi encontrado. Nada foi feito.' };
    if (pedidoAndou(acao, String(r.status))) return { feita: true, texto: TEXTOS_DAS_ACOES.pedidoFeito(acao, pedido) };
    return { feita: false, texto: TEXTOS_DAS_ACOES.naoAndou(pedido, NOME_DA_SITUACAO[String(r.status)] ?? String(r.status)) };
  }
}
