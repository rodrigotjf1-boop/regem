import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { conferirAppsLigado } from '../../common/conferir-apps';
import { precosNa99Ligado } from '../../common/precos-na-99';
import { OrzuniLeituraService } from '../orzuni/orzuni-leitura.service';
import { OrzuniFotoService } from '../orzuni/orzuni-foto.service';
import { Food99Service, type IntegFood99 } from '../integracoes/food99/food99.service';
import {
  CANAIS_CONFERIDOS,
  VEZ_DE_LER_VENCE_MIN,
  comparar,
  ehCanalConferido,
  ehTipoConferido,
  leituraDa99,
  leituraDoIfood,
  pendentes,
  precisaLer,
  precosParaUsar,
  type CanalConferido,
  type DoApp,
  type DoRegem,
  type LeituraDoApp,
  type Linha,
  type TipoConferido,
} from './conferencia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVE = /^(pdv|app|nome|regem):.{1,300}$/s;
/** Quem pode agir na conferência (o mesmo `GESTOR` das rotas de produto). */
export const QUEM_CONFERE = ['presidente', 'gerente', 'supervisao'] as const;
/** No máximo isto numa ação em massa ("Usar os preços do app"). */
const MAX_EM_MASSA = 500;

export type Ator = { id: string | null; perfil: string | null };

/** O estado da tela: lida; lendo pela 1ª vez; nunca deu para ler; sem a ligação do app; o servidor da loja sem a nuvem. */
export type EstadoDaConferencia = 'ok' | 'lendo' | 'semLeitura' | 'semLigacao' | 'semConexao';

export type RespostaDaConferencia = {
  loja: { id: string; nome: string } | null;
  canal: CanalConferido;
  /** Os dois apps desta loja: ligado (com o motivo quando não) e quantas linhas a resolver na última leitura. */
  canais: Record<CanalConferido, { ligado: boolean; motivo: string | null; pendentes: number | null }>;
  estado: EstadoDaConferencia;
  /** semLigacao: o porquê; semLeitura: a falha da leitura; semConexao: o aviso. */
  motivo: string | null;
  /** Outra tela está lendo o app agora (a lista é a leitura anterior). */
  lendoAgora: boolean;
  lidoEm: string | null;
  /** A última tentativa de leitura falhou (a lista é a leitura anterior, de `lidoEm`). */
  erro: string | null;
  erroEm: string | null;
  itens: Linha[];
  opcoes: Linha[];
};

type Loja = { id: string; nome: string };
type Disponivel = { ok: true; ig?: IntegFood99 } | { ok: false; motivo: string };
type LinhaDaLeitura = {
  lido_em: Date | string | null;
  itens: any;
  opcoes: any;
  lendo_desde: Date | string | null;
  erro: string | null;
  erro_em: Date | string | null;
};

const comoData = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
const iso = (v: unknown): string | null => comoData(v)?.toISOString() ?? null;
const numeroOuNulo = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
const brl = (n: number | null) => (n == null ? 'em branco' : `R$ ${n.toFixed(2).replace('.', ',')}`);
const DO_APP: Record<CanalConferido, string> = { ifood: 'do iFood', '99food': 'da 99' };
const AO_APP: Record<CanalConferido, string> = { ifood: 'ao iFood', '99food': 'à 99' };

/**
 * "CONFERIR COM OS APPS" (R3 F4a; mig 405; protótipo `mockups/regem-conciliacao-ifood.html`): a última leitura do iFood
 * (pelo Orzuni) e da 99 de cada loja, comparada com o Regem pelo código PDV, e as ações da linha — usar o preço do app no
 * Regem (uma ou várias), mandar o preço do Regem ao app, tirar o "Está no <app>", ignorar e desfazer.
 *
 *  • NUVEM: lê os apps (as credenciais só existem lá), guarda a leitura e age.
 *  • SERVIDOR DA LOJA: pede tudo à nuvem pela rota do token de sync (V37), com quem agiu; sem internet, a tela diz "sem
 *    conexão com a nuvem" e a ação não é feita.
 *
 * Lê o app AO ABRIR (no máximo uma leitura automática por dia) e pelo "Ler agora"; duas telas juntas fazem UMA leitura (a
 * vez de ler fica na linha da leitura, `lendo_desde`). Nasce desligada: o direito `conferir_apps` da empresa.
 */
@Injectable()
export class ConferenciaService {
  private readonly log = new Logger('Conferencia');
  /** O fetch do servidor da loja à nuvem — os testes trocam por um falso. */
  buscarNaNuvem: typeof fetch = fetch;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    @Optional() private readonly orzuni?: OrzuniLeituraService,
    @Optional() private readonly food99?: Food99Service,
    @Optional() private readonly orzuniFoto?: OrzuniFotoService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  /** O direito está ligado nesta empresa? (a aba só aparece assim) */
  ligada(tenantId: string): Promise<boolean> {
    return conferirAppsLigado(this.db, tenantId);
  }

  private async exigirLigada(tenantId: string) {
    if (!(await conferirAppsLigado(this.db, tenantId)))
      throw new ForbiddenException('"Conferir com os apps" está desligada nesta empresa — quem liga é a distribuição Regem.');
  }

  /** A loja da conferência: a escolhida (da empresa e viva) ou, sem escolha, a única da empresa (V86). */
  private async loja(tenantId: string, unidade: string | null): Promise<Loja> {
    if (unidade) {
      if (!UUID.test(unidade)) throw new BadRequestException('Loja inválida.');
      const [l] = await this.rows(sql`select id, nome from unidade where id = ${unidade} and tenant_id = ${tenantId} and deleted_at is null`);
      if (!l) throw new NotFoundException('Loja não encontrada.');
      return { id: String(l.id), nome: String(l.nome) };
    }
    const lojas = await this.rows(sql`select id, nome from unidade where tenant_id = ${tenantId} and deleted_at is null order by nome limit 2`);
    if (lojas.length === 1) return { id: String(lojas[0].id), nome: String(lojas[0].nome) };
    if (!lojas.length) throw new ConflictException('A empresa não tem loja cadastrada.');
    throw new ConflictException({
      statusCode: 409,
      code: 'ESCOLHA_A_LOJA',
      message: 'A conferência é por loja: escolha a loja no topo da tela.',
    });
  }

