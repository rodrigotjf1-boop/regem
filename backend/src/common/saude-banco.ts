import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */
// "O BANCO está de pé?" — UM lugar para a pergunta, usado pelo /ping e pelo /health.
//
// Por que existe: com o Postgres do servidor local PARADO, o /ping respondia 200 só com
// variáveis de ambiente e o /health devolvia `{status:'ok'}` fixo. Resultado: o app da loja
// mostrava "servidor online" e NUNCA oferecia o modo nuvem, e o `edge/saude-local.mjs`
// aprovava uma atualização com o banco fora.
//
// Cuidados (registro interno de erros):
//   V6  — SQL em string: aqui é só `select 1`, sem coluna/tabela nenhuma (nada a conferir
//         no banco real; roda igual na nuvem e no servidor local).
//   V11 — erro esperado SEMPRE deixa rastro local com o motivo REAL (nunca engolido em
//         silêncio): o log diz o código do pg / o texto do timeout.
//   V3  — nada de promessa perdida sem `.catch`: a consulta que perde a corrida do prazo
//         recebe um catch próprio, senão uma rejeição tardia derrubaria o processo.
//
// Escala: o /ping é chamado por TODOS os terminais a cada ~12 s. Sem cache, 20 terminais =
// ~100 `select 1`/min por loja, e na nuvem isso multiplica por loja. Por isso o resultado
// vale por JANELA_MS e as chamadas simultâneas compartilham a MESMA consulta (dedupe em voo).

const PRAZO_MS = 2_000; // prazo curto: o cliente não pode ficar pendurado esperando o banco
const JANELA_MS = 3_000; // o resultado vale por ~3 s (o ping roda a cada 12 s por dispositivo)

export type SaudeBanco = { ok: boolean; motivo?: string };

const logger = new Logger('SaudeBanco');

let cache: { em: number; r: SaudeBanco } | null = null;
let emVoo: Promise<SaudeBanco> | null = null;

// Só para os testes: zera o cache entre casos (o estado é de módulo, de propósito —
// é compartilhado entre /ping e /health justamente para não bater duas vezes no banco).
export function limparCacheSaudeBanco(): void {
  cache = null;
  emVoo = null;
}

function motivoDe(e: any): string {
  const cod = e?.code ?? e?.cause?.code;
  return `${cod ? `[${cod}] ` : ''}${e?.message ?? e}`;
}

async function consultar(db: DrizzleDB): Promise<SaudeBanco> {
  let prazo: NodeJS.Timeout | undefined;
  try {
    // `select 1`: a consulta mais barata que existe e que mesmo assim EXIGE uma conexão
    // viva — é o que separa "o processo Node está no ar" de "a loja consegue operar".
    const consulta = Promise.resolve(db.execute(sql`select 1`));
    // V3: quem perde a corrida abaixo continua pendente; sem este catch, uma rejeição
    // tardia (ECONNREFUSED chegando depois do prazo) viraria unhandledRejection.
    consulta.catch(() => undefined);
    await Promise.race([
      consulta,
      new Promise<never>((_, rej) => {
        prazo = setTimeout(() => rej(new Error(`sem resposta em ${PRAZO_MS} ms`)), PRAZO_MS);
        // Não segura o processo vivo só por causa deste temporizador.
        if (typeof prazo.unref === 'function') prazo.unref();
      }),
    ]);
    return { ok: true };
  } catch (e: any) {
    const motivo = motivoDe(e);
    // V11: rastro local com o motivo real. Aviso (não erro): banco fora é uma condição
    // esperada no servidor da loja (PC religando, Postgres subindo) — quem trata é o cliente.
    logger.warn(`banco indisponível: ${motivo}`);
    return { ok: false, motivo };
  } finally {
    if (prazo) clearTimeout(prazo);
  }
}

// Resposta do cache quando fresca; senão uma única consulta compartilhada por todos os
// chamadores simultâneos. NUNCA rejeita — banco fora é `{ ok: false }`, não exceção.
export function checarBanco(db: DrizzleDB): Promise<SaudeBanco> {
  const agora = Date.now();
  if (cache && agora - cache.em < JANELA_MS) return Promise.resolve(cache.r);
  if (emVoo) return emVoo;
  emVoo = consultar(db)
    .catch((e: any) => ({ ok: false, motivo: motivoDe(e) }) as SaudeBanco)
    .then((r) => {
      cache = { em: Date.now(), r };
      emVoo = null;
      return r;
    });
  return emVoo;
}
