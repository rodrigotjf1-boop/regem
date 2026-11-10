import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloService } from '../modulo/modulo.service';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import { sqlUnidade } from '../../common/filtro-unidade';
import {
  FichaLida,
  PaginaDeVagas,
  VERSAO_COMUNICACAO,
  VERSAO_GUARDA,
  gerarProtocolo,
  lerFicha,
  lerOrigem,
  lerPagina,
  lerSituacao,
  paginaDaLinha,
  slug,
  termoDaComunicacao,
  termoDaGuarda,
} from './vagas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VAGAS E CANDIDATOS (F1, mig 389). Só NUVEM: a página pública e as fichas moram lá (o módulo nem sobe no servidor da
// loja). Toda consulta filtra a empresa à mão — a rota pública não tem empresa no login (a RLS não ajuda aqui).

const linhas = (r: any): any[] => r?.rows ?? r ?? [];
/** Lista de texto para coluna `text[]` (V31/ERR-104: array JS no `sql` vira lista de parâmetros, não array). */
const arrTexto = (lista: string[]): SQL =>
  lista.length ? sql`array[${sql.join(lista.map((x) => sql`${x}`), sql`, `)}]::text[]` : sql`'{}'::text[]`;

export const MODULO_VAGAS = 'vagas';

// As marcas de origem que a loja ganha ao criar a página (a tela deixa criar outras e apagar estas).
const QR_INICIAIS: { codigo: string; nome: string }[] = [
  { codigo: 'balcao', nome: 'Balcão' },
  { codigo: 'salao', nome: 'Salão e mesas' },
  { codigo: 'fachada', nome: 'Fachada / vitrine' },
  { codigo: 'instagram', nome: 'Instagram (bio e posts)' },
];

