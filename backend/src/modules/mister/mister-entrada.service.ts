import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloService } from '../modulo/modulo.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { pessoaVale } from './mister-vinculo.service';
import {
  AINDA_NAO_RESPONDO_A_CADA_MIN,
  CODIGOS_ERRADOS_JANELA_MIN,
  CODIGOS_ERRADOS_MAX,
  CODIGO_VALE_MIN,
  PENDENTE_VALE_MIN,
  RESPOSTA_FIXA_A_CADA_H,
  Resposta,
  TEXTOS,
  codigoNaMensagem,
  ehPararAvisos,
  ehTrocarDeEmpresa,
  ehVoltarAvisos,
  empresaEscolhida,
  pareceCodigo,
  perguntaDaEmpresa,
  primeiroNome,
  soDigitos,
} from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTRADA DO MISTER (mig 417): o que acontece com a mensagem que chega ao número da distribuição.
//
// As regras de separação entre empresas (`docs/plano-mister.md`), na ordem em que o código as aplica:
//  1. O telefone só representa alguém depois de ligado por dentro do Regem, com o código. Quem só escreve recebe uma
//     resposta FIXA — sem IA e sem dado de ninguém —, no máximo uma vez a cada 12 horas.
//  2. A pessoa precisa valer AGORA: ativa, gerente ou presidente, empresa viva e com o módulo Mister ligado. Quem saiu
//     ou foi rebaixado deixa de ser reconhecido na mensagem seguinte (a conferência é a cada mensagem).
//  3. O mesmo telefone pode estar em duas empresas: o Mister pergunta de qual é o assunto e guarda a escolha. Na dúvida
//     pergunta de novo — nunca chuta.
//  4. A chave geral (o console da distribuição) desligada: a mensagem é anotada e o Mister fica calado.
//
// Nada daqui lança para quem chamou (o webhook): cada falha vira log e a conversa segue. O texto da mensagem não é
// guardado — só a que espera a escolha da empresa, por até 10 minutos.

const MODULO = 'mister';
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');
const cortar = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n));

export interface MensagemDoMister {
  telefone: string;
  texto: string;
  botaoId?: string | null;
  wamid?: string | null;
}

/** O que o Mister fez com a mensagem. Vai para `mister_mensagem.desfecho` e é o que os testes conferem. */
export type Desfecho =
  | 'repetida'
  | 'desligado'
  | 'ligou'
  | 'codigo_nao_vale'
  | 'codigos_demais'
  | 'codigo_calado'
  | 'numero_de_outra_pessoa'
  | 'sem_acesso'
  | 'fixa'
  | 'fixa_calada'
  | 'perguntou_empresa'
  | 'escolheu_empresa'
  | 'uma_empresa_so'
  | 'parou'
  | 'voltou'
  | 'ainda_nao_respondo'
  | 'calado';

interface Vinculo {
  id: string;
  tenantId: string;
  colaboradorId: string;
  unidadeId: string | null;
  nome: string;
  empresa: string;
}

