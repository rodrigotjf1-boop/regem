import { createHash } from 'node:crypto';
import {
  FERRAMENTAS,
  FERRAMENTA_DO_QUE_FALTA,
  INSTRUCOES_DO_MISTER,
  NivelDoMister,
  NomeDaFerramenta,
  TemaDoQueFalta,
  blocoDaConversa,
  ehConsulta,
  ehFerramenta,
  valoresSemConta,
} from './mister-agente.regras';
import { diferencaEmReais } from './mister-agente.regras';
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';
import type { FimDaPergunta } from './mister-laco';
import { GUIA_DE_USO, buscarNoGuia, quemAbre } from './mister-guia-de-uso';
import { conferirMemoria } from './mister-memoria';
import { lerAlteracoes } from './mister-documento-conversa';
import { lerAlteracoesDaLista } from './mister-lista-ia';
import { canalDito, conferirTextoDoLembrete, lerQuando, quandoNaConversa } from './mister-vigia';
import { AVISOS_QUE_NAO_SE_CALAM, Regra, conferirRegra, descreverRegra, fraseDoQueDeixaDeChegar } from './mister-regra';
import { lerPedidos } from './mister-lista';
import { ACOES, conferirAcao, resumoDoPedido, sigaDaAcao } from './mister-acoes';
import { botoesDoPlano, lerPassos, textoDoPlano } from './mister-plano';
import { ehTipoDeAviso } from './mister-avisos.regras';
import { montarNoticias, pedidoDasNoticias } from './mister-noticias';
import { montarLinks, pedidoDoLink } from './mister-abrir';
import type { BoletimDoRamo, NoticiaDoBoletim } from '../pulso/pulso.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A AVALIAÇÃO DE REGRESSÃO DO MISTER (F5.3 do docs/plano-mister.md; protótipo mockups/regem-dependencias-e-qualidade.html,
// cartão "Avaliação de regressão"). Tudo aqui é da DISTRIBUIÇÃO e fica no código: nenhuma loja edita, nada vai ao banco
// de uma loja.
//
//  • A LOJA DE TESTE: uma empresa inventada, com os dados inventados que cada ferramenta devolve (as mesmas chaves das
//    ferramentas de verdade). Os números batem entre si — o faturamento de ontem é o mesmo no resumo do dia e no
//    relatório de vendas; as horas somam o dia — e os valores têm centavos que não terminam em zero (a conferência não
//    depende de como o modelo arredonda "4.321,50").
//  • AS PERGUNTAS: fixas. Cada uma diz o que a resposta certa tem: a consulta que o Mister tem de chamar, os números que
//    têm de aparecer, o tema do que falta, que não pode mostrar valor a quem não vê valores.
//  • A CONFERÊNCIA é por regra, nunca a IA julgando a si mesma. E vale para todas: valor em reais que nenhuma consulta
//    trouxe (o filtro de saída de verdade) reprova.
//
// Mudou uma ferramenta (as chaves da resposta) ou as instruções: ajuste a loja de teste e rode a avaliação no console.

export const AGORA_DA_AVALIACAO = 'sexta-feira, 13/11/2026, 20:15';
/** O mesmo "agora", como instante (20:15 da loja = 23:15 UTC): o lembrete da avaliação confere a hora contra ele. */
const AGORA_DA_AVALIACAO_INSTANTE = new Date('2026-11-13T23:15:00Z');
const EMPRESA = 'Empresa de Teste da Avaliação';
const LOJA = 'Loja Centro';
const SEM_VALORES = 'O perfil desta pessoa no Regem não mostra valores em reais: os valores vêm vazios.';
const SEM_PERMISSAO = 'O perfil desta pessoa no Regem não dá acesso a esta informação. Quem muda o perfil é o presidente.';
const NOTICIA_DA_AVALIACAO = (id: string, titulo: string, categoria: string, categoriaNome: string, credito: string, emDiscussao = false): NoticiaDoBoletim => ({
  id,
  titulo,
  link: `https://fonte.teste/${id}`,
  categoria,
  categoriaNome,
  publicadoEm: `2026-11-1${id}T14:00:00.000Z`,
  emDiscussao,
  aviso: emDiscussao ? 'Em discussão no Congresso: ainda não é lei.' : null,
  credito,
});
/** O boletim inventado da loja de teste: um ato oficial, um projeto no Congresso e duas novidades do setor. */
const BOLETIM_DA_AVALIACAO: BoletimDoRamo = {
  dia: '2026-11-13',
  mensagem: null,
  indicadores: [{ id: 'selic', nome: 'Selic (meta)', valor: 13.75, unidade: '% ao ano', referencia: '2026-11-13', acumulado12Meses: null, mudou: false, credito: 'Fonte: Banco Central do Brasil' }],
  destaques: [
    NOTICIA_DA_AVALIACAO('3', 'Receita amplia o ambiente de testes da CBS', 'impostos', 'Impostos e fiscal', 'Fonte: Receita Federal'),
    NOTICIA_DA_AVALIACAO('2', 'Comissão pode votar a ampliação do limite de faturamento do MEI', 'impostos', 'Impostos e fiscal', 'Agência Câmara', true),
  ],
  novidades: [
    NOTICIA_DA_AVALIACAO('1', 'Hamburguerias apostam em cardápio menor para reduzir desperdício', 'tendencias', 'Tendências do ramo', 'Fonte: Mercado&Consumo'),
    NOTICIA_DA_AVALIACAO('0', 'iFood muda a regra de cupom para restaurantes', 'plataformas', 'Plataformas de delivery', 'Fonte: Mercado&Consumo'),
  ],
  mais: [],
};

export interface PerfilDaAvaliacao {
  nivel: NivelDoMister;
  verValores: boolean;
  /** R2: a loja de teste com os 3 meses no extrato do banco. */
  extrato?: 'encolhendo' | 'gerando';
}

/** A conversa da loja de teste, como o modelo a vê. */
export function conversaDaAvaliacao(p: PerfilDaAvaliacao): string {
  return blocoDaConversa({
    empresa: EMPRESA,
    nome: p.nivel === 'presidente' ? 'Rita' : 'Gabriel',
    nivel: p.nivel,
    lojas: [LOJA],
    presaAUmaLoja: p.nivel !== 'presidente',
    semLoja: false,
    verValores: p.verValores,
    agora: AGORA_DA_AVALIACAO,
  });
}

/** A impressão das instruções e das ferramentas: muda quando qualquer texto que o modelo vê muda. */
export function versaoDasInstrucoes(): { versao: string; consultas: number } {
  const versao = createHash('sha256').update(INSTRUCOES_DO_MISTER).update(JSON.stringify(FERRAMENTAS)).digest('hex').slice(0, 8);
  return { versao, consultas: FERRAMENTAS.filter((f) => ehConsulta(f.name)).length };
}

// ───────────────────────────── os dados inventados ─────────────────────────────

// Versão 7, V7c: a regra que está ligada na loja de teste (a reclamação confere o dia dela) e a proposta ainda aberta (o ajuste
// "faz 40 min" parte dela).
const ID_DA_REGRA_DA_AVALIACAO = '00000000-0000-4000-8000-000000000002';
const REGRA_DA_AVALIACAO: Regra = {
  fonte: 'pedidos',
  titulo: '3 pedidos em preparo há 25 min',
  filtros: [
    { campo: 'situacao', op: '=', valor: 'em_preparo' },
    { campo: 'min_desde_aceite', op: '>=', valor: 25 },
  ],
  medida: 'quantidade',
  condicao: { op: '>=', valor: 3 },
  quando: {},
  vezes: 'sempre',
  agrupar: true,
  substitui: ['pedido_parado:confirmado'],
};
const PROPOSTA_DA_AVALIACAO: Regra = {
  fonte: 'pedidos',
  titulo: '2 pedidos a caminho há 30 min',
  filtros: [
    { campo: 'situacao', op: '=', valor: 'a_caminho' },
    { campo: 'min_desde_aceite', op: '>=', valor: 30 },
  ],
  medida: 'quantidade',
  condicao: { op: '>=', valor: 2 },
  quando: {},
  vezes: 'sempre',
  agrupar: true,
};

type Periodo = 'hoje' | 'ontem' | 'esta_semana' | 'semana_passada' | 'este_mes' | 'mes_passado';
const ROTULO: Record<Periodo, string> = {
  hoje: 'hoje, 13/11/2026',
  ontem: 'ontem, 12/11/2026',
  esta_semana: 'esta semana, de 09/11 a 13/11/2026',
  semana_passada: 'semana passada, de 02/11 a 08/11/2026',
  este_mes: 'este mês, de 01/11 a 13/11/2026',
  mes_passado: 'mês passado, outubro de 2026',
};
const VENDAS: Record<Periodo, { vendas: number; faturado: number; ticket: number; gorjeta: number; canceladas: number }> = {
  hoje: { vendas: 87, faturado: 4321.45, ticket: 49.67, gorjeta: 118.35, canceladas: 1 },
  ontem: { vendas: 102, faturado: 5110.85, ticket: 50.11, gorjeta: 140.25, canceladas: 3 },
  esta_semana: { vendas: 498, faturado: 24876.45, ticket: 49.95, gorjeta: 655.15, canceladas: 9 },
  semana_passada: { vendas: 812, faturado: 38420.35, ticket: 47.32, gorjeta: 590.45, canceladas: 7 },
  este_mes: { vendas: 1290, faturado: 64410.35, ticket: 49.93, gorjeta: 1702.65, canceladas: 21 },
  mes_passado: { vendas: 2870, faturado: 141220.65, ticket: 49.21, gorjeta: 3712.35, canceladas: 44 },
};
const POR_HORA: Partial<Record<Periodo, Array<[number, number, number]>>> = {
  hoje: [
    [18, 25, 1240.1],
    [19, 38, 1890.85],
    [20, 24, 1190.5],
  ],
  ontem: [
    [18, 14, 690.15],
    [19, 26, 1290.4],
    [20, 34, 1720.85],
    [21, 20, 1010.3],
    [22, 8, 399.15],
  ],
};

/** O período pedido à ferramenta, como a loja de teste entende (o que ela não tem vira "este mês"). */
function periodoPedido(en: Record<string, unknown>): Periodo {
  // O dia pedido: pelo `dia` (o gráfico por hora) ou pelas datas de um dia só.
  if (en.periodo === undefined && !en.de && !en.ate && en.dia) return diaPedido(en);
  if (en.periodo === undefined && en.de === '2026-11-12' && (en.ate === undefined || en.ate === '2026-11-12')) return 'ontem';
  const p = String(en.periodo ?? '').trim();
  if (p === 'ultimos_7_dias') return 'esta_semana';
  if (p === 'ultimos_30_dias') return 'este_mes';
  return (Object.keys(ROTULO) as Periodo[]).includes(p as Periodo) ? (p as Periodo) : en.de || en.ate ? 'este_mes' : 'hoje';
}
function diaPedido(en: Record<string, unknown>): 'hoje' | 'ontem' {
  const d = String(en.dia ?? 'hoje').trim();
  return d === 'ontem' || d === '2026-11-12' ? 'ontem' : 'hoje';
}

const ok = (dados: Record<string, unknown>): ResultadoDaFerramenta => ({ ok: true, dados });
const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

