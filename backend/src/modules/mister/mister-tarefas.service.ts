import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TEXTOS_DAS_ACOES } from './mister-acoes';
import { tarefaAberta } from './mapa/tarefas-abertas';
import { funcaoDoMapa } from './mapa/busca-no-mapa';
import { MisterFerramentasService, type EscopoDoMister, type ResultadoDaFerramenta } from './mister-ferramentas.service';
import { origemDe } from './mister-imagem-numeros';
import { MOTIVO_DO_PIN, MOTIVO_DO_QR, comMotivo, motivoDoPerfil } from './mister-motivo';
import { MisterNumeroService } from './mister-numero.service';
import { botoesDaProposta } from './mister-procedimentos';
import { MisterPropostasService, type PropostaPendente } from './mister-propostas.service';
import { horaNoFuso } from '../../common/data';
import { PRAZO_DA_TAREFA_MIN, PROCEDIMENTO_DA_TAREFA, TEXTOS_DAS_TAREFAS, pedidoDaTarefa, sigaDaTarefa, tarefasNoMister } from './mister-tarefas';
import { MisterTelasService } from './mister-telas.service';
import { PEDIDO_MAX, textoAprendido } from './mister-aprendizado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FAZER UMA TAREFA PELO MAPA (Mister, versão 10, fase C4; `mister-tarefas.ts`, `docs/plano-mister.md` § "C4a"). A porta
// `fazer_no_regem`: confere o pedido, grava a proposta de quem pediu e manda o "Vou fazer" com "Autorizar" e "Não agora"; no
// "Autorizar", a escrita vai à própria API como a pessoa (o bilhete preso ao método, ao caminho e ao corpo) e o "feito" sai só
// com a resposta de sucesso da API. Nasce desligado (`MISTER_FAZER_TAREFAS=1`).

const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

/**
 * O id da proposta de uma tarefa: a mesma pessoa, a mesma rota, a mesma LOJA, o mesmo caminho e o mesmo corpo. A loja entra
 * (rodada 7, MIS-C-04, ERR-650): a loja vai no cabeçalho, fora do corpo — sem ela, "estender a pausa" na loja B regravava a
 * proposta da loja A (o mesmo id) e o "Autorizar" que a pessoa viu para a A fazia na B.
 */
export function idDaTarefa(tenantId: string, colaboradorId: string, rota: string, unidadeId: string | null, caminho: string, corpo: Record<string, unknown>): string {
  const chave = createHash('sha256').update(`${unidadeId ?? ''}|${caminho}|${JSON.stringify(corpo)}`).digest('hex').slice(0, 32);
  return uuidDeChave('mister:tarefa:', tenantId, ':', colaboradorId, ':', rota, ':', chave);
}

