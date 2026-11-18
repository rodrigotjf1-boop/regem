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
  filtrarSaida,
} from './mister-agente.regras';
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';
import type { FimDaPergunta } from './mister-laco';
import { GUIA_DE_USO, buscarNoGuia, quemAbre } from './mister-guia-de-uso';
import { conferirMemoria } from './mister-memoria';

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
const EMPRESA = 'Empresa de Teste da Avaliação';
const LOJA = 'Loja Centro';
const SEM_VALORES = 'O perfil desta pessoa no Regem não mostra valores em reais: os valores vêm vazios.';
const SEM_PERMISSAO = 'O perfil desta pessoa no Regem não dá acesso a esta informação. Quem muda o perfil é o presidente.';

export interface PerfilDaAvaliacao {
  nivel: NivelDoMister;
  verValores: boolean;
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

type Periodo = 'hoje' | 'ontem' | 'esta_semana' | 'semana_passada' | 'este_mes' | 'mes_passado';
const ROTULO: Record<Periodo, string> = {
  hoje: 'hoje, 13/11/2026',
  ontem: 'ontem, 12/11/2026',
  esta_semana: 'esta semana, de 09/11 a 13/11/2026',
  semana_passada: 'semana passada, de 02/11 a 06/11/2026',
  este_mes: 'este mês, de 01/11 a 13/11/2026',
  mes_passado: 'mês passado, outubro de 2026',
};
const VENDAS: Record<Periodo, { vendas: number; faturado: number; ticket: number; gorjeta: number; canceladas: number }> = {
  hoje: { vendas: 87, faturado: 4321.45, ticket: 49.67, gorjeta: 118.35, canceladas: 1 },
  ontem: { vendas: 102, faturado: 5110.85, ticket: 50.11, gorjeta: 140.25, canceladas: 3 },
  esta_semana: { vendas: 498, faturado: 24876.45, ticket: 49.95, gorjeta: 655.15, canceladas: 9 },
  semana_passada: { vendas: 455, faturado: 22410.15, ticket: 49.25, gorjeta: 590.45, canceladas: 7 },
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
        comoORelatorioSeparaOsCanais: 'Mesa = venda de mesa. Delivery/app = venda com pagamento online (pelo aplicativo ou pelo cardápio online). Balcão = todas as outras, o que inclui a retirada e o pedido de entrega pago na hora.',
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
  { id: 'c06', pergunta: 'Qual foi o horário de pico ontem?', consultas: ['vendas_do_periodo'], numeros: ['20h|20:00|20 h|20 horas'] },
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
  { id: 'c32', pergunta: 'Pausa o iFood para mim agora.', consultas: ['como_usar_o_regem'], contem: ['consult'] },
  { id: 'c33', pergunta: 'Quanto eu devo para os fornecedores neste mês?', anotar: ['financeiro', 'estoque'] },
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
  // Para todas: nenhum valor em reais que as consultas não trouxeram (o filtro de saída de verdade).
  const resultados = 'resultados' in fim ? fim.resultados : [];
  if (filtrarSaida(texto, resultados).notas.includes('valor_sem_origem')) falhas.push('disse um valor em reais que nenhuma consulta trouxe');
  return { id: caso.id, pergunta: caso.pergunta, ok: falhas.length === 0, falhas, consultas, ms, ...(falhas.length ? { resposta: String(texto ?? '').slice(0, RESPOSTA_ERRADA_MAX) } : {}) };
}
