import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { DRIZZLE, DrizzleDB, resolverSsl } from '../../../db/drizzle.module';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { ehServidorLocal } from '../../../common/modo';
import { Food99Service, IntegFood99 } from './food99.service';
import {
  DESISTIR_99_DEPOIS_HORAS,
  Desfecho99,
  LIMITE_DESCRICAO_99,
  LIMITE_NOME_99,
  MudancaNoItem,
  RESERVA_99_MINUTOS,
  centavos,
  desfechoDoErrno,
  grupoParaAtualizar,
  gruposComOItem,
  itemParaAtualizar,
  recuoMinutos99,
} from './food99-catalogo.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Uma linha da fila `food99_envio` já reservada para este processo. */
type Envio99 = {
  id: string;
  tenant_id: string;
  integracao_id: string;
  tipo: 'preco_item' | 'status_item' | 'cadastro_item';
  ref_id: string;
  versao: number;
  tentativas: number;
  /** cadastro_item: os campos que mudaram ({nome, descricao}). */
  dados: Record<string, unknown> | null;
  /** O que mudou: o produto ou a opção do catálogo (o complemento — mig 404). */
  alvo: 'produto' | 'opcao';
};

/** O que mandar à 99 (ou por que não mandar). `pausadoNoRegem` = o Regem quer o item pausado lá. */
type Chamada99 =
  | { dispensar: string }
  | { tipo: 'item'; codigo: string; mudar: MudancaNoItem; pausadoNoRegem: boolean }
  | { tipo: 'situacao'; codigo: string; status: 1 | 2 }
  // O preço do complemento: em cada grupo da 99 que o tem (centavos).
  | { tipo: 'grupos'; codigo: string; preco: number };

/** O cardápio da loja na 99, lido UMA vez por volta (por integração) e mantido em dia com o que a volta já mandou. */
type Cardapio99 = { errno: number; errmsg: string | null; itens: Map<string, any>; grupos: any[] };

export type ResumoDo99 = { enviados: number; dispensados: number; adiados: number; desistidos: number };

const LOTE = 50;

/**
 * O ENVIO À 99 item a item (R3 da Gestão do catálogo, fase F2; mig 402). A fila é gravada pelos gatilhos do banco na
 * MESMA transação da mudança (a tela da nuvem e o sincronismo da loja entram iguais); aqui ela sai:
 *  • na hora, acordada pelo `pg_notify('food99_envio')` (um LISTEN por processo, como o do Orzuni);
 *  • e pela rotina de 15 s, que pega o que o aviso não acordou (sem LISTEN: pooler, queda) e as novas tentativas.
 * Não é consulta à 99 de tempos em tempos: só a fila local, por índice, e só o que pode sair (V84). O cardápio da 99 é
 * lido só quando há preço, nome ou descrição a mandar — o `updateItem` exige o item inteiro (`itemParaAtualizar`).
 *
 * Cada envio lê o valor NA HORA (edições seguidas viram um envio, com o mais novo) e passa pela régua de "acesso vale"
 * (V75): empresa viva, direito `precos_na_99` ligado, integração da 99 ativa e a loja dela viva — senão é DISPENSADO com
 * o motivo, sem chamar a 99. Só NUVEM (o servidor da loja não tem a tabela; a `@Cron` também sobe lá e volta na primeira
 * linha). Uma empresa com problema não segura as outras (V25): só a 99 fora para DUAS empresas encerra a volta.
 */
