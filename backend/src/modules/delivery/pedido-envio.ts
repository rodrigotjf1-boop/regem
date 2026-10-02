import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';
import type { Observacao } from '../../common/chamadas-externas';
import { trechoSeguro } from '../../common/chamadas-externas';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// REGISTRO DOS ENVIOS DO PEDIDO (mig 305) — o que o Regem mandou ao canal e ao cliente a cada
// mudança de status, se deu certo e o motivo quando não deu. Decisão do dono (02/10/2026):
// REGISTRAR E MOSTRAR, sem mudar o envio. Aqui ninguém reenvia nada, ninguém barra nada.
//
// Regras deste arquivo:
//  • gravar o registro NUNCA lança e nunca atrasa o pedido — é chamado em segundo plano;
//  • o registro é DESTA máquina (a tabela não sincroniza): a loja vê o que ela tentou;
//  • não se guarda corpo, token nem telefone — só o resultado e um motivo curto.

const log = new Logger('PedidoEnvio');

export type ResultadoEnvio = 'enviado' | 'falhou' | 'nao_enviado';

/** Devolvido pelo trecho que envia quando ele decide NÃO chamar o canal. */
export class NaoEnviado {
  constructor(
    readonly motivo: string,
    /** false = nem vale registro (ex.: a entrega é do canal, não há o que mandar). */
    readonly registrar = true,
  ) {}
}
export const SEM_CREDENCIAL = () =>
  new NaoEnviado(
    ehServidorLocal()
      ? 'este servidor (loja) não tem a credencial do canal — a integração fica na nuvem'
      : 'integração do canal inativa ou sem credencial',
  );

export interface EnvioDoPedido {
  tenantId: string;
  pedidoId: string;
  destino: string;
  acao: string;
  resultado: ResultadoEnvio;
  motivo?: string | null;
  httpStatus?: number | null;
  duracaoMs?: number | null;
}

/** Transforma o que foi observado numa tentativa de envio em resultado + motivo legível. */
export function resumirEnvio(obs: Observacao<unknown>): Pick<EnvioDoPedido, 'resultado' | 'motivo' | 'httpStatus' | 'duracaoMs'> | null {
  const duracaoMs = obs.chamadas.reduce((s, c) => s + c.ms, 0) || null;
  const ultima = obs.chamadas[obs.chamadas.length - 1];
  const httpStatus = ultima?.status ?? null;
  const doCanal = () => {
    if (!ultima) return null;
    if (ultima.erro === 'timeout') return 'o canal não respondeu a tempo';
    if (ultima.erro === 'rede') return 'falha de rede ao falar com o canal';
    const trecho = ultima.trecho ? ` — ${ultima.trecho}` : '';
    return ultima.ok ? `o canal recusou${trecho}` : `HTTP ${ultima.status}${trecho}`;
  };
  if (obs.valor instanceof NaoEnviado) {
    return obs.valor.registrar ? { resultado: 'nao_enviado', motivo: obs.valor.motivo, httpStatus: null, duracaoMs } : null;
  }
  if (obs.lancou) {
    const e = obs.erro as { message?: string } | null;
    return { resultado: 'falhou', motivo: doCanal() ?? trechoSeguro(String(e?.message ?? 'erro ao enviar')), httpStatus, duracaoMs };
  }
  if (!obs.chamadas.length) {
    // Nada saiu desta máquina. `true` sem chamada não existe; `false`/vazio = sem credencial.
    return { resultado: 'nao_enviado', motivo: SEM_CREDENCIAL().motivo, httpStatus: null, duracaoMs: null };
  }
  // Quem envia e devolve verdadeiro/falso manda no resultado (a 99Food responde HTTP 200 com
  // o erro dentro do corpo); quem não devolve nada é julgado pela última chamada.
  const ok = typeof obs.valor === 'boolean' ? obs.valor : ultima.ok;
  return ok ? { resultado: 'enviado', motivo: null, httpStatus, duracaoMs } : { resultado: 'falhou', motivo: doCanal(), httpStatus, duracaoMs };
}

let avisouSemTabela = false;