  /** O app pode ser conferido nesta loja? (sem chamar o app) */
  private async disponivel(tenantId: string, lojaId: string, canal: CanalConferido): Promise<Disponivel> {
    if (canal === 'ifood') {
      if (!this.orzuni) return { ok: false, motivo: 'O iFood pelo Orzuni não está ligado nesta instalação.' };
      const d = await this.orzuni.disponivel(tenantId, lojaId);
      return d.ok ? { ok: true } : { ok: false, motivo: d.motivo };
    }
    if (!(await precosNa99Ligado(this.db, tenantId)))
      return { ok: false, motivo: 'O "Preço e pausa na 99" está desligado nesta empresa — quem liga é a distribuição Regem.' };
    const ig = this.food99 ? await this.food99.integracaoDoTenant(tenantId) : null;
    // A 99 é uma por empresa; sem loja na integração, vale para todas (como a fila da 99, mig 402).
    if (!ig || (ig.unidadeId && ig.unidadeId !== lojaId))
      return { ok: false, motivo: 'Esta loja não está conectada à 99. Conecte em Delivery › Painel › ⚙️ › Integrações › 99Food.' };
    return { ok: true, ig };
  }

  // ── o lado do Regem ──────────────────────────────────────────────────────────────────────────────────────

  /** Os produtos da loja (os dela e os sem loja — V4) e as opções com código, com os preços dos dois apps. */
  private async regem(tenantId: string, lojaId: string) {
    const [produtos, opcoes] = await Promise.all([
      this.rows(sql`
        select p.id, p.nome, p.codigo, p.preco_ifood::text as preco_ifood, p.preco_99::text as preco_99,
               p.no_ifood, p.na_99, p.ativo
          from produto p
         where p.tenant_id = ${tenantId} and p.deleted_at is null
           and (p.unidade_id = ${lojaId} or p.unidade_id is null)`),
      this.rows(sql`
        select o.id, o.nome, o.codigo_pdv, o.preco_ifood::text as preco_ifood, o.preco_99::text as preco_99, o.ativo
          from opcao o
         where o.tenant_id = ${tenantId} and o.deleted_at is null and coalesce(o.codigo_pdv, '') <> ''`),
    ]);
    const lado = (canal: CanalConferido) => ({
      itens: produtos.map(
        (p): DoRegem => ({
          id: String(p.id),
          nome: String(p.nome),
          codigo: p.codigo ?? null,
          preco: numeroOuNulo(canal === 'ifood' ? p.preco_ifood : p.preco_99),
          marcado: (canal === 'ifood' ? p.no_ifood : p.na_99) === true,
          ativo: p.ativo !== false,
        }),
      ),
      opcoes: opcoes.map(
        (o): DoRegem => ({
          id: String(o.id),
          nome: String(o.nome),
          codigo: o.codigo_pdv ?? null,
          preco: numeroOuNulo(canal === 'ifood' ? o.preco_ifood : o.preco_99),
          marcado: false,
          ativo: o.ativo !== false,
        }),
      ),
    });
    return lado;
  }

  private async ignorados(tenantId: string, lojaId: string, canal: CanalConferido) {
    const r = await this.rows(sql`
      select tipo, chave from conferencia_app_ignorado
       where tenant_id = ${tenantId} and unidade_id = ${lojaId} and canal = ${canal}`);
    const porTipo: Record<TipoConferido, Set<string>> = { item: new Set(), opcao: new Set() };
    for (const x of r) if (ehTipoConferido(x.tipo)) porTipo[x.tipo].add(String(x.chave));
    return porTipo;
  }

  private async leituraGuardada(tenantId: string, lojaId: string, canal: CanalConferido): Promise<LinhaDaLeitura | null> {
    const [l] = await this.rows(sql`
      select lido_em, itens, opcoes, lendo_desde, erro, erro_em from conferencia_app_leitura
       where tenant_id = ${tenantId} and unidade_id = ${lojaId} and canal = ${canal}`);
    return (l as LinhaDaLeitura) ?? null;
  }

  /** As linhas de um app numa loja, pela leitura guardada (sem chamar o app). */
  private async linhas(
    tenantId: string,
    lojaId: string,
    canal: CanalConferido,
    guardada: LinhaDaLeitura | null,
    jaLido?: Awaited<ReturnType<ConferenciaService['regem']>>,
  ) {
    if (!guardada?.lido_em) return { itens: [] as Linha[], opcoes: [] as Linha[] };
    const [lado, ign] = await Promise.all([jaLido ?? this.regem(tenantId, lojaId), this.ignorados(tenantId, lojaId, canal)]);
    const r = lado(canal);
    const doApp = (v: any): DoApp[] => (Array.isArray(v) ? (v as DoApp[]) : []);
    return {
      itens: comparar({ canal, tipo: 'item', doApp: doApp(guardada.itens), doRegem: r.itens, ignorados: ign.item }),
      opcoes: comparar({ canal, tipo: 'opcao', doApp: doApp(guardada.opcoes), doRegem: r.opcoes, ignorados: ign.opcao }),
    };
  }

  // ── a leitura ────────────────────────────────────────────────────────────────────────────────────────────

