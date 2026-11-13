import { ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MisterNumeroService } from './mister-numero.service';
import { CODIGO_VALE_MIN, NIVEIS_DO_MISTER, linkDoCodigo, mensagemDoCodigo, novoCodigo } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O VÍNCULO do telefone com a pessoa (mig 417) — o lado de DENTRO do Regem.
//  • Só a própria pessoa liga o próprio número: o código sai aqui, para quem está logado, e a ligação acontece quando a
//    mensagem com o código chega ao número do Mister (`mister-entrada.service.ts`). Ninguém digita telefone de ninguém.
//  • O código é único na nuvem inteira (índice sem a empresa): é ele que diz, na mensagem que chega, de qual empresa e
//    de qual pessoa é o telefone. Vale 10 minutos e uma vez.
//  • Quem pode: gerente ou presidente, ativo — conferido no banco a cada uso, não no que o token dizia ao entrar.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const TENTATIVAS_DE_CODIGO = 5;

/** As condições de "esta pessoa ainda pode falar com o Mister", sobre `c` (colaborador), `f`, `p` e `emp`. */
export const pessoaVale = () => sql`
  c.deleted_at is null and c.status = 'ativo' and emp.deleted_at is null
  and coalesce(p.nivel, f.categoria::text) in (${sql.join(NIVEIS_DO_MISTER.map((n) => sql`${n}`), sql`, `)})`;

export interface MeuWhatsapp {
  /** O número do Mister está conectado e a distribuição liberou: dá para ligar e ser atendido. */
  disponivel: boolean;
  /** O número do Mister (só dígitos), para salvar nos contatos. */
  numeroDoMister: string | null;
  ligado: boolean;
  final: string | null;
  ligadoEm: string | null;
  pausado: boolean;
  /** O código que ainda vale, se a pessoa gerou um e ainda não usou. */
  codigo: { codigo: string; mensagem: string; link: string | null; expiraEm: string } | null;
}

@Injectable()
export class MisterVinculoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async podeFalar(user: AuthUser): Promise<boolean> {
    const r = linhas(
      await this.db.execute(sql`
        select 1
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = c.tenant_id
         where c.id = ${user.colaboradorId}::uuid and c.tenant_id = ${user.tenantId}::uuid and ${pessoaVale()}`),
    );
    return r.length > 0;
  }

  /** A situação do WhatsApp de quem está logado. */
  async meu(user: AuthUser): Promise<MeuWhatsapp> {
    const n = await this.numero.ler();
    const [v] = linhas(
      await this.db.execute(sql`
        select telefone, pausado_em is not null as pausado, codigo, (codigo_expira_em > now()) as "codigoVale",
               to_char(ligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "ligadoEm",
               to_char(codigo_expira_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "expiraEm"
          from mister_vinculo
         where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${user.colaboradorId}::uuid`),
    );
    const ligado = !!(v?.telefone && v?.ligadoEm);
    const numeroDoMister = n.situacao !== 'sem' ? n.numero : null;
    return {
      disponivel: n.situacao === 'conectado' && n.ligado,
      numeroDoMister,
      ligado,
      final: ligado ? String(v.telefone).slice(-4) : null,
      ligadoEm: ligado ? v.ligadoEm : null,
      pausado: ligado && v.pausado === true,
      codigo:
        v?.codigo && v.codigoVale === true
          ? { codigo: v.codigo, mensagem: mensagemDoCodigo(v.codigo), link: numeroDoMister ? linkDoCodigo(numeroDoMister, v.codigo) : null, expiraEm: v.expiraEm }
          : null,
    };
  }

  /**
   * Gera o código de ligar para quem está logado. O código anterior da pessoa deixa de valer. Quem já está ligado
   * continua ligado até a mensagem com o código novo chegar (é como se troca de celular).
   */
  async gerarCodigo(user: AuthUser): Promise<MeuWhatsapp> {
    if (!(await this.podeFalar(user))) throw new ForbiddenException('Só gerente ou presidente liga o WhatsApp ao Mister.');
    const n = await this.numero.ler();
    if (n.situacao !== 'conectado' || !n.numero || !n.ligado) throw new ConflictException('O Mister ainda não está disponível pelo WhatsApp. Fale com a Regem.');
    for (let i = 0; ; i++) {
      try {
        await this.db.execute(sql`
          insert into mister_vinculo (tenant_id, colaborador_id, codigo, codigo_expira_em)
          values (${user.tenantId}::uuid, ${user.colaboradorId}::uuid, ${novoCodigo()}, now() + make_interval(mins => ${CODIGO_VALE_MIN}))
          on conflict (tenant_id, colaborador_id) do update
            set codigo = excluded.codigo, codigo_expira_em = excluded.codigo_expira_em, atualizado_em = now()`);
        break;
      } catch (e: any) {
        // O mesmo código está aberto para outra pessoa (em qualquer empresa): sorteia outro.
        if (e?.code !== '23505' || i + 1 >= TENTATIVAS_DE_CODIGO) throw e;
      }
    }
    await this.auditar(user, 'mister_whatsapp_codigo', {});
    return this.meu(user);
  }

  /** Desliga o WhatsApp de quem está logado. */
  async desligar(user: AuthUser): Promise<MeuWhatsapp> {
    const r = linhas(
      await this.db.execute(sql`
        update mister_vinculo
           set telefone = null, ligado_em = null, pausado_em = null, codigo = null, codigo_expira_em = null, atualizado_em = now()
         where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${user.colaboradorId}::uuid and (telefone is not null or codigo is not null)
        returning id`),
    );
    if (r.length) await this.auditar(user, 'mister_whatsapp_desligado', {});
    return this.meu(user);
  }

  private async auditar(user: AuthUser, acao: string, detalhe: Record<string, unknown>): Promise<void> {
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao,
      entidadeTipo: 'mister_vinculo',
      entidadeId: user.colaboradorId,
      detalhe,
    });
  }
}
