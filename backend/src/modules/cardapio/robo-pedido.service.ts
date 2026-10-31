import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cliente, clienteEndereco, pedidoExterno, roboCarrinho } from '../../db/schema';
import { Conversa, lerConversa } from '../../common/conversa-do-robo';
import { paraCentavos, paraReais } from '../../util/dinheiro';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from './cardapio.service';
import { normalizar, reais } from './robo-consultas';
import {
  EntregaDoCarrinho,
  Falta,
  Linha,
  MAX_LINHAS,
  PagamentoDoCarrinho,
  acharBairro,
  acharForma,
  acharProduto,
  acharVariacao,
  alterarEscolhas,
  faltaDaLinha,
  faltaDoPedido,
  formasDoRobo,
  formasSoPeloLink,
  itensDoPedido,
  montarEscolhas,
  nomeDoCliente,
  pedeTroco,
  quantidadeDoPedido,
  referenciaDoPedido,
  referenciaParaOPedido,
  textoDoEndereco,
  valorDoTroco,
} from './robo-pedido';
import { resumoDoPedido } from './robo-resumo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO PELO WHATSAPP (Fase 5, F3 e F4 — pedido do dono de 30/10/2026). O robô monta o pedido na conversa e o Regem
// guarda o carrinho (`robo_carrinho`, mig 344), confere cada passo e, quando o cliente confirma o resumo, registra pelo
// MESMO caminho do cardápio online (`receberPedido`): preço, taxa, horário, estoque e a entrada na loja são os de sempre.
// Quem é o cliente vem da FICHA DA CONVERSA (`x-regem-conversa`, assinada pelo Regem a cada mensagem): a loja e o
// telefone saem dela, nunca de um parâmetro que a IA preencha (V79).

type Contexto = { token: string; cfg: any; conversa: Conversa };
type Carrinho = typeof roboCarrinho.$inferSelect;
type ClienteDaConversa = { id: string; nome: string | null; telefone: string | null; enderecos: any[] } | null;
type Recusa = { ok: false; motivo: string; mensagem: string; [k: string]: unknown };

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const VALIDADE_DO_CARRINHO = sql`interval '12 hours'`;

/** As formas do número no cadastro: com/sem o 55 e com/sem o nono dígito (a chave sempre tem o 9 — ERR-134). */
export function formasDaChave(chave: string): string[] {
  const f = new Set([chave, `55${chave}`]);
  if (/^[1-9][0-9]9[6-9][0-9]{7}$/.test(chave)) {
    const sem9 = `${chave.slice(0, 2)}${chave.slice(3)}`;
    f.add(sem9);
    f.add(`55${sem9}`);
  }
  return [...f];
}

const recusa = (motivo: string, mensagem: string, extra: Record<string, unknown> = {}): Recusa => ({ ok: false, motivo, mensagem, ...extra });

@Injectable()
export class RoboPedidoService {
  private readonly logger = new Logger('RoboPedido');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cardapio: CardapioService,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  /** A loja (pela chave do número, com a senha do robô) e o cliente (pela ficha da conversa, da mesma loja). */
  async contexto(segredo: string, ficha: unknown, instancia?: string, phoneNumberId?: string): Promise<Contexto> {
    const token = await this.cardapio.tokenDaLojaDoRobo(segredo, instancia, phoneNumberId);
    const conversa = lerConversa(ficha);
    const cfg = await this.cardapio.resolver(token);
    if (!conversa || conversa.tenantId !== cfg.tenantId)
      throw new UnauthorizedException('Conversa não reconhecida: use a ficha que veio com a mensagem do cliente.');
    return { token, cfg, conversa };
  }

  // ───────────────────────── leitura ─────────────────────────

  /** O cliente da conversa no cadastro da loja (pelo telefone, em qualquer das formas) e os endereços dele (até 5). */
  private async clienteDaConversa(ctx: Contexto): Promise<ClienteDaConversa> {
    const [c] = await this.db
      .select({ id: cliente.id, nome: cliente.nome, telefone: cliente.telefone })
      .from(cliente)
      .where(and(eq(cliente.tenantId, ctx.cfg.tenantId), inArray(cliente.telefone, formasDaChave(ctx.conversa.chave))))
      .orderBy(desc(cliente.totalPedidos), cliente.criadoEm)
      .limit(1);
    if (!c) return null;
    const enderecos = await this.db
      .select()
      .from(clienteEndereco)
      .where(and(eq(clienteEndereco.tenantId, ctx.cfg.tenantId), eq(clienteEndereco.clienteId, c.id)))
      .orderBy(desc(clienteEndereco.principal), desc(clienteEndereco.criadoEm))
      .limit(5);
    return { ...c, enderecos };
  }

  /** O carrinho aberto da conversa (o que passou de 12 h sem mudar é cancelado antes). */
  private async carrinhoAberto(ctx: Contexto): Promise<Carrinho | null> {
    await this.vencer(this.db, ctx);
    const [c] = await this.db
      .select()
      .from(roboCarrinho)
      .where(
        and(
          eq(roboCarrinho.tenantId, ctx.cfg.tenantId),
          eq(roboCarrinho.telefoneChave, ctx.conversa.chave),
          eq(roboCarrinho.status, 'aberto'),
        ),
      );
    return c ?? null;
  }

  private async vencer(db: any, ctx: Contexto) {
    await db.execute(sql`
      update robo_carrinho set status = 'cancelado', atualizado_em = now()
       where tenant_id = ${ctx.cfg.tenantId}::uuid and telefone_chave = ${ctx.conversa.chave}
         and status = 'aberto' and atualizado_em < now() - ${VALIDADE_DO_CARRINHO}`);
  }

