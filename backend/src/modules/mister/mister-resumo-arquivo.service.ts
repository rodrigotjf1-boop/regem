import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { somarDias } from '../../common/data';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  PREFIXO_DO_GRAFICO,
  PlanoDoResumo,
  TipoDoResumo,
  lerBotaoDoGrafico,
  nomeDoPdfDoGrafico,
  nomeDoPdfDoResumo,
  planoDeUmGrafico,
} from './grafico/plano-do-resumo';
import { FORMAS_DE_ENTREGA_DO_RESUMO, FormaDeEntregaDoResumo, MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { EscopoDoMister, MisterFerramentasService } from './mister-ferramentas.service';
import { TEXTOS_DO_LINK_PUBLICO, diaMesDe } from './mister-link-publico';
import { MisterLinkPublicoService } from './mister-link-publico.service';
import { midiaNaInstalacao } from './mister-midia.regras';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { gerarPdfDoResumo } from './relatorio-resumo-pdf';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESUMO EM ARQUIVO E NO LINK (versão 5, M5e; protótipo `mockups/regem-mister-ouve-ve-mostra.html`, conversas 7 e 8 e
// a aba "Arquivo e link"; decisão 8: "o resumo é texto com os botões 📄 PDF e 📊 Ver gráficos; o link abre sem login por
// 7 dias e só mostra aquele resumo, pelo mecanismo do link para encaminhar (mig 443)").
//
//  • O TEXTO do resumo vai sempre (é o da IA, como antes). O que vai junto é o ajuste "Como mandar o resumo"
//    (`mister_conversa_config.resumo_entrega`, mig 461): os botões (o padrão), o PDF junto, o link junto, ou só o texto.
//  • O PDF e o link saem do PLANO do resumo (`MisterFerramentasService.planoDoResumo`): só os números do Regem, no escopo
//    de quem recebe. Sem plano (o perfil sem os relatórios de vendas, um dia sem nada), só o texto.
//  • O botão leva só o id da linha do relatório (`rsm:pdf:<id>`, `rsm:graf:<id>`): o toque confere que a linha é de uma
//    empresa e de uma pessoa deste telefone e REFAZ o plano no escopo dela agora (a permissão e a loja conferidas de novo
//    — o botão não carrega nada que valha por si). O link nasce no toque, não a cada resumo (o teto de links vivos).
//  • Nasce DESLIGADO, na chave da versão 5 (`MISTER_MIDIA`): desligada, só o texto, como antes. O link segue a chave dele
//    (`MISTER_LINK_PUBLICO`): desligada, só o botão do PDF.
//  • Pela conexão por QR Code (Evolution) não há botão: o ajuste dos botões vira só o texto; o PDF e o link junto valem.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O prefixo dos botões do resumo; o id da linha de `mister_relatorio` vem depois. */
export const PREFIXO_DO_RESUMO = 'rsm:';
/** O texto com botões cabe nisto (a Meta corta em 1024); acima, os botões vão numa mensagem curta logo depois. */
const CABE_COM_BOTAO = 1000;

const FORMAS_DE_ENTREGA = FORMAS_DE_ENTREGA_DO_RESUMO;
export type FormaDeEntrega = FormaDeEntregaDoResumo;

export const botaoDoResumo = (acao: 'pdf' | 'graf', relatorioId: string) => `${PREFIXO_DO_RESUMO}${acao}:${relatorioId}`;
export function lerBotaoDoResumo(id: string): { acao: 'pdf' | 'graf'; relatorioId: string } | null {
  const m = /^rsm:(pdf|graf):(.+)$/.exec(String(id ?? ''));
  return m && UUID.test(m[2]) ? { acao: m[1] as 'pdf' | 'graf', relatorioId: m[2] } : null;
}

export const TEXTOS_DO_RESUMO_EM_ARQUIVO = {
  botoesDepois: '📎 Este resumo em arquivo ou nos gráficos:',
  naoDisponivel: 'Este resumo não está mais disponível para você.',
  semAcesso: 'Este WhatsApp não tem mais acesso a este resumo.',
  semPlano: 'Este resumo não tem gráficos para mostrar: não houve venda no período, ou o seu perfil no Regem não vê os relatórios de vendas.',
  falhou: 'Não consegui gerar o PDF agora. Toque de novo em instantes.',
  linkFalhou: 'Não consegui criar o link agora. Toque de novo em instantes.',
  graficoNaoDisponivel: 'Este gráfico não está mais disponível para você.',
  graficoSemConteudo: 'Este gráfico não tem mais o que mostrar (o período não teve venda), ou o gráfico na conversa foi desligado no Regem.',
} as const;

/** "📊 Vendas por dia · 12/11 a 18/11: <link>" e até quando vale. */
export function textoDoLinkDoGrafico(titulo: string, url: string, vence: Date): string {
  return `📊 ${titulo}: ${url}\nO link vale até ${diaMesDe(vence)} e só mostra este gráfico.`;
}

/** O "19/11 às 09:00" do rodapé do gráfico ("Lido em 19/11 às 09:00 · vendas concluídas"). */
const lidoEmDoRodape = (rodape: string): string => /Lido em (.+?)(?: ·|$)/.exec(rodape)?.[1] ?? '';

/** "📊 Os gráficos do resumo de quarta, 18/11/2026: <link>" e até quando vale. */
export function textoDoLinkDoResumo(titulo: string, url: string, vence: Date): string {
  const sobre = titulo.replace(/^Resumo/, 'resumo');
  return `📊 Os gráficos do ${sobre}: ${url}\nO link vale até ${diaMesDe(vence)} e só mostra este resumo.`;
}

export interface PessoaDoResumo {
  tenantId: string;
  colaboradorId: string;
  telefone: string;
}

@Injectable()
export class MisterResumoArquivoService implements OnModuleInit {
  private readonly logger = new Logger('MisterResumoArquivo');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ferramentas: MisterFerramentasService,
    private readonly numero: MisterNumeroService,
    private readonly links: MisterLinkPublicoService,
    @Optional() private readonly conversa?: MisterConversaConfigService,
    @Optional() private readonly entrada?: MisterEntradaService,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_DO_RESUMO, (botaoId, quem) => this.tocou(botaoId, quem));
    this.entrada?.registrarBotao(PREFIXO_DO_GRAFICO, (botaoId, quem) => this.tocouNoGrafico(botaoId, quem));
  }

  /**
   * O toque em "📄 PDF" ou "🔗 Ver no link" de um gráfico da conversa (`mostrar_grafico`): a empresa do botão tem de ser um
   * vínculo deste telefone, a loja (se o botão traz uma) tem de estar no escopo da pessoa AGORA, e o gráfico é refeito pela
   * MESMA consulta (a permissão, o período e a chave da versão 5 conferidos de novo). Devolve false quando o botão não é
   * de gráfico.
   */
  async tocouNoGrafico(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoGrafico(botaoId);
    if (!b) return false;
    const dizer = (texto: string) => this.numero.enviar(quem.telefone, { texto }).then(() => undefined, () => undefined);
    const vinculo = quem.vinculos.find((v) => v.tenantId === b.tenantId);
    const escopo = vinculo ? await this.ferramentas.escopo(vinculo.tenantId, vinculo.colaboradorId, quem.telefone) : null;
    const loja = b.loja ? escopo?.lojas.find((l) => l.id === b.loja) : null;
    if (!vinculo || !escopo || escopo.semLoja || (b.loja && !loja)) {
      await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.graficoNaoDisponivel);
      return true;
    }
    if (quem.wamid) this.numero.mostrarDigitando(quem.wamid);
    const r = await this.ferramentas.executar(escopo, 'mostrar_grafico', { tipo: b.tipo, de: b.de, ate: b.ate, ...(loja ? { loja: loja.nome } : {}) });
    const g = r.ok ? r.graficos?.[0] : undefined;
    if (!g) {
      await dizer(r.ok ? TEXTOS_DO_RESUMO_EM_ARQUIVO.graficoSemConteudo : TEXTOS_DO_RESUMO_EM_ARQUIVO.graficoNaoDisponivel);
      return true;
    }
    const plano = planoDeUmGrafico({
      tipo: b.tipo,
      grafico: g,
      empresa: escopo.empresa,
      loja: String(r.dados.loja ?? ''),
      periodo: String(r.dados.periodo ?? ''),
      lidoEm: lidoEmDoRodape(g.rodape),
      verValores: escopo.verValores,
    });
    const nome = nomeDoPdfDoGrafico(b.tipo, b.de, b.ate);
    const pessoa = { tenantId: vinculo.tenantId, colaboradorId: vinculo.colaboradorId, telefone: quem.telefone };
    if (b.acao === 'pdf') {
      try {
        await this.numero.enviarDocumento(quem.telefone, await gerarPdfDoResumo(plano, nome), nome, `${plano.titulo} · ${plano.empresa}`);
      } catch (e: any) {
        this.falhaDoJunto(pessoa, 'o PDF do gráfico', e);
        await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.falhou);
      }
      return true;
    }
    if (!this.links.ligado()) {
      await dizer(TEXTOS_DO_LINK_PUBLICO.desligado);
      return true;
    }
    const link = await this.links.criar(
      { tenantId: vinculo.tenantId, colaboradorId: vinculo.colaboradorId },
      { tipo: 'grafico', unidadeId: escopo.presa ?? loja?.id ?? null, titulo: plano.titulo, nomeDoPdf: nome, plano },
    );
    if ('erro' in link) {
      await dizer(link.erro);
      return true;
    }
    await this.numero
      .enviar(quem.telefone, { texto: textoDoLinkDoGrafico(plano.titulo, link.url, link.vence), link: { titulo: 'Abrir', url: link.url } })
      .catch((e) => this.falhaDoJunto(pessoa, 'o link do gráfico', e));
    return true;
  }

  /** A forma que vale agora para a empresa: desligada a versão 5 nesta instalação, só o texto. */
  async formaDaEmpresa(tenantId: string): Promise<FormaDeEntrega> {
    if (!midiaNaInstalacao()) return 'texto';
    const f = (await this.conversa?.daEmpresa(tenantId))?.resumoEntrega;
    return FORMAS_DE_ENTREGA.includes(f as FormaDeEntrega) ? (f as FormaDeEntrega) : 'botoes';
  }

  /**
   * Manda o texto do resumo e o que vai junto. Lança SÓ quando o TEXTO não saiu (quem chama marca "não enviado"); o que
   * vai junto e falha fica no log e o resumo conta como enviado (a pessoa leu o texto).
   */
  async entregar(pessoa: PessoaDoResumo, escopo: EscopoDoMister | null, relatorioId: string, tipo: TipoDoResumo, referencia: string, texto: string): Promise<{ forma: FormaDeEntrega; junto: string | null }> {
    let forma = await this.formaDaEmpresa(pessoa.tenantId).catch(() => 'texto' as FormaDeEntrega);
    let plano: PlanoDoResumo | null = null;
    if (forma !== 'texto' && escopo) {
      plano = await this.ferramentas.planoDoResumo(escopo, tipo, referencia, ateDoResumo(tipo, referencia)).catch((e: any) => {
        this.logger.warn(`o plano do resumo ${relatorioId} não foi montado — ${e?.message ?? e}`);
        return null;
      });
    }
    if (!plano) forma = 'texto';
    const provedor = forma === 'botoes' ? (await this.numero.ler()).provedor : null;
    if (forma === 'botoes' && provedor === 'evolution') forma = 'texto';

    if (forma === 'botoes') {
      const botoes = [{ id: botaoDoResumo('pdf', relatorioId), titulo: '📄 PDF' }, ...(this.links.ligado() ? [{ id: botaoDoResumo('graf', relatorioId), titulo: '📊 Ver gráficos' }] : [])];
      if (texto.length <= CABE_COM_BOTAO) {
        await this.numero.enviar(pessoa.telefone, { texto, botoes });
        return { forma, junto: 'botoes' };
      }
      await this.numero.enviar(pessoa.telefone, { texto });
      const saiu = await this.numero.enviar(pessoa.telefone, { texto: TEXTOS_DO_RESUMO_EM_ARQUIVO.botoesDepois, botoes }).then(() => true, (e) => this.falhaDoJunto(pessoa, 'os botões', e));
      return { forma, junto: saiu ? 'botoes_depois' : null };
    }
    if (forma === 'link') {
      if (!this.links.ligado()) {
        await this.numero.enviar(pessoa.telefone, { texto });
        return { forma: 'texto', junto: null };
      }
      const l = await this.criarLink(pessoa, escopo!, plano!, tipo, referencia);
      await this.numero.enviar(pessoa.telefone, { texto: 'erro' in l ? texto : `${texto}\n\n${textoDoLinkDoResumo(plano!.titulo, l.url, l.vence)}` });
      return { forma, junto: 'erro' in l ? null : 'link' };
    }
    await this.numero.enviar(pessoa.telefone, { texto });
    if (forma === 'pdf') {
      const saiu = await this.mandarPdf(pessoa.telefone, plano!, tipo, referencia).then(() => true, (e) => this.falhaDoJunto(pessoa, 'o PDF', e));
      return { forma, junto: saiu ? 'pdf' : null };
    }
    return { forma: 'texto', junto: null };
  }

  /**
   * O toque em "📄 PDF" ou "📊 Ver gráficos": a linha do relatório tem de ser de uma empresa e de uma pessoa deste telefone;
   * o plano é refeito AGORA, no escopo dela. Devolve false quando o botão não é do resumo (a entrada responde "não achei").
   */
  async tocou(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerBotaoDoResumo(botaoId);
    if (!b) return false;
    const dizer = (texto: string) => this.numero.enviar(quem.telefone, { texto }).then(() => undefined, () => undefined);
    const donos = quem.vinculos.map((v) => sql`(${v.tenantId}::uuid, ${v.colaboradorId}::uuid)`);
    const [l] = donos.length
      ? linhas(
          await this.db.execute(sql`
            select r.tenant_id::text as "tenantId", r.colaborador_id::text as "colaboradorId", r.tipo, to_char(r.referencia, 'YYYY-MM-DD') as referencia
              from mister_relatorio r
             where r.id = ${b.relatorioId}::uuid and r.tipo in ('resumo_dia', 'resumo_semana')
               and (r.tenant_id, r.colaborador_id) in (${sql.join(donos, sql`, `)})`),
        )
      : [];
    if (!l) {
      await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.naoDisponivel);
      return true;
    }
    const escopo = await this.ferramentas.escopo(l.tenantId, l.colaboradorId, quem.telefone);
    if (!escopo || escopo.semLoja) {
      await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.semAcesso);
      return true;
    }
    if (quem.wamid) this.numero.mostrarDigitando(quem.wamid);
    const tipo = l.tipo as TipoDoResumo;
    const plano = await this.ferramentas.planoDoResumo(escopo, tipo, l.referencia, ateDoResumo(tipo, l.referencia)).catch((e: any) => {
      this.logger.warn(`o plano do resumo ${b.relatorioId} não foi montado no toque — ${e?.message ?? e}`);
      return undefined;
    });
    if (plano === undefined) {
      await dizer(b.acao === 'pdf' ? TEXTOS_DO_RESUMO_EM_ARQUIVO.falhou : TEXTOS_DO_RESUMO_EM_ARQUIVO.linkFalhou);
      return true;
    }
    if (!plano) {
      await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.semPlano);
      return true;
    }
    const pessoa = { tenantId: l.tenantId, colaboradorId: l.colaboradorId, telefone: quem.telefone };
    if (b.acao === 'pdf') {
      await this.mandarPdf(quem.telefone, plano, tipo, l.referencia).catch(async (e) => {
        this.falhaDoJunto(pessoa, 'o PDF (toque)', e);
        await dizer(TEXTOS_DO_RESUMO_EM_ARQUIVO.falhou);
      });
      return true;
    }
    if (!this.links.ligado()) {
      await dizer(TEXTOS_DO_LINK_PUBLICO.desligado);
      return true;
    }
    const link = await this.criarLink(pessoa, escopo, plano, tipo, l.referencia);
    if ('erro' in link) {
      await dizer(link.erro);
      return true;
    }
    await this.numero
      .enviar(quem.telefone, { texto: textoDoLinkDoResumo(plano.titulo, link.url, link.vence), link: { titulo: 'Abrir', url: link.url } })
      .catch((e) => this.falhaDoJunto(pessoa, 'o link (toque)', e));
    return true;
  }

  private async mandarPdf(telefone: string, plano: PlanoDoResumo, tipo: TipoDoResumo, referencia: string): Promise<void> {
    const nome = nomeDoPdfDoResumo(tipo, referencia, ateDoResumo(tipo, referencia));
    const pdf = await gerarPdfDoResumo(plano, nome);
    await this.numero.enviarDocumento(telefone, pdf, nome, `${plano.titulo} · ${plano.empresa}`);
  }

  private criarLink(pessoa: PessoaDoResumo, escopo: EscopoDoMister, plano: PlanoDoResumo, tipo: TipoDoResumo, referencia: string) {
    return this.links.criar(
      { tenantId: pessoa.tenantId, colaboradorId: pessoa.colaboradorId },
      { tipo: 'resumo', unidadeId: escopo.presa ?? null, titulo: plano.titulo, nomeDoPdf: nomeDoPdfDoResumo(tipo, referencia, ateDoResumo(tipo, referencia)), plano },
    );
  }

  private falhaDoJunto(pessoa: PessoaDoResumo, o: string, e: any): false {
    const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}` : String(e?.message ?? e);
    this.logger.warn(`mister: ${o} do resumo não saiu para ${mascarar(pessoa.telefone)} (empresa ${pessoa.tenantId}) — ${motivo}`);
    return false;
  }
}

/** O último dia do resumo: o próprio dia, ou o 7º da semana (a semana do resumo vai da referência até 6 dias depois). */
export const ateDoResumo = (tipo: TipoDoResumo, referencia: string): string => (tipo === 'resumo_dia' ? referencia : somarDias(referencia, 6));