/** Grava UM registro. Nunca lança (V3): pode ser chamado com `void`. */
export async function gravarEnvio(db: DrizzleDB, e: EnvioDoPedido): Promise<void> {
  try {
    // a loja do registro é a do pedido — quem chama nem sempre a tem à mão
    await db.execute(sql`
      insert into pedido_envio (tenant_id, unidade_id, pedido_id, destino, acao, resultado, motivo, http_status, duracao_ms, servidor)
      select ${e.tenantId}, p.unidade_id, p.id, ${e.destino}, ${e.acao}, ${e.resultado},
             ${e.motivo ? String(e.motivo).slice(0, 400) : null}, ${e.httpStatus ?? null}, ${e.duracaoMs ?? null},
             ${ehServidorLocal() ? 'loja' : 'nuvem'}
        from pedido_externo p
       where p.id = ${e.pedidoId} and p.tenant_id = ${e.tenantId}`);
  } catch (err: any) {
    // Sem a tabela (migration 305 ainda não aplicada) o envio ao canal segue igual; avisa UMA vez.
    if (err?.code === '42P01') {
      if (!avisouSemTabela) {
        avisouSemTabela = true;
        log.warn('tabela pedido_envio ausente (migration 305): os envios não estão sendo registrados');
      }
      return;
    }
    log.warn(`registro do envio ${e.destino}/${e.acao} do pedido ${e.pedidoId} não gravado: ${err?.message ?? err}`);
  }
}

const rows = async (db: DrizzleDB, q: any): Promise<any[]> => {
  const r: any = await db.execute(q);
  return r.rows ?? r;
};

/** Sem a tabela (migration 305 ainda não aplicada) a leitura devolve vazio em vez de derrubar a tela. */
async function semTabela<T>(vazio: T, ler: () => Promise<T>): Promise<T> {
  try {
    return await ler();
  } catch (e: any) {
    if (e?.code === '42P01') return vazio;
    throw e;
  }
}

/** A linha do tempo dos envios de UM pedido (o mais antigo primeiro). */
export function enviosDoPedido(db: DrizzleDB, tenantId: string, pedidoId: string) {
  return semTabela([] as any[], () =>
    rows(
      db,
      sql`select id, destino, acao, resultado, motivo, http_status as "httpStatus", duracao_ms as "duracaoMs",
                 servidor, criado_em as "criadoEm"
            from pedido_envio
           where tenant_id = ${tenantId} and pedido_id = ${pedidoId}
           order by criado_em asc, id asc
           limit 200`,
    ),
  );
}

/** O que FALHOU nas últimas horas, da loja ou sem loja — para o aviso do painel. */
export function falhasDeEnvio(db: DrizzleDB, tenantId: string, unidadeId: string | null, horas = 24, limite = 30) {
  return semTabela({ horas, total: 0, pedidos: 0, itens: [] as any[] }, () => lerFalhas(db, tenantId, unidadeId, horas, limite));
}

async function lerFalhas(db: DrizzleDB, tenantId: string, unidadeId: string | null, horas: number, limite: number) {
  const desde = new Date(Date.now() - horas * 3_600_000);
  const daLoja = unidadeId ? sql`and (e.unidade_id = ${unidadeId} or e.unidade_id is null)` : sql``;
  const [conta] = await rows(
    db,
    sql`select count(*)::int as total, count(distinct e.pedido_id)::int as pedidos
          from pedido_envio e
         where e.tenant_id = ${tenantId} and e.resultado = 'falhou' and e.criado_em >= ${desde} ${daLoja}`,
  );
  const itens = await rows(
    db,
    sql`select e.id, e.pedido_id as "pedidoId", e.destino, e.acao, e.motivo, e.http_status as "httpStatus",
               e.criado_em as "criadoEm", p.numero, p.display_id as "displayId", p.canal, p.status
          from pedido_envio e
          join pedido_externo p on p.id = e.pedido_id
         where e.tenant_id = ${tenantId} and e.resultado = 'falhou' and e.criado_em >= ${desde} ${daLoja}
         order by e.criado_em desc
         limit ${Math.min(Math.max(Math.trunc(limite) || 30, 1), 100)}`,
  );
  return { horas, total: conta?.total ?? 0, pedidos: conta?.pedidos ?? 0, itens };
}

/** Apaga, em lote, os registros com mais de `dias` (o job diário chama). Devolve quantos saíram. */
export async function expurgarEnvios(db: DrizzleDB, dias = 90): Promise<number> {
  const corte = new Date(Date.now() - dias * 86_400_000);
  const r: any = await db.execute(sql`delete from pedido_envio where criado_em < ${corte}`);
  return Number(r.rowCount ?? 0);
}