@Injectable()
export class Food99CatalogoEnvioService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Food99Catalogo');
  private ouvinte: Client | null = null;
  private parado = false;
  private falhas = 0;
  private rodando = false;
  private deNovo = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly food99: Food99Service,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || ehServidorLocal()) return;
    void this.ouvir();
  }

  async onModuleDestroy() {
    this.parado = true;
    await this.ouvinte?.end().catch(() => {});
  }

  // A rotina: pega o que o aviso não acordou e as tentativas adiadas. Também sobe no servidor da loja: volta já.
  @Cron('*/15 * * * * *')
  rotina() {
    if (ehServidorLocal() || process.env.NODE_ENV === 'test') return;
    void this.acordar();
  }

  /** Despacha a fila agora. Nunca rejeita (V3). Se já está rodando, roda de novo ao terminar. */
  async acordar(): Promise<void> {
    if (this.rodando) {
      this.deNovo = true;
      return;
    }
    this.rodando = true;
    try {
      for (let voltas = 0; voltas < 40 && !this.parado; voltas++) {
        this.deNovo = false;
        const r = await this.processar();
        const vistos = r.enviados + r.dispensados + r.adiados + r.desistidos;
        if (vistos < LOTE && !this.deNovo) break;
      }
    } catch (e: any) {
      this.log.error(`despacho da 99 falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma volta do despacho. `tenantIds` restringe às empresas dadas (testes: o CI divide o banco — V32).
   * Devolve quantos foram enviados, dispensados, adiados e desistidos.
   */
  async processar(o: { tenantIds?: string[]; limite?: number } = {}): Promise<ResumoDo99> {
    const resumo: ResumoDo99 = { enviados: 0, dispensados: 0, adiados: 0, desistidos: 0 };
    if (ehServidorLocal()) return resumo;
    const lote = await this.reservar(o.tenantIds, o.limite ?? LOTE);
    if (!lote.length) return resumo;
    const foraPor = new Set<string>(); // empresas cuja chamada não teve resposta da 99
    const cardapios = new Map<string, Promise<Cardapio99>>(); // integração → o cardápio lido nesta volta
    for (let i = 0; i < lote.length; i++) {
      const envio = lote[i];
      if (foraPor.size >= 2) {
        // A 99 está fora para duas empresas: devolve o resto à fila, sem gastar tentativa.
        await this.devolver(lote.slice(i));
        resumo.adiados += lote.length - i;
        break;
      }
      try {
        const r = await this.enviarUm(envio, cardapios);
        resumo[r]++;
        if (r === 'adiados' && this.ultimoFora) foraPor.add(envio.tenant_id);
      } catch (e: any) {
        // Erro do próprio Regem nesta linha (banco): registra e segue com as outras empresas.
        this.log.error(`envio à 99 ${envio.id} (${envio.tipo}): ${e?.message ?? e}`);
        await this.adiar(envio, recuoMinutos99(envio.tentativas), `erro no Regem: ${String(e?.message ?? e).slice(0, 200)}`);
        resumo.adiados++;
      }
    }
    return resumo;
  }

  // ── reserva e desfecho na fila ────────────────────────────────────────────────────────────────────────────────

  private async reservar(tenantIds: string[] | undefined, limite: number): Promise<Envio99[]> {
    // Lista em SQL: `sql.join` (V31).
    const escopo = tenantIds?.length
      ? sql`and tenant_id in (${sql.join(tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})`
      : sql``;
    const r: any = await this.db.execute(sql`
      update food99_envio e
         set situacao = 'enviando',
             reservado_ate = now() + make_interval(mins => ${RESERVA_99_MINUTOS}),
             tentativas = e.tentativas + 1
       where e.id in (
         select f.id from food99_envio f
          where f.situacao in ('pendente', 'enviando')
            and (f.situacao = 'pendente' or f.reservado_ate < now())
            and f.proxima_em <= now() ${escopo}
          order by f.proxima_em, f.id
          limit ${limite}
          for update of f skip locked)
      returning e.id, e.tenant_id, e.integracao_id, e.tipo, e.ref_id, e.versao, e.tentativas, e.dados, e.alvo`);
    return ((r.rows ?? r) as any[])
      .map((x) => ({
        ...x,
        versao: Number(x.versao),
        tentativas: Number(x.tentativas),
        dados: x.dados && typeof x.dados === 'object' ? x.dados : null,
        alvo: x.alvo === 'opcao' ? ('opcao' as const) : ('produto' as const),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Termina o envio. Se a mudança andou enquanto ele saía (versão nova), volta à fila para mandar o valor novo. */
  private async finalizar(envio: Envio99, d: Desfecho99) {
    await this.db.execute(sql`
      update food99_envio
         set situacao = case when versao = ${envio.versao} then 'feito' else 'pendente' end,
             proxima_em = case when versao = ${envio.versao} then proxima_em else now() end,
             reservado_ate = null,
             enviado_em = now(),
             resultado = ${d.resultado},
             resposta = ${JSON.stringify(d.resposta)}::jsonb,
             ultimo_erro = ${d.erro}
       where id = ${envio.id}`);
  }

  /** Tenta de novo mais tarde. Passou do prazo desde a mudança: desiste, com o motivo. */
  private async adiar(envio: Envio99, minutos: number, erro: string): Promise<'adiados' | 'desistidos'> {
    const r: any = await this.db.execute(sql`
      update food99_envio
         set situacao = case
               when versao <> ${envio.versao} then 'pendente'
               when marcado_em < now() - make_interval(hours => ${DESISTIR_99_DEPOIS_HORAS}) then 'desistiu'
               else 'pendente' end,
             proxima_em = case when versao <> ${envio.versao} then now()
                               else now() + make_interval(mins => ${Math.max(1, Math.ceil(minutos))}) end,
             resultado = case when versao = ${envio.versao}
                                and marcado_em < now() - make_interval(hours => ${DESISTIR_99_DEPOIS_HORAS})
                              then 'erro' else resultado end,
             reservado_ate = null,
             ultimo_erro = ${erro.slice(0, 300)}
       where id = ${envio.id}
      returning situacao`);
    return (r.rows ?? r)[0]?.situacao === 'desistiu' ? 'desistidos' : 'adiados';
  }

  /** Devolve à fila sem gastar a tentativa (a volta parou antes de chegar neles). */
  private async devolver(lote: Envio99[]) {
    if (!lote.length) return;
    await this.db.execute(sql`
      update food99_envio
         set situacao = 'pendente', reservado_ate = null, tentativas = greatest(0, tentativas - 1),
             proxima_em = now() + make_interval(mins => 1)
       where id in (${sql.join(lote.map((e) => sql`${e.id}::uuid`), sql`, `)}) and situacao = 'enviando'`);
  }

  private async dispensar(envio: Envio99, motivo: string): Promise<'dispensados'> {
    await this.finalizar(envio, { resultado: 'dispensado', repetir: false, resposta: { motivo }, erro: null });
    return 'dispensados';
  }

  // ── um envio ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** A última falha foi "a 99 sem resposta" (conta para encerrar a volta). */
  private ultimoFora = false;

  private async enviarUm(envio: Envio99, cardapios: Map<string, Promise<Cardapio99>>): Promise<keyof ResumoDo99> {
    this.ultimoFora = false;
    // Régua de "acesso vale" (V75), lida NA HORA de mandar.
    const ctx = await this.contexto(envio);
    if (!ctx.empresaViva) return this.dispensar(envio, 'empresa excluída');
    if (!ctx.liberado) return this.dispensar(envio, 'o preço e a pausa na 99 estão desligados nesta empresa');
    const ig = await this.food99.integracaoAtivaPorId(envio.integracao_id);
    if (!ig || ig.tenantId !== envio.tenant_id) return this.dispensar(envio, 'a loja não está mais conectada à 99');
    if (ig.unidadeId && !ctx.lojaViva) return this.dispensar(envio, 'loja excluída');

    const chamada = envio.alvo === 'opcao' ? await this.montarChamadaDaOpcao(envio) : await this.montarChamada(envio, ig);
    if ('dispensar' in chamada) return this.dispensar(envio, chamada.dispensar);

    if (chamada.tipo === 'situacao') {
      const r = await this.food99.situacaoDosItens(ig, [chamada.codigo], chamada.status);
      let d = desfechoDoErrno(r.errno, r.errmsg, { status: chamada.status });
      // errno 0 vale para o pedido; o item que a 99 pôs em `failed` não mudou (código que ela não tem, na prática).
      if (r.errno === 0 && r.falha.includes(chamada.codigo))
        d = {
          resultado: 'nao_encontrado',
          repetir: false,
          resposta: { errno: 0, status: chamada.status, frase: `A 99 não mudou o item com o código ${chamada.codigo}: confira se ele existe no cardápio desta loja na 99.` },
          erro: null,
        };
      if (d.repetir) return this.falhou(envio, d);
      if (d.resultado === 'aplicado') this.anotarNoCardapio(cardapios, ig.id, chamada.codigo, { status: chamada.status });
      await this.finalizar(envio, d);
      await this.auditar(envio, ig, 'updateItemStatus', chamada.codigo, { status: chamada.status }, d);
      return 'enviados';
    }

    // preço / nome / descrição: o item INTEIRO, como a 99 tem, com a mudança do Regem por cima. O cardápio da loja na 99
    // é lido UMA vez por volta (os itens e os grupos de complementos).
    let lido = cardapios.get(ig.id);
    if (!lido) {
      lido = this.food99.itensDoCardapio(ig);
      cardapios.set(ig.id, lido);
    }
    const cardapio = await lido;
    if (cardapio.errno !== 0) {
      cardapios.delete(ig.id); // a próxima linha desta loja tenta ler de novo
      const d = desfechoDoErrno(cardapio.errno, cardapio.errmsg);
      if (d.repetir) return this.falhou(envio, d);
      await this.finalizar(envio, d);
      return 'enviados';
    }
    if (chamada.tipo === 'grupos') return this.enviarPrecoNosGrupos(envio, ig, chamada, cardapio);
    const daLista = cardapio.itens.get(chamada.codigo);
    if (!daLista) {
      const d: Desfecho99 = {
        resultado: 'nao_encontrado',
        repetir: false,
        resposta: {
          frase: `A 99 não tem item com o código ${chamada.codigo} no cardápio desta loja: o preço e o nome vão quando ele existir lá (o "Exportar catálogo" em Delivery › Painel › ⚙️ › Integrações › 99Food cria).`,
        },
        erro: null,
      };
      await this.finalizar(envio, d);
      return 'enviados';
    }
    const corpo = itemParaAtualizar(daLista, chamada.mudar);
    // O Regem quer o item pausado: ele vai pausado mesmo que a leitura ainda não mostre (nunca reativa por aqui).
    if (chamada.pausadoNoRegem) corpo.status = 2;
    const r = await this.food99.atualizarItem(ig, corpo);
    const antes = Number(daLista.price);
    const d = desfechoDoErrno(r.errno, r.errmsg, {
      ...(chamada.mudar.preco !== undefined ? { antes: Number.isFinite(antes) ? antes / 100 : null, depois: chamada.mudar.preco / 100 } : {}),
      ...(chamada.mudar.nome !== undefined ? { nome: true } : {}),
      ...(chamada.mudar.descricao !== undefined ? { descricao: true } : {}),
      ...(chamada.mudar.foto !== undefined ? { foto: true } : {}),
    });
    if (d.repetir) return this.falhou(envio, d);
    if (d.resultado === 'aplicado') this.anotarNoCardapio(cardapios, ig.id, chamada.codigo, corpo);
    await this.finalizar(envio, d);
    await this.auditar(
      envio,
      ig,
      'updateItem',
      chamada.codigo,
      { preco: chamada.mudar.preco ?? null, nome: chamada.mudar.nome !== undefined, descricao: chamada.mudar.descricao !== undefined, foto: chamada.mudar.foto !== undefined },
      d,
    );
    return 'enviados';
  }

  /**
   * O preço do COMPLEMENTO (mig 404): em CADA grupo da 99 que tem a opção, o "Update Modifier Group" com o grupo inteiro
   * como a 99 tem e só o preço dela trocado. Uma falha que vale repetir adia o envio inteiro (os grupos já trocados
   * recebem o mesmo preço de novo — nada muda); recusa num grupo e aplicado noutro = "aplicado em parte", com a frase.
   */
  private async enviarPrecoNosGrupos(
    envio: Envio99,
    ig: IntegFood99,
    chamada: { codigo: string; preco: number },
    cardapio: Cardapio99,
  ): Promise<keyof ResumoDo99> {
    const grupos = gruposComOItem(cardapio.grupos, chamada.codigo);
    if (!grupos.length) {
      await this.finalizar(envio, {
        resultado: 'nao_encontrado',
        repetir: false,
        resposta: { frase: `A 99 não tem o complemento com o código ${chamada.codigo} em nenhum grupo desta loja: o preço vai quando ele estiver num grupo lá.` },
        erro: null,
      });
      return 'enviados';
    }
    const antesCent = grupos
      .map((g) => g.app_mg_items.find((it: any) => String(it?.app_item_id) === chamada.codigo)?.price)
      .find((v: unknown) => v !== undefined && v !== null);
    const extra = {
      grupos: grupos.length,
      antes: antesCent !== undefined && Number.isFinite(Number(antesCent)) ? Number(antesCent) / 100 : null,
      depois: chamada.preco / 100,
    };
    let aplicados = 0;
    let recusa: Desfecho99 | null = null;
    for (const g of grupos) {
      const corpo = grupoParaAtualizar(g, chamada.codigo, chamada.preco);
      const r = await this.food99.atualizarGrupo(ig, corpo);
      const d = desfechoDoErrno(r.errno, r.errmsg);
      if (d.repetir) return this.falhou(envio, d);
      if (d.resultado === 'aplicado') {
        aplicados++;
        g.app_mg_items = corpo.app_mg_items; // o grupo lido (o da volta) passa a ter o preço novo
      } else recusa = recusa ?? d;
    }
    const d: Desfecho99 = !recusa
      ? { resultado: 'aplicado', repetir: false, resposta: { errno: 0, ...extra }, erro: null }
      : aplicados
        ? {
            resultado: 'parcial',
            repetir: false,
            resposta: {
              ...recusa.resposta,
              ...extra,
              frase: `A 99 aplicou o preço em ${aplicados} de ${grupos.length} grupos. ${String(recusa.resposta.frase ?? '')}`.trim(),
            },
            erro: recusa.erro,
          }
        : { ...recusa, resposta: { ...recusa.resposta, ...extra } };
    await this.finalizar(envio, d);
    await this.auditar(envio, ig, 'updateModifierGroup', chamada.codigo, { preco: chamada.preco, grupos: grupos.length }, d);
    return 'enviados';
  }

  /** A falha que vale tentar de novo (sem resposta, sem token, erro da 99): adia; sem resposta conta para parar a volta. */
  private falhou(envio: Envio99, d: Desfecho99): Promise<'adiados' | 'desistidos'> {
    const errno = Number(d.resposta.errno);
    if (errno === -1) this.ultimoFora = true;
    return this.adiar(envio, recuoMinutos99(envio.tentativas), d.erro ?? 'a 99 não respondeu');
  }

  /** O que a volta mandou com sucesso passa a valer no cardápio lido (a próxima linha do mesmo item não desfaz). */
  private anotarNoCardapio(cardapios: Map<string, Promise<Cardapio99>>, integracaoId: string, codigo: string, campos: Record<string, unknown>) {
    const lido = cardapios.get(integracaoId);
    if (!lido) return;
    cardapios.set(
      integracaoId,
      lido.then((c) => {
        const it = c.itens.get(codigo);
        if (it) c.itens.set(codigo, { ...it, ...campos });
        return c;
      }),
    );
  }

  /** A régua: empresa viva, direito ligado e a loja da integração viva. */
  private async contexto(envio: Envio99) {
    const r: any = await this.db.execute(sql`
      select (select emp.deleted_at is null from empresa emp where emp.id = ${envio.tenant_id}) as empresa_viva,
             exists (select 1 from entitlement e where e.tenant_id = ${envio.tenant_id}
                       and e.modulo = 'precos_na_99' and e.ativo) as liberado,
             exists (select 1 from integracao i join unidade u on u.id = i.unidade_id
                      where i.id = ${envio.integracao_id} and u.tenant_id = ${envio.tenant_id}
                        and u.deleted_at is null) as loja_viva`);
    const x = (r.rows ?? r)[0] ?? {};
    return { empresaViva: x.empresa_viva === true, liberado: x.liberado === true, lojaViva: x.loja_viva === true };
  }

  /**
   * O COMPLEMENTO (a opção do catálogo — mig 404), lido NA HORA: a situação (pausado na 99 = "Em falta" ou `'99food'` em
   * `canais_pausados`) ou o preço na 99 (um por código, para os grupos — zero vale, o complemento grátis).
   */
  private async montarChamadaDaOpcao(envio: Envio99): Promise<Chamada99> {
    const r: any = await this.db.execute(sql`
      select o.codigo_pdv, o.preco_99::text as preco, o.esgotado, o.deleted_at,
             coalesce(jsonb_exists(o.canais_pausados, '99food'), false) as pausado_na_99
        from opcao o where o.id = ${envio.ref_id} and o.tenant_id = ${envio.tenant_id}`);
    const o = (r.rows ?? r)[0];
    if (!o || o.deleted_at) return { dispensar: 'complemento excluído' };
    const codigo = String(o.codigo_pdv ?? '').trim();
    if (!codigo) return { dispensar: 'complemento sem código PDV' };
    if (envio.tipo === 'status_item') return { tipo: 'situacao', codigo, status: o.esgotado === true || o.pausado_na_99 === true ? 2 : 1 };
    if (envio.tipo === 'preco_item') {
      if (o.preco == null) return { dispensar: 'sem preço na 99 (em branco: o Regem não mexe no preço de lá)' };
      const valor = centavos(o.preco);
      if (!(valor >= 0)) return { dispensar: 'preço inválido' };
      return { tipo: 'grupos', codigo, preco: valor };
    }
    return { dispensar: 'o nome do complemento não vai à 99 por aqui' };
  }

  /** O que mandar, lido NA HORA (o valor mais novo). Fora das condições: dispensa, com o motivo. */
  private async montarChamada(envio: Envio99, ig: IntegFood99): Promise<Chamada99> {
    const r: any = await this.db.execute(sql`
      select p.codigo, p.nome, p.descricao, p.preco_99::text as preco, p.na_99, p.deleted_at, p.unidade_id, p.imagem_ref,
             coalesce(jsonb_exists(p.canais_pausados, '99food'), false) as pausado_na_99,
             p.pausado_estoque,
             ${ig.unidadeId
               ? sql`exists (select 1 from produto_pausa_estoque pe
                              where pe.produto_id = p.id and pe.unidade_id = ${ig.unidadeId}
                                and pe.pausado and pe.deleted_at is null)`
               : sql`false`} as esgotado_na_loja
        from produto p where p.id = ${envio.ref_id} and p.tenant_id = ${envio.tenant_id}`);
    const p = (r.rows ?? r)[0];
    if (!p || p.deleted_at) return { dispensar: 'produto excluído' };
    if (p.unidade_id && ig.unidadeId && String(p.unidade_id) !== ig.unidadeId) return { dispensar: 'produto de outra loja' };
    const codigo = String(p.codigo ?? '').trim();
    if (!codigo) return { dispensar: 'produto sem código PDV' };
    // Pausado na 99 se QUALQUER pausa da 99 vale: o "Pausado na 99" ou o esgotado do estoque (todas as lojas ou esta).
    const pausadoNoRegem = p.pausado_na_99 === true || p.pausado_estoque === true || p.esgotado_na_loja === true;
    if (!p.na_99) {
      // Fora do cardápio da 99 ("Onde vende"): o item de lá fica PAUSADO — o Regem não apaga item da 99.
      if (envio.tipo === 'status_item') return { tipo: 'situacao', codigo, status: 2 };
      return { dispensar: 'produto marcado fora do cardápio da 99' };
    }
    if (envio.tipo === 'status_item') return { tipo: 'situacao', codigo, status: pausadoNoRegem ? 2 : 1 };
    if (envio.tipo === 'preco_item') {
      if (p.preco == null) return { dispensar: 'sem preço na 99 (em branco: o Regem não mexe no preço de lá)' };
      const valor = centavos(p.preco);
      if (!(valor > 0)) return { dispensar: 'preço zero não vai à 99 (o item sairia de graça)' };
      return { tipo: 'item', codigo, mudar: { preco: valor }, pausadoNoRegem };
    }
    // cadastro_item: só os campos que mudaram (`dados`); sem a lista, só o nome — nunca apagar a descrição de lá.
    const dados = envio.dados ?? {};
    const mudar: MudancaNoItem = {};
    if (dados.nome === true || !Object.keys(dados).length) {
      const nome = String(p.nome ?? '').trim();
      if (!nome) return { dispensar: 'produto sem nome' };
      if (nome.length > LIMITE_NOME_99) return { dispensar: `o nome tem ${nome.length} caracteres e a 99 aceita até ${LIMITE_NOME_99}: encurte o nome` };
      mudar.nome = nome;
    }
    if (dados.descricao === true) {
      const descricao = String(p.descricao ?? '').trim();
      if (descricao.length > LIMITE_DESCRICAO_99)
        return { dispensar: `a descrição tem ${descricao.length} caracteres e a 99 aceita até ${LIMITE_DESCRICAO_99}: encurte a descrição` };
      mudar.descricao = descricao;
    }
    // "Mandar esta foto à 99" (R3 F6): o endereço público da foto do Regem (na nuvem: o do Supabase). A foto ainda só no
    // servidor da loja não tem endereço que a 99 alcance — dispensa com o motivo (ela sobe para a nuvem em instantes).
    if (dados.foto === true) {
      const url = String(p.imagem_ref ?? '').trim();
      if (!url) return { dispensar: 'o produto não tem foto no Regem' };
      if (!/^https:\/\//i.test(url)) return { dispensar: 'a foto ainda está só no servidor da loja: ela sobe para a nuvem em instantes; mande de novo depois' };
      mudar.foto = url;
    }
    return { tipo: 'item', codigo, mudar, pausadoNoRegem };
  }

  /** O que foi à 99 fica no registro da empresa (quem: o sistema; o que a 99 respondeu). */
  private async auditar(envio: Envio99, ig: IntegFood99, chamada: string, codigo: string, detalhe: Record<string, unknown>, d: Desfecho99) {
    await this.auditoria.registrar({
      tenantId: envio.tenant_id,
      unidadeId: ig.unidadeId,
      atorId: null,
      atorPerfil: 'sistema',
      tipo: 'integracao',
      acao: 'enviou_a_99',
      entidadeTipo: envio.alvo === 'opcao' ? 'opcao' : 'produto',
      entidadeId: envio.ref_id,
      origem: '99food',
      detalhe: { chamada, codigoPdv: codigo, ...detalhe, resultado: d.resultado, errno: d.resposta.errno ?? null },
    });
  }

  // ── o aviso do banco (LISTEN) ─────────────────────────────────────────────────────────────────────────────────

  private async ouvir() {
    if (this.parado) return;
    const connectionString = process.env.DATABASE_URL;
    const ssl = resolverSsl(connectionString);
    const c = new Client({ connectionString, ...(ssl ? { ssl } : {}) });
    const cair = (motivo: string) => {
      if (this.ouvinte !== c) return;
      this.ouvinte = null;
      c.end().catch(() => {});
      this.reouvir(motivo);
    };
    c.on('error', (e: any) => cair(e?.code ?? e?.message ?? String(e)));
    c.on('end', () => cair('conexão encerrada'));
    c.on('notification', () => void this.acordar());
    try {
      await c.connect();
      await c.query('LISTEN food99_envio');
      this.ouvinte = c;
      if (this.falhas) this.log.log('LISTEN food99_envio restabelecido');
      this.falhas = 0;
      void this.acordar(); // o que entrou enquanto não ouvíamos
    } catch (e: any) {
      c.end().catch(() => {});
      this.reouvir(e?.message ?? String(e));
    }
  }

  private reouvir(motivo: string) {
    if (this.parado) return;
    this.falhas++;
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(this.falhas - 1, 5));
    if (this.falhas === 1 || this.falhas % 10 === 0)
      this.log.warn(`LISTEN food99_envio indisponível (${motivo}) — a rotina de 15 s segue; nova tentativa em ${espera / 1000}s`);
    setTimeout(() => void this.ouvir(), espera);
  }
}