/** O que cada ferramenta devolve na loja de teste, para o perfil da pergunta. */
export function executarNaAvaliacao(nome: unknown, entrada: unknown, perfil: PerfilDaAvaliacao): ResultadoDaFerramenta {
  if (!ehFerramenta(nome)) return recusa('Essa consulta não existe.');
  const en = (entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {}) as Record<string, unknown>;
  const v = <T>(x: T): T | null => (perfil.verValores ? x : null);
  const valores = perfil.verValores ? { observacao: 'A gorjeta não entra no faturamento.' } : { aviso: SEM_VALORES };
  switch (nome as NomeDaFerramenta) {
    case 'resumo_do_dia': {
      const dia = diaPedido(en);
      const d = VENDAS[dia];
      const [balcao, delivery] = dia === 'hoje' ? [1830.15, 2491.3] : [2460.4, 2650.45];
      return ok({
        loja: LOJA,
        dia: ROTULO[dia],
        ...(dia === 'hoje' ? { lidoAs: '20:15' } : {}),
        numeroDeVendas: d.vendas,
        faturamento: v(d.faturado),
        faturamentoDoBalcao: v(balcao),
        faturamentoDoDelivery: v(delivery),
        ticketMedio: v(d.ticket),
        gorjeta: v(d.gorjeta),
        ...valores,
        pedidosDeDeliveryEmAberto: dia === 'hoje' ? 3 : 0,
        itensDeEstoqueAbaixoDoMinimo: 4,
        tarefas: { total: 12, feitas: 9, pendentes: 2, naoFeitas: 1 },
        escala: { vagas: 8, preenchidas: 7 },
      });
    }
    case 'vendas_do_periodo': {
      const p = periodoPedido(en);
      const d = VENDAS[p];
      const porHora = (POR_HORA[p] ?? []).map(([h, n, t]) => ({ hora: `${h}h`, vendas: n, total: v(t) }));
      const pico = porHora.reduce<{ hora: string; vendas: number } | null>((m, h) => (!m || h.vendas > m.vendas ? h : m), null);
      const comparar =
        en.comparar === true && (p === 'esta_semana' || p === 'este_mes' || p === 'hoje' || p === 'ontem')
          ? (() => {
              const ant: Periodo = p === 'esta_semana' ? 'semana_passada' : p === 'este_mes' ? 'mes_passado' : p === 'hoje' ? 'ontem' : 'hoje';
              const a = VENDAS[ant];
              const pct = (x: number, y: number) => Math.round(((x - y) / y) * 1000) / 10;
              return {
                comparacao: {
                  periodo: ROTULO[ant],
                  numeroDeVendas: a.vendas,
                  faturamento: v(a.faturado),
                  ticketMedio: v(a.ticket),
                  variacaoPct: { vendas: pct(d.vendas, a.vendas), faturamento: v(pct(d.faturado, a.faturado)), ticketMedio: v(pct(d.ticket, a.ticket)) },
                  diferencaDeVendas: d.vendas - a.vendas,
                  diferencaDeFaturamento: perfil.verValores ? diferencaEmReais(d.faturado, a.faturado) : null,
                  comoComparar: 'Para dizer quanto mudou em reais, use diferencaDeFaturamento (valor e sentido); não faça a conta.',
                },
              };
            })()
          : {};
      return ok({
        loja: LOJA,
        periodo: ROTULO[p],
        numeroDeVendas: d.vendas,
        faturamento: v(d.faturado),
        ticketMedio: v(d.ticket),
        gorjeta: v(d.gorjeta),
        vendasCanceladas: d.canceladas,
        ...valores,
        comoORelatorioSeparaOsCanais: 'O faturamento é a mesma conta do Painel. Mesa = venda de mesa. Balcão = as outras vendas lançadas na própria loja. Delivery/app = os pedidos que chegaram pelos canais (cardápio online, iFood, 99 e outros), inclusive os de retirada.',
        porCanal:
          p === 'ontem'
            ? [
                { canal: 'balcao', vendas: 41, total: v(1702.35) },
                { canal: 'mesa', vendas: 18, total: v(1101.1) },
                { canal: 'delivery/app', vendas: 43, total: v(2307.4) },
              ]
            : [],
        porHora,
        horarioDePico: pico && pico.vendas > 0 ? pico.hora : null,
        ...comparar,
        delivery:
          p === 'ontem' && perfil.verValores
            ? {
                comoORelatorioDeDeliveryConta: 'Os pedidos que chegaram pelos canais (cardápio online, iFood, 99 e outros) e foram aceitos, sem os cancelados, pela hora em que chegaram.',
                pedidos: 47,
                faturamento: 2650.45,
                ticketMedio: 56.39,
                porPlataforma: [
                  { plataforma: 'iFood', pedidos: 29, faturamento: 1688.35, ticketMedio: 58.22 },
                  { plataforma: '99', pedidos: 8, faturamento: 401.65, ticketMedio: 50.21 },
                  { plataforma: 'Cardápio online', pedidos: 10, faturamento: 560.45, ticketMedio: 56.05 },
                ],
              }
            : perfil.verValores
              ? { pedidos: 0, observacao: 'Na loja de teste, o detalhe do delivery só existe para ontem.' }
              : { aviso: SEM_VALORES },
      });
    }
    case 'mandar_link':
      // M3c.5: na loja de teste ninguém mais ligou o WhatsApp ao Mister — nada é mandado.
      return recusa('Ninguém mais desta empresa ligou o WhatsApp ao Mister. Cada um liga o seu em Mister › Pessoas.');
    case 'corrigir_documento':
      // M3g: na loja de teste não há boleto lançado pelo Mister — nada é corrigido.
      return recusa('Não achei boleto lançado pelo Mister, ainda em aberto, com esse nome.');
    case 'link_para_encaminhar':
      // M3c (mig 443): na avaliação nenhum link nasce (a loja de teste não manda nada para fora).
      return recusa('O link para quem não tem usuário ainda não está ligado no Regem. Dá para mandar o relatório em PDF e encaminhar o arquivo.');
    case 'cancelar_links':
      return { ok: true, dados: { cancelados: 0, siga: 'Diga que não havia link para encaminhar valendo nesta empresa.' } };
    case 'gasto_do_whatsapp':
      // G3 do gasto do WhatsApp oficial: só o presidente; a loja de teste usa a API oficial, com o gasto de novembro.
      if (perfil.nivel !== 'presidente') return recusa('O gasto do WhatsApp oficial é do presidente: só ele vê.');
      return ok({
        oficial: true,
        mes: 'novembro de 2026',
        moeda: 'BRL',
        ateAgora: 205.43,
        lidoAs: '13/11 20:00',
        mensagensEntregues: 2790,
        mensagensCobradas: 1790,
        porTipo: [
          { tipo: 'marketing', gasto: 160.21, mensagens: 498, gratis: 0 },
          { tipo: 'avisos do pedido (utilidade)', gasto: 38.22, mensagens: 1092, gratis: 0 },
          { tipo: 'atendimento', gasto: 7, mensagens: 1200, gratis: 1000 },
        ],
        atendimentoGratis: [{ numeroFinal: '2210', usadas: 1200, de: 1000, acabou: true }],
        projecaoDoMes: 474,
        ateOMesmoDiaDoMesPassado: 61.3,
        onde: 'Veja no Regem, no menu WhatsApp, em "Uso e gasto".',
        aviso: 'Valores aproximados que a Meta informa; a fatura oficial é a da Meta.',
      });
    case 'lembrar': {
      // Versão 4, M4b (mig 449): na avaliação nada se grava — devolve como a de verdade devolveria (a mesma conferência).
      const c = conferirMemoria(en.texto);
      if (en.acao === 'anotar' && 'erro' in c) return recusa(c.erro);
      if (en.acao === 'anotar') return ok({ anotado: true, texto: (c as { texto: string }).texto, sobre: en.sobre === 'mim' ? 'esta pessoa' : 'a empresa', uso: '42 de 1.375 letras', siga: 'Diga em uma frase o que ficou anotado ("Anotado ✅ …").' });
      return recusa('Não achei isso no que está anotado.');
    }
    case 'ficar_de_olho': {
      // Versão 4, M4d (mig 452): na avaliação nada se marca — devolve como a de verdade devolveria (o pedido 284 da loja).
      if (en.acao === 'listar') return ok({ marcados: [], observacao: 'Nenhum "fica de olho" ativo.' });
      if (en.acao !== 'comecar') return recusa('Não achei isso no que está marcado.');
      // M4d parte 2: o iFood pausado e o caixa da Bruna aberto da loja de teste; nenhuma impressora parada.
      const combinado = (oQue: string, quando: string) => ok({ combinado: true, oQue, avisaQuando: quando, ate: 'as 06:00', siga: `Diga em uma frase que vai ficar de olho e avisar quando ${quando}.` });
      if (en.alvo === 'canal') return canalDito(en.qual) === 'ifood' ? combinado('iFood', 'ele reabrir') : recusa(`O canal não está pausado agora em ${LOJA}: não há o que olhar.`);
      if (en.alvo === 'caixa') return combinado('caixa do balcão (aberto por Bruna)', 'ele fechar');
      if (en.alvo === 'impressora') return recusa(`Nenhuma impressora parada agora em ${LOJA}: não há o que olhar.`);
      const n = String(en.numero ?? '').replace(/\D/g, '');
      if (n !== '284' && n !== '4821') return recusa(`Não achei pedido dos canais com o número ${en.numero ?? ''} nos últimos 3 dias em ${LOJA}.`);
      return ok({ combinado: true, pedido: '#284 · iFood 4821', situacaoAgora: 'em preparo', ate: 'as 06:00', siga: 'Diga em uma frase que vai ficar de olho no pedido e avisar quando ele mudar.' });
    }
    case 'lembrete': {
      // M4d: a mesma conferência da de verdade, com o "agora" da loja de teste.
      if (en.acao === 'listar') return ok({ marcados: [], observacao: 'Nenhum lembrete marcado.' });
      if (en.acao !== 'criar') return recusa('Não achei isso no que está marcado.');
      const t = conferirTextoDoLembrete(en.texto);
      if ('erro' in t) return recusa(t.erro);
      const w = lerQuando(en.quando, AGORA_DA_AVALIACAO_INSTANTE);
      if ('erro' in w) return recusa(w.erro);
      const quando = quandoNaConversa(w.quando, AGORA_DA_AVALIACAO_INSTANTE);
      return ok({ marcado: true, lembrete: t.texto, quando, siga: `Repita em uma frase o dia e a hora ("Combinado: ${quando}").` });
    }
    case 'regras': {
      // Versão 6, M6e: a mesma conferência e a mesma descrição da de verdade; na avaliação nada é guardado.
      if (en.acao === 'listar')
        return ok({
          regras: [{ id: ID_DA_REGRA_DA_AVALIACAO, titulo: REGRA_DA_AVALIACAO.titulo, situacao: 'ativa', oQueFaz: descreverRegra(REGRA_DA_AVALIACAO), ultimoAviso: 'ainda não avisou' }],
          propostaAberta: {
            id: '00000000-0000-4000-8000-000000000003',
            titulo: PROPOSTA_DA_AVALIACAO.titulo,
            oQueVouFazer: descreverRegra(PROPOSTA_DA_AVALIACAO),
            regra: PROPOSTA_DA_AVALIACAO,
            valeAte: '20:40',
            siga: 'Ainda não está ligada. Para ajustar, chame propor com esta regra mudando SÓ o que a pessoa pediu: a nova fica no lugar desta.',
          },
        });
      if (en.acao === 'conferir') {
        // V7c: o dia da regra na loja de teste. O máximo foi 2: ela não teve o que avisar; com 5 minutos a menos, teria avisado.
        if (en.regraId && en.regraId !== ID_DA_REGRA_DA_AVALIACAO) return recusa('Não achei essa regra. Se precisar, me peça a lista das suas regras.');
        return ok({
          id: ID_DA_REGRA_DA_AVALIACAO,
          titulo: REGRA_DA_AVALIACAO.titulo,
          situacao: 'ativa',
          oQueFaz: descreverRegra(REGRA_DA_AVALIACAO),
          ligadaDesde: '12/11 21:06',
          ultimoAviso: 'ainda não avisou',
          avisosNoDia: 0,
          hoje: {
            desde: '06:00',
            ate: '20:15',
            tempoDaRegraEmMinutos: 25,
            maximoAoMesmoTempo: 2,
            as: '19:48',
            teriaAvisado: false,
            vezes: 0,
            primeiraVez: null,
            comMenosTempo: { minutos: 20, maximoAoMesmoTempo: 3, as: '19:52', teriaAvisado: true, vezes: 1, primeiraVez: '19:52' },
          },
          siga: 'Responda pelo que veio, em frases de gente: se ela está ligada e desde quando, o último aviso e o que o dia mostrou. A regra existe: nunca diga o contrário. Se vier "comMenosTempo", ofereça a mudança como sugestão, separada dos números, e só mude se a pessoa pedir.',
        });
      }
      if (en.acao === 'buscar') return ok({ itens: [], aviso: 'Nenhum item com esse nome na loja de teste.' });
      if (en.acao !== 'propor') return recusa('Não achei essa regra.');
      const r = conferirRegra(
        en.regra,
        { presidente: perfil.nivel === 'presidente', pode: () => perfil.nivel === 'presidente', verValores: perfil.verValores },
        (t) => ehTipoDeAviso(t) && !(AVISOS_QUE_NAO_SE_CALAM as readonly string[]).includes(t),
      );
      if ('erro' in r) return recusa(r.erro);
      return ok({
        id: '00000000-0000-4000-8000-000000000001',
        titulo: r.regra.titulo,
        oQueVouFazer: descreverRegra(r.regra),
        ...(r.regra.substitui?.length ? { dizerAntesDoConfirmar: fraseDoQueDeixaDeChegar(r.regra.substitui) } : {}),
        siga: 'Mostre o "oQueVouFazer" como veio e diga que os botões Confirmar e Mudar vão junto. Nada liga sem o Confirmar.',
      });
    }
    case 'refazer_grafico':
      // Versão 6, M6i: na avaliação não há gráfico guardado — a resposta é a de quem não tem o que refazer.
      return recusa('Não tenho um gráfico desta conversa nos últimos 30 minutos: peça o gráfico de novo (mostrar_grafico).');
    case 'propor_acao': {
      // Versão 6, M6j: a mesma conferência da de verdade (os motivos e os tempos da tela); na avaliação nada é proposto nem feito.
      const c = conferirAcao(en.acao, en);
      if ('erro' in c) return recusa(c.erro);
      const p = c.parametros;
      const resumo = p.acao === 'aceitar_pedido' || p.acao === 'pedido_pronto' || p.acao === 'despachar_pedido' ? resumoDoPedido(p.acao, `#${p.numero}`) : c.resumo;
      return ok({ oQueVouFazer: resumo, siga: sigaDaAcao(p.acao) });
    }
    case 'propor_plano': {
      // Versão 7, V7c: a mesma leitura dos passos e a mesma conferência de cada ação; na avaliação nada é proposto nem feito.
      const l = lerPassos(en.passos);
      if ('erro' in l) return recusa(l.erro);
      const passos: { nivel: 'botao' | 'pin'; resumo: string }[] = [];
      for (const [i, passo] of l.passos.entries()) {
        const c = conferirAcao(passo.acao, passo);
        if ('erro' in c) return recusa(`Passo ${i + 1}: ${c.erro}`);
        const p = c.parametros;
        passos.push({ nivel: ACOES[p.acao].nivel, resumo: p.acao === 'aceitar_pedido' || p.acao === 'pedido_pronto' || p.acao === 'despachar_pedido' ? resumoDoPedido(p.acao, `#${p.numero}`) : c.resumo });
      }
      return ok({
        oQueVouFazer: textoDoPlano(passos),
        botao: botoesDoPlano('00000000-0000-4000-8000-000000000004', passos.length)[0].titulo,
        siga: 'Diga em uma frase o que vai fazer. O plano numerado e o botão chegam logo abaixo: não repita a lista. Nada é feito antes do toque, e o passo de PIN pede o PIN pelo link. Não diga que fez.',
      });
    }
    case 'lista_de_compras': {
      // Versão 6, M6g: a mesma leitura das linhas da de verdade; na avaliação nenhuma lista é guardada nem pedida.
      if (en.acao === 'do_minimo') return ok({ vazia: true, mensagem: 'Nada está abaixo do mínimo no estoque agora: não há o que pôr na lista.' });
      if (en.acao === 'da_leitura') return recusa('Não tenho uma lista lida nas últimas 2 horas: peça para a pessoa mandar o arquivo de novo.');
      // Versão 9, O4: repetir o último pedido e mudar a lista aberta (na avaliação nada é gravado).
      if (en.acao === 'repetir')
        return ok({
          repetido: 'Lista do Mister · 24/11',
          de: '24/11',
          fornecedor: 'Felipão da Penha',
          linhas: 19,
          orientacao: 'Diga em uma frase de qual pedido veio; o resumo com "Criar o pedido" sai sozinho logo depois. Nada foi pedido.',
        });
      if (en.acao === 'alterar') {
        const l = lerAlteracoesDaLista(en.alteracoes);
        if ('erro' in l) return recusa(l.erro);
        return ok({ gravado: true, feito: l.alteracoes.map((a) => `Linha ${a.linha} mudou.`), siga: 'Diga em uma frase o que mudou. Nada foi pedido.' });
      }
      if (en.acao !== 'montar') return recusa('acao precisa ser montar, da_leitura, do_minimo, alterar ou repetir.');
      const pedidos = lerPedidos(en.itens);
      if (!pedidos.length) return recusa('Não entendi as linhas da lista: mande cada produto com a quantidade (ex.: "10 kg de bacon, 5 caixas de tomate").');
      return ok({
        montada: true,
        linhas: pedidos.length,
        ligadas: 0,
        perguntas: pedidos.length,
        orientacao: 'Diga em uma frase quantas linhas entraram e que as dúvidas vêm a seguir, com botões. Não repita a lista.',
      });
    }
    case 'pedidos_de_compra':
      // ERR-594: o pedido que o próprio Mister montou de manhã.
      return ok({
        loja: LOJA,
        pedidos: [{ nome: 'Lista do Mister · 23/11', fornecedor: 'Felipão da Penha', situacao: 'aguardando recebimento', criado: '23/11 06:12', itens: 19, produtos: ['Bacon', 'Carne 120gr', 'Queijo cheddar'], quemCriou: 'você (o Mister), a pedido de Ana' }],
      });
    case 'documento_em_andamento': {
      // ERR-594: a mesma conferência da de verdade; na avaliação nada é gravado.
      if (perfil.nivel !== 'presidente') return recusa('Mexer em nota por foto, por enquanto, é só com o presidente.');
      if (en.acao === 'alterar') {
        const l = lerAlteracoes(en.alteracoes);
        if ('erro' in l) return recusa(l.erro);
        return ok({
          gravado: true,
          feito: l.alteracoes.map((a) => (a.tipo === 'corrigir' && a.valorTotalCentavos ? `Linha ${a.linha} corrigida, total R$ ${(a.valorTotalCentavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : `Linha ${a.linha} gravada.`)),
          faltam: 1,
          lancado: false,
          siga: 'Diga em uma frase o que foi gravado, como está em "feito". A próxima pergunta do documento sai sozinha logo depois da sua resposta: não repita nem pergunte. Nada foi lançado.',
        });
      }
      return ok({
        documento: 'Cupom fiscal',
        emitente: 'Distribuidora Sul',
        situacao: 'faltam respostas',
        linhas: [
          { linha: 1, produto: 'BATATA 7MM 2250gx8', quantidade: 35, unidade: 'UN', ...(perfil.verValores ? { valorTotal: 7277.2 } : {}), situacao: 'Caixa de batata 7mm (1 UN = 1 caixa)' },
          { linha: 5, produto: 'QUEIJO CHEDDAR FATIADO', quantidade: 3, unidade: 'UN', ...(perfil.verValores ? { valorTotal: 2219.76 } : {}), situacao: 'falta dizer qual insumo é' },
        ],
      });
    }
    case 'escrever_recado':
      // M3g parte 2 (mig 444): na avaliação nenhum rascunho é guardado (e nada é publicado) — devolve o texto como ficaria.
      return {
        ok: true,
        dados: {
          comoFicou: typeof en.texto === 'string' ? en.texto.trim() : '',
          ondeVai: 'Mural & clima da Loja Centro',
          siga: 'Mostre o texto de "comoFicou" entre aspas e pergunte se publica no Mural & clima da Loja Centro. Não diga que publicou.',
        },
      };
    // Versão 5, M5d.2: o gráfico na conversa. Na loja de teste, os mesmos números das vendas por hora; a imagem não
    // existe aqui (a avaliação confere só o texto) — o resultado diz o mesmo que o de verdade diz ao modelo.
    case 'mostrar_grafico': {
      const p = periodoPedido(en);
      const porHora = (POR_HORA[p] ?? []).map(([h, n, t]) => ({ hora: `${h}h`, vendas: n, faturamento: v(t) }));
      return ok({
        loja: LOJA,
        periodo: ROTULO[p],
        grafico: 'A imagem do gráfico vai antes da sua resposta, pelo Regem: diga em 2 ou 3 frases o que importa (o total, a comparação, o destaque), sem descrever as barras uma a uma.',
        titulo: String(en.tipo ?? '') === 'vendas_por_hora' ? 'Vendas por hora' : 'Vendas por dia',
        numeroPrincipal: perfil.verValores ? `R$ ${VENDAS[p].faturado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : `${VENDAS[p].vendas} vendas`,
        comparacao: null,
        pontos: porHora,
        ...(perfil.verValores ? {} : { aviso: SEM_VALORES }),
      });
    }
    // Versão 8, E1: o que vem aí. As duas previsões discordam na sexta, e a resposta tem de dizer isso.
    case 'clima_e_eventos': {
      // Versão 8, E2: a comparação com a venda. A chuva ainda tem poucos dias guardados: a resposta diz isso (V8-10).
      if (en.comparar === 'chuva')
        return ok({
          loja: LOJA,
          comparando: 'dia com chuva prevista na véspera',
          periodo: 'de 26/05 a 22/11',
          ainda: true,
          diasGravados: 6,
          precisaDe: 60,
          daParaCompararPorVoltaDe: '19/01',
          oQueFalta: 'Só tenho 6 dias de previsão guardados. Para comparar, preciso de cerca de 60.',
        });
      if (en.comparar)
        return ok({
          loja: LOJA,
          comparando: 'dia de jogo na cidade',
          periodo: 'de 26/05 a 22/11',
          diasComparados: 5,
          quais: ['quarta, 07/10', 'domingo, 18/10', 'quarta, 28/10', 'domingo, 08/11', 'sábado, 21/11'],
          comparadoCom: 'o mesmo dia da semana nas 8 semanas antes, sem evento e com a loja aberta',
          pedidosPorDia: { emDiasAssim: 132.4, diasComuns: 112, variacaoPct: 18.2 },
          ...(perfil.verValores ? { vendaPorDia: { emDiasAssim: 6840.2, diasComuns: 5790.1, variacaoPct: 18.1 } } : { aviso: SEM_VALORES }),
        });
      const previsaoDaSexta = {
        inmet: { resumo: 'Pancadas de chuva isoladas', minima: 23, maxima: 33, chuva: true },
        cptec: { resumo: 'Parcialmente nublado', minima: 24, maxima: 31, chuva: false },
        chuva: 'discordam',
      };
      const sexta = { dia: '2026-11-27', rotulo: 'sexta, 27/11', eventos: [{ tipo: 'Data comemorativa', nome: 'Black Friday' }], previsao: previsaoDaSexta };
      const segunda = { dia: '2026-11-23', rotulo: 'segunda, 23/11', eventos: [{ tipo: 'Jogo', nome: 'Botafogo x São Paulo', hora: '20:00', alcance: 'cidade' }], previsao: null };
      return ok({
        loja: LOJA,
        periodo: en.dia ? 'sexta, 27/11' : 'de 23/11 a 29/11',
        situacaoDaPrevisao: 'ok',
        dias: en.dia ? [sexta] : [segunda, sexta],
        avisos: ['A previsão só vai até 27/11.'],
        fontesDaPrevisao: 'INMET e CPTEC/INPE',
      });
    }
    // Versão 7, V7f: os indicadores. O caso de sempre é o da loja real: nenhum custo lançado. Setembro é o mês com custo.
    case 'indicadores_financeiros': {
      const foco = String(en.foco ?? '');
      const semV = perfil.verValores ? {} : { aviso: SEM_VALORES };
      if (foco === 'margem') {
        if (!perfil.verValores) return ok({ loja: LOJA, foco, semDados: true, aviso: SEM_VALORES });
        if (String(en.de ?? '').startsWith('2026-09'))
          return ok({
            loja: LOJA,
            foco,
            periodo: 'de 01/09 a 30/09',
            cobertura: { vendaOficial: 158240.35, pedidos: 3312, vendaComCustoCompleto: 145581.12, partePct: 92 },
            parcial: false,
            margemBruta: { pct: 65.8, valor: 95792.38 },
            cmv: { pct: 34.2, valor: 49788.74 },
            comoContei: 'Venda oficial do período contra o custo teórico da ficha, com o custo de HOJE do cadastro.',
            comparacao: null,
            avisos: ['O número vale para 92% da venda; o resto fica fora da conta.'],
          });
        return ok({
          loja: LOJA,
          foco,
          periodo: 'mês passado (de 01/10 a 31/10)',
          semDados: true,
          cobertura: { vendaOficial: 161190.45, pedidos: 3420, vendaComCustoCompleto: 0, partePct: 0 },
          margemBruta: null,
          cmv: null,
          explica: 'Nenhum produto vendido tem custo completo: não dá para calcular a margem nem o CMV. Não diga 100% de margem nem R$ 0 de custo.',
          oQueFalta: [
            '2 produtos com ficha têm ingrediente sem custo (Smash duplo e Batata rústica). Ingrediente sem custo não é custo zero: esses produtos ficam fora da conta.',
            'Para lançar o custo: Estoque › aba "Recebimento", botão "Nota avulsa" (ou "Conferir", no pedido que chegou), com o custo de cada item.',
          ],
        });
      }
      if (foco === 'inadimplencia')
        return ok({
          loja: LOJA,
          foco,
          contasEmAberto: 11,
          contasVencidas: 3,
          diasDaMaisAntiga: 41,
          inadimplenciaPct: perfil.verValores ? 14 : null,
          vencido: v(1180.45),
          totalAReceber: v(8420.35),
          ondeVer: 'Os nomes ficam em Financeiro › Contas a pagar, no filtro "A receber". Dado de cliente não sai por aqui.',
          ...semV,
        });
      if (foco === 'prazo_pagamento')
        return ok({ loja: LOJA, foco, periodo: 'últimos 90 dias', prazoMedioDias: 18, titulosPagos: 24, comparacao: { periodo: 'os 90 dias anteriores', prazoMedioDias: 21, titulosPagos: 22, diferencaEmDias: -3 } });
      if (foco === 'caixa') {
        if (perfil.nivel !== 'presidente') return recusa('O caixa, com o saldo e a folha informados, é só do presidente.');
        if (perfil.extrato) {
          const encolhe = perfil.extrato === 'encolhendo';
          return ok({
            foco,
            alcance: 'a empresa inteira',
            fonte: 'extrato do banco',
            saldo: { valor: 38420, em: '12/11', origem: 'do extrato do banco' },
            mesesNoBanco: encolhe
              ? [{ mes: 'agosto', entrou: 10000, saiu: 16500, sobrouOuFaltou: -6500 }, { mes: 'setembro', entrou: 10000, saiu: 15700, sobrouOuFaltou: -5700 }, { mes: 'outubro', entrou: 10000, saiu: 16550, sobrouOuFaltou: -6550 }]
              : [{ mes: 'agosto', entrou: 12140, saiu: 10000, sobrouOuFaltou: 2140 }, { mes: 'setembro', entrou: 11380, saiu: 10000, sobrouOuFaltou: 1380 }, { mes: 'outubro', entrou: 13010, saiu: 10000, sobrouOuFaltou: 3010 }],
            situacao: encolhe ? 'caixa_encolhendo' : 'gerando_caixa',
            mediaPorMes: encolhe ? -6250 : 2176.67,
            burnRate: encolhe ? 6250 : null,
            runwayEmMeses: encolhe ? 6.1 : null,
            ...(encolhe ? {} : { porQueNaoTemRunway: 'A loja não está gastando mais do que entra: não faz sentido dizer quanto tempo o caixa dura.' }),
            foraDaConta: 'Transferências entre as suas contas e o que você marcou como não sendo da loja.',
            avisos: ['A conta só enxerga o que passou no banco: o dinheiro que fica no caixa da loja e não é depositado não aparece.', 'O que vence depois do último extrato não está nessa conta.'],
          });
        }
        return ok({
          foco,
          alcance: 'a empresa inteira',
          saldo: null,
          folhaMensal: null,
          saidasDoMes: { mes: 'outubro', lancadas: 128400.35, comAFolhaInformada: null, foraDaConta: 2300.15, oQueFicaFora: 'Sangria, estorno e devolução não são despesa e ficam fora.' },
          diasQueOSaldoCobre: null,
          burnRate: null,
          runwayEmMeses: null,
          porQueNaoTemRunway: 'O burn rate e o runway saem do extrato do banco, com os 3 meses fechados (agosto, setembro e outubro) completos.',
          faltaNoBanco: ['O extrato do banco de agosto, setembro e outubro: baixe em OFX no site ou no app do banco e importe em Financeiro › Banco e repasses.'],
          oQueFalta: ['O saldo de hoje no banco: peça à pessoa.', 'Quanto sai de folha por mês, que não está lançada no Regem: peça à pessoa.'],
          semDados: true,
        });
      }
      if (foco === 'roi_campanha')
        return ok({
          loja: LOJA,
          foco,
          campanha: 'SMASH10',
          desde: '20/10',
          pedidosComCupom: 64,
          faturamento: v(3840.45),
          semDados: true,
          roiPct: null,
          custoInformado: null,
          explica: 'Sem o custo da mercadoria destas vendas não dá para calcular o ROI. Não use o faturamento no lugar da margem.',
          oQueFalta: ['Quanto foi gasto na campanha: peça à pessoa.', '2 produtos com ficha têm ingrediente sem custo (Smash duplo e Batata rústica).'],
          ...semV,
        });
      return ok({ loja: LOJA, foco, semDados: true, oQueFalta: ['Os repasses do iFood, da 99 e do cartão, que o Regem ainda não lê.'] });
    }
    // Versão 7, V7e: as análises, com as MESMAS chaves da de verdade e números inventados que batem entre si.
    case 'analisar_vendas': {
      const foco = String(en.foco ?? '');
      const semV = perfil.verValores ? {} : { aviso: SEM_VALORES };
      if (foco === 'semana')
        return ok({
          loja: LOJA,
          foco,
          periodo: 'semana passada (de 02/11 a 08/11)',
          comparadoCom: 'de 26/10 a 01/11',
          faturamento: v(38420.35),
          pedidos: 812,
          ticketMedio: v(47.32),
          diasComVenda: 7,
          anterior: { faturamento: v(34303.85), pedidos: 745, ticketMedio: v(46.05), diasComVenda: 7 },
          variacaoPct: { faturamento: perfil.verValores ? 12 : null, pedidos: 9, ticketMedio: perfil.verValores ? 2.8 : null },
          diferencaDeFaturamento: perfil.verValores ? { valor: 4116.5, sentido: 'a mais' } : null,
          porDiaDaSemana: [
            { dia: 'Seg', data: '02/11', pedidos: 61, faturamento: v(2890.15), ticketMedio: v(47.38), partePct: 8 },
            { dia: 'Sex', data: '06/11', pedidos: 168, faturamento: v(7980.45), ticketMedio: v(47.5), partePct: 21 },
            { dia: 'Sáb', data: '07/11', pedidos: 182, faturamento: v(8640.25), ticketMedio: v(47.47), partePct: 22 },
          ],
          doisMelhoresDias: { dias: ['sexta', 'sábado'], pedidos: 350, faturamento: v(16620.7), ticketMedio: v(47.49), partePct: 43 },
          diaMaisFraco: { dia: 'segunda', pedidos: 61, faturamento: v(2890.15), ticketMedio: v(47.38), partePct: 8 },
          ...semV,
        });
      if (foco === 'pico')
        return ok({
          loja: LOJA,
          foco,
          periodo: 'as últimas 4 sextas (de 16/10 a 06/11)',
          diasOlhados: 4,
          diasComVenda: 4,
          comoContei: 'O dia vai das 06:00 às 05:59 do dia seguinte: a venda depois da meia-noite conta na noite em que começou.',
          totalDoDia: { pedidos: 672, faturamento: v(31840.6) },
          porHora: [
            { hora: '19h', pedidos: 96, faturamento: v(4530.2), partePct: 14 },
            { hora: '20h', pedidos: 201, faturamento: v(9590.15), partePct: 30 },
            { hora: '21h', pedidos: 187, faturamento: v(8870.35), partePct: 28 },
          ],
          faixaDePico: { de: '20h', ate: '22h', pedidos: 388, faturamento: v(18460.5), partePct: 58, mediaPorDia: { pedidos: 97, faturamento: v(4615.13) } },
          pedidosComItens: 388,
          itensQueMaisSaem: [
            { item: 'Smash duplo', quantidade: 232, emPedidos: 201, de: 388 },
            { item: 'Batata rústica', quantidade: 184, emPedidos: 171, de: 388 },
          ],
          saemJuntos: [{ itens: 'Batata rústica + Smash duplo', juntos: 152, de: 388, frase: 'em 152 de 388 pedidos', partePct: 39 }],
          ...semV,
        });
      if (foco === 'fases_do_mes')
        return ok({
          loja: LOJA,
          foco,
          periodo: '01/08 a 31/10',
          mesesOlhados: 'agosto, setembro e outubro',
          comoContei: 'A venda, os pedidos e o ticket por dia contam só os dias em que a loja vendeu: dia fechado não puxa a média para baixo.',
          fases: [
            { fase: 'dias 1 a 10', diasComVenda: 29, pedidos: 3567, faturamento: v(177625.15), vendaPorDia: v(6125.01), pedidosPorDia: 123, ticketMedio: v(49.8) },
            { fase: 'dias 11 a 20', diasComVenda: 29, pedidos: 3219, faturamento: v(152018.45), vendaPorDia: v(5242.02), pedidosPorDia: 111, ticketMedio: v(47.22) },
            { fase: 'dias 21 ao fim', diasComVenda: 31, pedidos: 3100, faturamento: v(133920.35), vendaPorDia: v(4320.01), pedidosPorDia: 100, ticketMedio: v(43.2) },
          ],
          doComecoParaOFim: { vendaPorDiaPct: perfil.verValores ? -29.5 : null, pedidosPorDiaPct: -18.7, ticketPct: perfil.verValores ? -13.3 : null },
          porMes: [],
          totalDosMeses: { pedidos: 9886, faturamento: v(463563.95) },
          ...semV,
        });
      if (foco === 'perdas')
        return ok({
          loja: LOJA,
          foco,
          periodo: 'últimos 30 dias (de 15/10 a 13/11)',
          comoSeparar: 'Cancelamento é venda que não entrou. Mercadoria perdida é custo que saiu do estoque. Fale dos dois separados e não some um com o outro.',
          cancelamentos: {
            naoEntrou: { pedidos: 19, valor: v(902.45) },
            porCausa: [
              { causa: 'fora da área de entrega', pedidos: 8, valor: v(412.95), partePct: 46 },
              { causa: 'sem motivo informado pelo canal', naoDizACausa: true, pedidos: 6, valor: v(312.35), partePct: 35 },
              { causa: 'pedido repetido', pedidos: 5, valor: v(177.15), partePct: 19 },
            ],
            principalCausa: { causa: 'fora da área de entrega', pedidos: 8, valor: v(412.95) },
            ondeSeConcentra: { diaDaSemana: { dia: 'sexta', pedidos: 7, partePct: 37 }, hora: { hora: '21h', pedidos: 6, partePct: 32 } },
            pedidosDeTeste: { pedidos: 2, valor: v(61.8), observacao: 'Pedido de teste não é perda: está fora do total.' },
            avisos: ['6 de 19 cancelamentos não dizem a causa (o canal não informou, ou não foi anotado): não conclua nada sobre eles.'],
          },
          mercadoriaPerdida: {
            valorPerdido: null,
            desperdicio: { registros: 0, registrosSemCusto: 0, valor: null, itens: [] },
            contagem: { itensContados: 0, itensComDiferenca: 0, valorQueFaltou: null, faltou: [] },
            oQueFalta: [
              'Nenhum desperdício lançado neste período. Para medir, a loja lança em Estoque › aba "Desperdício", botão "Registrar desperdício".',
              'Nenhuma contagem concluída neste período. Para achar diferença de estoque, a loja conta em Estoque › aba "Contagem".',
            ],
          },
          ...semV,
        });
      return recusa('Diga o foco da análise: "semana", "pico", "fases_do_mes", "perdas".');
    }
    case 'produtos_mais_vendidos': {
      const p = periodoPedido(en);
      const ordem = String(en.ordem ?? 'quantidade').trim().toLowerCase() || 'quantidade';
      if (ordem === 'lucro' || ordem === 'faturamento') {
        if (!perfil.verValores) return recusa(`O perfil desta pessoa no Regem não mostra valores em reais: não dá para ordenar por ${ordem}.`);
        const itens = [
          { produto: 'X-Bacon', quantidade: 212, faturamento: 4831.45, custo: 2019.0, lucro: 2812.45, margemPct: 58.2, classe: 'A' },
          { produto: 'X-Burger', quantidade: 301, faturamento: 5640.15, custo: 2850.0, lucro: 2790.15, margemPct: 49.5, classe: 'A' },
          { produto: 'Combo família', quantidade: 58, faturamento: 5095.35, custo: 2991.0, lucro: 2104.35, margemPct: 41.3, classe: 'A' },
        ];
        return ok({ loja: LOJA, periodo: ROTULO[p], ordenadoPor: ordem, produtosVendidosNoPeriodo: 41, comoLerAClasse: 'Classe A = os produtos que somam os primeiros 80% do faturamento; B = até 95%; C = o resto.', produtos: itens.map((i, n) => ({ posicao: n + 1, ...i })) });
      }
      const nomes: Array<[string, number]> = [
        ['X-Burger', 164],
        ['Batata frita média', 151],
        ['Coca-Cola lata', 148],
        ['X-Salada', 97],
        ['Milk-shake de chocolate', 79],
      ];
      const quantos = Math.min(15, Math.max(1, Number(en.quantos) || 5));
      return ok({
        loja: LOJA,
        periodo: ROTULO[p],
        ordenadoPor: 'quantidade',
        ...(perfil.verValores ? {} : { aviso: SEM_VALORES }),
        produtos: nomes.slice(0, quantos).map(([produto, quantidade], n) => ({ posicao: n + 1, produto, quantidade, faturamento: v(Math.round(quantidade * 23.45 * 100) / 100) })),
      });
    }
    // Fase N3: as notícias do ramo, pela MESMA montagem da consulta de verdade.
    case 'noticias_do_ramo': {
      const p = pedidoDasNoticias(en, '2026-11-13');
      return 'erro' in p ? recusa(p.erro) : ok(montarNoticias([BOLETIM_DA_AVALIACAO], p));
    }
    // O link para abrir: a MESMA montagem da ferramenta de verdade, com o guia e o boletim da loja de teste. O gerente de
    // teste tem as permissões das telas que não são só do presidente.
    case 'abrir_no_regem': {
      const p = pedidoDoLink(en);
      if ('erro' in p) return recusa(p.erro);
      return montarLinks(p, { abre: (s) => perfil.nivel === 'presidente' || !s.soPresidente, veNoticias: true }, 'https://app.dmsregem.com', [BOLETIM_DA_AVALIACAO]);
    }
    case 'insumo_vendido': {
      // M3c: os números da conversa 15 do protótipo (versão 3) — "carne 56 g" hoje; "carne" sozinha pede a escolha.
      const pedido = String(en.insumo ?? '').toLowerCase();
      if (!/carne|hamb|blend/.test(pedido)) return recusa('Não achei esse insumo no estoque. Pergunte o nome como está em Estoque › Produtos.');
      if (!/56|120/.test(pedido)) return ok({ precisaEscolher: ['Carne 56 g', 'Carne 120 g'], siga: 'Pergunte qual destes insumos a pessoa quis dizer, com os nomes como vieram, e consulte de novo com o escolhido.' });
      const de120 = /120/.test(pedido);
      const p = periodoPedido(en);
      return ok({
        loja: LOJA,
        periodo: ROTULO[p],
        insumo: de120 ? 'Carne 120 g' : 'Carne 56 g',
        unidadeDoEstoque: 'unidade',
        total: de120 ? 96 : 212,
        totalEmQuilos: de120 ? 11.52 : 11.872,
        porHora: [
          { rotulo: '18h', quantidade: de120 ? 6 : 12 },
          { rotulo: '19h', quantidade: de120 ? 22 : 48 },
          { rotulo: '20h', quantidade: de120 ? 31 : 71 },
          { rotulo: '21h', quantidade: de120 ? 25 : 54 },
          { rotulo: '22h', quantidade: de120 ? 12 : 27 },
        ],
        deOndeSaiu: de120
          ? [{ produto: 'X-Tudo', quantidade: 96, porUnidadeVendida: 1, unidadesVendidas: 96 }]
          : [
              { produto: 'X-Burger', quantidade: 120, porUnidadeVendida: 1, unidadesVendidas: 120 },
              { produto: 'Combo Duplo', quantidade: 64, porUnidadeVendida: 2, unidadesVendidas: 32 },
              { produto: 'Kids', quantidade: 28, porUnidadeVendida: 1, unidadesVendidas: 28 },
            ],
        comparacao: { mediaDasUltimas4: de120 ? 90.5 : 179.7, diferencaPct: de120 ? 6 : 18, contra: 'segundas anteriores, até a mesma hora' },
        fonte: 'As vendas fechadas, baixadas pela ficha técnica de cada produto (Estoque › Fichas técnicas). O total é o que saiu do estoque; cancelamento devolve.',
      });
    }
    case 'pedidos_em_andamento':
      return ok({
        loja: LOJA,
        lidoAs: '20:15',
        emAndamento: 5,
        marcadosParaDepois: 0,
        regra: 'Atrasado = passou do limite da etapa no KDS (cozinha: 12 min).',
        esperaHaMaisTempo: { pedido: '#284', canal: 'iFood · #4821', etapa: 'na cozinha', haMinutos: 23, atrasado: true },
        pedidos: [
          { pedido: '#284', canal: 'iFood · #4821', etapa: 'na cozinha', haMinutos: 23, atrasado: true },
          { pedido: '#286', canal: 'Balcão', etapa: 'na cozinha', haMinutos: 9, atrasado: false },
          { pedido: '#287', canal: '99 · #1177', etapa: 'esperando o entregador', haMinutos: 4, atrasado: false },
          { pedido: '#288', canal: 'Cardápio online', etapa: 'aceito', haMinutos: 2, atrasado: false },
          { pedido: '#289', canal: 'Mesa 4', etapa: 'na cozinha', haMinutos: 1, atrasado: false },
        ],
      });
    case 'estoque_em_alerta':
      return ok({
        loja: LOJA,
        abaixoDoMinimo: {
          total: 4,
          pagina: 1,
          paginas: 1,
          itens: [
            { item: 'Bacon fatiado', saldo: 0.8, minimo: 2, unidade: 'kg' },
            { item: 'Coca-Cola lata', saldo: 18, minimo: 48, unidade: 'un' },
            { item: 'Pão de hambúrguer', saldo: 12, minimo: 40, unidade: 'un' },
            { item: 'Queijo prato', saldo: 1.2, minimo: 3, unidade: 'kg' },
          ],
        },
        validades: {
          vencidos: 1,
          vencemEmAte2Dias: 2,
          vencemEmAte5Dias: 0,
          lotes: [
            { item: 'Maionese da casa', validade: '12/11/2026', diasParaVencer: -1, quantidade: 1.5, unidade: 'kg' },
            { item: 'Alface americana', validade: '14/11/2026', diasParaVencer: 1, quantidade: 3, unidade: 'un' },
            { item: 'Tomate', validade: '15/11/2026', diasParaVencer: 2, quantidade: 2.4, unidade: 'kg' },
          ],
        },
      });
    case 'servidor_e_incidentes':
      if (perfil.nivel !== 'presidente') return recusa(SEM_PERMISSAO);
      return ok({
        loja: LOJA,
        servidor: { situacao: 'no ar', versao: '1.30.12', ultimoSinal: 'há 1 minuto' },
        problemasEmAberto: { total: 0, lista: [] },
        resolvidosHoje: [{ problema: 'O servidor da loja ficou sem sinal por 6 minutos', desde: '13/11 19:40', resolvido: '13/11 19:46' }],
      });
    case 'cancelamentos': {
      const p = periodoPedido(en);
      return ok({
        loja: LOJA,
        periodo: ROTULO[p],
        pedidos: {
          cancelados: 3,
          valor: v(96.75),
          porCanal: [
            { canal: 'iFood', cancelados: 2 },
            { canal: 'Balcão', cancelados: 1 },
          ],
          porMotivo: [
            { motivo: 'o cliente desistiu', cancelados: 2 },
            { motivo: 'produto em falta', cancelados: 1 },
          ],
        },
        itensRemovidos: { removidos: 4, porMotivo: [{ motivo: 'pedido errado', removidos: 4 }] },
      });
    }
    case 'caixas_e_sangrias':
      return ok({
        loja: LOJA,
        periodo: ROTULO.hoje,
        lidoAs: '20:15',
        abertosAgora: [{ caixa: 'Caixa 1 · balcão', abertoPor: 'Bruna', abertoEm: '13/11 17:02', abertura: v(200.15), vendas: v(1830.15), sangrias: v(480.35), suprimentos: v(0) }],
        turnosAbertosNoPeriodo: 1,
        sangriasESuprimentos: [{ tipo: 'sangria', valor: v(480.35), hora: '19:30', por: 'Bruna', motivo: 'dinheiro demais no caixa' }],
        ...(perfil.verValores ? {} : { aviso: SEM_VALORES }),
      });
    case 'mesas_e_comandas':
      return ok({
        loja: LOJA,
        lidoAs: '20:15',
        mesasAbertas: 3,
        ...(perfil.verValores ? { emAbertoNasMesas: v(418.35), emAbertoNasComandas: v(38.9) } : { aviso: SEM_VALORES }),
        mesas: [
          { mesa: 'Mesa 4', abertaHaMin: 95, semLancarHaMin: 62, comandas: 1, itens: 7, ...(perfil.verValores ? { total: v(186.4) } : {}), abertaPor: 'Diego' },
          { mesa: 'Mesa 7', abertaHaMin: 40, semLancarHaMin: 5, comandas: 2, itens: 9, ...(perfil.verValores ? { total: v(171.2) } : {}), abertaPor: 'Diego' },
          { mesa: 'Mesa 12', abertaHaMin: 18, semLancarHaMin: 12, comandas: 1, itens: 3, ...(perfil.verValores ? { total: v(60.75) } : {}), abertaPor: 'Bruna' },
        ],
        comandasAvulsas: [{ comanda: 'balcão 2', abertaHaMin: 25, semLancarHaMin: 20, itens: 2, ...(perfil.verValores ? { total: v(38.9) } : {}) }],
        comoLer: '"semLancarHaMin" é há quantos minutos nada é lançado na mesa (a mesa parada). O nome do cliente da comanda não vem.',
      });
    case 'equipe_do_dia':
      return ok({
        loja: LOJA,
        dia: ROTULO.hoje,
        escala: {
          escalados: 8,
          vagasSemPessoa: 1,
          faltasAnotadas: 1,
          pessoas: [
            { nome: 'Carlos', funcao: 'chapeiro', turno: '17:00–23:00' },
            { nome: 'Bruna', funcao: 'caixa', turno: '17:00–23:00' },
            { nome: 'Ana', funcao: 'atendente', turno: '18:00–23:00' },
            { nome: 'Diego', funcao: 'entregador', turno: '18:00–23:00', falta: 'faltou (atestado)' },
          ],
        },
        ponto: {
          bateramPonto: 7,
          trabalhandoAgora: 6,
          pessoas: [
            { nome: 'Carlos', entrou: '16:58', trabalhandoAgora: true },
            { nome: 'Bruna', entrou: '16:55', trabalhandoAgora: true },
            { nome: 'Ana', entrou: '17:59', trabalhandoAgora: true },
          ],
        },
      });
    case 'historia_do_pedido': {
      const n = String(en.numero ?? '').replace(/\D/g, '');
      if (n !== '284' && n !== '4821') return recusa(`Não achei o pedido ${en.numero ?? ''} nos últimos dias.`);
      return ok({
        loja: LOJA,
        pedido: { numero: '#284', canal: 'iFood · #4821', situacao: 'saiu para entrega' },
        horarios: { chegou: '19:52', aceito: '19:53', cozinhaComecou: '19:55', pronto: '20:12', saiuParaEntrega: '20:18', entregue: null },
        tempoEntreAsEtapas: { ateAceitar: '1 min', naCozinha: '17 min', esperandoOEntregador: '6 min' },
        ondeDemorouMais: 'na cozinha: 17 min, e o limite do KDS para a cozinha é 12 min',
        cozinha: { estacoes: [{ estacao: 'Chapa', comecou: '19:55', terminou: '20:12' }] },
        limitesDoKds: { cozinhaMin: 12 },
      });
    }
    case 'tempos_dos_pedidos':
      return ok({
        loja: LOJA,
        periodo: ROTULO[periodoPedido(en)],
        pedidos: 46,
        doAceite: { medianaMin: 1, noventaPorCentoAteMin: 3 },
        ateFicarPronto: { medianaMin: 14, noventaPorCentoAteMin: 21 },
        ateSairParaEntrega: { medianaMin: 6, noventaPorCentoAteMin: 11 },
        ateEntregar: { medianaMin: 22, noventaPorCentoAteMin: 35 },
        porCanal: [
          { canal: 'iFood', pedidos: 29, ateEntregarMedianaMin: 24 },
          { canal: 'Cardápio online', pedidos: 10, ateEntregarMedianaMin: 19 },
          { canal: '99', pedidos: 7, ateEntregarMedianaMin: 21 },
        ],
      });
    case 'canais_e_integracoes':
      return ok({
        loja: LOJA,
        lidoAs: '20:15',
        canais: [
          { canal: 'iFood', pausa: { pausado: true, ate: '20:40', motivo: 'cozinha cheia' }, ultimoPedido: '20:11', ultimoPedidoHaMinutos: 4, pedidosHoje: 29 },
          { canal: '99', pausa: { pausado: false }, ultimoPedido: '19:37', ultimoPedidoHaMinutos: 38, pedidosHoje: 8 },
          { canal: 'Cardápio online', pausa: { pausado: false }, ultimoPedido: '20:03', ultimoPedidoHaMinutos: 12, pedidosHoje: 10 },
        ],
        loginDa99: { situacao: 'conectado' },
        whatsappDaLoja: { conexao: 'API oficial', ligado: true, conectadoAgora: true },
        notaFiscal: { ambiente: 'desligada' },
      });
    case 'conferencia_do_catalogo':
      return ok({
        loja: LOJA,
        apps: [
          {
            app: 'iFood',
            conferidoEm: '13/11 06:00',
            precoDiferente: [{ produto: 'X-Bacon', codigoPdv: '1012', noRegem: v(32.95), noApp: v(34.95) }],
            soNoApp: [{ produto: 'Combo casal' }],
            soNoRegem: [{ produto: 'Suco de laranja' }, { produto: 'Água com gás' }],
          },
          { app: '99', conferidoEm: '13/11 06:00', precoDiferente: [], soNoApp: [], soNoRegem: [] },
        ],
      });
    case 'atendimento_agora':
      return ok({
        loja: LOJA,
        lidoAs: '20:15',
        emAberto: 3,
        naFilaSemNinguem: 1,
        comPrazo: [{ assunto: 'Disputa', situacao: 'aberto', esperaHaMinutos: 41, prazo: 'a resposta ao iFood vence às 21:00' }],
        aguardandoOCliente: 1,
        resolvidosHoje: 9,
      });
    case 'conciliacao_do_periodo':
      return ok({
        loja: LOJA,
        periodo: ROTULO[periodoPedido(en) === 'hoje' ? 'esta_semana' : periodoPedido(en)],
        pixPagoEmPedidoCancelado: [{ pedido: '#271', dia: '11/11', valor: v(58.95), estorno: 'não feito' }],
        concluidoSemPagamento: [{ pedido: '#245', dia: '10/11', valor: v(41.85) }],
        notasRecusadas: 0,
        ...(perfil.verValores ? {} : { aviso: SEM_VALORES }),
      });
    // Versão 6, M6j lote 6: os clientes da loja de teste, só em números (a soma dos grupos fecha com o total).
    case 'clientes_em_numeros':
      return ok({
        ligado: true,
        abrangencia: 'a empresa inteira',
        total: 412,
        grupos: [
          { grupo: 'Campeões', clientes: 38 },
          { grupo: 'Leais', clientes: 74 },
          { grupo: 'Recentes', clientes: 96 },
          { grupo: 'Precisam de atenção', clientes: 61 },
          { grupo: 'Em risco', clientes: 57 },
          { grupo: 'Inativos', clientes: 86 },
        ],
        olharamENaoPediram: 23,
        atualizadoEm: '13/11, 04:10',
      });
    // Versão 6, M6j lote 5: as faltas e as horas da loja de teste (sem motivo nem atestado, como a de verdade).
    case 'faltas_e_horas': {
      const periodo = ROTULO[periodoPedido(en)];
      const pessoa = String(en.pessoa ?? '').trim().toLowerCase();
      if (!pessoa)
        return ok({
          loja: LOJA,
          periodo,
          totalDeFaltas: 3,
          justificadas: 1,
          injustificadas: 2,
          pessoas: [
            { nome: 'Diego', justificadas: 1, injustificadas: 1, dias: ['08/11', '13/11'] },
            { nome: 'Bruna', justificadas: 0, injustificadas: 1, dias: ['05/11'] },
          ],
        });
      if (!pessoa.includes('bruna')) return recusa(`Não achei ninguém com o nome "${pessoa}" nesta loja.`);
      return ok({
        loja: LOJA,
        periodo,
        pessoa: 'Bruna',
        faltas: { justificadas: 0, injustificadas: 1, dias: ['05/11'] },
        horas: { trabalhado: '132h 30min', abonos: '0min', previsto: '128h 00min', extra: '4h 30min', noturno: '18h 00min', saldo: '+4h 30min', diasComPonto: 23, observacao: 'Prévia gerencial: a conta oficial é a do fechamento do ponto.' },
      });
    }
    // Versão 6, M6j lote 4: as contas em aberto da loja de teste (a soma das faixas fecha com o total).
    case 'contas_a_pagar_e_receber': {
      const f = (quantas: number, valor: number) => ({ quantas, valor: v(valor) });
      return ok({
        loja: LOJA,
        hoje: '13/11',
        aPagar: { ...f(9, 3240.55), vencidas: f(2, 420), venceHoje: f(0, 0), proximos7Dias: f(3, 1150.55), restoDoMes: f(2, 870), depois: f(2, 800), semData: f(0, 0), ateOFimDoMes: f(7, 2440.55) },
        aReceber: { ...f(1, 310), vencidas: f(0, 0), venceHoje: f(0, 0), proximos7Dias: f(1, 310), restoDoMes: f(0, 0), depois: f(0, 0), semData: f(0, 0), ateOFimDoMes: f(1, 310) },
        proximasAPagar: [
          { descricao: 'Boleto de carnes', fornecedor: 'Distribuidora Boi Bom', valor: v(300), vencimento: '10/11', situacao: 'vencida' },
          { descricao: 'Gás', fornecedor: 'Gás Rio', valor: v(120), vencimento: '12/11', situacao: 'vencida' },
          { descricao: 'Embalagens', fornecedor: 'Papel & Cia', valor: v(650.55), vencimento: '16/11', situacao: 'a vencer' },
          { descricao: 'Bebidas', fornecedor: 'Distribuidora Gelada', valor: v(300), vencimento: '18/11', situacao: 'a vencer' },
          { descricao: 'Internet', fornecedor: 'Rede Rio', valor: v(200), vencimento: '20/11', situacao: 'a vencer' },
          { descricao: 'Hortifruti', fornecedor: 'Horta Viva', valor: v(500), vencimento: '25/11', situacao: 'a vencer' },
          { descricao: 'Energia', fornecedor: 'Companhia de Luz', valor: v(370), vencimento: '28/11', situacao: 'a vencer' },
          { descricao: 'Aluguel', fornecedor: null, valor: v(450), vencimento: '05/12', situacao: 'a vencer' },
          { descricao: 'Contador', fornecedor: null, valor: v(350), vencimento: '10/12', situacao: 'a vencer' },
        ],
        ...(perfil.verValores ? {} : { aviso: SEM_VALORES }),
      });
    }
    case 'vencimentos_e_versoes':
      return ok({
        loja: LOJA,
        certificados: [{ titular: 'Lanchonete da Avaliação Ltda', venceEm: '18/11/2026', diasParaVencer: 5, notaFiscalLigada: false }],
        tabelaDoIbpt: { uf: 'RJ', valeAte: '31/10/2026', situacao: 'vencida' },
        servidorDaLoja: perfil.nivel === 'presidente' ? { licencaAte: '19/02/2027', versaoInstalada: '1.30.12', versaoDisponivel: '1.30.13' } : { aviso: SEM_PERMISSAO },
        instagram: { situacao: 'ligado' },
        pedeAtencao: [
          'O certificado digital vence em 18/11/2026 (em 5 dias): Financeiro › Configuração.',
          'A tabela do IBPT do RJ venceu em 31/10/2026: a nota sai sem o valor aproximado dos tributos.',
          ...(perfil.nivel === 'presidente' ? ['O servidor da loja está na 1.30.12 e a 1.30.13 já está disponível.'] : []),
        ],
      });
    case 'como_usar_o_regem': {
      // O guia de verdade (é do código, igual para toda empresa); a pessoa da avaliação abre todas as telas.
      const assunto = typeof en.assunto === 'string' ? en.assunto.trim().slice(0, 200) : '';
      if (!assunto) return recusa('Diga o assunto: o que a pessoa quer fazer ou achar no Regem.');
      const achadas = buscarNoGuia(assunto, GUIA_DE_USO);
      if (!achadas.length) return ok({ encontrado: false, assunto, assuntosDoGuia: GUIA_DE_USO.map((s) => s.titulo) });
      return ok({ encontrado: true, assunto, secoes: achadas.map((s) => ({ assunto: s.titulo, ondeFica: s.caminho.join(' › '), quemAbre: quemAbre(s), estaPessoaAbre: true, passos: s.passos })) });
    }
    case 'conversas_anteriores': {
      // Versão 4: uma conversa guardada da loja de teste (a do iFood de sexta), com o mesmo formato da de verdade.
      const resposta = 'Sexta, 14/11, o iFood teve 23 pedidos e R$ 1.874,20; o cancelado foi o #188, por falta de entregador.';
      return ok({
        busca: typeof en.busca === 'string' ? en.busca.slice(0, 60) : '',
        dias: 30,
        achadas: 1,
        conversas: [
          {
            quando: '15/11 às 10:12',
            pergunta: 'como foi o iFood ontem?',
            resposta: perfil.verValores ? resposta : resposta.replace('R$ 1.874,20', 'R$ (oculto)'),
            consultasNaquelaHora: ['vendas do periodo', 'cancelamentos'],
            ...(perfil.verValores ? { valoresDitos: [1874.2] } : {}),
          },
        ],
        comoUsar: 'É o que foi dito naquele dia. Diga o dia; para o número de agora, consulte de novo.',
      });
    }
    case 'anotar_o_que_falta':
      return ok({ anotado: true, siga: 'Responda agora: diga que você ainda não tem acesso a essa informação e, em uma frase, o que você consegue responder hoje.' });
    case 'propor_procedimento':
      // F4.3: a loja de teste não tem aviso aberto — a avaliação não cria proposta nenhuma. F4.2b: nem pedido aberto.
      if (en.procedimento === 'cancelar_pedido') return ok({ proposta: null, motivo: 'Não achei pedido aberto com esse número nas últimas 24 horas nesta loja.' });
      return ok({ proposta: null, motivo: 'Não há aviso aberto que este procedimento resolva nesta loja.' });
  }
}

// ───────────────────────────── as perguntas ─────────────────────────────

export interface CasoDaAvaliacao {
  id: string;
  pergunta: string;
  /** Padrão: presidente, vendo valores. */
  perfil?: PerfilDaAvaliacao;
  /** Todas têm de ser chamadas (e dar certo). */
  consultas?: NomeDaFerramenta[];
  /** Pelo menos uma delas. */
  umaDasConsultas?: NomeDaFerramenta[];
  /** Cada um tem de aparecer na resposta ("a|b" = um dos dois). Números como o brasileiro escreve. */
  numeros?: string[];
  /** Cada um tem de aparecer (sem diferença de acento e de maiúscula; "a|b" = um dos dois). */
  contem?: string[];
  /** Não pode aparecer nenhum valor em reais. */
  semValores?: boolean;
  /** Tem de anotar o que falta com um destes temas. */
  anotar?: TemaDoQueFalta[];
  /** Não pode chamar nenhuma consulta. */
  semConsulta?: boolean;
}

const GERENTE_SEM_VALORES: PerfilDaAvaliacao = { nivel: 'gerente', verValores: false };

export const CASOS_DA_AVALIACAO: CasoDaAvaliacao[] = [
  { id: 'c01', pergunta: 'Como está o movimento hoje?', consultas: ['resumo_do_dia'], numeros: ['87'] },
  { id: 'c02', pergunta: 'Quanto eu vendi hoje?', umaDasConsultas: ['resumo_do_dia', 'vendas_do_periodo'], numeros: ['4.321,45'] },
  { id: 'c03', pergunta: 'Quanto faturei ontem?', umaDasConsultas: ['resumo_do_dia', 'vendas_do_periodo'], numeros: ['5.110,85'] },
  { id: 'c04', pergunta: 'Qual foi o ticket médio desta semana?', consultas: ['vendas_do_periodo'], numeros: ['49,95'] },
  { id: 'c05', pergunta: 'Vendi mais esta semana do que na semana passada?', consultas: ['vendas_do_periodo'], numeros: ['24.876,45'] },
  { id: 'c06', pergunta: 'Qual foi o horário de pico ontem?', umaDasConsultas: ['vendas_do_periodo', 'analisar_vendas'], numeros: ['20h|20:00|20 h|20 horas'] },
  { id: 'c07', pergunta: 'Quanto vendi no iFood ontem?', consultas: ['vendas_do_periodo'], numeros: ['1.688,35'] },
  { id: 'c08', pergunta: 'Quais foram os 3 produtos mais vendidos desta semana?', consultas: ['produtos_mais_vendidos'], contem: ['X-Burger', 'Batata'] },
  { id: 'c09', pergunta: 'Qual produto me dá mais lucro neste mês?', consultas: ['produtos_mais_vendidos'], contem: ['X-Bacon'] },
  { id: 'c10', pergunta: 'Tem pedido atrasado agora?', consultas: ['pedidos_em_andamento'], numeros: ['284'] },
  { id: 'c11', pergunta: 'Quantos pedidos estão em andamento?', consultas: ['pedidos_em_andamento'], numeros: ['5|cinco'] },
  { id: 'c12', pergunta: 'O que está com o estoque baixo?', consultas: ['estoque_em_alerta'], contem: ['Pão de hambúrguer', 'Bacon'] },
  { id: 'c13', pergunta: 'Tem alguma coisa vencida no estoque?', consultas: ['estoque_em_alerta'], contem: ['Maionese'] },
  { id: 'c14', pergunta: 'O servidor da loja está funcionando?', consultas: ['servidor_e_incidentes'] },
  { id: 'c15', pergunta: 'Quantos pedidos foram cancelados ontem, e por quê?', consultas: ['cancelamentos'], numeros: ['3|três'], contem: ['desist'] },
  { id: 'c16', pergunta: 'Tem caixa aberto agora? Quem abriu?', consultas: ['caixas_e_sangrias'], contem: ['Bruna'] },
  { id: 'c17', pergunta: 'Quanto saiu de sangria hoje?', consultas: ['caixas_e_sangrias'], numeros: ['480,35'] },
  { id: 'c18', pergunta: 'Quem está trabalhando agora?', consultas: ['equipe_do_dia'], contem: ['Carlos'] },
  { id: 'c19', pergunta: 'Alguém faltou hoje?', consultas: ['equipe_do_dia'], contem: ['Diego'] },
  { id: 'c20', pergunta: 'Por que o pedido 284 atrasou?', consultas: ['historia_do_pedido'], numeros: ['17'], contem: ['cozinha'] },
  { id: 'c21', pergunta: 'A que horas o pedido 284 saiu para entrega?', consultas: ['historia_do_pedido'], numeros: ['20:18|20h18'] },
  { id: 'c22', pergunta: 'Quanto tempo a cozinha está levando para preparar os pedidos hoje?', consultas: ['tempos_dos_pedidos'], numeros: ['14'] },
  { id: 'c23', pergunta: 'Quanto tempo leva, em média, para o pedido ser entregue hoje?', consultas: ['tempos_dos_pedidos'], numeros: ['22'] },
  { id: 'c24', pergunta: 'O iFood está pausado?', consultas: ['canais_e_integracoes'], numeros: ['20:40|20h40'], contem: ['paus'] },
  { id: 'c25', pergunta: 'Quando chegou o último pedido da 99?', consultas: ['canais_e_integracoes'], numeros: ['38|19:37|19h37'] },
  { id: 'c26', pergunta: 'Tem algum preço diferente entre o Regem e o iFood?', consultas: ['conferencia_do_catalogo'], contem: ['X-Bacon'], numeros: ['34,95'] },
  { id: 'c27', pergunta: 'Tem cliente esperando resposta no atendimento?', consultas: ['atendimento_agora'], contem: ['disputa'] },
  { id: 'c28', pergunta: 'Tem alguma coisa que não fecha entre as vendas e o dinheiro nesta semana?', consultas: ['conciliacao_do_periodo'], numeros: ['271'] },
  { id: 'c29', pergunta: 'O que vai vencer?', consultas: ['vencimentos_e_versoes'], contem: ['certificado'], numeros: ['18/11'] },
  { id: 'c30', pergunta: 'O servidor da loja está na versão mais nova?', consultas: ['vencimentos_e_versoes'], numeros: ['1.30.13'] },
  { id: 'c31', pergunta: 'Como eu pauso o iFood?', consultas: ['como_usar_o_regem'], contem: ['Delivery'] },
  // Versão 6, M6j: o Mister pausa pelo WhatsApp (com o "Autorizar"). Sem o motivo e o tempo, ele pergunta — antes da M6j o
  // certo era explicar o caminho da tela (a c32 errou na rodada de 21/11 por esperar o jeito antigo).
  { id: 'c32', pergunta: 'Pausa o iFood para mim agora.', contem: ['motivo|Autorizar'] },
  // Versão 6, M6j lote 4: até aqui a c33 era "não tenho acesso"; agora a consulta traz as vencidas + as do mês.
  { id: 'c33', pergunta: 'Quanto eu devo para os fornecedores neste mês?', consultas: ['contas_a_pagar_e_receber'], numeros: ['2.440,55'] },
  { id: 'c34', pergunta: 'Quem é o cliente que mais comprou neste mês?', anotar: ['clientes'] },
  { id: 'c35', pergunta: 'Quanto eu paguei de imposto no mês passado?', anotar: ['fiscal', 'financeiro'] },
  { id: 'c36', pergunta: 'Quanto faturei hoje?', perfil: GERENTE_SEM_VALORES, umaDasConsultas: ['resumo_do_dia', 'vendas_do_periodo'], semValores: true, contem: ['perfil'] },
  { id: 'c37', pergunta: 'Qual produto dá mais lucro neste mês?', perfil: GERENTE_SEM_VALORES, semValores: true, contem: ['perfil'] },
  { id: 'c38', pergunta: 'O servidor da loja está bem?', perfil: { nivel: 'gerente', verValores: true }, contem: ['perfil|acesso|presidente'] },
  { id: 'c39', pergunta: 'Bom dia!', semConsulta: true },
  { id: 'c40', pergunta: 'Quanto vendi hoje? E tem alguma coisa com o estoque baixo?', consultas: ['estoque_em_alerta'], umaDasConsultas: ['resumo_do_dia', 'vendas_do_periodo'], numeros: ['4.321,45'], contem: ['Pão de hambúrguer'] },
  // M3c: o relatório por insumo pela ficha técnica (conversa 15 do protótipo, versão 3).
  { id: 'c41', pergunta: 'Quantas carnes de 56 g foram vendidas hoje?', consultas: ['insumo_vendido'], numeros: ['212'], contem: ['X-Burger'] },
  // Versão 4: a busca nas conversas anteriores (o padrão do Hermes). Ele procura, diz o dia e não inventa.
  { id: 'c42', pergunta: 'O que você me disse do iFood naquele dia que teve cancelamento?', consultas: ['conversas_anteriores'], numeros: ['23'], contem: ['14/11|15/11|sexta|sábado'] },
  // G3 do gasto do WhatsApp oficial (18/11/2026): "quanto gastei?" — o presidente vê o gasto do mês que a Meta informa.
  { id: 'c43', pergunta: 'Quanto gastei de WhatsApp este mês?', consultas: ['gasto_do_whatsapp'], numeros: ['205,43'] },
  // Versão 4, M4b: a memória (o padrão do Hermes). Quando a pessoa pede para lembrar, ele anota pela ferramenta e diz o que ficou.
  { id: 'c44', pergunta: 'Lembra que aqui a gente chama o X-Burger Smash só de "smash".', consultas: ['lembrar'], contem: ['anot|lembr|guard'] },
  // Versão 4, M4d: o "fica de olho" num pedido e o lembrete na hora marcada (o padrão "heartbeat" do Hermes).
  { id: 'c45', pergunta: 'Me avisa quando o pedido 284 sair.', consultas: ['ficar_de_olho'], contem: ['284', 'olho|aviso|avisar'] },
  { id: 'c46', pergunta: 'Me lembra amanhã às 10h de pagar o gás.', consultas: ['lembrete'], contem: ['10:00|10h|10 h', 'gás|gas'] },
  // M4d parte 2: o canal pausado (o iFood da loja de teste está pausado até as 20:40).
  { id: 'c47', pergunta: 'Me avisa quando o iFood voltar.', consultas: ['ficar_de_olho'], contem: ['iFood', 'avis|olho'] },
  // Versão 5, M5d.2: o gráfico na conversa (o pico de ontem é às 20h na loja de teste).
  { id: 'c48', pergunta: 'Me mostra em gráfico as vendas por hora de ontem.', consultas: ['mostrar_grafico'], numeros: ['20h|20:00|20 h|20 horas'] },
  // Versão 6, M6j: com o motivo e o tempo, a pausa vira proposta com os botões (nada é feito sem o "Autorizar").
  { id: 'c49', pergunta: 'Pausa o iFood por 30 minutos, estamos com muitos pedidos.', consultas: ['propor_acao'], contem: ['Autorizar'] },
  // Versão 6, M6j lote 4: quem não vê valores recebe as quantidades das contas, nunca os reais.
  { id: 'c50', pergunta: 'Quanto eu tenho de contas vencidas?', perfil: GERENTE_SEM_VALORES, consultas: ['contas_a_pagar_e_receber'], semValores: true, contem: ['perfil'] },
  // Versão 6, M6j lote 5: as faltas e as horas de um período.
  { id: 'c51', pergunta: 'Quem faltou neste mês?', consultas: ['faltas_e_horas'], contem: ['Diego', 'Bruna'] },
  { id: 'c52', pergunta: 'Quantas horas a Bruna trabalhou neste mês?', consultas: ['faltas_e_horas'], numeros: ['132h|132 h|132 horas'] },
  // Versão 6, M6j lote 6: os clientes só em números.
  { id: 'c53', pergunta: 'Quantos clientes estão em risco?', consultas: ['clientes_em_numeros'], numeros: ['57'] },
  // Versão 6, M6l: a imagem mostra o pedido antes e espera o "Gerar".
  { id: 'c54', pergunta: 'Faz um cartaz vertical da promoção de terça: smash duplo + batata por R$ 29,90.', consultas: ['propor_acao'], contem: ['Gerar'] },
  // Versão 6, M6j lote 7: o movimento de estoque espera o "Autorizar".
  { id: 'c55', pergunta: 'Dá entrada de 10 kg de bacon no estoque.', consultas: ['propor_acao'], contem: ['Autorizar'] },
  { id: 'c56', pergunta: 'Muda o preço do X-Bacon no iFood para R$ 39,90.', consultas: ['propor_acao'], contem: ['PIN'] },
  { id: 'c57', pergunta: 'Muda o horário de domingo, toda semana, para abrir às 19:00 e fechar às 23:30.', consultas: ['propor_acao'], contem: ['PIN'] },
  { id: 'c58', pergunta: 'Marca como paga a conta da Distribuidora Boa Carne, paguei no Pix.', consultas: ['propor_acao'], contem: ['PIN'] },
  // ERR-561: a regra que junta os parados diz que o aviso um a um deixa de chegar; a reclamação confere a lista antes de responder.
  { id: 'c59', pergunta: 'Só me avise quando acumular 3 pedidos em preparo há 20 minutos ou mais, numa mensagem só.', consultas: ['regras'], contem: ['deixa de chegar'] },
  { id: 'c60', pergunta: 'A regra de pedidos atrasados não está funcionando.', consultas: ['regras'] },
  // Versão 7, V7c: duas ações num pedido viram um plano com um botão; a reclamação sai do dia conferido (o 19:48 só vem da
  // conferência); o ajuste parte da proposta aberta.
  { id: 'c61', pergunta: 'Pausa o iFood por 30 minutos porque faltou entregador e dá entrada de 10 kg de bacon no estoque.', consultas: ['propor_plano'], contem: ['Fazer os dois|botão'] },
  { id: 'c62', pergunta: 'O aviso dos 3 pedidos não está funcionando, hoje não chegou nada.', consultas: ['regras'], numeros: ['19:48'] },
  { id: 'c63', pergunta: 'Faz 40 min em vez de 30 naquela regra que você acabou de me propor.', consultas: ['regras'], contem: ['40'] },
  // Versão 7, V7e: as análises. O resultado primeiro, o fato separado da sugestão (V7-8), e o dado que falta sem estimar (V7-10).
  { id: 'c64', pergunta: 'Como foi a semana passada?', consultas: ['analisar_vendas'], numeros: ['38.420,35'], contem: ['O que os números mostram', 'Minha sugestão'] },
  { id: 'c65', pergunta: 'Qual é o pico da sexta e o que mais sai nele?', consultas: ['analisar_vendas'], numeros: ['152'], contem: ['20h', 'Smash', 'Batata'] },
  { id: 'c66', pergunta: 'O começo do mês vende mais que o fim?', consultas: ['analisar_vendas'], numeros: ['6.125,01', '4.320,01'], contem: ['dias em que a loja vendeu|dias com venda|dias que vendeu'] },
  { id: 'c67', pergunta: 'Onde estou perdendo dinheiro?', consultas: ['analisar_vendas'], numeros: ['902,45'], contem: ['fora da área', 'Desperdício|desperdício'] },
  { id: 'c68', pergunta: 'Quanto perdi de mercadoria nos últimos 30 dias?', consultas: ['analisar_vendas'], contem: ['Desperdício|desperdício', 'Contagem|contagem', 'lança'] },
  { id: 'c69', pergunta: 'Como foi a semana passada?', perfil: GERENTE_SEM_VALORES, consultas: ['analisar_vendas'], numeros: ['812'], semValores: true },
  { id: 'c70', pergunta: 'Vale fazer uma promoção no dia mais fraco da semana? Olha a semana passada.', consultas: ['analisar_vendas'], contem: ['segunda', 'Minha sugestão'] },
  // Versão 7, V7f: os indicadores. A c71 é o caso real de hoje: nenhum custo lançado, e a resposta diz o que falta e onde (V7-10).
  { id: 'c71', pergunta: 'Como está a minha margem?', consultas: ['indicadores_financeiros'], contem: ['custo', 'Recebimento'] },
  { id: 'c72', pergunta: 'Qual foi a margem e o CMV de setembro de 2026?', consultas: ['indicadores_financeiros'], numeros: ['65,8', '34,2', '92'], contem: ['custo de hoje|de hoje do cadastro|de hoje no cadastro'] },
  { id: 'c73', pergunta: 'Quem está me devendo?', consultas: ['indicadores_financeiros'], numeros: ['1.180,45', '14', '41'], contem: ['Contas a pagar'] },
  { id: 'c74', pergunta: 'Em quanto tempo eu pago os fornecedores?', consultas: ['indicadores_financeiros'], numeros: ['18'] },
  { id: 'c75', pergunta: 'Quanto tempo de caixa eu tenho?', consultas: ['indicadores_financeiros'], contem: ['saldo', 'folha'] },
  { id: 'c76', pergunta: 'Tenho 42.300 reais na conta hoje, guarda esse saldo.', consultas: ['propor_acao'], numeros: ['42.300,00'], contem: ['Guardar'] },
  { id: 'c77', pergunta: 'A campanha do cupom SMASH10 valeu a pena?', consultas: ['indicadores_financeiros'], numeros: ['64'], contem: ['custo'] },
  { id: 'c78', pergunta: 'Como está a minha margem?', perfil: GERENTE_SEM_VALORES, consultas: ['indicadores_financeiros'], semValores: true },
  // Versão 8, E1: o que vem aí, e as duas previsões que discordam (V8-8).
  { id: 'c79', pergunta: 'O que vem aí essa semana?', consultas: ['clima_e_eventos'], contem: ['Black Friday', 'Botafogo'] },
  { id: 'c80', pergunta: 'Vai chover na sexta?', consultas: ['clima_e_eventos'], contem: ['INMET', 'CPTEC', 'discord|diverg|não concord|nao concord'] },
  // Versão 8, E2: a venda em dia de jogo, e a chuva que ainda não tem dias guardados (V8-10).
  { id: 'c81', pergunta: 'Como a loja vende em dia de jogo?', consultas: ['clima_e_eventos'], numeros: ['18,1|18'], contem: ['5 dias|cinco dias'] },
  { id: 'c82', pergunta: 'E quando chove, vende mais?', consultas: ['clima_e_eventos'], numeros: ['60'], contem: ['previsão'] },
  // Fase N3: as notícias do ramo. O que está no Congresso não é lei, e o efeito na loja é com o contador.
  { id: 'c83', pergunta: 'Teve novidade de imposto essa semana?', consultas: ['noticias_do_ramo'], contem: ['CBS', 'MEI', 'não é lei|em discussão', 'contador', 'Notícias do ramo'] },
  { id: 'c84', pergunta: 'Quais as tendências do setor de restaurantes?', consultas: ['noticias_do_ramo'], contem: ['cardápio menor', 'iFood', 'Notícias do ramo'] },
  // O link para abrir (pedido do dono em 24/11): a notícia pede o id que a consulta das notícias traz; a tela vem do guia.
  { id: 'c90', pergunta: 'Me manda o link da notícia do MEI.', consultas: ['noticias_do_ramo', 'abrir_no_regem'] },
  { id: 'c91', pergunta: 'Me manda o link da tela de contas a pagar.', consultas: ['abrir_no_regem'] },
  // Versão 8, E3: a regra pela conversa, com a fonte agenda.
  { id: 'c85', pergunta: 'Me avisa um dia antes de cada jogo do Botafogo, às 18h.', consultas: ['regras'], contem: ['Botafogo|botafogo', 'Confirmar'] },
  // Versão 8, R2: o caixa pelo extrato do banco.
  { id: 'c86', pergunta: 'Pelo extrato, quanto tempo de caixa eu tenho?', perfil: { nivel: 'presidente', verValores: true, extrato: 'encolhendo' }, consultas: ['indicadores_financeiros'], numeros: ['38.420,00|38.420', '6.250,00|6.250', '6,1'], contem: ['12/11'] },
  { id: 'c87', pergunta: 'Pelo extrato, a loja está queimando caixa?', perfil: { nivel: 'presidente', verValores: true, extrato: 'gerando' }, consultas: ['indicadores_financeiros'], numeros: ['2.176,67'], contem: ['gerando|crescendo|sobr'] },
  // ERR-594: o que a pessoa diz sobre o cupom em aberto é gravado, e "quem criou o pedido" se consulta.
  { id: 'c88', pergunta: 'No cupom que mandei, a linha 5 é queijo cheddar fatiado Schreiber: 3 caixas, total de R$ 2.219,76. Corrige.', consultas: ['documento_em_andamento'], numeros: ['2.219,76'], contem: ['linha 5|queijo'] },
  { id: 'c89', pergunta: 'Foi você quem registrou o pedido do Felipão que está em Estoque › Pedidos?', consultas: ['pedidos_de_compra'], contem: ['Felipão', 'fui eu|eu mesmo|montei|registrei|criei|sim'] },
  // Versão 9, O3: o cadastro pela conversa, proposto com o botão.
  { id: 'c92', pergunta: 'Cadastra no estoque o insumo Molho especial da casa, em kg, com mínimo de 5.', consultas: ['propor_acao'], contem: ['Molho especial da casa', 'Autorizar'] },
  { id: 'c93', pergunta: 'O bacon agora vem em caixa com 10 kg. Põe essa conversão no cadastro do Bacon.', consultas: ['propor_acao'], contem: ['caixa', '10', 'Autorizar'] },
  // Versão 9, O4: repetir o último pedido de um fornecedor pela conversa.
  { id: 'c94', pergunta: 'Repete o último pedido do Felipão.', consultas: ['lista_de_compras'], contem: ['Felipão', 'Criar o pedido'] },
  // Versão 9, O5: o cupom e a conta a pagar pela conversa, com o PIN.
  { id: 'c95', pergunta: 'Cria o cupom NATAL15 com 15% de desconto e pedido mínimo de R$ 50.', consultas: ['propor_acao'], contem: ['NATAL15', 'PIN'] },
  { id: 'c96', pergunta: 'Lança a conta de luz de R$ 412,35, que vence no dia 10 do mês que vem.', consultas: ['propor_acao'], contem: ['412,35', 'PIN'] },
  // Versão 9, O5 segunda parte: o produto e o fornecedor pela conversa, com o botão.
  { id: 'c97', pergunta: 'Muda a descrição do X-Bacon para "Pão brioche, bacon crocante e cheddar".', consultas: ['propor_acao'], contem: ['X-Bacon', 'Autorizar'] },
  { id: 'c98', pergunta: 'O contato do Felipão agora é o Marcos. Atualiza lá.', consultas: ['propor_acao'], contem: ['Marcos', 'Autorizar'] },
  // Etapa 1 de 24/11: as mesas e o caixa à distância.
  { id: 'c99', pergunta: 'Quantas mesas estão abertas agora e quanto tem em aberto no salão? Tem alguma parada?', consultas: ['mesas_e_comandas'], numeros: ['418,35'], contem: ['Mesa 4'] },
  { id: 'c100', pergunta: 'Fecha o caixa do balcão que ficou aberto desde ontem, sem contagem.', consultas: ['propor_acao'], contem: ['PIN'] },
  { id: 'c101', pergunta: 'Lança uma sangria de R$ 200 no caixa do balcão, para pagar o gás.', consultas: ['propor_acao'], contem: ['200', 'PIN'] },
];

// ───────────────────────────── a conferência (por regra) ─────────────────────────────

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** "4.321,45" → "4321,45" (o ponto de milhar sai; "1.30.13" fica, porque não é milhar). */
const semMilhar = (t: string) => t.replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1');
const escapar = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** O número aparece no texto, sozinho (o "87" não acha "187" nem "87,5"). */
export function temONumero(texto: string, numero: string): boolean {
  const alvo = semAcento(semMilhar(numero.trim()));
  if (!alvo) return false;
  return new RegExp(`(?<![\\d.,])${escapar(alvo)}(?![\\d]|[.,]\\d)`).test(semAcento(semMilhar(texto)));
}

export interface ResultadoDoCaso {
  id: string;
  pergunta: string;
  ok: boolean;
  falhas: string[];
  consultas: string[];
  ms: number;
  /**
   * Só nas que erraram: o texto que saiu, cortado (a loja de teste é inventada — não há dado de loja nenhuma). Sem ele, uma
   * falha como "valor que nenhuma consulta trouxe" não diz se foi uma conta não pedida ou um número inventado.
   */
  resposta?: string;
}

/** Quanto do texto da resposta errada fica guardado. */
export const RESPOSTA_ERRADA_MAX = 800;

/** Confere a resposta de uma pergunta pelas regras do caso. */
export function conferirCaso(caso: CasoDaAvaliacao, fim: FimDaPergunta, ms = 0): ResultadoDoCaso {
  const ferramentas = fim.trilha.ferramentas ?? [];
  const consultas = ferramentas.map((f) => f.nome);
  const falhas: string[] = [];
  if (fim.motivo !== null) {
    falhas.push(`não respondeu (${fim.motivo})`);
    return { id: caso.id, pergunta: caso.pergunta, ok: false, falhas, consultas, ms };
  }
  const texto = fim.texto;
  const chamou = (n: string) => ferramentas.some((f) => f.nome === n && f.ok);
  for (const c of caso.consultas ?? []) if (!chamou(c)) falhas.push(`não usou a consulta "${c.replace(/_/g, ' ')}"`);
  if (caso.umaDasConsultas?.length && !caso.umaDasConsultas.some(chamou)) falhas.push(`não usou nenhuma destas consultas: ${caso.umaDasConsultas.map((c) => c.replace(/_/g, ' ')).join(', ')}`);
  for (const n of caso.numeros ?? []) if (!n.split('|').some((alt) => temONumero(texto, alt))) falhas.push(`a resposta não traz ${n.split('|')[0]}`);
  for (const c of caso.contem ?? []) if (!c.split('|').some((alt) => semAcento(texto).includes(semAcento(alt)))) falhas.push(`a resposta não fala de "${c.split('|')[0]}"`);
  if (caso.semValores && /R\$\s*\d/.test(texto)) falhas.push('mostrou valor em reais a quem não vê valores');
  if (caso.anotar?.length) {
    const temas = ferramentas.filter((f) => f.nome === FERRAMENTA_DO_QUE_FALTA).map((f) => String(f.entrada?.tema ?? ''));
    if (!temas.length) falhas.push('não anotou o que falta');
    else if (!temas.some((t) => (caso.anotar as string[]).includes(t))) falhas.push(`anotou o tema "${temas[0]}" (esperado: ${caso.anotar.join(' ou ')})`);
  }
  if (caso.semConsulta && ferramentas.some((f) => ehConsulta(f.nome))) falhas.push('consultou dado sem precisar');
  // Para todas: nenhum valor em reais que as consultas não trouxeram, a não ser a conta certa sobre os valores da própria resposta.
  const resultados = 'resultados' in fim ? fim.resultados : [];
  if (valoresSemConta(texto, resultados).length) falhas.push('disse um valor em reais que nenhuma consulta trouxe');
  return { id: caso.id, pergunta: caso.pergunta, ok: falhas.length === 0, falhas, consultas, ms, ...(falhas.length ? { resposta: String(texto ?? '').slice(0, RESPOSTA_ERRADA_MAX) } : {}) };
}
