import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { DadosDoPedido, VEZES_POR_CASO, lerPedidoDeSugestao, limparSugestao, montarPedido } from './copiloto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O COPILOTO DO ATENDIMENTO (item 7 do checkpoint da Central, mig 376; protótipo, versão 5): o botão "✨ Sugerir
// resposta" do caso pede aqui uma sugestão ao modelo de IA. A sugestão só volta para a caixa de escrever; quem envia é a
// pessoa.
//  • A IA é a DA EMPRESA (mig 415, `IaEmpresaService`): a chave que o presidente cadastrou ou, enquanto a empresa não
//    tem a dela, a da distribuição (`ANTHROPIC_API_KEY`). O modelo é `COPILOTO_MODELO` (padrão Claude Haiku 5.5). Cada
//    sugestão soma no medidor de uso da empresa, com a origem da chave.
//  • Ligado por empresa (`robo_config.copiloto_ligado`, nasce desligado) E com IA para a empresa (e `COPILOTO_DESLIGADO`
//    não é 1). Só na nuvem — no servidor da loja, o botão não aparece.
//  • A tela manda as mensagens que mostra e as respostas prontas; o servidor junta o que só ele sabe de verdade (o
//    pedido, o resumo do robô, o nome da loja) e tira da conversa telefone, e-mail e documento (`copiloto.ts`).
//  • Até 20 sugestões por caso — gravação condicional: duas abas não passam do limite.
//  • Cada pedido vai à auditoria (quem, o caso, o modelo, se veio), sem o texto da conversa.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semColuna = (e: any) => e?.code === '42703' || e?.code === '42P01'; // banco sem a 376
const MODELO_PADRAO = 'claude-haiku-5-5';
const ROTULO_DO_TIPO: Record<string, string> = {
  mudanca: 'mudança no pedido',
  erro: 'problema no pedido',
  humano: 'quer falar com alguém',
  cancelamento: 'pedido de cancelamento',
  outro: 'atendimento',
  disputa: 'disputa do iFood',
  avaliacao: 'avaliação do iFood',
  cancelamento_99: 'pedido de cancelamento na 99',
  reembolso_99: 'pedido de reembolso na 99',
  chat: 'mensagem no chat',
  atendimento: 'atendimento',
};

