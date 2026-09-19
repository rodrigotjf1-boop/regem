import { Controller, Get, Inject } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from './db/drizzle.module';
import { checarBanco } from './common/saude-banco';

// Health-check de infraestrutura (deploy/EasyPanel, e o mesmo binário no servidor local).
// Antes devolvia `{status:'ok'}` FIXO — nem dava para saber se o banco estava de pé. Agora
// confere o banco de verdade (mesmo `select 1` com prazo curto e cache de ~3 s que o /ping
// usa — as duas rotas dividem o cache, então um health-check frequente não vira carga no
// Postgres).
// ⚠️ ESTA ROTA CONTINUA RESPONDENDO 200 mesmo com o banco fora, de propósito: ela é o
// sinal de VIDA que o EasyPanel usa para decidir se reinicia o contêiner. Uma oscilação do
// Postgres derrubaria todas as APIs em cascata — foi assim o incidente de sobrecarga de
// agosto. O estado do banco vai no corpo (`banco`, `status: degradado`), para quem
// monitora agir; quem precisa de "dá para operar?" usa o /ping, que devolve 503.
@Controller('health')
export class AppController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get()
  async check() {
    const banco = await checarBanco(this.db);
    return {
      status: banco.ok ? 'ok' : 'degradado',
      service: 'regen-api',
      banco: banco.ok,
      ts: new Date().toISOString(),
    };
  }
}