@Injectable()
export class MisterEntradaService {
  private readonly logger = new Logger(MisterEntradaService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly modulos: ModuloService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** Este identificador da Meta é o número do Mister? (A loja não pode conectar o número do Mister como dela.) */
  async ehONumeroDoMister(phoneNumberId: string): Promise<boolean> {
    return !!(await this.numero.doPhoneId(phoneNumberId));
  }

  /**
   * O ponto de entrada do webhook. Devolve `true` quando o número é o do Mister — aí as mensagens são tratadas aqui e
   * NUNCA seguem para o caminho das lojas —, e `false` quando não é (o webhook segue como sempre).
   */
  async receberDaMeta(phoneNumberId: string, valor: any): Promise<boolean> {
    if (!(await this.numero.doPhoneId(phoneNumberId))) return false;
    await this.numero.anotarEntrada(phoneNumberId).catch((e) => this.logger.warn(`anotar a entrada falhou: ${e?.message ?? e}`));
    for (const m of valor?.messages ?? []) {
      const resposta = m?.interactive?.button_reply ?? m?.interactive?.list_reply;
      const entrada: MensagemDoMister = {
        telefone: soDigitos(m?.from),
        texto: String(m?.text?.body ?? m?.button?.text ?? resposta?.title ?? ''),
        botaoId: resposta?.id ? String(resposta.id) : null,
        wamid: m?.id ? String(m.id) : null,
      };
      try {
        const desfecho = await this.receber(entrada);
        this.logger.log(`mister de=${mascarar(entrada.telefone)} tipo=${m?.type} id=${m?.id} → ${desfecho}`);
      } catch (e: any) {
        this.logger.error(`mister: a mensagem ${m?.id} de ${mascarar(entrada.telefone)} não foi tratada — ${e?.message ?? e}`, e?.stack);
      }
    }
    return true;
  }

  /** Uma mensagem. Devolve o que foi feito. */
  async receber(e: MensagemDoMister): Promise<Desfecho> {
    const tel = soDigitos(e.telefone);
    if (!tel) return 'calado';
    // A Meta reenvia: a mesma mensagem só é tratada uma vez (a gravação diz se é nova).
    if (e.wamid) {
      const nova = linhas(await this.db.execute(sql`insert into mister_mensagem (wamid, telefone) values (${e.wamid}, ${tel}) on conflict (wamid) do nothing returning wamid`));
      if (!nova.length) return 'repetida';
    }
    const desfecho = await this.tratar(tel, e);
    if (e.wamid) await this.db.execute(sql`update mister_mensagem set desfecho = ${desfecho.desfecho}, tenant_id = ${desfecho.tenantId ?? null}::uuid where wamid = ${e.wamid}`);
    return desfecho.desfecho;
  }

  private async tratar(tel: string, e: MensagemDoMister): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    // A chave geral: desligada, o Mister não responde a ninguém (nem a código).
    const n = await this.numero.ler();
    if (!n.ligado) return { desfecho: 'desligado' };

    const texto = String(e.texto ?? '');
    if (codigoNaMensagem(texto) || pareceCodigo(texto)) return this.ligar(tel, codigoNaMensagem(texto));

    const vinculos = await this.vinculosDoTelefone(tel);
    if (!vinculos.length) {
      // Telefone que não está ligado: a resposta fixa, e só se a última foi há mais de 12 horas (gravação condicional).
      const vez = linhas(
        await this.db.execute(sql`
          insert into mister_conversa (telefone, fixa_em, ultima_entrada_em) values (${tel}, now(), now())
          on conflict (telefone) do update set fixa_em = now(), ultima_entrada_em = now(), atualizado_em = now()
            where mister_conversa.fixa_em is null or mister_conversa.fixa_em < now() - make_interval(hours => ${RESPOSTA_FIXA_A_CADA_H})
          returning telefone`),
      );
      if (!vez.length) return { desfecho: 'fixa_calada' };
      await this.responder(tel, { texto: TEXTOS.desconhecido });
      return { desfecho: 'fixa' };
    }

    const alvo = await this.empresaDaConversa(tel, e, vinculos);
    if ('desfecho' in alvo) return alvo;
    return this.atender(tel, alvo.vinculo, alvo.texto);
  }

  // ───────────────────────────── ligar pelo código ─────────────────────────────

  private async ligar(tel: string, codigo: string | null): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    // Muitos códigos errados: o telefone deixa de ser atendido em códigos até a janela passar (ninguém adivinha código).
    const [conv] = linhas(
      await this.db.execute(sql`
        select codigos_errados as errados,
               (codigos_desde is not null and codigos_desde > now() - make_interval(mins => ${CODIGOS_ERRADOS_JANELA_MIN})) as "naJanela"
          from mister_conversa where telefone = ${tel}`),
    );
    if (conv?.naJanela === true && Number(conv.errados) >= CODIGOS_ERRADOS_MAX) return { desfecho: 'codigo_calado' };

