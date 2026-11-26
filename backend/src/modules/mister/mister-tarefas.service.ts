import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { TEXTOS_DAS_ACOES } from './mister-acoes';
import { tarefaAberta } from './mapa/tarefas-abertas';
import { MisterFerramentasService, type EscopoDoMister, type ResultadoDaFerramenta } from './mister-ferramentas.service';
import { origemDe } from './mister-imagem-numeros';
import { MOTIVO_DO_PIN, MOTIVO_DO_QR, comMotivo, motivoDoPerfil } from './mister-motivo';
import { MisterNumeroService } from './mister-numero.service';
import { botoesDaProposta } from './mister-procedimentos';
import { MisterPropostasService } from './mister-propostas.service';
import { PRAZO_DA_TAREFA_MIN, PROCEDIMENTO_DA_TAREFA, TEXTOS_DAS_TAREFAS, pedidoDaTarefa, tarefasNoMister } from './mister-tarefas';
import { MisterTelasService } from './mister-telas.service';
import { PEDIDO_MAX, textoAprendido } from './mister-aprendizado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FAZER UMA TAREFA PELO MAPA (Mister, versão 10, fase C4; `mister-tarefas.ts`, `docs/plano-mister.md` § "C4a"). A porta
// `fazer_no_regem`: confere o pedido, grava a proposta de quem pediu e manda o "Vou fazer" com "Autorizar" e "Não agora"; no
// "Autorizar", a escrita vai à própria API como a pessoa (o bilhete preso ao método, ao caminho e ao corpo) e o "feito" sai só
// com a resposta de sucesso da API. Nasce desligado (`MISTER_FAZER_TAREFAS=1`).

const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

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
      // Pela conexão por QR Code não há o botão "Autorizar".
      if (this.numero && (await this.numero.ler()).provedor === 'evolution') return comMotivo(TEXTOS_DAS_ACOES.semBotao, MOTIVO_DO_QR);
      const unidadeId = loja.atual ?? (e.lojaUnica ? (e.lojas[0]?.id ?? null) : null);
      const p = pedidoDaTarefa(en, { unidadeId }, origemDe(en.__origem).resultados);
      if ('erro' in p) return recusa(p.erro);
      // A C4a abre só tarefas de botão; a de PIN entra com o link numa fase seguinte.
      if (p.f.marca !== 'botao') return recusa(TEXTOS_DAS_TAREFAS.fora);
      const chave = createHash('sha256').update(`${p.caminho}|${JSON.stringify(p.corpo)}`).digest('hex').slice(0, 32);
      const avisoId = uuidDeChave('mister:tarefa:', e.tenantId, ':', e.colaboradorId, ':', p.f.rota, ':', chave);
      const prop = await this.propostas.gravarDaConversa(
        e.tenantId,
        unidadeId,
        avisoId,
        PROCEDIMENTO_DA_TAREFA,
        'botao',
        // C7: o pedido nas palavras da pessoa vai junto (vira exemplo, se a tarefa der certo).
        { colaboradorId: e.colaboradorId, nivel: e.nivel, rota: p.f.rota, metodo: p.metodo, caminho: p.caminho, corpo: p.corpo, loja: unidadeId, frase: p.f.frase, resumo: p.resumo, ...(origemDe(en.__origem).falas[0] ? { pedidoDaPessoa: textoAprendido(origemDe(en.__origem).falas[0], PEDIDO_MAX) } : {}) },
        PRAZO_DA_TAREFA_MIN,
      );
      if (!prop) return recusa('Essa mesma tarefa já foi autorizada e está em andamento; o resultado chega na conversa.');
      return {
        ok: true,
        dados: { oQueVouFazer: p.resumo, siga: TEXTOS_DAS_TAREFAS.siga },
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
  async executar(p: { id: string; tenantId: string; parametros: any; autorizadaPor: string | null }): Promise<{ feita: boolean; texto: string }> {
    const par = (p.parametros ?? {}) as Record<string, any>;
    const quem = p.autorizadaPor;
    if (!quem || quem !== String(par.colaboradorId ?? '')) return { feita: false, texto: 'a tarefa só vale com o "Autorizar" de quem pediu. Nada foi feito.' };
    if (!tarefasNoMister()) return { feita: false, texto: 'as tarefas pelo Mister foram desligadas. Nada foi feito.' };
    if (!tarefaAberta(par.rota)) return { feita: false, texto: 'essa tarefa não está mais aberta ao Mister. Nada foi feito.' };
    const e = await this.ferramentas.escopoDaTela(p.tenantId, quem);
    if (!e) return { feita: false, texto: 'o seu acesso ao Mister mudou. Nada foi feito.' };
    const metodo = ['POST', 'PUT', 'PATCH'].includes(par.metodo) ? (par.metodo as 'POST' | 'PUT' | 'PATCH') : 'POST';
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
}