@Injectable()
export class MisterTarefasService implements OnModuleInit {
  private readonly logger = new Logger('MisterTarefas');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly propostas: MisterPropostasService,
    private readonly telas: MisterTelasService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.ferramentas.registrarTarefas((e, en, loja) => this.propor(e, en, loja));
    this.propostas.registrarTarefa((p) => this.executar(p));
  }

  /** A porta `fazer_no_regem`. Nunca lança: o erro vira a frase que volta à IA. */
  async propor(e: EscopoDoMister, en: Record<string, unknown>, loja: { atual: string | null; nome: string }): Promise<ResultadoDaFerramenta> {
    if (!tarefasNoMister()) return recusa(TEXTOS_DAS_TAREFAS.fora);
    if (e.nivel !== 'presidente' && e.nivel !== 'gerente') return comMotivo(TEXTOS_DAS_ACOES.soGestor, motivoDoPerfil('o presidente ou o gerente'));
    if (e.pinPendente) return comMotivo('Para fazer pela conversa, confirme antes o seu PIN: o link vai logo depois desta resposta.', MOTIVO_DO_PIN);
    try {
      const unidadeId = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
      const p = pedidoDaTarefa(en, { unidadeId, nome: loja.nome, variasLojas: !e.lojaUnica }, origemDe(en.__origem).resultados);
      if ('erro' in p) return recusa(p.erro);
      // C4 Onda 1: a tarefa marcada "pin" no mapa (apaga o que tem histórico, mexe em dinheiro ou pessoas) sai com o link
      // "Abrir no Regem", que pede o PIN — como as ações de PIN. A de botão, com "Autorizar" e "Não agora".
      const comPin = p.f.marca === 'pin';
      // Pela conexão por QR Code não há o botão "Autorizar" (o link do PIN funciona).
      if (!comPin && this.numero && (await this.numero.ler()).provedor === 'evolution') return comMotivo(TEXTOS_DAS_ACOES.semBotao, MOTIVO_DO_QR);
      const avisoId = idDaTarefa(e.tenantId, e.colaboradorId, p.f.rota, unidadeId, p.caminho, p.corpo);
      const prop = await this.propostas.gravarDaConversa(
        e.tenantId,
        unidadeId,
        avisoId,
        PROCEDIMENTO_DA_TAREFA,
        comPin ? 'pin' : 'botao',
        // C7: o pedido nas palavras da pessoa vai junto (vira exemplo, se a tarefa der certo).
        { colaboradorId: e.colaboradorId, nivel: e.nivel, rota: p.f.rota, metodo: p.metodo, caminho: p.caminho, corpo: p.corpo, loja: unidadeId, frase: p.f.frase, resumo: p.resumo, ...(origemDe(en.__origem).falas[0] ? { pedidoDaPessoa: textoAprendido(origemDe(en.__origem).falas[0], PEDIDO_MAX) } : {}) },
        PRAZO_DA_TAREFA_MIN,
      );
      if (!prop) return recusa('Essa mesma tarefa já foi autorizada e está em andamento; o resultado chega na conversa.');
      if (comPin) {
        // O link sai depois da resposta (o agente chama `enviarLinkDaProposta`), nunca com botões.
        const proposta: PropostaPendente = {
          id: prop.id,
          procedimento: PROCEDIMENTO_DA_TAREFA as unknown as PropostaPendente['procedimento'],
          nivel: 'pin',
          pergunta: TEXTOS_DAS_TAREFAS.link(p.resumo, horaNoFuso(new Date(prop.venceEm))),
          botoes: [],
        };
        return { ok: true, dados: { oQueVouFazer: p.resumo, siga: sigaDaTarefa(p.f.marca) }, proposta };
      }
      return {
        ok: true,
        dados: { oQueVouFazer: p.resumo, siga: sigaDaTarefa(p.f.marca) },
        mensagens: [{ texto: TEXTOS_DAS_TAREFAS.pergunta(p.resumo), botoes: botoesDaProposta(prop.id) }],
      };
    } catch (err: any) {
      this.logger.error(`a tarefa não foi proposta: ${String(err?.message ?? err).slice(0, 300)}`, err?.stack);
      return recusa('Não consegui preparar a tarefa agora.');
    }
  }

  /**
   * O "Autorizar" de quem pediu: a tarefa ainda aberta e a pessoa ainda com acesso; a escrita pela própria API, como ela (as
   * travas da tela de novo); o "feito" só com a resposta de sucesso.
   */
  async executar(p: { id: string; tenantId: string; nivel?: string | null; parametros: any; autorizadaPor: string | null }): Promise<{ feita: boolean; texto: string }> {
    const par = (p.parametros ?? {}) as Record<string, any>;
    const quem = p.autorizadaPor;
    if (!quem || quem !== String(par.colaboradorId ?? '')) return { feita: false, texto: 'a tarefa só vale com o "Autorizar" de quem pediu. Nada foi feito.' };
    if (!tarefasNoMister()) return { feita: false, texto: 'as tarefas pelo Mister foram desligadas. Nada foi feito.' };
    if (!tarefaAberta(par.rota)) return { feita: false, texto: 'essa tarefa não está mais aberta ao Mister. Nada foi feito.' };
    // Rodada 7, MIS-C-05 (ERR-650): a marca VIGENTE do mapa decide, não a gravada. A proposta de botão de uma tarefa que passou
    // a pedir o PIN não vale (o PIN não foi dado).
    const marca = funcaoDoMapa(par.rota)?.marca;
    if (marca !== 'botao' && marca !== 'pin') return { feita: false, texto: 'essa tarefa não está mais aberta ao Mister. Nada foi feito.' };
    if (marca === 'pin' && p.nivel !== 'pin') return { feita: false, texto: 'essa tarefa agora pede o PIN. Nada foi feito; peça de novo para receber o link.' };
    const e = await this.ferramentas.escopoDaTela(p.tenantId, quem);
    if (!e) return { feita: false, texto: 'o seu acesso ao Mister mudou. Nada foi feito.' };
    const metodo = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(par.metodo) ? (par.metodo as 'POST' | 'PUT' | 'PATCH' | 'DELETE') : 'POST';
    const r = await this.telas.escrever(e, metodo, String(par.caminho ?? ''), (par.corpo ?? {}) as Record<string, unknown>, par.loja ?? null);
    const auditar = (acao: string, detalhe: Record<string, unknown>) =>
      this.auditoria
        ?.registrar({ tenantId: p.tenantId, atorId: quem, atorPerfil: e.nivel, tipo: 'mister', acao, entidadeTipo: 'mister_proposta', entidadeId: p.id, detalhe: { rota: par.rota, ...detalhe }, origem: 'whatsapp' } as any)
        .catch(() => undefined);
    if (!r) {
      await auditar('mister_tarefa_nao_deu', { motivo: 'sem_resposta' });
      return { feita: false, texto: 'o Regem não respondeu agora. Confira na tela se foi feito antes de pedir de novo.' };
    }
    if (r.status >= 200 && r.status < 300) {
      await auditar('mister_tarefa_feita', { status: r.status });
      return { feita: true, texto: TEXTOS_DAS_TAREFAS.feita(String(par.frase ?? 'a tarefa')) };
    }
    await auditar('mister_tarefa_nao_deu', { status: r.status });
    if (r.status === 401 || r.status === 403) return { feita: false, texto: 'o seu perfil no Regem não faz isso pela tela. Nada foi feito; quem muda o perfil é o presidente.' };
    if (r.status === 404) return { feita: false, texto: 'o registro não existe mais. Nada foi feito.' };
    if (r.status === 400 || r.status === 409 || r.status === 422) return { feita: false, texto: `a tela recusou${r.mensagem ? `: ${r.mensagem}` : '.'} Nada foi feito.` };
    return { feita: false, texto: 'não deu agora no Regem. Nada foi feito; tente de novo daqui a pouco.' };
  }

  /**
   * H2b dos dias especiais: a tarefa proposta por um BOTÃO de aviso ("Feriado chegando" → "Fechada" ou "Horário normal"), não
   * pela IA — a MESMA conferência (`pedidoDaTarefa`), a mesma proposta e o mesmo link do PIN; a execução é a de sempre
   * (`executar`, pela rota da tela). Só tarefa de PIN, sem loja (a da conversa não existe aqui). `ok` = o link saiu.
   */
  async proporPeloBotao(
    q: { tenantId: string; colaboradorId: string; nivel: string; telefone: string },
    rota: string,
    campos: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; texto: string }> {
    if (!tarefasNoMister()) return { ok: false, texto: TEXTOS_DAS_TAREFAS.fora };
    if (q.nivel !== 'presidente' && q.nivel !== 'gerente') return { ok: false, texto: TEXTOS_DAS_ACOES.soGestor };
    const p = pedidoDaTarefa({ rota, campos }, { unidadeId: null });
    if ('erro' in p) return { ok: false, texto: p.erro };
    if (p.f.marca !== 'pin') return { ok: false, texto: TEXTOS_DAS_TAREFAS.fora };
    const avisoId = idDaTarefa(q.tenantId, q.colaboradorId, p.f.rota, null, p.caminho, p.corpo);
    const prop = await this.propostas.gravarDaConversa(
      q.tenantId,
      null,
      avisoId,
      PROCEDIMENTO_DA_TAREFA,
      'pin',
      { colaboradorId: q.colaboradorId, nivel: q.nivel, rota: p.f.rota, metodo: p.metodo, caminho: p.caminho, corpo: p.corpo, loja: null, frase: p.f.frase, resumo: p.resumo },
      PRAZO_DA_TAREFA_MIN,
    );
    if (!prop) return { ok: false, texto: 'Essa mesma tarefa já foi autorizada e está em andamento; o resultado chega na conversa.' };
    const url = await this.propostas.enviarLink(prop.id, q.colaboradorId, q.telefone, TEXTOS_DAS_TAREFAS.link(p.resumo, horaNoFuso(new Date(prop.venceEm))));
    return url ? { ok: true } : { ok: false, texto: 'Não consegui preparar o link do PIN agora. Responda pela tela: Delivery › Configurações › Horários.' };
  }
}
