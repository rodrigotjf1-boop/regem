import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import type { IntegracaoCtxData } from './integracao-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS CANAIS DA CENTRAL DE ATENDIMENTO pela API de integração (Liame — escopo `atendimento.canais.ler`, mig 398; pedido
// Z12 do Liame, aprovado pelo dono em 11/11/2026). O Liame liga o Direct do Instagram só para quem usa o Liame sem o
// Regem: quando a empresa conecta o Instagram ou o Messenger à Central do Regem, o Direct do Liame desliga sozinho
// naquela conta, para o cliente não receber duas respostas.
//
// "ATENDE" = a conta está CONECTADA à Central (`instagram_conta`, mig 377; `messenger_conta`, mig 386): as mensagens
// chegam ao Regem. Os ajustes de dentro (a fila, o robô) não contam: é a regra do dono — "se o usuário ativar no Regem,
// fica desativado no Liame". Desconectar apaga a linha: a conta some da resposta na hora.
//
// EMPRESA: as duas tabelas são da empresa (uma conta por empresa), então a resposta é a da empresa do token, qualquer que
// seja a loja dele. SÓ NUVEM: as tabelas não existem no servidor da loja (o controller é `@CloudOnly()`).
//
// O QUE SAI: só o id e o @ do Instagram e o id da página. NUNCA o acesso (`token_cifrado`), o nome da página, quem
// conectou, o erro, as mensagens ou os contatos. Uma consulta só, por índice (`uq_*_conta_empresa`), lida na hora.

export type CanaisAtendimento = {
  instagram: { ig_user_id: string; usuario: string | null }[];
  messenger: { pagina_id: string }[];
};

@Injectable()
export class AtendimentoIntegracaoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** `GET /integracao/atendimento/canais`: as contas do Instagram e as páginas do Facebook conectadas à Central. */
  async canais(ctx: IntegracaoCtxData): Promise<CanaisAtendimento> {
    const tenant = sql`${ctx.tenantId}::uuid`;
    const r: any = await this.db.execute(sql`
      select 'instagram' as canal, ic.ig_user_id as id, ic.usuario
        from instagram_conta ic
       where ic.tenant_id = ${tenant}
      union all
      select 'messenger' as canal, mc.pagina_id as id, null as usuario
        from messenger_conta mc
       where mc.tenant_id = ${tenant}
       order by canal, id`);
    const linhas: any[] = r?.rows ?? r ?? [];
    return {
      instagram: linhas
        .filter((l) => l.canal === 'instagram')
        .map((l) => ({ ig_user_id: String(l.id), usuario: l.usuario == null || l.usuario === '' ? null : String(l.usuario).replace(/^@/, '') })),
      messenger: linhas.filter((l) => l.canal === 'messenger').map((l) => ({ pagina_id: String(l.id) })),
    };
  }
}