  /** Pega a vez de ler o app nesta loja (duas telas juntas: uma só lê). */
  private async pegarAVez(tenantId: string, lojaId: string, canal: CanalConferido): Promise<boolean> {
    const r = await this.rows(sql`
      insert into conferencia_app_leitura (tenant_id, unidade_id, canal, lendo_desde)
      values (${tenantId}, ${lojaId}, ${canal}, clock_timestamp())
      on conflict (unidade_id, canal) do update set lendo_desde = clock_timestamp()
       where conferencia_app_leitura.lendo_desde is null
          or conferencia_app_leitura.lendo_desde < clock_timestamp() - make_interval(mins => ${VEZ_DE_LER_VENCE_MIN})
      returning id`);
    return r.length > 0;
  }

  /** Lê o app agora e guarda o resultado (ou a falha). Nunca rejeita: a vez é sempre devolvida. */
  private async lerEGuardar(tenantId: string, lojaId: string, canal: CanalConferido, disp: Disponivel): Promise<void> {
    let resultado: { ok: true; leitura: LeituraDoApp } | { ok: false; erro: string };
    try {
      resultado = await this.lerOApp(tenantId, lojaId, canal, disp);
    } catch (e: any) {
      this.log.error(`leitura ${canal} da loja ${lojaId}: ${e?.message ?? e}`);
      resultado = { ok: false, erro: `Não deu para ler ${canal === 'ifood' ? 'o iFood' : 'a 99'} agora. Tente de novo em instantes.` };
    }
    try {
      if (resultado.ok) {
        await this.db.execute(sql`
          update conferencia_app_leitura
             set lido_em = clock_timestamp(), itens = ${JSON.stringify(resultado.leitura.itens)}::jsonb,
                 opcoes = ${JSON.stringify(resultado.leitura.opcoes)}::jsonb, lendo_desde = null, erro = null, erro_em = null
           where tenant_id = ${tenantId} and unidade_id = ${lojaId} and canal = ${canal}`);
      } else {
        this.log.warn(`leitura ${canal} da loja ${lojaId} falhou: ${resultado.erro}`);
        await this.db.execute(sql`
          update conferencia_app_leitura set lendo_desde = null, erro = ${resultado.erro}, erro_em = clock_timestamp()
           where tenant_id = ${tenantId} and unidade_id = ${lojaId} and canal = ${canal}`);
      }
    } catch (e: any) {
      this.log.error(`guardar a leitura ${canal} da loja ${lojaId}: ${e?.message ?? e}`);
    }
  }

  private async lerOApp(
    tenantId: string,
    lojaId: string,
    canal: CanalConferido,
    disp: Disponivel,
  ): Promise<{ ok: true; leitura: LeituraDoApp } | { ok: false; erro: string }> {
    if (canal === 'ifood') {
      const r = await this.orzuni!.lerCardapio(tenantId, lojaId);
      if (!r.ok) return { ok: false, erro: r.erro };
      const leitura = leituraDoIfood(r.cardapio, r.complementos);
      return leitura ? { ok: true, leitura } : { ok: false, erro: 'O Orzuni respondeu sem o cardápio do iFood. Tente de novo em instantes.' };
    }
    const ig = disp.ok ? disp.ig : undefined;
    if (!ig || !this.food99) return { ok: false, erro: 'Esta loja não está conectada à 99.' };
    const r = await this.food99.cardapioDaLoja(ig);
    if (r.errno === 0) {
      const leitura = leituraDa99(r.data);
      return leitura ? { ok: true, leitura } : { ok: false, erro: 'A 99 respondeu sem a lista de itens. Tente de novo em instantes.' };
    }
    if (r.errno === -2)
      return { ok: false, erro: 'A loja está sem o acesso da 99 agora. Conecte de novo em Delivery › Painel › ⚙️ › Integrações › 99Food.' };
    if (r.errno === -1 || r.errno === 10000 || r.errno === 10001)
      return { ok: false, erro: 'A 99 não respondeu agora. Nada foi mudado; tente de novo em instantes.' };
    return { ok: false, erro: `A 99 recusou a leitura do cardápio (código ${r.errno}${r.errmsg ? `: ${r.errmsg}` : ''}).` };
  }

  // ── a conferência ────────────────────────────────────────────────────────────────────────────────────────

  /** A conferência de um app numa loja: lê quando é a hora (ou quando pediram) e compara. */
  async conferir(tenantId: string, unidade: string | null, canalBruto: unknown, ler: boolean): Promise<RespostaDaConferencia> {
    if (!ehCanalConferido(canalBruto)) throw new BadRequestException('Escolha o app: iFood ou 99.');
    const canal = canalBruto;
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.conferirPelaNuvem(tenantId, unidade, canal, ler);
    const loja = await this.loja(tenantId, unidade);
    return this.conferirNaLoja(tenantId, loja, canal, ler);
  }

