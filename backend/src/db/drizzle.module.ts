import { Global, Module, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { rootCertificates } from 'node:tls';
import * as schema from './schema';
import { SUPABASE_CA } from './supabase-ca';
import { RLS_ENABLED, getAmbientTx } from './tenant-context';

export const DRIZZLE = Symbol('DRIZZLE');
export type DrizzleDB = NodePgDatabase<typeof schema>;

/* eslint-disable @typescript-eslint/no-explicit-any */
// Com RLS ligado, o db injetado vira um PROXY: cada acesso a método (select/insert/
// update/delete/execute/transaction/query…) é roteado para a transação ambiente do
// request (que já fixou o GUC app.tenant) quando ela existe — senão para o pool real.
// Assim NENHUM serviço precisa mudar: `this.db.select()` já roda dentro do tenant.
// Sem transação ambiente (RLS desligado, jobs, rotas públicas) → pool real, igual antes.
function comProxyDeTenant(realDb: DrizzleDB): DrizzleDB {
  return new Proxy(realDb as any, {
    get(target, prop, receiver) {
      const ativo = getAmbientTx() ?? target;
      const val = Reflect.get(ativo, prop, ativo);
      return typeof val === 'function' ? val.bind(ativo) : val;
    },
  }) as DrizzleDB;
}

type SslOpt = false | { ca?: string[]; rejectUnauthorized: boolean };

// SSL da conexão, CONDICIONAL — sem quebrar o edge (Postgres local, sem a CA da
// Supabase). Controlado por DB_SSL:
//   disable      → sem TLS (default do edge/local).
//   require      → TLS, mas NÃO verifica a cadeia (só cifra — escape hatch).
//   verify-full  → TLS + verifica a cadeia (padrão da NUVEM). Confia na CA da
//                  Supabase embutida MAIS as raízes públicas do sistema, então
//                  vale tanto para a conexão direta (self-signed da Supabase)
//                  quanto para o pooler/Supavisor (cert de CA pública).
// Sem DB_SSL, INFERE pelo host: *.supabase.co / *.pooler.supabase.com → verify-full;
// qualquer outro (localhost, IP do edge) → disable. DB_SSL_CA (PEM) troca a CA.
function resolverSsl(connStr?: string): SslOpt {
  const modo = (process.env.DB_SSL || '').toLowerCase().trim();
  let host = '';
  try {
    host = new URL(connStr ?? '').hostname.toLowerCase();
  } catch {
    /* string sem host parseável — trata como local */
  }
  const ehSupabase = /\.supabase\.(co|com)$/.test(host) || host.includes('pooler.supabase');
  const efetivo = modo || (ehSupabase ? 'verify-full' : 'disable');
  if (efetivo === 'disable') return false;
  if (efetivo === 'require') return { rejectUnauthorized: false };
  // verify-full (default): confia na CA da Supabase + raízes públicas do sistema.
  const ca = [process.env.DB_SSL_CA?.trim() || SUPABASE_CA, ...rootCertificates];
  return { ca, rejectUnauthorized: true };
}

@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DrizzleDB => {
        const connectionString = config.get<string>('DATABASE_URL');
        const ssl = resolverSsl(connectionString);
        new Logger('DrizzleModule').log(
          `Conexão Postgres — TLS: ${ssl ? (ssl.rejectUnauthorized ? 'verify-full' : 'require (sem verificação)') : 'off'}`,
        );
        const pool = new Pool({ connectionString, ...(ssl ? { ssl } : {}) });
        // RESILIÊNCIA (auditoria ago/2026): uma conexão OCIOSA do pool que recebe erro
        // emite 'error' NO POOL — e sem handler o Node faz throw e DERRUBA o processo
        // inteiro. Acontece toda vez que o Postgres reinicia (57P01 "terminating
        // connection due to administrator command" — no edge a cada install/update; na
        // nuvem quando a Supabase encerra conexões ociosas). O pg já descarta a conexão
        // morta e abre outra na próxima query; aqui só logamos para NÃO derrubar o app.
        pool.on('error', (err: any) => {
          new Logger('DrizzleModule').warn(
            `Pool Postgres: conexão ociosa caiu (${err?.code ?? err?.message ?? err}) — descartada; app segue no ar.`,
          );
        });
        const realDb = drizzle(pool, { schema });
        // RLS desligado (default): retorna o db normal — caminho idêntico ao de antes.
        return RLS_ENABLED ? comProxyDeTenant(realDb) : realDb;
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule {}
