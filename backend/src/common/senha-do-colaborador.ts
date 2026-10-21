import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SENHA DE QUEM ESTÁ LOGADO, conferida na hora — a autorização por clique do Hub DMS (Padrão DMS §3: autorizar pede a
// senha, nunca o PIN, mesmo com a sessão aberta). Vale só a do próprio colaborador, da empresa da sessão, ativo e não
// excluído (V48: tirar o acesso fecha todas as portas). Diferente da `autorizarPorSenhaDeGestor`, que aceita a senha de
// qualquer gestor presente: aqui quem confirma é quem clicou.
//
// O bcrypt roda mesmo sem a linha, contra um resumo que nunca confere: o tempo da resposta não diz se a conta existe.

let resumoQueNuncaConfere: string | null = null;
const resumoFalso = (): string => (resumoQueNuncaConfere ??= bcrypt.hashSync(randomBytes(24).toString('base64'), 10));

export async function conferirSenhaDoColaborador(db: any, tenantId: string, colaboradorId: string, senha: unknown): Promise<boolean> {
  const r: any = await db.execute(sql`
    select senha_hash from colaborador
     where id = ${colaboradorId}::uuid and tenant_id = ${tenantId}::uuid
       and deleted_at is null and status = 'ativo' and senha_hash is not null`);
  const resumo = ((r.rows ?? r)[0]?.senha_hash as string | undefined) ?? null;
  const confere = await bcrypt.compare(typeof senha === 'string' ? senha : '', resumo ?? resumoFalso());
  return resumo !== null && confere;
}