    const [dono] = codigo
      ? linhas(
          await this.db.execute(sql`
            select g.tenant_id as "tenantId", c.unidade_id as "unidadeId", emp.nome as empresa
              from mister_vinculo g
              join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
              join empresa emp on emp.id = g.tenant_id
             where g.codigo = ${codigo} and g.codigo_expira_em > now()`),
        )
      : [];
    if (!dono) return this.codigoErrado(tel);
    if (!(await this.modulos.ativo(dono.tenantId, dono.unidadeId ?? null, MODULO))) {
      await this.responder(tel, { texto: TEXTOS.semAcesso });
      return { desfecho: 'sem_acesso', tenantId: dono.tenantId };
    }

    // O número pode estar preso, nesta empresa, a quem não pode mais falar com o Mister: solta antes de ligar.
    await this.db.execute(sql`
      update mister_vinculo g
         set telefone = null, ligado_em = null, pausado_em = null, atualizado_em = now()
       where g.tenant_id = ${dono.tenantId}::uuid and g.telefone = ${tel}
         and not exists (
           select 1
             from colaborador c
             left join funcao f on f.id = c.funcao_id
             left join perfil_acesso p on p.id = c.perfil_acesso_id
             join empresa emp on emp.id = c.tenant_id
            where c.id = g.colaborador_id and c.tenant_id = g.tenant_id and ${pessoaVale()})`);

    let ligado: any[];
    try {
      // A gravação que liga confere TUDO de novo no mesmo comando: o código ainda vale e a pessoa ainda pode.
      ligado = linhas(
        await this.db.execute(sql`
          update mister_vinculo g
             set telefone = ${tel}, ligado_em = now(), pausado_em = null, codigo = null, codigo_expira_em = null,
                 ultima_entrada_em = now(), atualizado_em = now()
            from colaborador c
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            join empresa emp on emp.id = c.tenant_id
           where g.codigo = ${codigo} and g.codigo_expira_em > now()
             and c.id = g.colaborador_id and c.tenant_id = g.tenant_id and ${pessoaVale()}
          returning g.id, g.tenant_id as "tenantId", g.colaborador_id as "colaboradorId", c.nome, emp.nome as empresa`),
      );
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      await this.responder(tel, { texto: TEXTOS.numeroDeOutraPessoa(dono.empresa) });
      return { desfecho: 'numero_de_outra_pessoa', tenantId: dono.tenantId };
    }
    if (!ligado.length) {
      // O código existia há um instante e a gravação não ligou: a pessoa deixou de poder, ou outra mensagem usou o código.
      const [jaLigou] = linhas(
        await this.db.execute(sql`
          select 1 from mister_vinculo
           where tenant_id = ${dono.tenantId}::uuid and telefone = ${tel} and ligado_em > now() - make_interval(mins => ${CODIGO_VALE_MIN})`),
      );
      if (jaLigou) return { desfecho: 'calado', tenantId: dono.tenantId };
      await this.responder(tel, { texto: TEXTOS.semAcesso });
      return { desfecho: 'sem_acesso', tenantId: dono.tenantId };
    }