  /** O mesmo, na NUVEM, para uma loja já conferida (a tela daqui e o servidor da loja). */
  private async conferirNaLoja(tenantId: string, loja: Loja, canal: CanalConferido, ler: boolean): Promise<RespostaDaConferencia> {
    const disps = Object.fromEntries(
      await Promise.all(CANAIS_CONFERIDOS.map(async (c) => [c, await this.disponivel(tenantId, loja.id, c)] as const)),
    ) as Record<CanalConferido, Disponivel>;
    const disp = disps[canal];
    let guardada = await this.leituraGuardada(tenantId, loja.id, canal);
    let lendoAgora = false;
    if (disp.ok) {
      const pediu = precisaLer({ pediu: ler, lidoEm: comoData(guardada?.lido_em), erroEm: comoData(guardada?.erro_em), agora: new Date() });
      if (pediu) {
        if (await this.pegarAVez(tenantId, loja.id, canal)) {
          await this.lerEGuardar(tenantId, loja.id, canal, disp);
          guardada = await this.leituraGuardada(tenantId, loja.id, canal);
        } else {
          lendoAgora = true;
        }
      }
    }
    const lado = await this.regem(tenantId, loja.id);
    const { itens, opcoes } = await this.linhas(tenantId, loja.id, canal, guardada, lado);
    // O outro app: só a contagem, pela leitura guardada (nunca lê o outro app por aqui).
    const canais = {} as RespostaDaConferencia['canais'];
    for (const c of CANAIS_CONFERIDOS) {
      const d = disps[c];
      if (!d.ok) {
        canais[c] = { ligado: false, motivo: d.motivo, pendentes: null };
        continue;
      }
      if (c === canal) {
        canais[c] = { ligado: true, motivo: null, pendentes: guardada?.lido_em ? pendentes(itens) + pendentes(opcoes) : null };
        continue;
      }
      const g = await this.leituraGuardada(tenantId, loja.id, c);
      const l = await this.linhas(tenantId, loja.id, c, g, lado);
      canais[c] = { ligado: true, motivo: null, pendentes: g?.lido_em ? pendentes(l.itens) + pendentes(l.opcoes) : null };
    }
    const lidoEm = iso(guardada?.lido_em);
    const erroEm = iso(guardada?.erro_em);
    // O erro só vale se veio depois da última leitura boa.
    const erro = guardada?.erro && (!lidoEm || (erroEm && erroEm > lidoEm)) ? String(guardada.erro) : null;
    let estado: EstadoDaConferencia = 'ok';
    let motivo: string | null = null;
    if (!disp.ok) {
      estado = 'semLigacao';
      motivo = disp.motivo;
    } else if (!lidoEm) {
      if (lendoAgora) estado = 'lendo';
      else {
        estado = 'semLeitura';
        motivo = erro ?? `Ainda não deu para ler ${canal === 'ifood' ? 'o iFood' : 'a 99'}.`;
      }
    }
    return {
      loja,
      canal,
      canais,
      estado,
      motivo,
      lendoAgora,
      lidoEm,
      erro: estado === 'semLeitura' ? null : erro,
      erroEm: estado === 'semLeitura' ? null : erro ? erroEm : null,
      itens: disp.ok ? itens : [],
      opcoes: disp.ok ? opcoes : [],
    };
  }

  // ── as ações ─────────────────────────────────────────────────────────────────────────────────────────────

  /** A loja e o app da ação, com a leitura guardada já comparada (as ações nunca leem o app). */
  private async contextoDaAcao(tenantId: string, unidade: string | null, dto: any) {
    if (!ehCanalConferido(dto?.canal)) throw new BadRequestException('Escolha o app: iFood ou 99.');
    if (!ehTipoConferido(dto?.tipo)) throw new BadRequestException('Diga se é item ou opção.');
    const canal: CanalConferido = dto.canal;
    const tipo: TipoConferido = dto.tipo;
    const loja = await this.loja(tenantId, unidade);
    const disp = await this.disponivel(tenantId, loja.id, canal);
    if (!disp.ok) throw new ConflictException(disp.motivo);
    const guardada = await this.leituraGuardada(tenantId, loja.id, canal);
    if (!guardada?.lido_em) throw new ConflictException(`Leia ${canal === 'ifood' ? 'o iFood' : 'a 99'} antes ("Ler agora").`);
    const l = await this.linhas(tenantId, loja.id, canal, guardada);
    return { canal, tipo, loja, linhas: tipo === 'item' ? l.itens : l.opcoes };
  }

