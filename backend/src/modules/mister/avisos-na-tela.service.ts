import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { Destino, NOME_DO_DESTINO, TIPOS_DE_AVISO } from './mister-avisos.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AVISOS NA TELA DA LOJA (F1.4, protótipo `mockups/regem-avisos-na-tela.html` aprovado em 14/11/2026). A faixa
// abaixo do topo do app e a gaveta "Avisos da loja", para TODOS que estão logados na loja (o caixa, a cozinha, o
// gerente). Mostra os avisos ABERTOS com o destino "Tela do Regem na loja" (`mister_aviso`, mig 419, só da nuvem).
//
//  • Roda nos DOIS lados. Na nuvem lê a tabela. No servidor da loja a tabela não existe: ele PEDE À NUVEM com o token do
//    sincronismo (V37: nunca um "vazio" calado), com cache curto por loja; sem internet, devolve `semConexao` e a tela
//    não inventa nada.
//  • "Ciente" é POR PESSOA e fica no servidor (`dados.cientes`, os colaboradores): tira a faixa só de quem clicou; o aviso
//    continua no ⚠️ do topo e na gaveta até se resolver. Se ele escalar, a rotina limpa os "ciente" e a faixa volta para
//    todos (`MisterAvisosService.marcarEscala`).
//  • Nada de cliente, conversa ou valor: o título e o "o que fazer" que a rotina já escreveu.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quantos avisos abertos a tela recebe (os mais recentes; mais que isto é sinal de outro problema). */
export const AVISOS_NA_TELA_MAX = 20;
/** O cache do servidor da loja: muitas telas abertas na loja fazem UMA leitura na nuvem a cada tanto. */
const CACHE_MS = 15_000;
const CACHE_FALHA_MS = 30_000;

/** Um aviso como a nuvem guarda (para o servidor da loja e para a tela). */
export interface AvisoAbertoDaLoja {
  id: string;
  tipo: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: string;
  escaladoEm: string | null;
  unidadeId: string | null;
  cientes: string[];
  /** Os outros destinos que receberam (KDS, WhatsApp do gerente…), pelo nome que a tela mostra. */
  tambem: string[];
}

/** O aviso como a tela recebe: sem a lista de quem deu ciente — só se ESTA pessoa deu. */
export interface AvisoNaTela {
  id: string;
  grupo: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: string;
  escalado: boolean;
  tambem: string[];
  ciente: boolean;
}

export interface AvisosDaLoja {
  avisos: AvisoNaTela[];
  /** Servidor da loja sem conseguir falar com a nuvem: a tela não mostra nada (e não diz "nenhum aviso"). */
  semConexao?: boolean;
}

const GRUPO_DO_TIPO = new Map(TIPOS_DE_AVISO.map((t) => [t.tipo as string, t.grupo as string]));

/** O aviso para a tela de UMA pessoa. Pura: o mesmo cálculo nos dois lados. */
export function avisoParaATela(a: AvisoAbertoDaLoja, colaboradorId: string): AvisoNaTela {
  return {
    id: a.id,
    grupo: GRUPO_DO_TIPO.get(a.tipo) ?? 'Na loja',
    titulo: a.titulo,
    detalhe: a.detalhe,
    abertoEm: a.abertoEm,
    escalado: !!a.escaladoEm,
    tambem: a.tambem,
    ciente: a.cientes.includes(colaboradorId),
  };
}

/** Os outros destinos que receberam o aviso (o que a gaveta diz: "também foi para…"). */
export function outrosDestinos(entregas: unknown): string[] {
  const vistos = new Set<string>();
  for (const e of Array.isArray(entregas) ? entregas : []) {
    const d = String((e as any)?.destino ?? '') as Destino;
    if ((e as any)?.ok === true && d !== 'tela' && NOME_DO_DESTINO[d]) vistos.add(NOME_DO_DESTINO[d]);
  }
  return [...vistos];
}

/**
 * Rodada 7, MIS-I-02 (ERR-661): no servidor da loja, a nuvem manda os avisos do TOKEN (o servidor antigo sem loja recebe os da
 * empresa inteira); a tela mostra só os da loja da SESSÃO e os da rede — como a régua da nuvem (`sqlUnidadeOuRede`). Sessão sem
 * loja definida (`null`, o presidente em "todas") vê tudo; a sem loja nenhuma (NIL) só os da rede.
 */
export function daLojaDaSessao(a: { unidadeId: string | null }, unidadeDaSessao: string | null): boolean {
  return !unidadeDaSessao || !a.unidadeId || a.unidadeId === unidadeDaSessao;
}