  /** Quem é o cliente, os endereços salvos (numerados para o robô escolher) e o pedido em montagem. */
  async ver(ctx: Contexto) {
    const [menu, cli, c] = await Promise.all([this.cardapio.menu(ctx.token), this.clienteDaConversa(ctx), this.carrinhoAberto(ctx)]);
    return {
      cliente: cli
        ? { conhecido: true, nome: cli.nome ?? null }
        : { conhecido: false, nome: null, dica: 'Cliente novo: pergunte o nome para o pedido.' },
      enderecosSalvos: (cli?.enderecos ?? []).map((e, i) => ({ n: i + 1, endereco: this.textoDoSalvo(e) })),
      pedido: await this.estado(ctx, menu, c, cli),
    };
  }

  private textoDoSalvo(e: any): string {
    const ref = e.referencia || e.complemento;
    return [[e.logradouro, e.numero].filter(Boolean).join(', '), e.bairro, ref ? `ref: ${ref}` : ''].filter((s) => s && String(s).trim()).join(' · ');
  }

  // ───────────────────────── gravação ─────────────────────────

  /**
   * Muda o carrinho aberto (cria se não houver) numa transação curta: trava a linha, aplica a mudança e sobe a versão.
   * A mudança recebe o carrinho como está AGORA (duas mensagens ao mesmo tempo não se atropelam) e pode recusar.
   */
  private async mudar(
    ctx: Contexto,
    mudanca: (c: Carrinho) => Partial<Pick<Carrinho, 'itens' | 'entrega' | 'pagamento' | 'clienteNome'>> | Recusa,
  ): Promise<{ carrinho: Carrinho; recusa: Recusa | null }> {
    return this.db.transaction(async (tx: any) => {
      await this.vencer(tx, ctx);
      // Um aberto por cliente (índice único parcial): a corrida de duas mensagens cai no "do nothing".
      await tx.execute(sql`
        insert into robo_carrinho (tenant_id, telefone, telefone_chave)
        values (${ctx.cfg.tenantId}::uuid, ${ctx.conversa.telefone}, ${ctx.conversa.chave})
        on conflict (tenant_id, telefone_chave) where status = 'aberto' do nothing`);
      const [c] = linhasDe(
        await tx.execute(sql`
          select * from robo_carrinho
           where tenant_id = ${ctx.cfg.tenantId}::uuid and telefone_chave = ${ctx.conversa.chave} and status = 'aberto'
           for update`),
      );
      const atual = this.carrinhoDaLinha(c);
      const r = mudanca(atual);
      if ((r as Recusa).ok === false) return { carrinho: atual, recusa: r as Recusa };
      const [novo] = await tx
        .update(roboCarrinho)
        .set({ ...(r as any), versao: sql`${roboCarrinho.versao} + 1`, atualizadoEm: new Date() })
        .where(eq(roboCarrinho.id, atual.id))
        .returning();
      return { carrinho: novo as Carrinho, recusa: null };
    });
  }