  private chaveDoPedido(v: unknown): string {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!CHAVE.test(s)) throw new BadRequestException('Linha inválida.');
    return s;
  }

  /** "Ignorar": a linha sai das contagens até desfazer (por loja e por app). */
  async ignorar(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'ignorar', unidade, dto, ator);
    if (!ehCanalConferido(dto?.canal)) throw new BadRequestException('Escolha o app: iFood ou 99.');
    if (!ehTipoConferido(dto?.tipo)) throw new BadRequestException('Diga se é item ou opção.');
    const chave = this.chaveDoPedido(dto?.chave);
    const nome = typeof dto?.nome === 'string' ? dto.nome.trim().slice(0, 200) : null;
    const loja = await this.loja(tenantId, unidade);
    const feito = await this.rows(sql`
      insert into conferencia_app_ignorado (tenant_id, unidade_id, canal, tipo, chave, nome, criado_por)
      values (${tenantId}, ${loja.id}, ${dto.canal}, ${dto.tipo}, ${chave}, ${nome}, ${ator.id})
      on conflict (unidade_id, canal, tipo, chave) do nothing
      returning id`);
    if (feito.length)
      await this.auditar(tenantId, loja, ator, 'conferencia_ignorou', { canal: dto.canal, tipo: dto.tipo, chave, nome });
    return { ok: true, ignorada: true };
  }

  /** "Desfazer" o "Ignorar". */
  async desfazer(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'desfazer', unidade, dto, ator);
    if (!ehCanalConferido(dto?.canal)) throw new BadRequestException('Escolha o app: iFood ou 99.');
    if (!ehTipoConferido(dto?.tipo)) throw new BadRequestException('Diga se é item ou opção.');
    const chave = this.chaveDoPedido(dto?.chave);
    const loja = await this.loja(tenantId, unidade);
    const feito = await this.rows(sql`
      delete from conferencia_app_ignorado
       where tenant_id = ${tenantId} and unidade_id = ${loja.id} and canal = ${dto.canal} and tipo = ${dto.tipo} and chave = ${chave}
      returning nome`);
    if (feito.length)
      await this.auditar(tenantId, loja, ator, 'conferencia_desfez_ignorar', { canal: dto.canal, tipo: dto.tipo, chave, nome: feito[0].nome ?? null });
    return { ok: true, ignorada: false };
  }

  /**
   * "Usar o preço do app no Regem" — uma linha ou várias (a ação em massa do protótipo só existe nesta direção). Os preços
   * vêm da última leitura guardada (o que a tela mostrou); a comparação é refeita com o preço do Regem de agora e a gravação
   * é numa query só (operação em massa = 1 pedido, set-based), condicionada a esse preço — quem gravou no mesmo instante fica
   * de fora, com o motivo; a auditoria guarda o "de" verdadeiro. Os gatilhos da fila (migs 400, 402–404) mandam o preço ao
   * app — o mesmo valor que ele já tem, então volta "sem mudança".
   */
  async usarPrecoDoApp(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'usar-preco-do-app', unidade, dto, ator);
    const chaves: string[] = Array.isArray(dto?.chaves) ? dto.chaves.map((c: unknown) => this.chaveDoPedido(c)) : [];
    if (!chaves.length) throw new BadRequestException('Escolha ao menos uma linha.');
    if (chaves.length > MAX_EM_MASSA) throw new BadRequestException(`No máximo ${MAX_EM_MASSA} linhas de uma vez.`);
    const { canal, tipo, loja, linhas } = await this.contextoDaAcao(tenantId, unidade, dto);
    const { usar, recusas } = precosParaUsar(linhas, chaves);
    if (!usar.length) return { feitos: 0, recusas };
    const tabela = sql.raw(tipo === 'item' ? 'produto' : 'opcao');
    const coluna = sql.raw(canal === 'ifood' ? 'preco_ifood' : 'preco_99');
    const valores = sql.join(
      usar.map((u) => sql`(${u.regemId}::uuid, ${u.de == null ? null : u.de.toFixed(2)}::numeric, ${u.para.toFixed(2)}::numeric)`),
      sql`, `,
    );
    const feitos = await this.rows(sql`
      update ${tabela} t
         set ${coluna} = v.para, updated_at = now()
        from (values ${valores}) as v(id, de, para)
       where t.id = v.id and t.tenant_id = ${tenantId} and t.deleted_at is null
         and t.${coluna} is not distinct from v.de
      returning t.id`);
    const ids = new Set(feitos.map((f) => String(f.id)));
    const gravados = usar.filter((u) => ids.has(u.regemId));
    for (const u of usar)
      if (!ids.has(u.regemId)) recusas.push({ chave: u.chave, motivo: `O preço de "${u.nome}" no Regem acabou de mudar — confira de novo.` });
    if (gravados.length)
      await this.auditar(tenantId, loja, ator, 'conferencia_usou_preco_do_app', {
        canal,
        tipo,
        itens: gravados.map((u) => ({ id: u.regemId, nome: u.nome, de: u.de, para: u.para })),
      });
    return { feitos: gravados.length, recusas, gravados: gravados.map((u) => ({ chave: u.chave, regemId: u.regemId, de: u.de, para: u.para })) };
  }

  /**
   * "Mandar o preço do Regem ao app": a linha com o preço diferente e preenchido no Regem volta à fila do envio daquele app
   * (o despacho lê o valor do Regem na hora; o resultado aparece no "Último envio" do item). Nesta loja.
   */
  async mandarPrecoAoApp(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'mandar-preco-ao-app', unidade, dto, ator);
    const chave = this.chaveDoPedido(dto?.chave);
    const { canal, tipo, loja, linhas } = await this.contextoDaAcao(tenantId, unidade, dto);
    const l = linhas.find((x) => x.chave === chave);
    if (!l) throw new ConflictException('A linha não está na última leitura do app — leia de novo.');
    if (l.situacao !== 'preco' || !l.regem) throw new ConflictException(`"${l.nome}" não está com o preço diferente.`);
    if (l.regem.preco == null) throw new ConflictException(`O preço ${DO_APP[canal]} de "${l.regem.nome}" está em branco no Regem.`);
    const id = l.regem.id;
    if (canal === 'ifood') await this.db.execute(sql`select orzuni_marcar(${tenantId}::uuid, ${loja.id}::uuid, ${tipo === 'item' ? 'preco_item' : 'preco_opcao'}, ${id}::uuid)`);
    else if (tipo === 'item') await this.db.execute(sql`select food99_marcar(${tenantId}::uuid, ${loja.id}::uuid, 'preco_item', ${id}::uuid)`);
    else await this.db.execute(sql`select food99_marcar_opcao(${tenantId}::uuid, 'preco_item', ${id}::uuid)`);
    await this.auditar(tenantId, loja, ator, 'conferencia_mandou_preco_ao_app', {
      canal,
      tipo,
      id,
      nome: l.regem.nome,
      valor: l.regem.preco,
      noApp: l.precos,
    });
    return { ok: true, frase: `${brl(l.regem.preco)} vai ${AO_APP[canal]} agora — o resultado aparece no "Último envio".` };
  }

  /** "Tirar o Está no <app>": o produto marcado que o app não tem (linha "só no Regem") sai do cardápio daquele app no Regem. */
  async tirarDoApp(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'tirar-do-app', unidade, dto, ator);
    const chave = this.chaveDoPedido(dto?.chave);
    const { canal, loja, linhas } = await this.contextoDaAcao(tenantId, unidade, { ...dto, tipo: 'item' });
    const l = linhas.find((x) => x.chave === chave);
    if (!l || !l.regem || (l.situacao !== 'soRegem' && !(l.situacao === 'ignorada' && chave.startsWith('regem:'))))
      throw new ConflictException('Só o produto que está "só no Regem" sai do cardápio do app por aqui.');
    const coluna = sql.raw(canal === 'ifood' ? 'no_ifood' : 'na_99');
    const feito = await this.rows(sql`
      update produto set ${coluna} = false, updated_at = now()
       where id = ${l.regem.id} and tenant_id = ${tenantId} and deleted_at is null and ${coluna}
      returning id`);
    if (feito.length) await this.auditar(tenantId, loja, ator, 'conferencia_tirou_do_app', { canal, id: l.regem.id, nome: l.regem.nome });
    return { ok: true, mudou: feito.length > 0 };
  }

  /**
   * "Ligar a um produto" (linha "só no app") e "Corrigir o código" (linha "só no Regem": o código de um item do app) — R3
   * F4b, decisão 4: o produto passa a ter o código do item do app e COPIA o que o app tem — "Está no <app>", o preço e a
   * pausa daquele app. Nada vai ao app por isso: a transação leva a marca `regem.ligando_ao_app` e o gatilho daquele app
   * (mig 406) não enfileira. O código vale para todos os canais: o gatilho do OUTRO app segue como sempre. O código é
   * único por empresa (índice `idx_produto_codigo`): quem pegou o mesmo código no mesmo instante recebe 409 com o motivo.
   */
  async ligar(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    await this.exigirLigada(tenantId);
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'ligar', unidade, dto, ator);
    const chave = this.chaveDoPedido(dto?.chave);
    const produtoId = typeof dto?.produtoId === 'string' && UUID.test(dto.produtoId) ? dto.produtoId : null;
    if (!produtoId) throw new BadRequestException('Escolha o produto do Regem.');
    const { canal, loja, linhas } = await this.contextoDaAcao(tenantId, unidade, { ...dto, tipo: 'item' });
    const l = linhas.find((x) => x.chave === chave);
    if (!l || l.situacao !== 'soApp' || !l.pdv)
      throw new ConflictException('Só o item que está só no app (com código) se liga a um produto do Regem — leia de novo.');
    const marca = sql.raw(canal === 'ifood' ? 'no_ifood' : 'na_99');
    const coluna = sql.raw(canal === 'ifood' ? 'preco_ifood' : 'preco_99');
    // Um preço só no app vem para o Regem; sem preço (ou preços diferentes nos grupos) o do Regem fica como está.
    const precoDoApp = l.precos.length === 1 ? l.precos[0].toFixed(2) : null;
    let antes: any;
    try {
      antes = await this.db.transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('regem.ligando_ao_app', ${canal}, true)`);
        const r: any = await tx.execute(sql`
          select id, nome, codigo, ${coluna}::text as preco, ${marca} as marcado,
                 jsonb_exists(coalesce(canais_pausados, '[]'::jsonb), ${canal}) as pausado
            from produto
           where id = ${produtoId} and tenant_id = ${tenantId} and deleted_at is null
             and (unidade_id = ${loja.id} or unidade_id is null)
           for update`);
        const p = (r.rows ?? r)[0];
        if (!p) throw new NotFoundException('Produto não encontrado nesta loja.');
        await tx.execute(sql`
          update produto
             set codigo = ${l.pdv},
                 ${marca} = true,
                 ${coluna} = coalesce(${precoDoApp}::numeric, ${coluna}),
                 canais_pausados = case
                   when not ${l.pausado === true} then coalesce(canais_pausados, '[]'::jsonb) - ${canal}::text
                   when jsonb_exists(coalesce(canais_pausados, '[]'::jsonb), ${canal}) then canais_pausados
                   else coalesce(canais_pausados, '[]'::jsonb) || to_jsonb(${canal}::text) end,
                 updated_at = now()
           where id = ${produtoId}`);
        return p;
      });
    } catch (e: any) {
      if (e?.code === '23505' || e?.cause?.code === '23505')
        throw new ConflictException(`O código ${l.pdv} já é de outro produto do Regem — leia ${canal === 'ifood' ? 'o iFood' : 'a 99'} de novo.`);
      throw e;
    }
    await this.auditar(tenantId, loja, ator, 'conferencia_ligou_ao_app', {
      canal,
      id: produtoId,
      nome: antes.nome,
      item: l.nome,
      codigo: { de: antes.codigo ?? null, para: l.pdv },
      preco: { de: numeroOuNulo(antes.preco), para: precoDoApp == null ? numeroOuNulo(antes.preco) : Number(precoDoApp) },
      pausado: { de: antes.pausado === true, para: l.pausado === true },
    });
    return {
      ok: true,
      frase: `"${antes.nome}" está ligado a "${l.nome}" ${canal === 'ifood' ? 'do iFood' : 'da 99'} (código ${l.pdv}). Nada mudou ${canal === 'ifood' ? 'no iFood' : 'na 99'}.`,
    };
  }

  // ── as fotos (R3 F6) ───────────────────────────────────────────────────────────────────────────────────────

  /**
   * A foto de cada produto em cada app, pela ÚLTIMA leitura guardada (nunca lê o app por aqui): `produtoId → endereço` (ou
   * `null`, sem foto lá). Só os produtos que ligam ao item do app. Sem a conferência ligada ou sem leitura: nada (a tela
   * não mostra a situação das fotos).
   */
  async fotos(tenantId: string, unidade: string | null): Promise<{ canais: Record<CanalConferido, { lidoEm: string; porProduto: Record<string, string | null> } | null> }> {
    const vazio = { canais: { ifood: null, '99food': null } as Record<CanalConferido, null> };
    if (!(await conferirAppsLigado(this.db, tenantId))) return vazio;
    if (ehServidorLocal()) {
      const qs = new URLSearchParams(unidade ? { unidade } : {});
      const r = await this.naNuvem('GET', `/catalogo/conferencia/loja/fotos?${qs.toString()}`);
      if (r.ok && r.j?.tenantId === tenantId && r.j?.canais) return { canais: r.j.canais };
      return vazio;
    }
    let loja: Loja;
    try {
      loja = await this.loja(tenantId, unidade);
    } catch {
      return vazio;
    }
    const lado = await this.regem(tenantId, loja.id);
    const canais = {} as Record<CanalConferido, { lidoEm: string; porProduto: Record<string, string | null> } | null>;
    for (const c of CANAIS_CONFERIDOS) {
      const g = await this.leituraGuardada(tenantId, loja.id, c);
      if (!g?.lido_em) {
        canais[c] = null;
        continue;
      }
      const { itens } = await this.linhas(tenantId, loja.id, c, g, lado);
      const porProduto: Record<string, string | null> = {};
      for (const l of itens) if (l.regem && l.situacao !== 'soRegem' && l.imagem !== undefined) porProduto[l.regem.id] = l.imagem;
      canais[c] = { lidoEm: iso(g.lido_em)!, porProduto };
    }
    return { canais };
  }

  /**
   * "Mandar esta foto à 99" (R3 F6): a foto do Regem do produto vai à 99 pelo endereço público dela (`head_img` no
   * `updateItem`) — a fila da 99 (cadastro do item com `dados.foto`). Não depende da conferência ligada: pede o "Preço e
   * pausa na 99", a loja conectada à 99 e o produto na 99 com código. A foto ainda só no servidor da loja (sem o endereço
   * da nuvem) não vai: ela sobe sozinha em instantes.
   */
  async mandarFotoA99(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'foto-99', unidade, dto, ator);
    const produtoId = typeof dto?.produtoId === 'string' && UUID.test(dto.produtoId) ? dto.produtoId : null;
    if (!produtoId) throw new BadRequestException('Escolha o produto.');
    const loja = await this.loja(tenantId, unidade);
    const disp = await this.disponivel(tenantId, loja.id, '99food');
    if (!disp.ok) throw new ConflictException(disp.motivo);
    const [p] = await this.rows(sql`
      select id, nome, codigo, na_99, imagem_ref from produto
       where id = ${produtoId} and tenant_id = ${tenantId} and deleted_at is null and (unidade_id = ${loja.id} or unidade_id is null)`);
    if (!p) throw new NotFoundException('Produto não encontrado nesta loja.');
    if (!p.na_99 || !String(p.codigo ?? '').trim()) throw new ConflictException(`"${p.nome}" não está na 99 com código PDV: a foto não tem para onde ir.`);
    const url = String(p.imagem_ref ?? '').trim();
    if (!url) throw new ConflictException(`"${p.nome}" não tem foto no Regem.`);
    if (!/^https:\/\//i.test(url))
      throw new ConflictException('A foto ainda está só no servidor da loja: ela sobe para a nuvem em instantes. Mande de novo daqui a pouco.');
    await this.db.execute(sql`select food99_marcar(${tenantId}::uuid, null::uuid, 'cadastro_item', ${produtoId}::uuid, '{"foto": true}'::jsonb)`);
    await this.auditar(tenantId, loja, ator, 'mandou_foto_a_99', { canal: '99food', id: produtoId, nome: p.nome });
    return { ok: true, frase: `A foto de "${p.nome}" vai à 99 agora — o resultado aparece no "Último envio à 99".` };
  }

  /**
   * "Mandar esta foto ao iFood" (R3 F6b): a foto do Regem vai ao item do iFood pela porta do Orzuni, NA HORA (o
   * `OrzuniFotoService` confere a ligação, a permissão, o produto e a foto). O que foi chamado no Orzuni fica na auditoria
   * com o resultado — também a recusa (V37); o que nem saiu (ligação, foto que não serve) só volta com a frase.
   */
  async mandarFotoAoIfood(tenantId: string, unidade: string | null, dto: any, ator: Ator) {
    if (ehServidorLocal()) return this.agirPelaNuvem(tenantId, 'foto-ifood', unidade, dto, ator);
    const produtoId = typeof dto?.produtoId === 'string' && UUID.test(dto.produtoId) ? dto.produtoId : null;
    if (!produtoId) throw new BadRequestException('Escolha o produto.');
    const loja = await this.loja(tenantId, unidade);
    if (!this.orzuniFoto) throw new ConflictException('O iFood pelo Orzuni não está ligado nesta instalação.');
    // `imagem` (R3 F6c): a cópia quadrada que a tela recortou, só para o iFood; ausente, vai a foto do produto como está.
    const r = await this.orzuniFoto.mandar(tenantId, loja.id, produtoId, dto?.imagem);
    if (r.chamou)
      await this.auditar(tenantId, loja, ator, 'mandou_foto_ao_ifood', {
        canal: 'ifood',
        id: produtoId,
        nome: r.nome,
        resultado: r.ok ? r.resultado : 'recusado',
        enquadrada: typeof dto?.imagem === 'string' && dto.imagem.length > 0,
        ...(r.ok ? { repetido: r.repetido } : { motivo: r.motivo }),
      });
    if (r.ok) return { ok: true, frase: r.frase };
    if (r.status === 404) throw new NotFoundException(r.motivo);
    if (r.status === 503) throw new ServiceUnavailableException(r.motivo);
    throw new ConflictException(r.motivo);
  }

  private async auditar(tenantId: string, loja: Loja, ator: Ator, acao: string, detalhe: Record<string, unknown>) {
    await this.auditoria.registrar({
      tenantId,
      unidadeId: loja.id,
      atorId: ator.id,
      atorPerfil: ator.perfil,
      tipo: 'cadastro',
      acao,
      entidadeTipo: 'conferencia_app',
      entidadeId: null,
      origem: 'conferir_com_os_apps',
      detalhe: { loja: loja.nome, ...detalhe },
    });
  }

  // ── servidor da loja → nuvem ─────────────────────────────────────────────────────────────────────────────

  /** Os mesmos pedidos, vindos do servidor da loja pela rota do token de sync. Quem agiu é conferido aqui. */
  async conferirVindoDaLoja(tenantId: string, lojaDoToken: string | null, q: { canal?: unknown; unidade?: unknown; ler?: unknown }) {
    await this.exigirLigada(tenantId);
    if (!ehCanalConferido(q?.canal)) throw new BadRequestException('Escolha o app: iFood ou 99.');
    const loja = await this.loja(tenantId, this.lojaDaLoja(lojaDoToken, q?.unidade));
    return { tenantId, ...(await this.conferirNaLoja(tenantId, loja, q.canal, q?.ler === '1' || q?.ler === true)) };
  }

  /** As fotos dos apps (F6), pedidas pelo servidor da loja (só leitura). */
  async fotosVindoDaLoja(tenantId: string, lojaDoToken: string | null, unidade: unknown) {
    return { tenantId, ...(await this.fotos(tenantId, this.lojaDaLoja(lojaDoToken, unidade))) };
  }

  async agirVindoDaLoja(tenantId: string, lojaDoToken: string | null, acao: string, dto: any) {
    const ator = await this.atorDaLoja(tenantId, dto?.atorId);
    const unidade = this.lojaDaLoja(lojaDoToken, dto?.unidade);
    switch (acao) {
      case 'ignorar':
        return this.ignorar(tenantId, unidade, dto, ator);
      case 'desfazer':
        return this.desfazer(tenantId, unidade, dto, ator);
      case 'usar-preco-do-app':
        return this.usarPrecoDoApp(tenantId, unidade, dto, ator);
      case 'mandar-preco-ao-app':
        return this.mandarPrecoAoApp(tenantId, unidade, dto, ator);
      case 'tirar-do-app':
        return this.tirarDoApp(tenantId, unidade, dto, ator);
      case 'ligar':
        return this.ligar(tenantId, unidade, dto, ator);
      case 'foto-99':
        return this.mandarFotoA99(tenantId, unidade, dto, ator);
      case 'foto-ifood':
        return this.mandarFotoAoIfood(tenantId, unidade, dto, ator);
      default:
        throw new NotFoundException('Ação desconhecida.');
    }
  }

  /** A loja pedida pelo servidor da loja: a do token, quando ele tem uma (o servidor de uma loja não age em outra). */
  private lojaDaLoja(lojaDoToken: string | null, pedida: unknown): string | null {
    const p = typeof pedida === 'string' && UUID.test(pedida) ? pedida : null;
    if (lojaDoToken && p && p !== lojaDoToken) throw new ForbiddenException('O servidor desta loja não confere outra loja.');
    return lojaDoToken ?? p;
  }

  /** Quem agiu no servidor da loja: colaborador ativo da empresa e da gestão (a loja já conferiu o perfil e o "Ver valores"). */
  private async atorDaLoja(tenantId: string, atorId: unknown): Promise<Ator> {
    const id = typeof atorId === 'string' && UUID.test(atorId) ? atorId : null;
    const [quem] = id
      ? await this.rows(sql`
          select c.id, coalesce(p.nivel, f.categoria::text) as nivel
            from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
           where c.id = ${id} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`)
      : [];
    if (!quem || !(QUEM_CONFERE as readonly string[]).includes(String(quem.nivel)))
      throw new ForbiddenException('Quem confere o cardápio com os apps é a gestão.');
    return { id: String(quem.id), perfil: String(quem.nivel) };
  }

  /** GET à nuvem (servidor da loja): sem conexão, a tela diz isso e mostra a lista vazia (V37). */
  private async conferirPelaNuvem(tenantId: string, unidade: string | null, canal: CanalConferido, ler: boolean): Promise<RespostaDaConferencia> {
    const qs = new URLSearchParams({ canal, ...(unidade ? { unidade } : {}), ...(ler ? { ler: '1' } : {}) });
    const r = await this.naNuvem('GET', `/catalogo/conferencia/loja?${qs.toString()}`);
    if (r.ok && r.j?.tenantId === tenantId && Array.isArray(r.j?.itens)) {
      const { tenantId: _t, ...resto } = r.j;
      return resto as RespostaDaConferencia;
    }
    if (!r.ok && r.status && r.status >= 400 && r.status < 500) throw new HttpException(r.corpo ?? { message: r.motivo }, r.status);
    this.log.warn(`conferência sem a nuvem (${r.ok ? 'a nuvem respondeu por outra empresa ou sem a lista' : r.motivo})`);
    const vazio = { ligado: false, motivo: null, pendentes: null };
    return {
      loja: null,
      canal,
      canais: { ifood: vazio, '99food': vazio },
      estado: 'semConexao',
      motivo: 'Sem conexão com a nuvem agora. A conferência lê os apps pela nuvem; tente de novo quando a internet voltar.',
      lendoAgora: false,
      lidoEm: null,
      erro: null,
      erroEm: null,
      itens: [],
      opcoes: [],
    };
  }

  /** POST à nuvem (servidor da loja), com quem agiu. A recusa da nuvem volta como veio; sem conexão, nada foi feito. */
  private async agirPelaNuvem(tenantId: string, acao: string, unidade: string | null, dto: any, ator: Ator) {
    const r = await this.naNuvem('POST', `/catalogo/conferencia/loja/${acao}`, { ...(dto ?? {}), unidade, atorId: ator.id });
    if (r.ok) {
      if (r.j?.tenantId !== tenantId) throw new ServiceUnavailableException('A nuvem respondeu por outra empresa: a ação não foi feita.');
      const { tenantId: _t, ...resto } = r.j;
      return resto;
    }
    if (r.status && r.status >= 400 && r.status < 500) throw new HttpException(r.corpo ?? { message: r.motivo }, r.status);
    this.log.warn(`conferência: "${acao}" sem a nuvem (${r.motivo})`);
    throw new ServiceUnavailableException('Sem conexão com a nuvem agora: nada foi feito. Tente de novo quando a internet voltar.');
  }

  private async naNuvem(
    metodo: 'GET' | 'POST',
    caminho: string,
    corpo?: unknown,
  ): Promise<{ ok: true; j: any } | { ok: false; status?: number; motivo: string; corpo?: any }> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) return { ok: false, motivo: 'sem CLOUD_API/SYNC_TOKEN no servidor da loja' };
    try {
      const res = await this.buscarNaNuvem(`${nuvem}${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        // A leitura do app pode levar alguns segundos (2 chamadas ao Orzuni).
        signal: AbortSignal.timeout(metodo === 'GET' ? 30_000 : 15_000),
      });
      const j: any = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, status: res.status, motivo: String(j?.message ?? `HTTP ${res.status}`), corpo: j ?? undefined };
      return { ok: true, j };
    } catch (e: any) {
      return { ok: false, motivo: e?.cause?.code ?? e?.name ?? e?.message ?? String(e) };
    }
  }
}