@Injectable()
export class VagasService {
  private readonly log = new Logger('Vagas');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly modulos: ModuloService,
  ) {}

  // ── a loja como o candidato vê (a mesma do cardápio online: Configurações › Loja) ──────────────────────────────
  private async lojaPublica(tenantId: string, unidadeId: string) {
    const r: any = await this.db.execute(sql`
      select c.unidade_id is null as "daEmpresa", c.nome_publico as "nomePublico", c.logo_ref as "logoRef",
             c.logo_emoji as "logoEmoji", c.tema_config->>'corPrimaria' as "corPrimaria"
        from cardapio_config c
       where c.tenant_id = ${tenantId} and (c.unidade_id is null or c.unidade_id = ${unidadeId}::uuid)`);
    const ls = linhas(r) as any[];
    const daLoja = ls.find((l) => !l.daEmpresa);
    const daEmpresa = ls.find((l) => l.daEmpresa);
    const campo = (k: string) => String(daLoja?.[k] ?? '').trim() || String(daEmpresa?.[k] ?? '').trim() || null;
    let nome = campo('nomePublico');
    if (!nome) {
      const n: any = await this.db.execute(sql`
        select (select u.nome from unidade u where u.id = ${unidadeId}::uuid and u.tenant_id = ${tenantId}) as unidade,
               (select e.nome from empresa e where e.id = ${tenantId}) as empresa`);
      const l = linhas(n)[0] ?? {};
      nome = String(l.unidade ?? '').trim() || String(l.empresa ?? '').trim() || 'a loja';
    }
    return { nome, logoRef: campo('logoRef'), logoEmoji: campo('logoEmoji'), corPrimaria: campo('corPrimaria') };
  }

  /** A página pelo código público — só ligada e com o módulo ligado na loja (senão, "não encontrada", sem dizer por quê). */
  private async paginaPorCodigo(codigo: string) {
    const cod = String(codigo ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(cod)) throw new NotFoundException('Página de vagas não encontrada.');
    const [l] = linhas(await this.db.execute(sql`select * from vaga_pagina where codigo = ${cod}`));
    if (!l || l.ligada !== true) throw new NotFoundException('Página de vagas não encontrada.');
    if (!(await this.modulos.ativo(l.tenant_id, l.unidade_id, MODULO_VAGAS)))
      throw new NotFoundException('Página de vagas não encontrada.');
    return { linha: l, pagina: paginaDaLinha(l) };
  }

  /** O que a página pública mostra: só o que a loja escolheu publicar (nada de documento, contato interno ou fichas). */
  async paginaPublica(codigo: string) {
    const { linha, pagina } = await this.paginaPorCodigo(codigo);
    const loja = await this.lojaPublica(linha.tenant_id, linha.unidade_id);
    return {
      loja: { nome: loja.nome, logoRef: loja.logoRef, logoEmoji: loja.logoEmoji },
      cores: { principal: pagina.corPrincipal ?? loja.corPrimaria ?? null, destaque: pagina.corDestaque },
      pagina: {
        titulo: pagina.titulo,
        frase: pagina.frase,
        funcoes: pagina.funcoes.filter((f) => f.aberta).map(({ codigo: c, nome, salario, lideranca }) => ({ codigo: c, nome, salario, lideranca })),
        beneficios: pagina.beneficios,
        vagaFixa: pagina.vagaFixa,
        horista: pagina.horista,
        horarios: pagina.horarios,
        idadeMinima: pagina.idadeMinima,
        guardaMeses: pagina.guardaMeses,
        perguntas: pagina.perguntas,
      },
      termos: {
        guarda: termoDaGuarda(loja.nome, pagina.guardaMeses),
        comunicacao: termoDaComunicacao(loja.nome),
      },
    };
  }

  /**
   * Recebe a ficha da página pública. Única por loja e telefone: o reenvio com o mesmo WhatsApp ATUALIZA a ficha (e as
   * experiências e os cursos), sobe para o topo da lista e entra no histórico. Responde só o protocolo — nunca a ficha.
   */
  async receberFicha(codigo: string, dto: any): Promise<{ protocolo: string; reenvio: boolean }> {
    // Campo-isca: gente não vê, robô preenche. Responde como se tivesse recebido e não grava nada.
    if (dto && typeof dto === 'object' && String(dto.site ?? '').trim()) {
      this.log.warn(`Ficha recusada pelo campo-isca (página ${String(codigo).slice(0, 40)}).`);
      return { protocolo: gerarProtocolo(), reenvio: false };
    }
    const { linha, pagina } = await this.paginaPorCodigo(codigo);
    const hoje = hojeISO();
    const f = lerFicha(dto, pagina, hoje);
    const origem = lerOrigem(dto?.origem);
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      try {
        return await this.gravarFicha(linha.tenant_id, linha.unidade_id, pagina, f, origem, hoje);
      } catch (e: any) {
        // Protocolo repetido na empresa (raríssimo): sorteia outro. Qualquer outra falha sobe.
        if (e?.code === '23505' && String(e?.constraint ?? '').includes('protocolo')) continue;
        throw e;
      }
    }
    throw new ConflictException('Não conseguimos registrar agora. Tente de novo em instantes.');
  }

  private async gravarFicha(tenantId: string, unidadeId: string, pagina: PaginaDeVagas, f: FichaLida, origem: string | null, hoje: string) {
    return this.db.transaction(async (tx: any) => {
      // O termo de mensagens ANTES deste envio: o histórico diz "autorizou" ou "desmarcou" só quando a escolha muda.
      const [antes] = linhas(await tx.execute(sql`
        select comunicacao_aceita_em is not null and comunicacao_cancelada_em is null as ativa
          from candidato where tenant_id = ${tenantId} and unidade_id = ${unidadeId} and telefone = ${f.telefone}
           for update`));
      const r: any = await tx.execute(sql`
        insert into candidato (
          tenant_id, unidade_id, protocolo, nome, nascimento, sexo, telefone, email,
          cep, rua, numero, complemento, bairro, cidade,
          meios_transporte, conducoes, uber_motivo, uber_obs, valor_ida, valor_volta,
          funcoes, setores, tipo_vaga, escala, dias, obs_horarios,
          experiencia, liderou, estuda, grau_estudo, escola, turno_estudo, cursos_situacao,
          trabalhando, comeca, respostas, origem,
          consentimento_em, consentimento_versao,
          comunicacao_aceita_em, comunicacao_versao,
          expurgo_em
        ) values (
          ${tenantId}, ${unidadeId}, ${gerarProtocolo()}, ${f.nome}, ${f.nascimento}::date, ${f.sexo}, ${f.telefone}, ${f.email},
          ${f.cep}, ${f.rua}, ${f.numero}, ${f.complemento}, ${f.bairro}, ${f.cidade},
          ${arrTexto(f.meios)}, ${f.conducoes}, ${f.uberMotivo}, ${f.uberObs}, ${f.valorIda}, ${f.valorVolta},
          ${arrTexto(f.funcoes)}, ${arrTexto(f.setores)}, ${f.tipoVaga}, ${f.escala}, ${arrTexto(f.dias)}, ${f.obsHorarios},
          ${f.experiencia}, ${f.liderou}, ${f.estuda}, ${f.grauEstudo}, ${f.escola}, ${f.turnoEstudo}, ${f.cursosSituacao},
          ${f.trabalhando}, ${f.comeca}, ${JSON.stringify({ ...f.respostas, ...(f.origemDeclarada ? { origem_declarada: f.origemDeclarada } : {}) })}::jsonb, ${origem},
          clock_timestamp(), ${VERSAO_GUARDA},
          ${f.comunicacao ? sql`clock_timestamp()` : sql`null`}, ${f.comunicacao ? VERSAO_COMUNICACAO : null},
          (${hoje}::date + make_interval(months => ${pagina.guardaMeses}))::date
        )
        on conflict (tenant_id, unidade_id, telefone) do update set
          nome = excluded.nome, nascimento = excluded.nascimento, sexo = excluded.sexo, email = excluded.email,
          cep = excluded.cep, rua = excluded.rua, numero = excluded.numero, complemento = excluded.complemento,
          bairro = excluded.bairro, cidade = excluded.cidade,
          meios_transporte = excluded.meios_transporte, conducoes = excluded.conducoes, uber_motivo = excluded.uber_motivo,
          uber_obs = excluded.uber_obs, valor_ida = excluded.valor_ida, valor_volta = excluded.valor_volta,
          funcoes = excluded.funcoes, setores = excluded.setores, tipo_vaga = excluded.tipo_vaga, escala = excluded.escala,
          dias = excluded.dias, obs_horarios = excluded.obs_horarios,
          experiencia = excluded.experiencia, liderou = excluded.liderou, estuda = excluded.estuda,
          grau_estudo = excluded.grau_estudo, escola = excluded.escola, turno_estudo = excluded.turno_estudo,
          cursos_situacao = excluded.cursos_situacao, trabalhando = excluded.trabalhando, comeca = excluded.comeca,
          respostas = excluded.respostas, origem = coalesce(excluded.origem, candidato.origem),
          consentimento_em = excluded.consentimento_em, consentimento_versao = excluded.consentimento_versao,
          -- A última escolha vale: marcou de novo → (re)autoriza; desmarcou quem tinha autorizado → cancela.
          -- Seguia autorizado: fica a data da 1ª autorização; voltou a autorizar depois de cancelar: a data nova.
          comunicacao_aceita_em = case when excluded.comunicacao_aceita_em is null then candidato.comunicacao_aceita_em
                                       when candidato.comunicacao_aceita_em is not null and candidato.comunicacao_cancelada_em is null
                                       then candidato.comunicacao_aceita_em
                                       else excluded.comunicacao_aceita_em end,
          comunicacao_versao = coalesce(excluded.comunicacao_versao, candidato.comunicacao_versao),
          comunicacao_cancelada_em = case when excluded.comunicacao_aceita_em is not null then null
                                          when candidato.comunicacao_aceita_em is not null then coalesce(candidato.comunicacao_cancelada_em, clock_timestamp())
                                          else candidato.comunicacao_cancelada_em end,
          expurgo_em = excluded.expurgo_em, recebido_em = clock_timestamp(), atualizado_em = clock_timestamp()
        returning id, protocolo, (xmax = 0) as novo`);
      const c = linhas(r)[0];
      await tx.execute(sql`delete from candidato_experiencia where candidato_id = ${c.id}`);
      await tx.execute(sql`delete from candidato_curso where candidato_id = ${c.id}`);
      let ordem = 0;
      for (const x of f.experiencias)
        await tx.execute(sql`
          insert into candidato_experiencia (candidato_id, tenant_id, tipo, ordem, empresa, funcao, cargo, equipe, tempo, vinculo, atual, descricao)
          values (${c.id}, ${tenantId}, ${x.tipo}, ${ordem++}, ${x.empresa}, ${x.funcao}, ${x.cargo}, ${x.equipe}, ${x.tempo}, ${x.vinculo}, ${x.atual}, ${x.descricao})`);
      ordem = 0;
      for (const x of f.cursos)
        await tx.execute(sql`
          insert into candidato_curso (candidato_id, tenant_id, ordem, nome, onde, situacao)
          values (${c.id}, ${tenantId}, ${ordem++}, ${x.nome}, ${x.onde}, ${x.situacao})`);
      const deOnde = origem ? ` (origem: ${origem})` : '';
      await tx.execute(sql`
        insert into candidato_evento (candidato_id, tenant_id, tipo, texto)
        values (${c.id}, ${tenantId}, ${c.novo ? 'recebida' : 'reenviada'},
                ${c.novo ? `Ficha recebida pela página de vagas${deOnde}` : `Ficha reenviada pelo candidato${deOnde} — as respostas foram atualizadas`})`);
      const estavaAtiva = antes?.ativa === true;
      if (f.comunicacao !== estavaAtiva)
        await tx.execute(sql`
          insert into candidato_evento (candidato_id, tenant_id, tipo, texto)
          values (${c.id}, ${tenantId}, 'comunicacao',
                  ${f.comunicacao ? 'Autorizou receber mensagens e e-mails' : 'Cancelou o recebimento de mensagens e e-mails'})`);
      return { protocolo: c.protocolo as string, reenvio: !c.novo };
    });
  }

  // ── a lista e a ficha (tela da loja) ────────────────────────────────────────────────────────────────────────────
  /** As fichas da loja em uso (presidente na rede: todas), da mais nova à mais velha. Sem `limit`: o expurgo limita a base. */
  async lista(tenantId: string, unidade: string | null) {
    const r: any = await this.db.execute(sql`
      select c.id, c.protocolo, c.situacao, c.nome, c.nascimento::text as nascimento,
             date_part('year', age(${hojeISO()}::date, c.nascimento))::int as idade,
             c.telefone, c.bairro, c.cidade, c.funcoes, c.setores, c.tipo_vaga as "tipoVaga", c.escala, c.dias,
             c.meios_transporte as meios, c.conducoes, c.valor_ida::float8 as "valorIda", c.valor_volta::float8 as "valorVolta",
             c.experiencia, c.estuda, c.turno_estudo as "turnoEstudo", c.trabalhando, c.comeca, c.origem,
             (select q.nome from vaga_qr q where q.tenant_id = c.tenant_id and q.unidade_id = c.unidade_id and q.codigo = c.origem) as "origemNome",
             c.entrevista_em as "entrevistaEm", c.recebido_em as "recebidoEm", c.unidade_id as "unidadeId", u.nome as loja,
             c.comunicacao_aceita_em is not null and c.comunicacao_cancelada_em is null as comunicacao,
             (select count(*)::int from candidato_experiencia x where x.candidato_id = c.id and x.tipo = 'trabalho') as experiencias,
             exists (select 1 from candidato_experiencia x where x.candidato_id = c.id and x.vinculo = 'carteira') as "temCarteira",
             exists (select 1 from candidato_experiencia x where x.candidato_id = c.id and x.tipo = 'lideranca') as "jaLiderou"
        from candidato c
        join unidade u on u.id = c.unidade_id
       where c.tenant_id = ${tenantId} ${sqlUnidade('c.unidade_id', unidade)}
       order by c.recebido_em desc, c.id desc`);
    return linhas(r);
  }

  private async daLoja(tx: any, tenantId: string, unidade: string | null, id: string, travar = false) {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new NotFoundException('Ficha não encontrada.');
    const [c] = linhas(await (tx ?? this.db).execute(sql`
      select c.*, c.nascimento::text as nascimento_txt, c.expurgo_em::text as expurgo_txt,
             (select q.nome from vaga_qr q where q.tenant_id = c.tenant_id and q.unidade_id = c.unidade_id and q.codigo = c.origem) as origem_nome
        from candidato c where c.id = ${id}::uuid and c.tenant_id = ${tenantId} ${sqlUnidade('c.unidade_id', unidade)}
      ${travar ? sql`for update` : sql``}`));
    if (!c) throw new NotFoundException('Ficha não encontrada.');
    return c;
  }

  /** A ficha inteira (com experiências, cursos e histórico). */
  async ficha(tenantId: string, unidade: string | null, id: string) {
    const c = await this.daLoja(null, tenantId, unidade, id);
    const [exps, cursos, eventos] = await Promise.all([
      this.db.execute(sql`select tipo, empresa, funcao, cargo, equipe, tempo, vinculo, atual, descricao from candidato_experiencia where candidato_id = ${c.id} order by tipo, ordem`),
      this.db.execute(sql`select nome, onde, situacao from candidato_curso where candidato_id = ${c.id} order by ordem`),
      this.db.execute(sql`select tipo, de, para, texto, autor_nome as "autorNome", criado_em as "criadoEm" from candidato_evento where candidato_id = ${c.id} order by criado_em, id`),
    ]);
    return {
      id: c.id,
      protocolo: c.protocolo,
      situacao: c.situacao,
      nome: c.nome,
      nascimento: c.nascimento_txt,
      sexo: c.sexo,
      telefone: c.telefone,
      email: c.email,
      endereco: { cep: c.cep, rua: c.rua, numero: c.numero, complemento: c.complemento, bairro: c.bairro, cidade: c.cidade },
      meios: c.meios_transporte,
      conducoes: c.conducoes,
      uberMotivo: c.uber_motivo,
      uberObs: c.uber_obs,
      valorIda: c.valor_ida === null ? null : Number(c.valor_ida),
      valorVolta: c.valor_volta === null ? null : Number(c.valor_volta),
      funcoes: c.funcoes,
      setores: c.setores,
      tipoVaga: c.tipo_vaga,
      escala: c.escala,
      dias: c.dias,
      obsHorarios: c.obs_horarios,
      experiencia: c.experiencia,
      liderou: c.liderou,
      estuda: c.estuda,
      grauEstudo: c.grau_estudo,
      escola: c.escola,
      turnoEstudo: c.turno_estudo,
      cursosSituacao: c.cursos_situacao,
      trabalhando: c.trabalhando,
      comeca: c.comeca,
      respostas: c.respostas ?? {},
      origem: c.origem,
      origemNome: c.origem_nome,
      entrevistaEm: c.entrevista_em,
      comunicacao: { aceitaEm: c.comunicacao_aceita_em, canceladaEm: c.comunicacao_cancelada_em },
      recebidoEm: c.recebido_em,
      expurgoEm: c.expurgo_txt,
      experiencias: linhas(exps),
      cursos: linhas(cursos),
      historico: linhas(eventos),
    };
  }

  private async evento(tx: any, c: any, user: AuthUser, tipo: string, texto: string, de: string | null = null, para: string | null = null) {
    await tx.execute(sql`
      insert into candidato_evento (candidato_id, tenant_id, tipo, de, para, texto, autor_id, autor_nome)
      values (${c.id}, ${c.tenant_id}, ${tipo}, ${de}, ${para}, ${texto}, ${user.colaboradorId ?? null}, ${user.nome ?? null})`);
  }

  async mudarSituacao(user: AuthUser, unidade: string | null, id: string, dto: any) {
    const nova = lerSituacao(dto?.situacao);
    const antes = await this.db.transaction(async (tx: any) => {
      const c = await this.daLoja(tx, user.tenantId, unidade, id, true);
      if (c.situacao === nova) return null;
      await tx.execute(sql`update candidato set situacao = ${nova}, atualizado_em = clock_timestamp() where id = ${c.id}`);
      await this.evento(tx, c, user, 'situacao', 'Situação alterada', c.situacao, nova);
      return { c, de: c.situacao as string };
    });
    if (antes)
      await this.auditoria.registrar({
        tenantId: user.tenantId, unidadeId: antes.c.unidade_id, atorId: user.colaboradorId, atorPerfil: user.categoria,
        tipo: 'pessoas', acao: 'candidato.situacao', entidadeTipo: 'candidato', entidadeId: antes.c.id,
        detalhe: { de: antes.de, para: nova }, origem: 'web',
      });
    return { ok: true, situacao: nova };
  }

  async anotar(user: AuthUser, unidade: string | null, id: string, dto: any) {
    const texto = String(dto?.texto ?? '').trim().slice(0, 1000);
    if (!texto) throw new BadRequestException('Escreva a anotação.');
    await this.db.transaction(async (tx: any) => {
      const c = await this.daLoja(tx, user.tenantId, unidade, id, true);
      await this.evento(tx, c, user, 'anotacao', texto);
    });
    return { ok: true };
  }

  async marcarEntrevista(user: AuthUser, unidade: string | null, id: string, dto: any) {
    const quando = new Date(String(dto?.quando ?? ''));
    if (Number.isNaN(quando.getTime())) throw new BadRequestException('Escolha o dia e a hora da entrevista.');
    const r = await this.db.transaction(async (tx: any) => {
      const c = await this.daLoja(tx, user.tenantId, unidade, id, true);
      const muda = !['entrevista', 'aprovado', 'contratado'].includes(c.situacao);
      await tx.execute(sql`
        update candidato set entrevista_em = ${quando.toISOString()}::timestamptz,
               situacao = ${muda ? 'entrevista' : c.situacao}, atualizado_em = clock_timestamp()
         where id = ${c.id}`);
      if (muda) await this.evento(tx, c, user, 'situacao', 'Situação alterada', c.situacao, 'entrevista');
      await this.evento(tx, c, user, 'entrevista', 'Entrevista marcada', null, quando.toISOString());
      return c;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId, unidadeId: r.unidade_id, atorId: user.colaboradorId, atorPerfil: user.categoria,
      tipo: 'pessoas', acao: 'candidato.entrevista', entidadeTipo: 'candidato', entidadeId: r.id,
      detalhe: { quando: quando.toISOString() }, origem: 'web',
    });
    return { ok: true, entrevistaEm: quando.toISOString() };
  }

  /** "Apagar dados" (LGPD): a ficha e tudo dela some; a auditoria guarda só que uma ficha foi apagada, por quem e quando. */
  async apagar(user: AuthUser, unidade: string | null, id: string) {
    const c = await this.db.transaction(async (tx: any) => {
      const f = await this.daLoja(tx, user.tenantId, unidade, id, true);
      await tx.execute(sql`delete from candidato where id = ${f.id}`);
      return f;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId, unidadeId: c.unidade_id, atorId: user.colaboradorId, atorPerfil: user.categoria,
      tipo: 'lgpd', acao: 'candidato.apagar', entidadeTipo: 'candidato', entidadeId: c.id,
      detalhe: { motivo: 'pedido na tela' }, origem: 'web',
    });
    return { ok: true };
  }

  // ── a página de vagas (ajustes da loja) ─────────────────────────────────────────────────────────────────────────
  // A página de vagas e os QR codes são de UMA loja. A loja em uso vazia é "todas as lojas" (presidente) OU a empresa de
  // loja única (o UnidadeUnicaInterceptor zera o filtro — V86): com uma loja só, é ela; com várias, pede para escolher.
  // A loja informada é conferida na empresa (um id que não é dela devolve 404, nunca erro de chave no banco).
  private async lojaDosAjustes(tenantId: string, unidade: string | null): Promise<string> {
    if (unidade && !/^[0-9a-f-]{36}$/i.test(unidade)) throw new NotFoundException('Loja não encontrada.');
    const lojas = linhas(await this.db.execute(sql`
      select id from unidade
       where tenant_id = ${tenantId} and deleted_at is null ${unidade ? sql`and id = ${unidade}::uuid` : sql``}
       order by created_at limit 2`));
    if (unidade) {
      if (!lojas.length) throw new NotFoundException('Loja não encontrada.');
      return lojas[0].id;
    }
    if (lojas.length === 1) return lojas[0].id;
    if (!lojas.length) throw new BadRequestException({ message: 'Cadastre a loja antes de montar a página de vagas.', code: 'VAGAS_SEM_LOJA' });
    throw new BadRequestException({ message: 'Escolha a loja no seletor do topo para ajustar a página de vagas.', code: 'VAGAS_ESCOLHA_A_LOJA' });
  }

  async pagina(tenantId: string, unidade: string | null) {
    const u = await this.lojaDosAjustes(tenantId, unidade);
    const [l] = linhas(await this.db.execute(sql`select * from vaga_pagina where tenant_id = ${tenantId} and unidade_id = ${u}::uuid`));
    const loja = await this.lojaPublica(tenantId, u);
    return { codigo: l?.codigo ?? null, criada: !!l, pagina: paginaDaLinha(l), loja };
  }

  async salvarPagina(user: AuthUser, unidade: string | null, dto: any) {
    const u = await this.lojaDosAjustes(user.tenantId, unidade);
    const atual = await this.pagina(user.tenantId, u);
    const p = lerPagina(dto, atual.pagina);
    const base = slug(atual.loja.nome);
    let codigo = atual.codigo;
    for (let tentativa = 0; ; tentativa++) {
      const cod = codigo ?? (tentativa === 0 ? base : `${base.slice(0, 27)}-${gerarProtocolo().slice(0, 4).toLowerCase()}`);
      try {
        await this.db.transaction(async (tx: any) => {
          await tx.execute(sql`
            insert into vaga_pagina (tenant_id, unidade_id, codigo, ligada, titulo, frase, funcoes, beneficios, vaga_fixa, horista,
                                     horarios, idade_minima, guarda_meses, perguntas, cor_principal, cor_destaque)
            values (${user.tenantId}, ${u}, ${cod}, ${p.ligada}, ${p.titulo}, ${p.frase}, ${JSON.stringify(p.funcoes)}::jsonb,
                    ${JSON.stringify(p.beneficios)}::jsonb, ${p.vagaFixa}, ${p.horista}, ${JSON.stringify(p.horarios)}::jsonb,
                    ${p.idadeMinima}, ${p.guardaMeses}, ${JSON.stringify(p.perguntas)}::jsonb, ${p.corPrincipal}, ${p.corDestaque})
            on conflict (tenant_id, unidade_id) do update set
              ligada = excluded.ligada, titulo = excluded.titulo, frase = excluded.frase, funcoes = excluded.funcoes,
              beneficios = excluded.beneficios, vaga_fixa = excluded.vaga_fixa, horista = excluded.horista,
              horarios = excluded.horarios, idade_minima = excluded.idade_minima, guarda_meses = excluded.guarda_meses,
              perguntas = excluded.perguntas, cor_principal = excluded.cor_principal, cor_destaque = excluded.cor_destaque,
              atualizado_em = clock_timestamp()`);
          if (!atual.criada)
            for (const q of QR_INICIAIS)
              await tx.execute(sql`
                insert into vaga_qr (tenant_id, unidade_id, codigo, nome) values (${user.tenantId}, ${u}, ${q.codigo}, ${q.nome})
                on conflict (tenant_id, unidade_id, codigo) do nothing`);
        });
        codigo = cod;
        break;
      } catch (e: any) {
        // O endereço público já é de outra loja: tenta com um final sorteado (só na criação).
        if (e?.code === '23505' && String(e?.constraint ?? '') === 'uq_vaga_pagina_codigo' && !atual.codigo && tentativa < 5) continue;
        throw e;
      }
    }
    await this.auditoria.registrar({
      tenantId: user.tenantId, unidadeId: u, atorId: user.colaboradorId, atorPerfil: user.categoria,
      tipo: 'pessoas', acao: atual.criada ? 'vagas.pagina.alterada' : 'vagas.pagina.criada', entidadeTipo: 'vaga_pagina', entidadeId: null,
      detalhe: { codigo, ligada: p.ligada, ...(atual.criada && atual.pagina.ligada !== p.ligada ? { ligadaAntes: atual.pagina.ligada } : {}) },
      origem: 'web',
    });
    return this.pagina(user.tenantId, u);
  }

  // ── QR codes / marcas de origem ─────────────────────────────────────────────────────────────────────────────────
  async qrs(tenantId: string, unidade: string | null) {
    const u = await this.lojaDosAjustes(tenantId, unidade);
    const r: any = await this.db.execute(sql`
      select q.id, q.codigo, q.nome,
             (select count(*)::int from candidato c where c.tenant_id = q.tenant_id and c.unidade_id = q.unidade_id and c.origem = q.codigo) as fichas
        from vaga_qr q
       where q.tenant_id = ${tenantId} and q.unidade_id = ${u}::uuid
       order by q.criado_em, q.codigo`);
    return linhas(r);
  }

  async criarQr(user: AuthUser, unidade: string | null, dto: any) {
    const u = await this.lojaDosAjustes(user.tenantId, unidade);
    const nome = String(dto?.nome ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (nome.length < 2) throw new BadRequestException('Escreva o nome do lugar (ex.: Balcão).');
    const codigo = slug(nome).slice(0, 30).replace(/-+$/g, '');
    try {
      const [q] = linhas(await this.db.execute(sql`
        insert into vaga_qr (tenant_id, unidade_id, codigo, nome) values (${user.tenantId}, ${u}, ${codigo}, ${nome})
        returning id, codigo, nome`));
      return { ...q, fichas: 0 };
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException('Já existe um QR com esse nome nesta loja.');
      throw e;
    }
  }

  async apagarQr(user: AuthUser, unidade: string | null, id: string) {
    const u = await this.lojaDosAjustes(user.tenantId, unidade);
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new NotFoundException('QR não encontrado.');
    const r = linhas(await this.db.execute(sql`
      delete from vaga_qr where id = ${id}::uuid and tenant_id = ${user.tenantId} and unidade_id = ${u}::uuid returning id`));
    if (!r.length) throw new NotFoundException('QR não encontrado.');
    return { ok: true };
  }

  // ── expurgo diário (LGPD) ───────────────────────────────────────────────────────────────────────────────────────
  // 04:50 de Brasília. O módulo nem sobe no servidor da loja, e a rotina se guarda sozinha mesmo assim.
  @Cron('0 50 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async expurgoDiario(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      const r = await this.expurgar();
      if (r.apagadas) this.log.log(`Expurgo das fichas vencidas: ${r.apagadas} apagada(s).`);
    } catch (e: any) {
      this.log.error(`Expurgo das fichas falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
    }
  }

  /** Apaga as fichas NÃO contratadas com o prazo vencido, em lotes (várias réplicas: `skip locked`). Idempotente. */
  async expurgar(opts: { tenantIds?: string[] } = {}): Promise<{ apagadas: number }> {
    const hoje = hojeISO();
    const so = opts.tenantIds?.length ? sql`and tenant_id in (${sql.join(opts.tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    let apagadas = 0;
    const porEmpresa = new Map<string, number>();
    for (;;) {
      const r = linhas(await this.db.execute(sql`
        delete from candidato where id in (
          select id from candidato
           where expurgo_em < ${hoje}::date and situacao <> 'contratado' ${so}
           order by expurgo_em limit 500 for update skip locked)
        returning tenant_id`));
      if (!r.length) break;
      apagadas += r.length;
      for (const l of r) porEmpresa.set(l.tenant_id, (porEmpresa.get(l.tenant_id) ?? 0) + 1);
      if (r.length < 500) break;
    }
    for (const [tenantId, n] of porEmpresa)
      await this.auditoria.registrar({
        tenantId, atorTipo: 'sistema', tipo: 'lgpd', acao: 'candidato.expurgo', origem: 'sistema',
        entidadeTipo: 'candidato', entidadeId: null, detalhe: { apagadas: n, ate: hoje },
      });
    return { apagadas };
  }
}