/** Os avisos abertos da loja com o destino "tela" (só na nuvem: a tabela é de lá). */
export async function lerAvisosAbertosDaLoja(db: any, tenantId: string, unidadeId: string | null): Promise<AvisoAbertoDaLoja[]> {
  const iso = (c: string) => sql.raw(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
  const lidos = linhas(
    await db.execute(sql`
      select a.id::text as id, a.tipo, a.titulo, a.detalhe, ${iso('a.aberto_em')} as "abertoEm", ${iso('a.escalado_em')} as "escaladoEm",
             a.unidade_id::text as "unidadeId", coalesce(a.dados -> 'cientes', '[]'::jsonb) as cientes, a.entregas
        from mister_aviso a
       where a.tenant_id = ${tenantId}::uuid and a.situacao = 'aberto'
         and a.entregas @> '[{"destino":"tela"}]'::jsonb
         -- Rodada 7, MIS-I-08 (ERR-661): o boleto e o ponto não vão à tela (qualquer perfil logado vê a tela da loja).
         and a.tipo not in ('boleto_vencendo', 'ponto_esquecido', 'ponto_do_mes')
         ${sqlUnidadeOuRede('a.unidade_id', unidadeId)}
       order by coalesce(a.escalado_em, a.aberto_em) desc
       limit ${AVISOS_NA_TELA_MAX}`),
  );
  return lidos.map((l) => ({
    id: l.id,
    tipo: String(l.tipo),
    titulo: String(l.titulo),
    detalhe: l.detalhe ? String(l.detalhe) : null,
    abertoEm: String(l.abertoEm),
    escaladoEm: l.escaladoEm ? String(l.escaladoEm) : null,
    unidadeId: l.unidadeId ?? null,
    cientes: (Array.isArray(l.cientes) ? l.cientes : []).map(String),
    tambem: outrosDestinos(l.entregas),
  }));
}

/**
 * "Ciente" de uma pessoa num aviso aberto desta loja (só na nuvem). A gravação acrescenta a pessoa só se ela ainda não
 * está na lista — duas pessoas ao mesmo tempo, as duas entram (o UPDATE trava a linha). Devolve se o aviso existe aqui.
 */
export async function marcarCiente(db: any, tenantId: string, unidadeId: string | null, colaboradorId: string, avisoId: string): Promise<boolean> {
  const onde = sql`a.id = ${avisoId}::uuid and a.tenant_id = ${tenantId}::uuid and a.situacao = 'aberto'
    and a.entregas @> '[{"destino":"tela"}]'::jsonb ${sqlUnidadeOuRede('a.unidade_id', unidadeId)}`;
  const feito = linhas(
    await db.execute(sql`
      update mister_aviso a
         set dados = jsonb_set(coalesce(a.dados, '{}'::jsonb), '{cientes}', coalesce(a.dados -> 'cientes', '[]'::jsonb) || jsonb_build_array(${colaboradorId}::text))
       where ${onde} and not (coalesce(a.dados -> 'cientes', '[]'::jsonb) ? ${colaboradorId}::text)
       returning a.id`),
  );
  if (feito.length) return true;
  // Já tinha dado ciente (toque duplo, duas telas): vale como feito.
  return linhas(await db.execute(sql`select 1 from mister_aviso a where ${onde}`)).length > 0;
}

@Injectable()
export class AvisosNaTelaService {
  private readonly logger = new Logger('AvisosNaTela');
  /** O cache do servidor da loja, por empresa e loja. Só leitura de aviso: nada de dado de pessoa nele além dos ids. */
  private readonly cache = new Map<string, { ate: number; dados: Promise<AvisoAbertoDaLoja[] | null> }>();

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Os avisos abertos da loja para a tela de quem pediu. */
  async daLoja(tenantId: string, unidadeId: string | null, colaboradorId: string): Promise<AvisosDaLoja> {
    if (!ehServidorLocal()) {
      const lidos = await this.lerNaNuvemSemTabela(() => lerAvisosAbertosDaLoja(this.db, tenantId, unidadeId));
      return { avisos: lidos.map((a) => avisoParaATela(a, colaboradorId)) };
    }
    const lidos = await this.daNuvemComCache(tenantId, unidadeId);
    if (!lidos) return { avisos: [], semConexao: true };
    return { avisos: lidos.filter((a) => daLojaDaSessao(a, unidadeId)).map((a) => avisoParaATela(a, colaboradorId)) };
  }

  /** "Ciente" de quem está logado. */
  async ciente(tenantId: string, unidadeId: string | null, colaboradorId: string, avisoId: string): Promise<{ ok: true }> {
    if (!UUID.test(String(avisoId ?? ''))) throw new BadRequestException('Aviso inválido.');
    if (!ehServidorLocal()) {
      if (!(await marcarCiente(this.db, tenantId, unidadeId, colaboradorId, avisoId))) throw new NotFoundException('Esse aviso não está mais aberto nesta loja.');
      return { ok: true };
    }
    // MIS-I-02 (ERR-661): no servidor da loja, só o aviso que a SESSÃO vê (a loja dela ou da rede) recebe o "Ciente".
    const daSessao = await this.daNuvemComCache(tenantId, unidadeId);
    if (daSessao && !daSessao.some((a) => a.id === avisoId && daLojaDaSessao(a, unidadeId))) throw new NotFoundException('Esse aviso não está mais aberto nesta loja.');
    const r = await this.naNuvem(`/mister/avisos/${avisoId}/ciente/loja`, { method: 'POST', body: JSON.stringify({ colaboradorId }) });
    this.cache.delete(`${tenantId}|${unidadeId ?? ''}`);
    if ('motivo' in r) {
      if (r.status === 404) throw new NotFoundException('Esse aviso não está mais aberto nesta loja.');
      throw new BadRequestException('Sem conexão com a nuvem agora: tente o "Ciente" de novo daqui a pouco.');
    }
    return { ok: true };
  }

  // ───────────────────────────── o servidor da loja pedindo à nuvem ─────────────────────────────

  /** A rota da nuvem que o servidor da loja chama (token do sincronismo): os avisos COM a lista de quem deu ciente. */
  async paraOServidorDaLoja(tenantId: string, unidadeId: string | null): Promise<{ tenantId: string; avisos: AvisoAbertoDaLoja[] }> {
    return { tenantId, avisos: await this.lerNaNuvemSemTabela(() => lerAvisosAbertosDaLoja(this.db, tenantId, unidadeId)) };
  }

  /**
   * O "Ciente" que chega do servidor da loja: a pessoa tem de ser desta empresa e, se o servidor é de uma loja, desta loja
   * (ou sem loja fixa, como o presidente) — a mesma régua do login (`colaborador.unidade_id`, senão a do setor da função).
   */
  async cienteDoServidorDaLoja(tenantId: string, unidadeId: string | null, avisoId: string, colaboradorId: unknown): Promise<{ ok: true }> {
    const colab = String(colaboradorId ?? '');
    if (!UUID.test(String(avisoId ?? '')) || !UUID.test(colab)) throw new BadRequestException('Aviso ou pessoa inválida.');
    const [pessoa] = linhas(
      await this.db.execute(sql`
        select coalesce(c.unidade_id, s.unidade_id)::text as loja
          from colaborador c left join funcao f on f.id = c.funcao_id left join setor s on s.id = f.setor_id
         where c.id = ${colab}::uuid and c.tenant_id = ${tenantId}::uuid and c.deleted_at is null`),
    );
    if (!pessoa) throw new BadRequestException('Essa pessoa não é desta empresa.');
    // Rodada 7, MIS-I-13 (ERR-661): o servidor de uma loja não dá "Ciente" em nome de quem é de outra loja.
    if (unidadeId && pessoa.loja && pessoa.loja !== unidadeId) throw new BadRequestException('Essa pessoa não é desta loja.');
    if (!(await marcarCiente(this.db, tenantId, unidadeId, colab, avisoId))) throw new NotFoundException('Esse aviso não está mais aberto nesta loja.');
    return { ok: true };
  }

  /** Banco sem a 419 (o de uma loja que chama a rota da nuvem por engano, ou o CI): nenhum aviso. */
  private async lerNaNuvemSemTabela(ler: () => Promise<AvisoAbertoDaLoja[]>): Promise<AvisoAbertoDaLoja[]> {
    try {
      return await ler();
    } catch (e: any) {
      if (e?.code === '42P01') return [];
      throw e;
    }
  }

  private daNuvemComCache(tenantId: string, unidadeId: string | null): Promise<AvisoAbertoDaLoja[] | null> {
    const chave = `${tenantId}|${unidadeId ?? ''}`;
    const agora = Date.now();
    const c = this.cache.get(chave);
    if (c && c.ate > agora) return c.dados;
    const dados = this.naNuvem('/mister/avisos/loja').then((r) => {
      if ('j' in r && r.j?.tenantId === tenantId && Array.isArray(r.j?.avisos)) return r.j.avisos as AvisoAbertoDaLoja[];
      this.logger.warn(`avisos da loja sem a nuvem (${'motivo' in r ? r.motivo : 'a nuvem respondeu por outra empresa ou sem a lista'}) — a tela não mostra a faixa.`);
      return null;
    });
    const item = { ate: agora + CACHE_MS, dados };
    this.cache.set(chave, item);
    dados.then((d) => {
      if (!d) item.ate = Date.now() + CACHE_FALHA_MS;
    });
    return dados;
  }

  /** A chamada à nuvem com o token do sincronismo. Nunca rejeita: a falha vira o motivo (loja sem internet é esperado). */
  protected async naNuvem(caminho: string, init: { method?: string; body?: string } = {}): Promise<{ j: any } | { motivo: string; status?: number }> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) return { motivo: 'sem CLOUD_API/SYNC_TOKEN no servidor da loja' };
    try {
      const res = await fetch(`${nuvem}${caminho}`, {
        method: init.method ?? 'GET',
        headers: { 'x-sync-token': token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        body: init.body,
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { motivo: `HTTP ${res.status}`, status: res.status };
      return { j: await res.json() };
    } catch (e: any) {
      return { motivo: e?.cause?.code ?? e?.name ?? e?.message ?? String(e) };
    }
  }
}