@Injectable()
export class CopilotoService {
  private readonly logger = new Logger('Copiloto');
  private readonly ia: IaEmpresaService;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() ia?: IaEmpresaService,
  ) {
    // Sem o serviço injetado (testes que montam o copiloto à mão), a mesma porta sobre o mesmo banco.
    this.ia = ia ?? new IaEmpresaService(db);
  }

  /** A distribuição ligou o copiloto nesta nuvem com a chave DELA (a que atende quem não tem chave própria)? */
  disponivel(): boolean {
    return !ehServidorLocal() && !!String(process.env.ANTHROPIC_API_KEY ?? '').trim() && process.env.COPILOTO_DESLIGADO !== '1';
  }

  /** Há IA para o copiloto DESTA empresa (a chave dela ou a da distribuição)? */
  async disponivelPara(tenantId: string): Promise<boolean> {
    if (ehServidorLocal() || process.env.COPILOTO_DESLIGADO === '1') return false;
    return this.ia.temAcesso(tenantId);
  }

  private modelo(): string {
    return String(process.env.COPILOTO_MODELO ?? '').trim() || MODELO_PADRAO;
  }

  /** "Sugerir resposta no caso" da empresa (sem linha, ou banco sem a 376: desligado). */
  async ligado(tenantId: string): Promise<boolean> {
    try {
      const [r] = linhas(await this.db.execute(sql`select copiloto_ligado as v from robo_config where tenant_id = ${tenantId}::uuid`));
      return r?.v === true;
    } catch (e: any) {
      if (semColuna(e)) return false;
      throw e;
    }
  }

  /** O que a tela precisa para mostrar (ou não) o botão. */
  async estado(tenantId: string): Promise<{ ligado: boolean; disponivel: boolean }> {
    return { ligado: await this.ligado(tenantId), disponivel: await this.disponivelPara(tenantId) };
  }

  /** Grava SÓ a coluna dele (V82); a mudança vai à auditoria. */
  async salvar(user: AuthUser, ligado: boolean): Promise<void> {
    const antes = await this.ligado(user.tenantId);
    if (antes === ligado) return;
    await this.db.execute(sql`
      insert into robo_config (tenant_id, copiloto_ligado, atualizado_por)
      values (${user.tenantId}::uuid, ${ligado}, ${user.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set copiloto_ligado = excluded.copiloto_ligado, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: ligado ? 'copiloto_ligado' : 'copiloto_desligado',
      entidadeTipo: 'robo_config',
      entidadeId: user.tenantId,
      detalhe: {},
    });
  }

  /** Uma sugestão de resposta para o caso (vai para a caixa de escrever da tela). */
  async sugerir(user: AuthUser, chamadoId: string, dto: unknown): Promise<{ texto: string; restantes: number }> {
    const daTela = lerPedidoDeSugestao(dto);
    if (!(await this.disponivelPara(user.tenantId))) throw new ServiceUnavailableException('O copiloto não está disponível agora.');
    if (!(await this.ligado(user.tenantId)))
      throw new ForbiddenException('O copiloto está desligado nesta empresa. Ligue em Delivery › Configurações › Atendimento, grupo "Copiloto".');
    const [c] = linhas(
      await this.db.execute(sql`
        select id, unidade_id as "unidadeId", tipo, canal, cliente, pedido_id as "pedidoId", detalhe
          from atendimento_chamado where tenant_id = ${user.tenantId}::uuid and id = ${chamadoId}::uuid`),
    );
    // O caso da loja de quem pede, ou sem loja (V4); presidente vê todas.
    if (!c || (user.categoria !== 'presidente' && user.unidadeId && c.unidadeId && c.unidadeId !== user.unidadeId))
      throw new NotFoundException('Caso não encontrado.');
    // A vez: até 20 por caso, com condição (duas abas ao mesmo tempo não passam do limite).
    const [vez] = linhas(
      await this.db.execute(sql`
        update atendimento_chamado
           set detalhe = coalesce(detalhe, '{}'::jsonb) || jsonb_build_object('copiloto', jsonb_build_object(
                 'vezes', coalesce((detalhe -> 'copiloto' ->> 'vezes')::int, 0) + 1, 'ultimaEm', now()))
         where tenant_id = ${user.tenantId}::uuid and id = ${chamadoId}::uuid
           and coalesce((detalhe -> 'copiloto' ->> 'vezes')::int, 0) < ${VEZES_POR_CASO}
        returning (detalhe -> 'copiloto' ->> 'vezes')::int as vezes`),
    );
    if (!vez) throw new BadRequestException(`Este caso já pediu ${VEZES_POR_CASO} sugestões. Escreva a resposta.`);

    const [loja] = linhas(
      await this.db.execute(sql`
        select coalesce(nullif(trim(cc.nome_publico), ''), e.nome) as nome
          from empresa e left join cardapio_config cc on cc.tenant_id = e.id
         where e.id = ${user.tenantId}::uuid
         order by cc.unidade_id nulls first limit 1`),
    );
    const { system, conteudo } = montarPedido({
      loja: String(loja?.nome ?? 'loja'),
      canal: c.canal,
      tipoDoCaso: ROTULO_DO_TIPO[c.tipo] ?? 'atendimento',
      cliente: c.cliente,
      resumo: c.detalhe?.robo ?? null,
      pedido: await this.pedido(user.tenantId, c.pedidoId),
      mensagens: daTela.mensagens,
      prontas: daTela.prontas,
    });
    const bruto = await this.chamarModelo(system, conteudo, user.tenantId);
    const texto = limparSugestao(bruto, c.canal);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: c.unidadeId ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'atendimento',
      acao: 'pediu_sugestao_copiloto',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: chamadoId,
      detalhe: { modelo: this.modelo(), veio: !!texto, vez: Number(vez.vezes) },
    });
    if (!texto) throw new BadGatewayException('O copiloto não trouxe uma sugestão que dê para usar. Tente de novo ou escreva a resposta.');
    return { texto, restantes: Math.max(0, VEZES_POR_CASO - Number(vez.vezes)) };
  }

  /** O pedido do caso, só o que a sugestão usa (sem telefone, endereço nem pagamento). */
  private async pedido(tenantId: string, pedidoId: string | null): Promise<DadosDoPedido> {
    if (!pedidoId) return null;
    const [p] = linhas(
      await this.db.execute(sql`
        select coalesce(display_id, numero::text) as numero, status, tipo, itens, criado_em as "criadoEm",
               despachado_em as "despachadoEm", entregador_nome as entregador
          from pedido_externo where tenant_id = ${tenantId}::uuid and id = ${pedidoId}::uuid`),
    );
    if (!p) return null;
    const itens = (Array.isArray(p.itens) ? p.itens : [])
      .map((i: any) => ({ nome: String(i?.nome ?? i?.name ?? '').trim(), quantidade: Number(i?.quantidade ?? i?.qtd ?? i?.quantity ?? 1) || 1 }))
      .filter((i: any) => i.nome);
    return { numero: p.numero ?? null, status: p.status ?? null, tipo: p.tipo ?? null, itens, criadoEm: p.criadoEm, despachadoEm: p.despachadoEm, entregador: p.entregador ?? null };
  }

  /**
   * A chamada ao modelo (à parte: o teste a troca). Recusa, cota ou chave errada viram uma mensagem para a tela; o
   * detalhe fica no log (V11), nunca a conversa.
   */
  protected async chamarModelo(system: string, conteudo: string, tenantId: string): Promise<string> {
    try {
      const r = await this.ia.pedir(tenantId, {
        recurso: 'copiloto',
        modelo: this.modelo(),
        maxTokens: 400,
        system,
        messages: [{ role: 'user', content: conteudo }],
      });
      return r.recusou ? '' : r.texto;
    } catch (e: any) {
      if (e instanceof FalhaDaIa) {
        if (e.motivo === 'limite_por_minuto') throw new ServiceUnavailableException('O copiloto está ocupado agora. Tente de novo em instantes.');
        // Sem chave, chave recusada, sem crédito ou teto atingido: não adianta tentar de novo agora (o motivo já foi ao
        // log pela porta da IA, e a situação da chave da empresa aparece para o presidente).
        if (e.motivo === 'sem_chave' || e.motivo === 'chave_recusada' || e.motivo === 'sem_credito' || e.motivo === 'teto_atingido')
          throw new ServiceUnavailableException('O copiloto não está disponível agora.');
      } else this.logger.warn(`o modelo não respondeu: ${String(e?.message ?? e).slice(0, 200)}`);
      throw new BadGatewayException('O copiloto não respondeu agora. Tente de novo.');
    }
  }
}