  /** A linha crua (snake_case, do `execute`) no formato do Drizzle. */
  private carrinhoDaLinha(r: any): Carrinho {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      telefone: r.telefone,
      telefoneChave: r.telefone_chave,
      clienteNome: r.cliente_nome,
      itens: r.itens ?? [],
      entrega: r.entrega ?? null,
      pagamento: r.pagamento ?? null,
      versao: Number(r.versao) || 0,
      status: r.status,
      pedidoId: r.pedido_id,
      criadoEm: r.criado_em,
      atualizadoEm: r.atualizado_em,
    } as Carrinho;
  }

  private async responder(ctx: Contexto, menu: any, r: { carrinho: Carrinho; recusa: Recusa | null }, feito?: string) {
    const pedido = await this.estado(ctx, menu, r.carrinho, await this.clienteDaConversa(ctx));
    return r.recusa ? { ...r.recusa, pedido } : { ok: true, feito: feito ?? null, pedido };
  }

  // ───────────────────────── itens ─────────────────────────

  async mexerNosItens(
    ctx: Contexto,
    dto: { acao?: string; produto?: string; versao?: string; adicionais?: unknown; tirarAdicionais?: unknown; quantidade?: unknown; observacao?: string; linha?: unknown },
  ) {
    const menu = await this.cardapio.menu(ctx.token);
    const acao = normalizar(dto?.acao);
    const obs = String(dto?.observacao ?? '').trim().slice(0, 140) || null;
    if (acao === 'adicionar' || acao === 'incluir') {
      const achado = acharProduto(menu, dto?.produto);
      if (!achado.ok) {
        const r =
          achado.motivo === 'varios'
            ? recusa('varios_produtos', 'Mais de um produto com esse nome: pergunte qual o cliente quer.', { opcoes: achado.opcoes })
            : achado.motivo === 'esgotado'
              ? recusa('esgotado', `${achado.produto.nome} está esgotado agora. Ofereça outra opção.`)
              : recusa('produto_nao_encontrado', 'Não achei esse produto no cardápio: use a busca do cardápio e confira o nome.');
        return { ...r, pedido: await this.estado(ctx, menu, await this.carrinhoAberto(ctx), await this.clienteDaConversa(ctx)) };
      }
      const p = achado.produto;
      const qtd = quantidadeDoPedido(dto?.quantidade);
      if (qtd == null) return this.semMudar(ctx, menu, recusa('quantidade', 'A quantidade vai de 1 a 50.'));
      const v = acharVariacao(p, dto?.versao);
      if (!v.ok && v.motivo === 'nenhuma')
        return this.semMudar(ctx, menu, recusa('versao', `${p.nome} não tem a versão "${dto?.versao}". As versões são estas.`, { opcoes: v.opcoes }));
      const esc = montarEscolhas(p, dto?.adicionais);
      if (esc.naoAchei.length)
        return this.semMudar(
          ctx,
          menu,
          recusa('adicional', `Não achei em ${p.nome}: ${esc.naoAchei.join(', ')}. Estas são as opções dele.`, {
            opcoesDoProduto: this.opcoesDoProduto(p),
          }),
        );
      if (esc.passouDoLimite.length)
        return this.semMudar(ctx, menu, recusa('limite', esc.passouDoLimite.map((g) => `${g.grupo}: no máximo ${g.maximo}`).join('; ')));
      const variacaoId = v.ok ? (v.variacao?.id ?? null) : null;
      const r = await this.mudar(ctx, (c) => {
        const linhas: Linha[] = Array.isArray(c.itens) ? (c.itens as Linha[]) : [];
        const chave = (l: Pick<Linha, 'produtoId' | 'variacaoId' | 'complementos' | 'observacao'>) =>
          `${l.produtoId}|${l.variacaoId ?? ''}|${[...(l.complementos ?? [])].sort().join(',')}|${l.observacao ?? ''}`;
        const nova = { produtoId: p.id, variacaoId, complementos: esc.complementos, observacao: obs };
        const igual = linhas.find((l) => chave(l) === chave(nova));
        if (igual) {
          if (igual.quantidade + qtd > 50) return recusa('quantidade', 'A quantidade de um item vai até 50.');
          return { itens: linhas.map((l) => (l === igual ? { ...l, quantidade: l.quantidade + qtd } : l)) };
        }
        if (linhas.length >= MAX_LINHAS) return recusa('itens', `O pedido pelo WhatsApp vai até ${MAX_LINHAS} itens.`);
        const n = linhas.reduce((m, l) => Math.max(m, Number(l.linha) || 0), 0) + 1;
        return { itens: [...linhas, { linha: n, ...nova, quantidade: qtd }] };
      });
      return this.responder(ctx, menu, r, `adicionado: ${qtd}x ${p.nome}`);
    }
    if (acao === 'limpar' || acao === 'esvaziar') {
      const r = await this.mudar(ctx, () => ({ itens: [] }));
      return this.responder(ctx, menu, r, 'itens apagados');
    }
    if (acao === 'remover' || acao === 'tirar' || acao === 'alterar' || acao === 'mudar') {
      const n = Number(dto?.linha);
      const r = await this.mudar(ctx, (c) => {
        const linhas: Linha[] = Array.isArray(c.itens) ? (c.itens as Linha[]) : [];
        const l = linhas.find((x) => Number(x.linha) === n);
        if (!l) return recusa('linha', `Não há o item ${dto?.linha ?? ''} no pedido: confira o número do item no pedido.`);
        if (acao === 'remover' || acao === 'tirar') return { itens: linhas.filter((x) => x !== l) };
        const p = (menu?.produtos ?? []).find((x: any) => x.id === l.produtoId);
        if (!p) return recusa('produto_fora', 'Esse item saiu do cardápio: tire do pedido.');
        let mudou: Linha = { ...l };
        // Vazio ou 0 = não muda a quantidade (a ferramenta manda todos os campos); para tirar o item, acao = remover.
        if (dto?.quantidade != null && dto?.quantidade !== '' && Number(dto.quantidade) !== 0) {
          const qtd = quantidadeDoPedido(dto.quantidade);
          if (qtd == null) return recusa('quantidade', 'A quantidade vai de 1 a 50.');
          mudou.quantidade = qtd;
        }
        if (dto?.versao) {
          const v = acharVariacao(p, dto.versao);
          if (!v.ok) return recusa('versao', `${p.nome} não tem a versão "${dto.versao}".`, { opcoes: v.opcoes });
          mudou.variacaoId = v.variacao?.id ?? null;
        }
        if (dto?.adicionais != null || dto?.tirarAdicionais != null) {
          const esc = alterarEscolhas(p, l.complementos ?? [], dto?.adicionais, dto?.tirarAdicionais);
          if (esc.naoAchei.length)
            return recusa('adicional', `Não achei em ${p.nome}: ${esc.naoAchei.join(', ')}.`, { opcoesDoProduto: this.opcoesDoProduto(p) });
          if (esc.passouDoLimite.length)
            return recusa('limite', esc.passouDoLimite.map((g) => `${g.grupo}: no máximo ${g.maximo} (tire um antes)`).join('; '));
          mudou.complementos = esc.complementos;
        }
        // Observação vazia não apaga a que havia; "nenhuma"/"sem observação" apaga.
        if (obs) mudou = { ...mudou, observacao: /^(nenhuma|sem observa)/i.test(obs) ? null : obs };
        return { itens: linhas.map((x) => (x === l ? mudou : x)) };
      });
      return this.responder(ctx, menu, r, r.recusa ? undefined : `item ${n} ${acao === 'remover' || acao === 'tirar' ? 'removido' : 'alterado'}`);
    }
    throw new BadRequestException('acao: adicionar, alterar, remover ou limpar.');
  }

  private async semMudar(ctx: Contexto, menu: any, r: Recusa) {
    return { ...r, pedido: await this.estado(ctx, menu, await this.carrinhoAberto(ctx), await this.clienteDaConversa(ctx)) };
  }

  /** As etapas do produto com as opções (para o robô dizer o que dá para escolher). */
  private opcoesDoProduto(p: any) {
    return (Array.isArray(p?.grupos) ? p.grupos : []).map((g: any) => ({
      etapa: g.nome,
      obrigatoria: g.obrigatorio === true || Number(g.min) > 0,
      maximo: g.max ?? null,
      opcoes: (g.opcoes ?? []).slice(0, 25).map((o: any) => (Number(o.precoDelta) > 0 ? `${o.nome} (+${reais(o.precoDelta)})` : o.nome)),
    }));
  }

  // ───────────────────────── nome ─────────────────────────

  async definirNome(ctx: Contexto, dto: { nome?: string }) {
    const menu = await this.cardapio.menu(ctx.token);
    const nome = nomeDoCliente(dto?.nome);
    const r = await this.mudar(ctx, () => (nome ? { clienteNome: nome } : recusa('nome', 'Nome inválido: pergunte de novo.')));
    return this.responder(ctx, menu, r, nome ? `nome: ${nome}` : undefined);
  }

  // ───────────────────────── entrega ─────────────────────────

  /** Os tipos que a loja faz pelo cardápio e os que estão abertos agora. */
  private tipos(menu: any) {
    const oferecidos: ('entrega' | 'retirada')[] = [];
    if (menu?.tipos?.delivery !== false) oferecidos.push('entrega');
    if (menu?.tipos?.retirada) oferecidos.push('retirada');
    const abertos = oferecidos.filter((t) => menu?.abertoPorTipo?.[t] !== false && menu?.loja?.aberto !== false);
    return { oferecidos, abertos };
  }

  async definirEntrega(
    ctx: Contexto,
    dto: { tipo?: string; endereco?: unknown; rua?: string; numero?: string; bairro?: string; referencia?: string; localizacao?: string; lat?: unknown; lng?: unknown },
  ) {
    const menu = await this.cardapio.menu(ctx.token);
    const { oferecidos, abertos } = this.tipos(menu);
    const t = normalizar(dto?.tipo);
    let tipo: 'entrega' | 'retirada' | null = /retir|buscar|balcao|pegar/.test(t) ? 'retirada' : /entreg|delivery|casa/.test(t) ? 'entrega' : null;
    if (!tipo && oferecidos.length === 1) tipo = oferecidos[0];
    if (!tipo && (Number(dto?.endereco) > 0 || dto?.rua || dto?.bairro || dto?.localizacao || dto?.referencia)) tipo = 'entrega';
    if (!tipo) return this.semMudar(ctx, menu, recusa('tipo', 'Diga se é entrega ou retirada.', { tipos: oferecidos }));
    if (!oferecidos.includes(tipo))
      return this.semMudar(ctx, menu, recusa('tipo', tipo === 'retirada' ? 'A loja não faz retirada pelo cardápio.' : 'A loja não faz entrega pelo cardápio.'));
    if (!abertos.includes(tipo)) {
      const volta = menu?.proximaAbertura?.[tipo];
      return this.semMudar(
        ctx,
        menu,
        recusa('fechado', `${tipo === 'entrega' ? 'A entrega' : 'A retirada'} está fechada agora${volta ? ` (volta ${String(volta).includes(' ') ? volta : `às ${volta}`})` : ''}.`),
      );
    }
    if (tipo === 'retirada') {
      const r = await this.mudar(ctx, () => ({ entrega: { tipo: 'retirada' } }));
      return this.responder(ctx, menu, r, 'retirada na loja');
    }

    // Entrega: o endereço salvo escolhido, ou o que já estava no pedido com o que veio agora por cima.
    const cli = await this.clienteDaConversa(ctx);
    const atual = await this.carrinhoAberto(ctx);
    const antes: any = atual?.entrega && (atual.entrega as any).tipo === 'entrega' ? atual.entrega : null;
    let e: Extract<EntregaDoCarrinho, { tipo: 'entrega' }>;
    if (Number(dto?.endereco) > 0) {
      const salvo = (cli?.enderecos ?? [])[Number(dto.endereco) - 1];
      if (!salvo) return this.semMudar(ctx, menu, recusa('endereco', 'Esse endereço salvo não existe: confira o número na lista.'));
      e = {
        tipo: 'entrega',
        rua: salvo.logradouro ?? '',
        numero: salvo.numero ?? '',
        bairro: salvo.bairro ?? null,
        bairroId: salvo.bairroId ?? null,
        referencia: salvo.referencia || salvo.complemento || null,
        lat: salvo.lat != null ? Number(salvo.lat) : null,
        lng: salvo.lng != null ? Number(salvo.lng) : null,
        enderecoId: salvo.id,
      };
    } else {
      const novoEndereco = !!(dto?.rua || dto?.numero);
      e = {
        tipo: 'entrega',
        rua: String(dto?.rua ?? (novoEndereco ? '' : (antes?.rua ?? ''))).trim().slice(0, 120),
        numero: String(dto?.numero ?? (novoEndereco ? '' : (antes?.numero ?? ''))).trim().slice(0, 20),
        bairro: dto?.bairro ? String(dto.bairro).trim().slice(0, 80) : novoEndereco ? null : (antes?.bairro ?? null),
        bairroId: dto?.bairro || novoEndereco ? null : (antes?.bairroId ?? null),
        referencia: novoEndereco ? null : (antes?.referencia ?? null),
        lat: novoEndereco ? null : (antes?.lat ?? null),
        lng: novoEndereco ? null : (antes?.lng ?? null),
        enderecoId: novoEndereco ? null : (antes?.enderecoId ?? null),
      };
    }
    if (dto?.referencia != null && String(dto.referencia).trim()) e.referencia = referenciaDoPedido(dto.referencia);
    const ponto = this.pontoDe(dto);
    if (ponto) {
      e.lat = ponto.lat;
      e.lng = ponto.lng;
    }
    if (!e.rua || !e.numero)
      return this.semMudar(ctx, menu, recusa('endereco', 'Falta a rua e o número do endereço de entrega.', { tem: { rua: e.rua || null, numero: e.numero || null } }));

    // A área: bairro da lista (modo bairro) ou a distância pelas faixas (modo distância) — a mesma conta do cardápio.
    if (menu?.loja?.areaModo === 'raio') {
      const taxa = await this.cardapio.taxaDeEntrega(ctx.cfg, { rua: e.rua, numero: e.numero, lat: e.lat ?? undefined, lng: e.lng ?? undefined }, 0);
      if (taxa.semLocalizacao)
        return this.semMudar(
          ctx,
          menu,
          recusa('localizacao', 'Não achei esse endereço no mapa. Peça ao cliente a localização pelo WhatsApp (clipe → Localização) ou confira a rua e o número.'),
        );
      if (taxa.alemDaUltimaFaixa) return this.semMudar(ctx, menu, this.foraDaArea(oferecidos, abertos, taxa.km));
      if (taxa.ponto) {
        e.lat = taxa.ponto.lat;
        e.lng = taxa.ponto.lng;
      }
    } else {
      const lista: any[] = Array.isArray(menu?.bairros) ? menu.bairros : [];
      const pelaLista = e.bairroId ? lista.find((b) => b.id === e.bairroId) : null;
      if (pelaLista) e.bairro = pelaLista.nome;
      else {
        if (!e.bairro) return this.semMudar(ctx, menu, recusa('bairro', 'Falta o bairro do endereço de entrega.'));
        const b = acharBairro(menu, e.bairro);
        if (!b.ok)
          return this.semMudar(
            ctx,
            menu,
            b.parecidos.length
              ? recusa('bairro', `Não achei o bairro "${e.bairro}" na lista de entrega. Pergunte se é um destes.`, { parecidos: b.parecidos })
              : this.foraDaArea(oferecidos, abertos, null),
          );
        e.bairro = b.bairro.nome;
        e.bairroId = b.bairro.id;
      }
    }
    const r = await this.mudar(ctx, () => ({ entrega: e }));
    return this.responder(ctx, menu, r, `entrega: ${textoDoEndereco(e)}`);
  }

  /** "Infelizmente nosso delivery não cobre a região" — e a retirada, quando a loja faz e está aberta. */
  private foraDaArea(oferecidos: string[], abertos: string[], km: number | null): Recusa {
    const retirada = oferecidos.includes('retirada') && abertos.includes('retirada');
    return recusa('fora_da_area', 'Infelizmente nosso delivery não cobre a região.', {
      ...(km != null ? { distanciaKm: Math.round(km * 10) / 10 } : {}),
      alternativa: retirada ? 'O cliente pode retirar na loja.' : null,
    });
  }

  /** A localização que o cliente mandou: "lat,lng" (o texto "[localização] -22.9,-43.2") ou os dois campos. */
  private pontoDe(dto: { localizacao?: string; lat?: unknown; lng?: unknown }): { lat: number; lng: number } | null {
    const m = String(dto?.localizacao ?? '').match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    const lat = m ? Number(m[1]) : Number(dto?.lat);
    const lng = m ? Number(m[2]) : Number(dto?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
    return { lat, lng };
  }

  // ───────────────────────── pagamento ─────────────────────────

  async definirPagamento(ctx: Contexto, dto: { forma?: string; troco?: unknown; semTroco?: unknown }) {
    const menu = await this.cardapio.menu(ctx.token);
    const atual = await this.carrinhoAberto(ctx);
    const tipo = ((atual?.entrega as any)?.tipo as 'entrega' | 'retirada' | undefined) ?? null;
    const f = acharForma(menu, tipo, dto?.forma);
    if (!f.ok) {
      const link = this.cardapio.linkDoCardapio(ctx.token);
      return this.semMudar(
        ctx,
        menu,
        f.motivo === 'so_pelo_link'
          ? recusa('so_pelo_link', `Pix e cartão online só pelo link do cardápio (${link}). Pelo WhatsApp, as formas são as da lista.`, { formas: f.opcoes })
          : recusa('forma', 'Essa forma de pagamento não está no cardápio. Ofereça as da lista.', { formas: f.opcoes, soPeloLink: formasSoPeloLink(menu) }),
      );
    }
    const semTroco = dto?.semTroco === true || String(dto?.semTroco ?? '').toLowerCase() === 'true' || f.porCartao;
    let trocoPara: number | null = null;
    if (pedeTroco(f.forma) && !semTroco && dto?.troco != null && dto?.troco !== '') {
      trocoPara = valorDoTroco(dto.troco);
      if (trocoPara == null) return this.semMudar(ctx, menu, recusa('troco', 'Não entendi o valor do troco: peça só o número (ex.: 100).'));
    }
    const pagamento: PagamentoDoCarrinho = { forma: f.forma, trocoPara, semTroco: pedeTroco(f.forma) ? semTroco : false };
    const r = await this.mudar(ctx, () => ({ pagamento }));
    const nome = formasDoRobo(menu, tipo).find((x) => x.forma === f.forma)?.nome ?? f.forma;
    return this.responder(ctx, menu, r, `pagamento: ${nome}`);
  }

  // ───────────────────────── cancelar ─────────────────────────

  async cancelar(ctx: Contexto) {
    const c = await this.carrinhoAberto(ctx);
    if (c)
      await this.db
        .update(roboCarrinho)
        .set({ status: 'cancelado', atualizadoEm: new Date() })
        .where(and(eq(roboCarrinho.id, c.id), eq(roboCarrinho.status, 'aberto')));
    return { ok: true, feito: c ? 'pedido em montagem cancelado' : 'não havia pedido em montagem' };
  }

  // ───────────────────────── o estado ─────────────────────────

  /**
   * O pedido como está: cada item com o preço (as contas do cardápio), o que falta escolher, a entrega com a taxa, o
   * pagamento com o troco, o total e o que ainda falta para registrar. `versao` vai no registrar (F4): só se registra o
   * que o cliente viu no resumo.
   */
  async estado(ctx: Contexto, menu: any, c: Carrinho | null, cli: ClienteDaConversa) {
    return (await this.calcular(ctx, menu, c, cli)).visao;
  }

  private async calcular(ctx: Contexto, menu: any, c: Carrinho | null, cli: ClienteDaConversa) {
    const linhas: Linha[] = Array.isArray(c?.itens) ? (c!.itens as Linha[]) : [];
    const produtos = new Map<string, any>((menu?.produtos ?? []).map((p: any) => [p.id, p]));
    const avisos: string[] = [];
    const incompletas: { linha: number; produto: string; falta: string[] }[] = [];
    const prontas: Linha[] = [];
    let bloqueado = false;
    for (const l of linhas) {
      const p = produtos.get(l.produtoId);
      if (!p) {
        avisos.push(`O item ${l.linha} saiu do cardápio: tire do pedido.`);
        bloqueado = true;
      } else if (p.esgotado) {
        avisos.push(`O item ${l.linha} (${p.nome}) esgotou agora: tire do pedido ou troque.`);
        bloqueado = true;
      } else {
        const falta = faltaDaLinha(p, l);
        if (falta.length) incompletas.push({ linha: l.linha, produto: p.nome, falta });
        else prontas.push(l);
      }
    }
    // O preço das linhas prontas pelas contas do pedido do cardápio. Falhou todo junto: confere uma a uma para dizer qual.
    const precos = new Map<number, { descricao: string; unitario: number; quantidade: number }>();
    let subtotalCent = 0;
    if (prontas.length) {
      const precificar = async (ls: Linha[]) => {
        const { porId, faixasAtacado } = await this.cardapio.conferirProdutosDoPedido(ctx.cfg, itensDoPedido(ls));
        return this.cardapio.precificarItensDoPedido(ctx.cfg, itensDoPedido(ls), porId, faixasAtacado);
      };
      try {
        const { itensOut, totalCent } = await precificar(prontas);
        subtotalCent = totalCent;
        itensOut.forEach((it: any, i: number) => precos.set(prontas[i].linha, { descricao: it.descricao, unitario: it.precoUnitario, quantidade: it.quantidade }));
      } catch {
        bloqueado = true;
        for (const l of prontas) {
          try {
            const { itensOut, totalCent } = await precificar([l]);
            subtotalCent += totalCent;
            precos.set(l.linha, { descricao: itensOut[0].descricao, unitario: itensOut[0].precoUnitario, quantidade: itensOut[0].quantidade });
          } catch (e: any) {
            avisos.push(`Item ${l.linha}: ${e?.message ?? 'não deu para conferir'}`);
          }
        }
      }
    }
    const subtotal = paraReais(subtotalCent);

    // Entrega e taxa (a mesma conta do cardápio); fora da área de novo (a loja mudou a lista ou as faixas) → falta.
    const { oferecidos, abertos } = this.tipos(menu);
    const en: any = c?.entrega ?? null;
    let tipo: 'entrega' | 'retirada' | null = en?.tipo === 'entrega' || en?.tipo === 'retirada' ? en.tipo : null;
    if (!tipo && oferecidos.length === 1) tipo = oferecidos[0];
    if (tipo && !abertos.includes(tipo)) {
      avisos.push(`${tipo === 'entrega' ? 'A entrega' : 'A retirada'} está fechada agora.`);
      bloqueado = true;
    }
    let taxa = 0;
    let taxaCheia = 0;
    let foraDaArea = false;
    if (tipo === 'entrega' && en?.tipo === 'entrega' && en.rua && en.numero) {
      if (menu?.loja?.areaModo === 'raio' || (en.bairroId && (menu?.bairros ?? []).some((b: any) => b.id === en.bairroId))) {
        const t = await this.cardapio.taxaDeEntrega(
          ctx.cfg,
          { bairroId: en.bairroId ?? undefined, rua: en.rua, numero: en.numero, lat: en.lat ?? undefined, lng: en.lng ?? undefined },
          subtotal,
        );
        taxa = t.taxa;
        taxaCheia = t.taxaCheia;
        foraDaArea = t.alemDaUltimaFaixa || (menu?.loja?.areaModo === 'raio' && t.semLocalizacao);
      } else foraDaArea = true;
    }
    const totalCent = subtotalCent + paraCentavos(taxa);
    const total = paraReais(totalCent);

    // Pagamento: a forma ainda é do cardápio? O troco ainda cobre o total?
    const pg = (c?.pagamento as PagamentoDoCarrinho | null) ?? null;
    const formas = formasDoRobo(menu, tipo);
    const formaServe = !!pg && formas.some((f) => f.forma === pg.forma);
    let trocoRuim = false;
    if (pg && formaServe && pg.trocoPara != null && pg.trocoPara < total) {
      avisos.push(`O troco para ${reais(pg.trocoPara)} não cobre o total de ${reais(total)}: pergunte de novo.`);
      trocoRuim = true;
    }
    const nome = c?.clienteNome ?? cli?.nome ?? null;
    const falta: Falta[] = faltaDoPedido({
      linhas: linhas.length,
      linhasIncompletas: incompletas,
      tipo,
      tiposAbertos: abertos,
      entrega: en,
      enderecoForaDaArea: foraDaArea,
      subtotal,
      pedidoMinimo: menu?.loja?.pedidoMinimo != null ? Number(menu.loja.pedidoMinimo) : null,
      nome,
      pagamento: pg && !trocoRuim ? pg : pg ? { ...pg, trocoPara: null, semTroco: false } : null,
      pagamentoServe: formaServe,
    });

    const visao = {
      versao: c?.versao ?? 0,
      itens: linhas.map((l) => {
        const p = produtos.get(l.produtoId);
        const pr = precos.get(l.linha);
        return {
          linha: l.linha,
          quantidade: l.quantidade,
          item: pr?.descricao ?? p?.nome ?? '(fora do cardápio)',
          observacao: l.observacao ?? null,
          precoUnitario: pr ? reais(pr.unitario) : null,
          total: pr ? reais(paraReais(paraCentavos(pr.unitario) * pr.quantidade)) : null,
          faltaEscolher: incompletas.find((x) => x.linha === l.linha)?.falta ?? [],
        };
      }),
      subtotal: reais(subtotal),
      entrega:
        tipo === 'retirada'
          ? { tipo: 'retirada', texto: 'Retirada na loja' }
          : tipo === 'entrega'
            ? {
                tipo: 'entrega',
                endereco: textoDoEndereco(en),
                taxa: reais(taxa),
                freteGratis: taxaCheia > 0 && taxa === 0,
                foraDaArea,
              }
            : null,
      nome,
      pagamento: pg
        ? {
            forma: formas.find((f) => f.forma === pg.forma)?.nome ?? pg.forma,
            troco: pg.trocoPara != null ? `troco para ${reais(pg.trocoPara)}` : pg.semTroco ? 'sem troco' : null,
          }
        : null,
      total: reais(total),
      falta,
      podeRegistrar: !falta.length && !bloqueado && linhas.length > 0,
      avisos,
      ...(falta.some((x) => x.campo === 'pagamento') ? { formasDePagamento: formas.map((f) => f.nome), soPeloLink: formasSoPeloLink(menu) } : {}),
      ...(falta.some((x) => x.campo === 'tipo') ? { tipos: abertos } : {}),
    };
    return { visao, total };
  }

  // ───────────────────────── registrar (F4) ─────────────────────────

  /**
   * Registra o pedido que o cliente confirmou no resumo: pelo MESMO caminho do cardápio online (`receberPedido`, com o
   * id do carrinho de chave de idempotência — repetir não cria outro). Manda ao cliente o RESUMO por escrito (sempre
   * texto, mesmo na conversa por áudio) e devolve o número e a situação real do pedido.
   */
  async registrar(ctx: Contexto, dto: { versao?: unknown }) {
    const menu = await this.cardapio.menu(ctx.token);
    const cli = await this.clienteDaConversa(ctx);
    const c = await this.carrinhoAberto(ctx);
    if (!c) return { ...recusa('sem_pedido', 'Não há pedido em montagem.'), pedido: await this.estado(ctx, menu, null, cli) };
    const { visao: est, total: totalDoResumo } = await this.calcular(ctx, menu, c, cli);
    if (!est.podeRegistrar) return { ...recusa('falta', 'O pedido ainda não está completo.', { falta: est.falta, avisos: est.avisos }), pedido: est };
    if (Number(dto?.versao) !== c.versao)
      return { ...recusa('versao', 'O pedido mudou depois do resumo: mostre o resumo de novo e peça a confirmação.'), pedido: est };

    // Trava o carrinho até o fim (outra mensagem do mesmo cliente espera) e confere a versão de novo, já travado.
    const falha: { msg: string | null } = { msg: null };
    const resultado = await this.db.transaction(async (tx: any) => {
      const [linha] = linhasDe(
        await tx.execute(sql`select * from robo_carrinho where id = ${c.id}::uuid and status = 'aberto' for update`),
      );
      if (!linha || Number(linha.versao) !== c.versao) return null;
      const en: any = c.entrega ?? {};
      const pg = c.pagamento as PagamentoDoCarrinho;
      const r: any = await this.cardapio.receberPedido(ctx.token, {
        clientRef: `robo-whatsapp-${c.id}`,
        cliente: est.nome ?? 'Cliente',
        // O telefone como o cadastro guarda (o do cadastro achado; senão a chave, com o nono dígito): sem isso o
        // número sem o 9 do WhatsApp criava um segundo cadastro (ERR-134/135).
        telefone: cli?.telefone ?? ctx.conversa.chave,
        // O tipo do resumo (a loja que só faz um tipo não pergunta: vem dele).
        tipo: en.tipo ?? est.entrega?.tipo,
        rua: en.tipo === 'entrega' ? en.rua : undefined,
        numero: en.tipo === 'entrega' ? en.numero : undefined,
        referencia: en.tipo === 'entrega' ? referenciaParaOPedido(en.referencia) : undefined,
        bairroId: en.tipo === 'entrega' && menu?.loja?.areaModo !== 'raio' ? (en.bairroId ?? undefined) : undefined,
        lat: en.tipo === 'entrega' && en.lat != null ? Number(en.lat) : undefined,
        lng: en.tipo === 'entrega' && en.lng != null ? Number(en.lng) : undefined,
        formaPagamento: pg.forma,
        trocoPara: pg.trocoPara ?? undefined,
        // O robô não oferece cashback nem cupom (ainda): o total gravado é o do resumo que o cliente confirmou.
        usarCashback: false,
        itens: itensDoPedido(c.itens as Linha[]),
      }).catch((e: any) => {
        // Recusa do pedido (loja fechou, item esgotou no meio): o carrinho fica aberto e o robô explica.
        if (e instanceof BadRequestException) {
          falha.msg = e.message;
          return null;
        }
        throw e;
      });
      if (!r) return null;
      await tx
        .update(roboCarrinho)
        .set({ status: 'registrado', pedidoId: r.pedidoId, atualizadoEm: new Date() })
        .where(eq(roboCarrinho.id, c.id));
      return r;
    });
    if (!resultado)
      return {
        ...(falha.msg ? recusa('nao_registrado', falha.msg) : recusa('versao', 'O pedido mudou agora: mostre o resumo de novo.')),
        pedido: await this.estado(ctx, menu, await this.carrinhoAberto(ctx), cli),
      };

    const [ped] = await this.db.select().from(pedidoExterno).where(eq(pedidoExterno.id, resultado.pedidoId));
    if ((c.entrega as any)?.tipo === 'entrega' && !(c.entrega as any)?.enderecoId) await this.guardarEndereco(ctx, ped, c.entrega as any);
    const formaNome = formasDoRobo(menu, (c.entrega as any)?.tipo ?? null).find((f) => f.forma === (c.pagamento as any)?.forma)?.nome;
    const resumo = resumoDoPedido(ped, { formaNome, tempoMin: (c.entrega as any)?.tipo === 'entrega' ? menu?.loja?.tempoEntregaMin : menu?.loja?.tempoRetiradaMin });
    // As contas são as mesmas: um total diferente do que o cliente viu é defeito a investigar (o gravado vale).
    if (paraCentavos(Number(ped?.total ?? 0)) !== paraCentavos(totalDoResumo))
      this.logger.warn(`pedido do robô ${ped?.id}: total gravado ${ped?.total} diferente do resumo ${totalDoResumo}`);
    const enviado = await this.enviarResumo(ctx, resumo.texto);
    return {
      ok: true,
      numero: ped?.displayId ?? resultado.displayId ?? null,
      situacao: resumo.situacao,
      aceito: resumo.aceito,
      resumoEnviado: enviado,
      // Se o resumo não saiu, o robô manda este texto como está.
      resumo: enviado ? null : resumo.texto,
      orientacao: enviado
        ? 'O resumo JÁ FOI ENVIADO ao cliente por escrito. Não repita o resumo: responda curto, agradecendo.'
        : 'Envie o resumo exatamente como veio.',
    };
  }

  /** O endereço novo da entrega vai para o cadastro do cliente (sem repetir rua e número que ele já tem). */
  private async guardarEndereco(ctx: Contexto, ped: any, e: any) {
    try {
      if (!ped?.clienteId) return;
      const ja = await this.db
        .select({ logradouro: clienteEndereco.logradouro, numero: clienteEndereco.numero })
        .from(clienteEndereco)
        .where(and(eq(clienteEndereco.tenantId, ctx.cfg.tenantId), eq(clienteEndereco.clienteId, ped.clienteId)));
      const chave = (r: unknown, n: unknown) => `${normalizar(r)}|${normalizar(n)}`;
      if (ja.some((x) => chave(x.logradouro, x.numero) === chave(e.rua, e.numero))) return;
      await this.db.insert(clienteEndereco).values({
        tenantId: ctx.cfg.tenantId,
        clienteId: ped.clienteId,
        logradouro: e.rua || null,
        numero: e.numero || null,
        bairro: e.bairro || null,
        bairroId: e.bairroId || null,
        referencia: referenciaParaOPedido(e.referencia) ?? null,
        lat: e.lat != null ? String(e.lat) : null,
        lng: e.lng != null ? String(e.lng) : null,
        principal: ja.length === 0,
      });
    } catch (err: any) {
      // O pedido já está gravado: o endereço que não entrou no cadastro só não aparece na próxima vez.
      this.logger.warn(`endereço do pedido ${ped?.id} não guardado no cadastro: ${err?.message ?? err}`);
    }
  }

  /** O resumo por escrito, pela via da loja (API oficial ou Evolution). Falhou: o robô manda o texto (devolvido). */
  private async enviarResumo(ctx: Contexto, texto: string): Promise<boolean> {
    try {
      if ((ctx.cfg.provedor ?? 'evolution') === 'cloud') await this.cloud.enviarTexto(ctx.cfg.tenantId, ctx.conversa.telefone, texto);
      else await this.evolution.enviar(ctx.cfg.tenantId, ctx.conversa.telefone, texto);
      return true;
    } catch (e: any) {
      this.logger.warn(`resumo do pedido não enviado ao cliente (o robô manda): ${e?.message ?? e}`);
      return false;
    }
  }
}