    const g = ligado[0];
    // A conversa passa a ser desta empresa, e a contagem de códigos errados zera.
    await this.db.execute(sql`
      insert into mister_conversa (telefone, tenant_id, escolhida_em, ultima_entrada_em) values (${tel}, ${g.tenantId}::uuid, now(), now())
      on conflict (telefone) do update
        set tenant_id = excluded.tenant_id, escolhida_em = now(), perguntada_em = null, pendente = null, pendente_em = null,
            codigos_errados = 0, codigos_desde = null, ultima_entrada_em = now(), atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: g.tenantId,
      atorId: g.colaboradorId,
      tipo: 'config',
      acao: 'mister_whatsapp_ligado',
      entidadeTipo: 'mister_vinculo',
      entidadeId: g.id,
      origem: 'whatsapp',
      detalhe: { final: tel.slice(-4) },
    });
    await this.responder(tel, { texto: TEXTOS.ligado(primeiroNome(g.nome), g.empresa) });
    return { desfecho: 'ligou', tenantId: g.tenantId };
  }

  private async codigoErrado(tel: string): Promise<{ desfecho: Desfecho }> {
    // Quem acabou de ligar e mandou o código de novo (toque duplo) não leva "não vale mais".
    const [jaLigou] = linhas(
      await this.db.execute(sql`select 1 from mister_vinculo where telefone = ${tel} and ligado_em > now() - make_interval(mins => ${CODIGO_VALE_MIN}) limit 1`),
    );
    if (jaLigou) return { desfecho: 'calado' };
    const [conta] = linhas(
      await this.db.execute(sql`
        insert into mister_conversa (telefone, codigos_errados, codigos_desde, ultima_entrada_em) values (${tel}, 1, now(), now())
        on conflict (telefone) do update set
          codigos_errados = case when mister_conversa.codigos_desde is null or mister_conversa.codigos_desde < now() - make_interval(mins => ${CODIGOS_ERRADOS_JANELA_MIN})
                                 then 1 else mister_conversa.codigos_errados + 1 end,
          codigos_desde = case when mister_conversa.codigos_desde is null or mister_conversa.codigos_desde < now() - make_interval(mins => ${CODIGOS_ERRADOS_JANELA_MIN})
                               then now() else mister_conversa.codigos_desde end,
          ultima_entrada_em = now(), atualizado_em = now()
        returning codigos_errados as errados`),
    );
    if (Number(conta?.errados) >= CODIGOS_ERRADOS_MAX) {
      await this.responder(tel, { texto: TEXTOS.codigosDemais });
      return { desfecho: 'codigos_demais' };
    }
    await this.responder(tel, { texto: TEXTOS.codigoNaoVale });
    return { desfecho: 'codigo_nao_vale' };
  }

  // ───────────────────────────── de qual empresa é a conversa ─────────────────────────────

  /** Os vínculos deste telefone que valem AGORA, em ordem estável (nome da empresa, depois o id). */
  private async vinculosDoTelefone(tel: string): Promise<Vinculo[]> {
    const todos = linhas(
      await this.db.execute(sql`
        select g.id, g.tenant_id as "tenantId", g.colaborador_id as "colaboradorId", c.unidade_id as "unidadeId", c.nome, emp.nome as empresa
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.telefone = ${tel} and g.ligado_em is not null and ${pessoaVale()}
         order by emp.nome, emp.id`),
    ) as Vinculo[];
    const vivos: Vinculo[] = [];
    for (const v of todos) if (await this.modulos.ativo(v.tenantId, v.unidadeId ?? null, MODULO)) vivos.push(v);
    return vivos;
  }

  private async empresaDaConversa(
    tel: string,
    e: MensagemDoMister,
    vinculos: Vinculo[],
  ): Promise<{ vinculo: Vinculo; texto: string } | { desfecho: Desfecho; tenantId?: string | null }> {
    const texto = String(e.texto ?? '');
    if (vinculos.length === 1) {
      if (ehTrocarDeEmpresa(texto)) {
        await this.responder(tel, { texto: TEXTOS.umaEmpresaSo(vinculos[0].empresa) });
        return { desfecho: 'uma_empresa_so', tenantId: vinculos[0].tenantId };
      }
      return { vinculo: vinculos[0], texto };
    }

    const empresas = vinculos.map((v) => ({ tenantId: v.tenantId, nome: v.empresa }));
    const [conv] = linhas(
      await this.db.execute(sql`
        select tenant_id as "tenantId", perguntada_em is not null as perguntada,
               case when pendente_em > now() - make_interval(mins => ${PENDENTE_VALE_MIN}) then pendente end as pendente
          from mister_conversa where telefone = ${tel}`),
    );

    if (ehTrocarDeEmpresa(texto)) {
      await this.perguntar(tel, empresas, { limpar: true });
      return { desfecho: 'perguntou_empresa' };
    }

    // A resposta à pergunta: o botão vale sempre; o texto (número ou nome) só quando a pergunta está aberta.
    const escolhida = empresaEscolhida({ botaoId: e.botaoId, texto: conv?.perguntada === true ? texto : null }, empresas);
    if (escolhida) {
      const vinculo = vinculos.find((v) => v.tenantId === escolhida)!;
      await this.db.execute(sql`
        insert into mister_conversa (telefone, tenant_id, escolhida_em, ultima_entrada_em) values (${tel}, ${escolhida}::uuid, now(), now())
        on conflict (telefone) do update
          set tenant_id = excluded.tenant_id, escolhida_em = now(), perguntada_em = null, pendente = null, pendente_em = null,
              ultima_entrada_em = now(), atualizado_em = now()`);
      await this.responder(tel, { texto: TEXTOS.seguindo(vinculo.empresa) });
      // A mensagem que esperava a escolha é atendida agora, já na empresa certa.
      const pendente = String(conv?.pendente ?? '').trim();
      if (pendente) await this.atender(tel, vinculo, pendente);
      return { desfecho: 'escolheu_empresa', tenantId: escolhida };
    }

    const emUso = conv?.tenantId ? vinculos.find((v) => v.tenantId === conv.tenantId) : undefined;
    if (emUso && conv?.perguntada !== true) return { vinculo: emUso, texto };

    // Não se sabe de qual empresa. Pergunta aberta e a resposta não serviu: pergunta de novo e mantém a mensagem que já
    // esperava. Senão: guarda esta mensagem e pergunta.
    if (conv?.perguntada === true) await this.perguntar(tel, empresas, { naoEntendi: true });
    else await this.perguntar(tel, empresas, { guardar: texto });
    return { desfecho: 'perguntou_empresa' };
  }

  /**
   * Pergunta de qual empresa é a conversa e deixa a escolha em aberto. `guardar` = a mensagem que fica esperando a
   * escolha (até 10 minutos); `limpar` = a pessoa pediu para trocar de empresa, nada fica esperando; sem os dois, a
   * mensagem que já esperava continua.
   */
  private async perguntar(tel: string, empresas: { tenantId: string; nome: string }[], o: { guardar?: string; limpar?: boolean; naoEntendi?: boolean }): Promise<void> {
    const guardar = o.guardar ? cortar(o.guardar.trim(), 500) || null : null;
    const manter = !guardar && !o.limpar;
    await this.db.execute(sql`
      insert into mister_conversa (telefone, perguntada_em, pendente, pendente_em, ultima_entrada_em)
      values (${tel}, now(), ${guardar}, ${guardar ? sql`now()` : sql`null`}, now())
      on conflict (telefone) do update
        set tenant_id = null, escolhida_em = null, perguntada_em = now(),
            pendente = ${manter ? sql`mister_conversa.pendente` : sql`excluded.pendente`},
            pendente_em = ${manter ? sql`mister_conversa.pendente_em` : sql`excluded.pendente_em`},
            ultima_entrada_em = now(), atualizado_em = now()`);
    const pergunta = perguntaDaEmpresa(empresas);
    await this.responder(tel, o.naoEntendi ? { ...pergunta, texto: `${TEXTOS.naoEntendiAEmpresa} ${pergunta.texto}` } : pergunta);
  }

  // ───────────────────────────── a conversa, já com a empresa certa ─────────────────────────────

  private async atender(tel: string, v: Vinculo, texto: string): Promise<{ desfecho: Desfecho; tenantId: string }> {
    await this.db.execute(sql`update mister_vinculo set ultima_entrada_em = now() where id = ${v.id}::uuid`);
    const nome = primeiroNome(v.nome);
    if (ehPararAvisos(texto)) {
      await this.db.execute(sql`update mister_vinculo set pausado_em = coalesce(pausado_em, now()), atualizado_em = now() where id = ${v.id}::uuid`);
      await this.auditar(v, 'mister_whatsapp_parou', tel);
      await this.responder(tel, { texto: TEXTOS.parou(nome) });
      return { desfecho: 'parou', tenantId: v.tenantId };
    }
    if (ehVoltarAvisos(texto)) {
      await this.db.execute(sql`update mister_vinculo set pausado_em = null, atualizado_em = now() where id = ${v.id}::uuid`);
      await this.auditar(v, 'mister_whatsapp_voltou', tel);
      await this.responder(tel, { texto: TEXTOS.voltou(nome) });
      return { desfecho: 'voltou', tenantId: v.tenantId };
    }
    // As perguntas ainda não estão no ar: o Mister diz isso, no máximo uma vez a cada meia hora (gravação condicional).
    const vez = linhas(
      await this.db.execute(sql`
        insert into mister_conversa (telefone, provisoria_em, ultima_entrada_em) values (${tel}, now(), now())
        on conflict (telefone) do update set provisoria_em = now(), ultima_entrada_em = now(), atualizado_em = now()
          where mister_conversa.provisoria_em is null or mister_conversa.provisoria_em < now() - make_interval(mins => ${AINDA_NAO_RESPONDO_A_CADA_MIN})
        returning telefone`),
    );
    if (!vez.length) return { desfecho: 'calado', tenantId: v.tenantId };
    await this.responder(tel, { texto: TEXTOS.aindaNaoRespondo(nome, v.empresa) });
    return { desfecho: 'ainda_nao_respondo', tenantId: v.tenantId };
  }

  private async auditar(v: Vinculo, acao: string, tel: string): Promise<void> {
    await this.auditoria?.registrar({
      tenantId: v.tenantId,
      atorId: v.colaboradorId,
      tipo: 'config',
      acao,
      entidadeTipo: 'mister_vinculo',
      entidadeId: v.id,
      origem: 'whatsapp',
      detalhe: { final: tel.slice(-4) },
    });
  }

  /** A resposta sai pelo número do Mister. A falha do envio fica no log (com o motivo) e não derruba a conversa. */
  private async responder(tel: string, resposta: Resposta): Promise<void> {
    try {
      await this.numero.enviar(tel, resposta);
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}${e.detalhe ? ` — ${e.detalhe}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a resposta a ${mascarar(tel)} não saiu (${motivo})`);
    }
  }

  // ───────────────────────────── a limpeza ─────────────────────────────

  /**
   * Todo dia, fora do movimento: sai o registro de mensagens com mais de 30 dias (não guarda texto; é só o "já tratei")
   * e o estado das conversas paradas há mais de 90 dias (quem volta a escrever começa uma conversa nova — o vínculo do
   * telefone com a pessoa não mora ali e continua). Devolve quantas linhas saíram.
   */
  @Cron('35 4 * * *')
  async limparMensagens(): Promise<number> {
    if (ehServidorLocal()) return 0;
    try {
      const r = linhas(await this.db.execute(sql`delete from mister_mensagem where recebida_em < now() - interval '30 days' returning wamid`));
      const c = linhas(
        await this.db.execute(sql`delete from mister_conversa where coalesce(ultima_entrada_em, atualizado_em) < now() - interval '90 days' returning telefone`),
      );
      return r.length + c.length;
    } catch (e: any) {
      this.logger.warn(`mister: a limpeza do registro de mensagens falhou — ${e?.message ?? e}`);
      return 0;
    }
  }
}
