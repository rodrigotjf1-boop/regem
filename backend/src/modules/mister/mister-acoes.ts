import {
  CANAIS_DA_PAUSA,
  CanalDaPausa,
  MOTIVOS,
  MOTIVOS_DA_PAUSA,
  NOME_DO_CANAL,
  TEMPOS_DA_99,
  TEMPOS_DO_CARDAPIO,
  ateDa99,
  ateDoCardapio,
  lerMotivo,
  voltaDaPausa,
} from '../../common/pausa-do-canal';
import { dataNoFuso } from '../../common/data';
import { conferirCadastro, type ParametrosDeCadastro } from './mister-acoes-cadastro';
import { conferirAcaoDaLoja, type ParametrosDaLoja } from './mister-acoes-loja';
import { conferirClassificacao, type ParametrosDaClassificacao } from './mister-acoes-banco';
import { conferirContagem, type ParametrosDaContagem } from './mister-acoes-contagem';
import { conferirCaixa, type ParametrosDoCaixa } from './mister-acoes-caixa';
import { conferirEntregador, type ParametrosDoEntregador } from './mister-acoes-entregador';
import { conferirPonto, type ParametrosDoPonto } from './mister-acoes-ponto';
import { conferirEnvio, conferirPrevisao, conferirValidadeInformada, type ParametrosDaPrevisao, type ParametrosDaValidade, type ParametrosDoEnvio } from './mister-acoes-compra';
import { conferirCardapio, type ParametrosDoCardapio } from './mister-acoes-cardapio';
import { conferirCampanha, type ParametrosDaCampanha } from './mister-acoes-campanha';
import { pareceDadoPessoalNaImagem } from './mister-imagem-numeros';
import { NOMES_DOS_DIAS, ehHoraDoDia, horasDaJanela, lerDiaDaSemana, textoDaJanela, type JanelaDoDia } from '../../common/horarios-da-loja';

// AS AÇÕES DO MISTER — a porta `propor_acao` (versão 6, M6j; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão
// 6", Frente C — "Uma porta só para as ações"; protótipo `mockups/regem-mister-v6.html`, "Fazer pelo WhatsApp, com
// segurança"). As consultas seguem como ferramentas; as AÇÕES passam por uma ferramenta só, com o catálogo e o formato de
// cada uma conferidos AQUI, pelo código. A ação só acontece no "Autorizar" de quem pediu (o tamanho do risco: botão), pelo
// MESMO serviço da tela, e o "feito" só sai com o efeito conferido. Lote 1: o Delivery (os canais e os pedidos).

/** O catálogo das ações. Ação nova entra aqui, com a execução pelo serviço da tela e a conferência do efeito. */
export const ACOES_DO_MISTER = [
  'pausar_canal',
  'reabrir_canal',
  'aceitar_pedido',
  'pedido_pronto',
  'despachar_pedido',
  // Lote 2: as tarefas do dia e a pausa do produto.
  'concluir_tarefa',
  'pausar_produto',
  'reativar_produto',
  // Lote 3: criar a tarefa de hoje.
  'criar_tarefa',
  // M6l: uma imagem pelo DMS Graph (cartaz, post), com o pedido mostrado antes.
  'criar_imagem',
  // Lote 7: entrada, saída ou o saldo contado de um produto do estoque.
  'movimentar_estoque',
  // Lote 8 (de PIN): o preço de um produto, canal por canal.
  'mudar_preco',
  // Lote 9 (de PIN): o horário da semana da loja.
  'mudar_horario',
  // Lote 10 (de PIN): marcar uma conta a pagar como paga.
  'pagar_conta',
  // V7f: o que o presidente informa na conversa (botões "Guardar" e "Corrigir").
  'informar_saldo',
  'informar_folha',
  'informar_custo_campanha',
  // Versão 9, O3: o cadastro pela conversa (Estoque › Produtos, Cadastros › Fornecedores, Estoque › Pedidos).
  'cadastrar_insumo',
  'alterar_insumo',
  'cadastrar_fornecedor',
  'excluir_pedido_compra',
  // Versão 9, O5: o cupom (PDV · Balcão › Cupons) e a conta a pagar (Financeiro › Contas a pagar).
  'criar_cupom',
  'remover_cupom',
  'lancar_conta',
  // Versão 9, O5 segunda parte: o produto (Cadastros › Cardápio), o fornecedor (Fornecedores) e a escala (Escala).
  'mudar_produto',
  'mudar_fornecedor',
  'trocar_turno',
  'folga_na_escala',
  // Versão 9, O5: classificar o lançamento do extrato (Financeiro › Banco e repasses), com o PIN. Só o presidente.
  'classificar_banco',
  // Versão 9, O3: a contagem do estoque (Estoque › Contagem), com o botão.
  'contar_estoque',
  // Etapa 1 de 24/11 (o dono): o caixa à distância, com o PIN.
  'fechar_caixa',
  'sangria',
  // Etapa 2 de 24/11: o acerto dos entregadores, com o PIN.
  'pagar_entregador',
  // Etapa 5 de 24/11: o ajuste de ponto (Portaria 671: nada se apaga), com o motivo e o PIN.
  'incluir_marcacao',
  'desconsiderar_marcacao',
  // Etapa 6 de 24/11: o pedido de compra marcado como enviado ao fornecedor.
  'pedido_enviado',
  // Etapa 7 de 24/11: o cardápio — categoria nova, produto novo e a promoção "de/por".
  'criar_categoria',
  'criar_produto',
  'promocao_do_produto',
  // Etapa 8 de 24/11: as campanhas — pausar/retomar e repetir uma montada na tela, com o custo antes.
  'pausar_campanha',
  'repetir_campanha',
  // P1 de "Pedidos e recebimento" (25/11): a validade pendente informada pela conversa.
  'informar_validade',
  // P3 de "Pedidos e recebimento" (25/11): a nova previsão de recebimento ("Mudar a previsão" do aviso do pedido atrasado).
  'mudar_previsao',
] as const;
export type AcaoDoMister = (typeof ACOES_DO_MISTER)[number];
export const ehAcaoDoMister = (p: unknown): p is AcaoDoMister => (ACOES_DO_MISTER as readonly string[]).includes(String(p));
/** Versão 9, O3: as ações do cadastro pela conversa. */
export const ACOES_DE_CADASTRO = ['cadastrar_insumo', 'alterar_insumo', 'cadastrar_fornecedor', 'excluir_pedido_compra'] as const;
export const ehCadastro = (a: unknown): a is (typeof ACOES_DE_CADASTRO)[number] => (ACOES_DE_CADASTRO as readonly unknown[]).includes(a);
/** Versão 9, O5: o cupom e a conta a pagar. */
export const ACOES_DA_LOJA = ['criar_cupom', 'remover_cupom', 'lancar_conta', 'mudar_produto', 'mudar_fornecedor', 'trocar_turno', 'folga_na_escala'] as const;
export const ehDaLoja = (a: unknown): a is (typeof ACOES_DA_LOJA)[number] => (ACOES_DA_LOJA as readonly unknown[]).includes(a);

export interface DefinicaoDaAcao {
  id: AcaoDoMister;
  /** O tamanho do risco (decisão do plano): o botão de quem pediu, ou o PIN pelo link para preço, horário e dinheiro. */
  nivel: 'botao' | 'pin';
  /** A permissão do perfil — a MESMA da rota da tela. O presidente pode tudo. */
  permissao: 'delivery' | 'meu_dia' | 'loja' | 'checklist' | 'estoque' | 'financeiro' | 'cupons' | 'cadastros' | 'escalas' | 'pdv' | 'ponto';
  /** Por quanto tempo a pergunta vale. */
  prazoMin: number;
  /** O nome curto, para a auditoria e o histórico das propostas. */
  nome: string;
  /** A rota da tela também pede "Ver valores em R$" (o presidente sempre pode). */
  pedeVerValores?: boolean;
  /** V7f: só o presidente da empresa inteira faz (nem o gerente com a permissão, nem o presidente preso a uma loja). */
  soPresidente?: boolean;
  /** Versão 9, O3: no Estoque, o tipo da permissão que a rota pede (criar, editar ou excluir). Sem ele, editar. */
  crud?: 'criar' | 'editar' | 'excluir';
}

export const ACOES: Record<AcaoDoMister, DefinicaoDaAcao> = {
  pausar_canal: { id: 'pausar_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'pausar canais de venda' },
  reabrir_canal: { id: 'reabrir_canal', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'reabrir canais de venda' },
  aceitar_pedido: { id: 'aceitar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'aceitar um pedido' },
  pedido_pronto: { id: 'pedido_pronto', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'marcar um pedido como pronto' },
  despachar_pedido: { id: 'despachar_pedido', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'despachar um pedido' },
  // Lote 2. A tarefa: a permissão da rota `PATCH /tarefas-instancias/:id/estado` (Tarefas). O produto: a de
  // `PUT /produtos/:id/pausa-canal` (Loja).
  concluir_tarefa: { id: 'concluir_tarefa', nivel: 'botao', permissao: 'meu_dia', prazoMin: 10, nome: 'marcar uma tarefa do dia' },
  pausar_produto: { id: 'pausar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'pausar um produto' },
  reativar_produto: { id: 'reativar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'reativar um produto' },
  // Lote 3: a permissão das rotas `POST /tarefas` e `POST /tarefas-instancias/instanciar` (Checklist & registros).
  criar_tarefa: { id: 'criar_tarefa', nivel: 'botao', permissao: 'checklist', prazoMin: 10, nome: 'criar uma tarefa para hoje' },
  // M6l: quem cuida do Delivery e do Marketing; vale por 30 minutos, para dar tempo de ler o pedido.
  criar_imagem: { id: 'criar_imagem', nivel: 'botao', permissao: 'delivery', prazoMin: 30, nome: 'criar uma imagem' },
  // Lote 7: a permissão da rota `POST /estoque/movimentos` é `estoque.editar` (a conferência é a `temAPermissao` do serviço).
  movimentar_estoque: { id: 'movimentar_estoque', nivel: 'botao', permissao: 'estoque', prazoMin: 10, nome: 'lançar um movimento de estoque' },
  // Lote 8: a rota `PUT /produtos/:id/preco-canal` pede a Loja e "Ver valores em R$"; muda o que o cliente paga, então é de PIN.
  mudar_preco: { id: 'mudar_preco', nivel: 'pin', permissao: 'loja', prazoMin: 15, nome: 'mudar o preço de um produto', pedeVerValores: true },
  // Lote 9: a rota `PUT /cardapio/config` pede presidente ou gerente com a Loja; muda quando a loja recebe pedido, então é de PIN.
  mudar_horario: { id: 'mudar_horario', nivel: 'pin', permissao: 'loja', prazoMin: 15, nome: 'mudar o horário da loja' },
  // Lote 10: a rota `POST /financeiro/titulos/:id/pagar` pede o Financeiro; a pessoa precisa VER o valor que autoriza.
  pagar_conta: { id: 'pagar_conta', nivel: 'pin', permissao: 'financeiro', prazoMin: 15, nome: 'marcar uma conta como paga', pedeVerValores: true },
  // V7f: não muda nada na loja, só guarda o que veio da pessoa; por isso é de botão.
  informar_saldo: { id: 'informar_saldo', nivel: 'botao', permissao: 'financeiro', prazoMin: 10, nome: 'guardar o saldo do banco', pedeVerValores: true, soPresidente: true },
  informar_folha: { id: 'informar_folha', nivel: 'botao', permissao: 'financeiro', prazoMin: 10, nome: 'guardar a folha do mês', pedeVerValores: true, soPresidente: true },
  // Versão 9, O3: as rotas de Estoque › Produtos (criar e editar), de Cadastros › Fornecedores (presidente ou gerente; aqui com o
  // Estoque) e a exclusão do pedido em Estoque › Pedidos (`estoque.excluir`).
  cadastrar_insumo: { id: 'cadastrar_insumo', nivel: 'botao', permissao: 'estoque', crud: 'criar', prazoMin: 10, nome: 'cadastrar um insumo' },
  alterar_insumo: { id: 'alterar_insumo', nivel: 'botao', permissao: 'estoque', crud: 'editar', prazoMin: 10, nome: 'mudar um insumo' },
  // A rota de Fornecedores pede `cadastros` (O5 segunda parte; na O3 estava a do estoque — corrigido).
  cadastrar_fornecedor: { id: 'cadastrar_fornecedor', nivel: 'botao', permissao: 'cadastros', prazoMin: 10, nome: 'cadastrar um fornecedor' },
  // Versão 9, O5: as rotas de Cupons pedem `cupons` (presidente ou gerente); a conta a pagar, o Financeiro e "Ver valores em R$".
  // O cupom e a conta mexem com dinheiro: PIN pelo link, como o preço. Tirar um cupom é de botão.
  criar_cupom: { id: 'criar_cupom', nivel: 'pin', permissao: 'cupons', prazoMin: 15, nome: 'criar um cupom' },
  remover_cupom: { id: 'remover_cupom', nivel: 'botao', permissao: 'cupons', prazoMin: 10, nome: 'tirar um cupom' },
  lancar_conta: { id: 'lancar_conta', nivel: 'pin', permissao: 'financeiro', prazoMin: 15, nome: 'lançar uma conta a pagar', pedeVerValores: true },
  // O5 segunda parte: tudo com o botão, cada um pela permissão da rota (produtos: `loja`; fornecedores: `cadastros`; escala: `escalas` editar).
  mudar_produto: { id: 'mudar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'mudar um produto do cardápio' },
  mudar_fornecedor: { id: 'mudar_fornecedor', nivel: 'botao', permissao: 'cadastros', prazoMin: 10, nome: 'mudar um fornecedor' },
  trocar_turno: { id: 'trocar_turno', nivel: 'botao', permissao: 'escalas', crud: 'editar', prazoMin: 10, nome: 'trocar a pessoa de um turno' },
  folga_na_escala: { id: 'folga_na_escala', nivel: 'botao', permissao: 'escalas', crud: 'editar', prazoMin: 10, nome: 'dar folga na escala' },
  // A rota de Banco e repasses é só do presidente (V8-2); a classificação mexe na conta do caixa: PIN, com "Ver valores em R$".
  // As rotas da contagem (iniciar e salvar) pedem "editar" do Estoque.
  // As rotas do caixa (`OperadorDeCaixa`) pedem o PDV; mexer no turno de outra pessoa é do gerente ou do presidente. Dinheiro: PIN.
  fechar_caixa: { id: 'fechar_caixa', nivel: 'pin', permissao: 'pdv', prazoMin: 15, nome: 'fechar um caixa' },
  sangria: { id: 'sangria', nivel: 'pin', permissao: 'pdv', prazoMin: 15, nome: 'lançar uma sangria', pedeVerValores: true },
  // A rota do pagamento (Delivery › Entregadores) pede o Delivery; é dinheiro saindo do caixa de entregas: PIN e "Ver valores".
  // As rotas de Gerenciamento de ponto: incluir pede ponto.criar e o ajuste, ponto.editar. Mexe na jornada (e no salário): PIN.
  // A rota "Marcar como enviado" de Estoque › Pedidos pede estoque.criar. Só registra o que a pessoa diz: botão.
  // Cadastros › Cardápio pede a permissão da loja (como o "mudar produto"). Criar não muda o que já existe: botão. A promoção é
  // preço: PIN e "Ver valores", como o preço do canal.
  // Delivery › Marketing: a rota pede o Delivery (e é do gerente ou do presidente — a regra geral das ações). Pausar só para:
  // botão. Repetir manda mensagem a muitos clientes (e, na API oficial, custa): PIN.
  pausar_campanha: { id: 'pausar_campanha', nivel: 'botao', permissao: 'delivery', prazoMin: 10, nome: 'pausar ou retomar uma campanha' },
  repetir_campanha: { id: 'repetir_campanha', nivel: 'pin', permissao: 'delivery', prazoMin: 15, nome: 'repetir uma campanha' },
  criar_categoria: { id: 'criar_categoria', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'criar uma categoria do cardápio' },
  criar_produto: { id: 'criar_produto', nivel: 'botao', permissao: 'loja', prazoMin: 10, nome: 'criar um produto do cardápio' },
  promocao_do_produto: { id: 'promocao_do_produto', nivel: 'pin', permissao: 'loja', prazoMin: 15, nome: 'pôr ou tirar a promoção de um produto', pedeVerValores: true },
  // A rota "Informar a validade" de Estoque › Pedidos pede estoque.editar (a de quem recebe). Completa uma pendência: botão.
  informar_validade: { id: 'informar_validade', nivel: 'botao', permissao: 'estoque', crud: 'editar', prazoMin: 10, nome: 'informar a validade de um item recebido' },
  pedido_enviado: { id: 'pedido_enviado', nivel: 'botao', permissao: 'estoque', crud: 'criar', prazoMin: 10, nome: 'marcar um pedido de compra como enviado' },
  // A previsão é da criação do pedido (Estoque › Pedidos pede estoque.criar). Só muda uma data: botão.
  mudar_previsao: { id: 'mudar_previsao', nivel: 'botao', permissao: 'estoque', crud: 'criar', prazoMin: 10, nome: 'mudar a previsão de recebimento de um pedido de compra' },
  incluir_marcacao: { id: 'incluir_marcacao', nivel: 'pin', permissao: 'ponto', crud: 'criar', prazoMin: 15, nome: 'incluir uma marcação de ponto' },
  desconsiderar_marcacao: { id: 'desconsiderar_marcacao', nivel: 'pin', permissao: 'ponto', crud: 'editar', prazoMin: 15, nome: 'desconsiderar uma marcação de ponto' },
  pagar_entregador: { id: 'pagar_entregador', nivel: 'pin', permissao: 'delivery', prazoMin: 15, nome: 'pagar um entregador', pedeVerValores: true },
  contar_estoque: { id: 'contar_estoque', nivel: 'botao', permissao: 'estoque', crud: 'editar', prazoMin: 10, nome: 'lançar uma contagem do estoque' },
  classificar_banco: { id: 'classificar_banco', nivel: 'pin', permissao: 'financeiro', prazoMin: 15, nome: 'classificar um lançamento do banco', pedeVerValores: true },
  excluir_pedido_compra: { id: 'excluir_pedido_compra', nivel: 'botao', permissao: 'estoque', crud: 'excluir', prazoMin: 10, nome: 'excluir um pedido de compra' },
  informar_custo_campanha: { id: 'informar_custo_campanha', nivel: 'botao', permissao: 'financeiro', prazoMin: 10, nome: 'guardar o custo de uma campanha', pedeVerValores: true, soPresidente: true },
};

/** As ações de PIN: o link vai a quem pediu (o presidente ou o gerente com a permissão), e o PIN é o dessa pessoa. */
export const ACOES_DE_PIN: readonly AcaoDoMister[] = ACOES_DO_MISTER.filter((a) => ACOES[a].nivel === 'pin');

// ───────────────────────────── M6l: a imagem ─────────────────────────────

/** Nasce desligada: quem liga é o dono, com `MISTER_CRIAR_IMAGEM=1` (a imagem é paga, pela franquia do DMS Graph). */
export const imagemLigada = (): boolean => process.env.MISTER_CRIAR_IMAGEM === '1';
export const PROPORCOES_DA_IMAGEM = ['1:1', '9:16', '16:9'] as const;
export type ProporcaoDaImagem = (typeof PROPORCOES_DA_IMAGEM)[number];
/** O pedido vai no corpo da mensagem com botões, que a Meta limita a 1.024 letras. */
export const PEDIDO_DA_IMAGEM_MAX = 800;
export const BOTOES_DA_IMAGEM = { autorizar: 'Gerar', naoAgora: 'Mudar' } as const;
/** O que a IA faz com a resposta da ação. */
export const sigaDaAcao = (acao: AcaoDoMister): string =>
  ehDadoInformado(acao)
    ? 'Mostre o "oQueVouFazer" como veio e diga que os botões "Guardar" e "Corrigir" chegam logo abaixo. Nada fica guardado antes do toque. Não diga que guardou.'
    : acao === 'pagar_conta'
    ? 'Mostre o "oQueVouFazer" como veio e diga que o link "Abrir no Regem" chega logo abaixo e pede o PIN. O Regem só registra a baixa: nunca diga que pagou, transferiu ou fez Pix, e nunca peça o PIN na conversa.'
    : ACOES[acao].nivel === 'pin'
    ? 'Mostre o "oQueVouFazer" como veio e diga que o link "Abrir no Regem" chega logo abaixo e pede o PIN. Nada muda sem o PIN; nunca peça o PIN na conversa. Não diga que mudou.'
    : acao === 'criar_imagem'
    ? 'Mostre o "oQueVouFazer" como veio, entre aspas, e diga que os botões "Gerar" e "Mudar" chegam logo abaixo e que usa 1 da franquia de imagens do mês. Nada é gerado sem o "Gerar". Não diga que gerou.'
    : 'Mostre o "oQueVouFazer" como veio e diga que os botões "Autorizar" e "Não agora" chegam logo abaixo. Nada é feito sem o "Autorizar". Não diga que fez.';

// ───────────────────────────── V7f: o que o presidente informa ─────────────────────────────

export const ACOES_DE_DADO_INFORMADO = ['informar_saldo', 'informar_folha', 'informar_custo_campanha'] as const;
export type AcaoDeDadoInformado = (typeof ACOES_DE_DADO_INFORMADO)[number];
export const ehDadoInformado = (a: unknown): a is AcaoDeDadoInformado => (ACOES_DE_DADO_INFORMADO as readonly unknown[]).includes(a);
export const BOTOES_DO_DADO = { autorizar: 'Guardar', naoAgora: 'Corrigir' } as const;
/** O tipo gravado em `mister_dado_informado`. */
export const TIPO_DO_DADO = { informar_saldo: 'saldo_banco', informar_folha: 'folha_mensal', informar_custo_campanha: 'custo_campanha' } as const;
/** Os tetos em reais: acima disto é quase certo um zero a mais. O da tabela é o maior deles. */
export const TETO_DO_DADO: Record<AcaoDeDadoInformado, number> = { informar_saldo: 99_999_999.99, informar_folha: 9_999_999.99, informar_custo_campanha: 9_999_999.99 };
const NOME_DO_DADO: Record<AcaoDeDadoInformado, string> = { informar_saldo: 'o saldo', informar_folha: 'a folha do mês', informar_custo_campanha: 'o custo da campanha' };

/** O valor vindo da IA (V109): número de verdade, positivo, dentro do teto e com até 2 casas. Devolve em centavos, ou null. */
export function centavosDoDado(v: unknown, teto: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > teto) return null;
  const centavos = v * 100;
  if (Math.abs(Math.round(centavos) - centavos) > 1e-6) return null;
  return Math.round(centavos);
}

/** O dia do saldo: um dia de verdade, de hoje até 7 dias atrás (saldo mais velho que isso não vale). */
export function lerDiaDoSaldo(v: unknown, hoje: string): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || v > hoje) return null;
  const limite = new Date(`${hoje}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 7);
  return v < limite.toISOString().slice(0, 10) ? null : v;
}

/** O "o que vou guardar", sempre dizendo que o dado veio da pessoa. */
export function resumoDoDado(acao: AcaoDeDadoInformado, centavos: number, dia: string, campanha: string | null): string {
  const valor = reaisDaAcao(centavos / 100);
  if (acao === 'informar_saldo') return `Vou guardar o saldo em ${diaMesBr(dia)}: ${valor}, informado por você. Veio de você, não do banco. Depois de 7 dias eu peço de novo.`;
  if (acao === 'informar_folha') return `Vou guardar a folha de ${valor} por mês, como estimativa sua. Veio de você, não do banco.`;
  return `Vou guardar o custo de ${valor} na campanha do cupom ${campanha}. Veio de você, não do banco.`;
}
/** O desfecho. Sem o valor: esta frase fica na auditoria e no histórico da proposta, e saldo e folha são só do presidente. */
export const textoDoDadoGuardado = (acao: AcaoDeDadoInformado, dia: string): string =>
  acao === 'informar_saldo'
    ? `Guardei o saldo de ${diaMesBr(dia)}. Veio de você, não do banco. Em 7 dias eu peço de novo.`
    : `Guardei ${NOME_DO_DADO[acao]}. Veio de você, não do banco.`;

// ───────────────────────────── lote 2: a tarefa e o produto ─────────────────────────────

export const ESTADOS_DA_TAREFA = ['feita', 'parcial', 'nao_feita'] as const;
export type EstadoDaTarefa = (typeof ESTADOS_DA_TAREFA)[number];
const NOME_DO_ESTADO: Record<EstadoDaTarefa, string> = { feita: 'feita', parcial: 'feita em parte', nao_feita: 'não feita' };
export const nomeDoEstadoDaTarefa = (e: string): string =>
  NOME_DO_ESTADO[e as EstadoDaTarefa] ?? ({ pendente: 'pendente', em_execucao: 'em execução', impossibilitada: 'impossibilitada' } as Record<string, string>)[e] ?? e;

/** Os canais da pausa do produto (os da tela: o Regem — balcão e cardápio digital juntos —, o iFood e a 99). */
export const CANAIS_DO_PRODUTO = ['regem', 'ifood', '99food'] as const;
export type CanalDoProduto = (typeof CANAIS_DO_PRODUTO)[number];
export function lerCanalDoProduto(v: unknown): CanalDoProduto | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === 'regem' || t === 'cardapio' || t === 'cardapio digital' || t === 'balcao' || t === 'loja') return 'regem';
  if (t === 'ifood') return 'ifood';
  if (t === '99' || t === '99food' || t === 'food99') return '99food';
  return null;
}
/** "no Regem (balcão e cardápio digital)", "no iFood e na 99". */
export function ondeOProduto(canais: readonly CanalDoProduto[]): string {
  const um = (c: CanalDoProduto) => (c === 'regem' ? 'no Regem (balcão e cardápio digital)' : c === 'ifood' ? 'no iFood' : 'na 99');
  const n = canais.map(um);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}
/** Sem canal dito: os canais em que o produto está (o "Pausar em todos" da Gestão do catálogo). */
export function canaisDoProduto(p: { noIfood: boolean; na99: boolean }): CanalDoProduto[] {
  return ['regem', ...(p.noIfood ? (['ifood'] as const) : []), ...(p.na99 ? (['99food'] as const) : [])];
}
/** O produto ficou como a ação pediu em cada canal? (o Regem: balcão e cardápio; os apps: a lista `canais_pausados`). */
export function produtoFicou(p: { disponivelBalcao: boolean; disponivelCardapio: boolean; canaisPausados: string[] }, canais: readonly CanalDoProduto[], pausado: boolean): CanalDoProduto[] {
  return canais.filter((c) => (c === 'regem' ? p.disponivelBalcao === !pausado && p.disponivelCardapio === !pausado : p.canaisPausados.includes(c) === pausado));
}

/** O canal como a pessoa (ou a IA) diz: "cardapio", "ifood", "99" (ou o nome interno "food99"). */
export function lerCanal(v: unknown): CanalDaPausa | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t === '99' || t === 'food99' || t === '99food') return 'food99';
  if (t === 'cardapio' || t === 'cardapio digital') return 'cardapio';
  if (t === 'ifood') return 'ifood';
  return null;
}

/** "o iFood", "o iFood e a 99", "o cardápio digital, o iFood e a 99". */
export function nomesDosCanais(canais: readonly CanalDaPausa[]): string {
  const um = (c: CanalDaPausa) => (c === 'food99' ? 'a 99' : c === 'ifood' ? 'o iFood' : 'o cardápio digital');
  const n = canais.map(um);
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

// ───────────────────────────── lote 7: o movimento de estoque ─────────────────────────────

export const TIPOS_DO_MOVIMENTO = ['entrada', 'saida', 'ajuste'] as const;
export type TipoDoMovimento = (typeof TIPOS_DO_MOVIMENTO)[number];
const ESTOQUE_MAX = 1_000_000;
/** Número de estoque vindo da IA: só número de verdade, dentro do teto, com até 3 casas (V109). */
const numeroDoEstoque = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= ESTOQUE_MAX ? Math.round(v * 1000) / 1000 : null;
const NOMES_DA_UNIDADE: Record<string, string> = {
  kg: 'kg', kgs: 'kg', quilo: 'kg', quilos: 'kg', kilo: 'kg', kilos: 'kg', quilograma: 'kg', quilogramas: 'kg',
  g: 'g', gr: 'g', grs: 'g', grama: 'g', gramas: 'g',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml',
  un: 'un', und: 'un', unid: 'un', unidade: 'un', unidades: 'un',
};
const unidadeNormal = (u: unknown): string => {
  const t = String(u ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f.]/g, '');
  return NOMES_DA_UNIDADE[t] ?? t;
};
/** A unidade que a pessoa disse é a do item? ("2 caixas" num item em kg não se lança: a conta seria errada.) */
export const mesmaUnidade = (dita: unknown, doItem: unknown): boolean => unidadeNormal(dita) === unidadeNormal(doItem);
export const quantidadeBr = (n: number): string => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
/** O "o que vou fazer" do movimento: o item, a loja, e o saldo antes e depois. */
export function resumoDoMovimento(
  m: { tipo: TipoDoMovimento; quantidade: number | null; saldoContado: number | null; motivo: string | null },
  a: { nome: string; unidade: string; saldo: number; loja: string | null },
): string {
  const un = (x: number) => `${quantidadeBr(x)} ${a.unidade}`;
  const naLoja = a.loja ? ` na ${a.loja}` : '';
  const porque = m.motivo ? ` (motivo: ${m.motivo})` : '';
  const q = m.quantidade ?? 0;
  const depois = Math.round((m.tipo === 'entrada' ? a.saldo + q : m.tipo === 'saida' ? a.saldo - q : (m.saldoContado ?? 0)) * 1000) / 1000;
  const oQue =
    m.tipo === 'entrada'
      ? `Dar entrada de ${un(q)} em "${a.nome}"${naLoja}${porque}.`
      : m.tipo === 'saida'
        ? `Dar saída de ${un(q)} em "${a.nome}"${naLoja}${porque}.`
        : `Acertar o saldo de "${a.nome}"${naLoja} pelo que foi contado${porque}.`;
  return `${oQue} Saldo: ${un(a.saldo)} → ${un(depois)}.${depois < 0 ? ' O saldo fica negativo.' : ''}`;
}

// ───────────────────────────── lote 8: o preço do produto (de PIN) ─────────────────────────────

const PRECO_MAXIMO_DA_ACAO = 999_999.99;
/** O preço vindo da IA (V109): número de verdade, maior que zero, no teto da tela e em centavos; senão, null. */
export function precoDaAcao(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > PRECO_MAXIMO_DA_ACAO) return null;
  const centavos = v * 100;
  return Math.abs(Math.round(centavos) - centavos) > 1e-6 ? null : Math.round(centavos) / 100;
}
export const reaisDaAcao = (v: number): string => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** O preço de hoje em cada canal. `de` null: a pessoa não pode ver agora (PIN da sessão vencido) ou o canal não tem preço próprio. */
export interface PrecoNoCanal {
  canal: CanalDoProduto;
  de: number | null;
}
export interface MudancaDePreco {
  nome: string;
  para: number;
  canais: PrecoNoCanal[];
  /** O produto tem preço de promoção (o cardápio digital cobra a promoção, não o preço de venda). */
  temPromocao: boolean;
  /** O valor da promoção, quando a pessoa pode ver. */
  promocao: number | null;
  /** O produto é da empresa, e ela tem mais de uma loja: o preço vale em todas. */
  todasAsLojas: boolean;
}
const comMaiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** O que a pessoa precisa saber antes do PIN: o salto grande (um zero a mais, a vírgula errada), a promoção e as outras lojas. */
function notasDoPreco(m: MudancaDePreco): string[] {
  const notas: string[] = [];
  const hoje = m.canais.map((c) => c.de).filter((d): d is number => d !== null && d > 0);
  if (hoje.some((d) => m.para >= d * 2)) notas.push('Atenção: é o dobro ou mais do preço de hoje.');
  else if (hoje.some((d) => m.para <= d / 2)) notas.push('Atenção: é a metade ou menos do preço de hoje.');
  if (m.temPromocao && m.canais.some((c) => c.canal === 'regem'))
    notas.push(`Ele está em promoção${m.promocao !== null ? ` por ${reaisDaAcao(m.promocao)}` : ''}: no cardápio digital o cliente continua pagando a promoção.`);
  if (m.todasAsLojas) notas.push('O produto é da empresa: o preço novo vale em todas as lojas.');
  return notas;
}
/** O "o que vou fazer" da conversa. */
export function resumoDoPreco(m: MudancaDePreco): string {
  const onde = m.canais.map((c) => `${ondeOProduto([c.canal])}${c.de !== null ? ` (hoje ${reaisDaAcao(c.de)})` : ''}`);
  const lista = onde.length <= 1 ? (onde[0] ?? '') : `${onde.slice(0, -1).join(', ')} e ${onde[onde.length - 1]}`;
  return [`Mudar o preço de "${m.nome}" para ${reaisDaAcao(m.para)} ${lista}.`, ...notasDoPreco(m)].join(' ');
}
/** O que a página do link mostra antes do PIN. */
export function apresentacaoDoPreco(m: MudancaDePreco): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const porCanal = m.canais.map((c) => `${comMaiuscula(ondeOProduto([c.canal]))}: ${c.de !== null ? `de ${reaisDaAcao(c.de)} para` : 'passa a'} ${reaisDaAcao(m.para)}.`);
  return { titulo: `Mudar o preço de "${m.nome}"?`, detalhe: null, valor: m.para, itens: [...porCanal, ...notasDoPreco(m)], botao: 'Autorizar a mudança' };
}
/** Os canais em que o preço gravado é o pedido (a conferência do efeito, em centavos). */
export function canaisComOPreco(l: { precoVenda?: unknown; precoIfood?: unknown; preco99?: unknown }, canais: readonly CanalDoProduto[], para: number): CanalDoProduto[] {
  const gravado = (c: CanalDoProduto) => (c === 'regem' ? l.precoVenda : c === 'ifood' ? l.precoIfood : l.preco99);
  return canais.filter((c) => {
    const v = gravado(c);
    return v !== null && v !== undefined && Math.round(Number(v) * 100) === Math.round(para * 100);
  });
}

// ───────────────────────────── lote 9: o horário da semana (de PIN) ─────────────────────────────

/** O que muda no horário, já com o de hoje de cada dia (vai na proposta; a página do link mostra daqui). */
export interface MudancaDeHorario {
  dias: { dia: number; de: JanelaDoDia | null; para: JanelaDoDia | null }[];
  /** Qual horário: o único da loja, o de entrega ou o de retirada e consumo no local. */
  conjunto: 'unico' | 'entrega' | 'retirada';
  loja: string | null;
  /** O cardápio é o da empresa, e ela tem mais de uma loja. */
  todasAsLojas: boolean;
  incluiHoje: boolean;
}
const NOME_DO_CONJUNTO: Record<MudancaDeHorario['conjunto'], string> = { unico: 'Entrega e retirada', entrega: 'Entrega', retirada: 'Retirada e consumo no local' };
function notasDoHorario(m: MudancaDeHorario): string[] {
  const notas: string[] = [];
  if (m.dias.some((d) => d.para && horasDaJanela(d.para) > 18)) notas.push('Atenção: janela de mais de 18 horas, confira se o horário está certo.');
  if (m.incluiHoje) notas.push('Hoje é um dos dias: o cardápio segue o horário novo assim que você autorizar.');
  if (m.todasAsLojas) notas.push('O cardápio é da empresa: o horário novo vale em todas as lojas.');
  notas.push('Vale no cardápio digital. O horário do iFood e da 99 é o de lá.');
  return notas;
}
/** O "o que vou fazer" da conversa. */
export function resumoDoHorario(m: MudancaDeHorario): string {
  const dias = m.dias.map((d) => `${NOMES_DOS_DIAS[d.dia]} de ${textoDaJanela(d.de)} para ${textoDaJanela(d.para)}`).join('; ');
  const qual = m.conjunto === 'unico' ? '' : ` (${NOME_DO_CONJUNTO[m.conjunto].toLowerCase()})`;
  return [`Mudar o horário da loja${m.loja ? ` ${m.loja}` : ''}${qual}: ${dias}.`, ...notasDoHorario(m)].join(' ');
}
/** O que a página do link mostra antes do PIN. */
export function apresentacaoDoHorario(m: MudancaDeHorario): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const porDia = m.dias.map((d) => `${NOMES_DOS_DIAS[d.dia]}: de ${textoDaJanela(d.de)} para ${textoDaJanela(d.para)}.`);
  return {
    titulo: 'Mudar o horário da loja?',
    detalhe: [NOME_DO_CONJUNTO[m.conjunto], m.loja].filter(Boolean).join(' · '),
    valor: null,
    itens: [...porDia, ...notasDoHorario(m)],
    botao: 'Autorizar a mudança',
  };
}

// ───────────────────────────── lote 10: marcar a conta como paga (de PIN) ─────────────────────────────

export const FORMAS_DA_BAIXA = ['dinheiro', 'pix', 'cartao', 'transferencia'] as const;
export type FormaDaBaixa = (typeof FORMAS_DA_BAIXA)[number];
const NOME_DA_FORMA: Record<FormaDaBaixa, string> = { dinheiro: 'dinheiro', pix: 'Pix', cartao: 'cartão', transferencia: 'transferência' };
export function lerFormaDaBaixa(v: unknown): FormaDaBaixa | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (FORMAS_DA_BAIXA as readonly string[]).includes(t) ? (t as FormaDaBaixa) : null;
}
export const dataBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const diaMesBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** A data do pagamento: um dia de verdade, de hoje para trás, até 60 dias. Qualquer outra coisa é null. */
export function lerDataDoPagamento(v: unknown, hoje: string): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v || v > hoje) return null;
  const limite = new Date(`${hoje}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - 60);
  return v < limite.toISOString().slice(0, 10) ? null : v;
}
/** O que a baixa vai gravar (vai na proposta; a página do link mostra daqui). */
export interface BaixaDeConta {
  descricao: string;
  fornecedor: string | null;
  valor: number;
  vencimento: string | null;
  forma: FormaDaBaixa;
  pagoEm: string;
  recorrente: boolean;
}
/** O Regem registra a baixa; ele não movimenta dinheiro no banco. A frase vai sempre, antes do PIN. */
const SO_REGISTRA = 'Isso só registra no Regem a saída do caixa: o pagamento no banco não sai daqui.';
const NOTA_RECORRENTE = 'É uma conta recorrente: a próxima é criada em aberto.';
/** O "o que vou fazer" da conversa. */
export function resumoDaBaixa(b: BaixaDeConta): string {
  const quem = b.fornecedor ? ` (${b.fornecedor})` : '';
  const vence = b.vencimento ? `, vencimento ${diaMesBr(b.vencimento)}` : '';
  return [
    `Marcar como paga a conta "${b.descricao}"${quem} de ${reaisDaAcao(b.valor)}${vence}, em ${NOME_DA_FORMA[b.forma]}, com data de ${dataBr(b.pagoEm)}.`,
    SO_REGISTRA,
    ...(b.recorrente ? [NOTA_RECORRENTE] : []),
  ].join(' ');
}
/** O que a página do link mostra antes do PIN. */
export function apresentacaoDaBaixa(b: BaixaDeConta): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: `Marcar como paga a conta "${b.descricao}"?`,
    detalhe: [b.fornecedor, b.vencimento ? `vence ${diaMesBr(b.vencimento)}` : null].filter(Boolean).join(' · ') || null,
    valor: b.valor,
    itens: [`Forma: ${NOME_DA_FORMA[b.forma]}.`, `Data do pagamento: ${dataBr(b.pagoEm)}.`, SO_REGISTRA, ...(b.recorrente ? [NOTA_RECORRENTE] : [])],
    botao: 'Marcar como paga',
  };
}
/** Uma conta na lista de "qual delas?". */
export const linhaDaConta = (c: { descricao: string; valor: number; vencimento: string | null }): string =>
  `"${c.descricao}" (${c.vencimento ? `vence ${diaMesBr(c.vencimento)}` : 'sem vencimento'}, ${reaisDaAcao(c.valor)})`;
/** O desfecho, com a forma e a data que ficaram gravadas. */
export const textoDaBaixaFeita = (b: BaixaDeConta, proxima: string | null): string =>
  `A conta "${b.descricao}" ficou paga: saída de ${reaisDaAcao(b.valor)} em ${NOME_DA_FORMA[b.forma]}, com data de ${dataBr(b.pagoEm)}.${proxima ? ` A próxima vence em ${dataBr(proxima)}.` : ''} Para desfazer, use "Estornar" em Financeiro › Contas a pagar.`;

/** O que a ação leva, já conferido (vai em `mister_proposta.parametros`, junto com quem pediu). */
export type ParametrosDaAcao =
  | { acao: 'pausar_canal'; canais: CanalDaPausa[]; motivo: string; motivoTexto: string | null; minutos: number | null; ate: string | null; fimDoDia: boolean }
  | { acao: 'reabrir_canal'; canais: CanalDaPausa[] }
  | { acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido'; numero: string }
  | { acao: 'concluir_tarefa'; tarefa: string; estado: EstadoDaTarefa; justificativa: string | null }
  | { acao: 'pausar_produto' | 'reativar_produto'; produto: string; canais: CanalDoProduto[] | null }
  | { acao: 'criar_tarefa'; titulo: string; funcao: string; horario: string | null; responsavel: string | null }
  | { acao: 'criar_imagem'; pedido: string; proporcao: ProporcaoDaImagem }
  | { acao: 'movimentar_estoque'; item: string; tipo: TipoDoMovimento; quantidade: number | null; saldoContado: number | null; motivo: string | null }
  | { acao: 'mudar_preco'; produto: string; canais: CanalDoProduto[]; precoNovo: number }
  | { acao: 'mudar_horario'; dias: number[]; janela: JanelaDoDia | null; horarioDe: 'entrega' | 'retirada' | null }
  | { acao: 'pagar_conta'; conta: string; venceEm: string | null; forma: FormaDaBaixa; pagoEm: string | null; valorPago: number | null }
  | { acao: AcaoDeDadoInformado; centavos: number; dia: string; campanha: string | null }
  | ParametrosDeCadastro
  | ParametrosDaLoja
  | ParametrosDaClassificacao
  | ParametrosDaContagem
  | ParametrosDoCaixa
  | ParametrosDoEntregador
  | ParametrosDoPonto
  | ParametrosDoEnvio
  | ParametrosDoCardapio
  | ParametrosDaCampanha
  | ParametrosDaValidade
  | ParametrosDaPrevisao;

const TEMPOS_TEXTO = `cardápio digital e iFood: ${TEMPOS_DO_CARDAPIO.join(', ')} min ou "até HH:MM"; 99: ${TEMPOS_DA_99.join(', ')} min ou até o fim do dia`;

/**
 * Confere o que a IA mandou para a ação — os MESMOS limites da tela (o motivo, os tempos de cada canal). Devolve os
 * parâmetros limpos e o "o que vou fazer" da pergunta, ou o erro em português (volta à IA, que pergunta à pessoa).
 */
export function conferirAcao(acao: unknown, en: Record<string, unknown>, agora: Date = new Date()): { parametros: ParametrosDaAcao; resumo: string } | { erro: string } {
  if (!ehAcaoDoMister(acao)) return { erro: `Essa ação não existe. As ações são: ${ACOES_DO_MISTER.join(', ')}.` };
  if (ehCadastro(acao)) return conferirCadastro(acao, en);
  if (ehDaLoja(acao)) return conferirAcaoDaLoja(acao, en, dataNoFuso(agora));
  if (acao === 'classificar_banco') return conferirClassificacao(en, dataNoFuso(agora));
  if (acao === 'contar_estoque') return conferirContagem(en);
  if (acao === 'fechar_caixa' || acao === 'sangria') return conferirCaixa(acao, en);
  if (acao === 'pagar_entregador') return conferirEntregador(en);
  if (acao === 'incluir_marcacao' || acao === 'desconsiderar_marcacao') return conferirPonto(acao, en);
  if (acao === 'pedido_enviado') return conferirEnvio(en);
  if (acao === 'informar_validade') return conferirValidadeInformada(en);
  if (acao === 'mudar_previsao') return conferirPrevisao(en, dataNoFuso(agora));
  if (acao === 'criar_categoria' || acao === 'criar_produto' || acao === 'promocao_do_produto') return conferirCardapio(acao, en);
  if (acao === 'pausar_campanha' || acao === 'repetir_campanha') return conferirCampanha(acao, en);
  if (acao === 'pausar_canal' || acao === 'reabrir_canal') {
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const canais = [...new Set(brutos.map(lerCanal))];
    if (!canais.length || canais.some((c) => c === null)) return { erro: 'Diga qual canal: cardapio, ifood ou 99 (um ou mais).' };
    const lista = (CANAIS_DA_PAUSA as readonly CanalDaPausa[]).filter((c) => canais.includes(c));
    if (acao === 'reabrir_canal') return { parametros: { acao, canais: lista }, resumo: `Reabrir ${nomesDosCanais(lista)} agora.` };
    const m = lerMotivo(en.motivo, en.motivoTexto);
    if (!m.ok) return { erro: `${m.erro} Os motivos: ${MOTIVOS.join(', ')} (outro pede o texto, até 80 letras).` };
    const minutos = en.minutos === undefined || en.minutos === null || en.minutos === '' ? null : Number(en.minutos);
    const ate = typeof en.ate === 'string' && en.ate.trim() ? en.ate.trim() : null;
    const fimDoDia = en.fimDoDia === true;
    const voltas: string[] = [];
    for (const c of lista) {
      const r = c === 'food99' ? ateDa99({ minutos, fimDoDia }, agora) : ateDoCardapio(minutos !== null ? { minutos } : { ate }, agora);
      if (!r.ok) return { erro: `${NOME_DO_CANAL[c]}: ${r.erro} Os tempos: ${TEMPOS_TEXTO}.` };
      voltas.push(`${nomesDosCanais([c])} ${voltaDaPausa(r.ate, agora).texto}`);
    }
    const motivo = m.motivo === 'outro' ? m.motivoTexto! : MOTIVOS_DA_PAUSA[m.motivo].rotulo;
    return {
      parametros: { acao, canais: lista, motivo: m.motivo, motivoTexto: m.motivoTexto, minutos, ate, fimDoDia },
      resumo: `Pausar ${nomesDosCanais(lista)} (motivo: ${motivo}). Volta: ${voltas.join('; ')}.`,
    };
  }
  if (acao === 'concluir_tarefa') {
    const tarefa = String(en.tarefa ?? '').trim().replace(/\s+/g, ' ');
    if (tarefa.length < 2 || tarefa.length > 80) return { erro: 'Diga a tarefa de hoje como ela aparece na lista (o título).' };
    const estado = (en.estado === undefined || en.estado === null || en.estado === '' ? 'feita' : String(en.estado)) as EstadoDaTarefa;
    if (!(ESTADOS_DA_TAREFA as readonly string[]).includes(estado)) return { erro: 'A tarefa fica feita, parcial ou nao_feita.' };
    // A MESMA regra da tela (`TarefaInstanciaService.concluir`): "não feita" pede o motivo.
    const justificativa = typeof en.justificativa === 'string' && en.justificativa.trim() ? en.justificativa.trim().slice(0, 200) : null;
    if (estado === 'nao_feita' && !justificativa) return { erro: 'Para marcar como não feita, diga o motivo (vai junto na tarefa).' };
    return {
      parametros: { acao, tarefa, estado, justificativa: estado === 'nao_feita' ? justificativa : null },
      resumo: `Marcar a tarefa "${tarefa}" como ${nomeDoEstadoDaTarefa(estado)}${estado === 'nao_feita' ? ` (motivo: ${justificativa})` : ''}.`,
    };
  }
  if (acao === 'pausar_produto' || acao === 'reativar_produto') {
    const produto = String(en.produto ?? '').trim().replace(/\s+/g, ' ');
    if (produto.length < 2 || produto.length > 80) return { erro: 'Diga o produto como ele aparece no cardápio.' };
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const lidos = [...new Set(brutos.map(lerCanalDoProduto))];
    if (lidos.some((c) => c === null)) return { erro: 'Os canais do produto são regem (balcão e cardápio digital), ifood e 99.' };
    const canais = lidos.length ? (CANAIS_DO_PRODUTO as readonly CanalDoProduto[]).filter((c) => lidos.includes(c)) : null;
    const verbo = acao === 'pausar_produto' ? 'Pausar' : 'Reativar';
    return { parametros: { acao, produto, canais }, resumo: `${verbo} "${produto}" ${canais ? ondeOProduto(canais) : 'em todos os canais em que ele está'}.` };
  }
  if (acao === 'criar_tarefa') {
    // A MESMA exigência da tela (`TarefaDefService.create`): o título e a função ("Selecione a função da tarefa.").
    const titulo = String(en.titulo ?? '').trim().replace(/\s+/g, ' ');
    if (titulo.length < 2 || titulo.length > 120) return { erro: 'Diga o título da tarefa (de 2 a 120 letras).' };
    const funcao = String(en.funcao ?? '').trim().replace(/\s+/g, ' ');
    if (funcao.length < 2 || funcao.length > 60) return { erro: 'Diga a função da tarefa (quem faz: a cozinha, o caixa, a limpeza…), como está no cadastro das funções.' };
    const horario = typeof en.horario === 'string' && en.horario.trim() ? en.horario.trim() : null;
    if (horario !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(horario)) return { erro: 'O horário da tarefa vai em HH:MM (por exemplo 15:30).' };
    const responsavel = typeof en.responsavel === 'string' && en.responsavel.trim() ? en.responsavel.trim().slice(0, 80) : null;
    return {
      parametros: { acao, titulo, funcao, horario, responsavel },
      resumo: `Criar para hoje a tarefa "${titulo}"${horario ? ` às ${horario}` : ''}, da função ${funcao}${responsavel ? `, para ${responsavel}` : ''}.`,
    };
  }
  if (acao === 'criar_imagem') {
    const pedido = String(en.pedidoDaImagem ?? '').trim().replace(/[ \t]+/g, ' ');
    if (pedido.length < 20 || pedido.length > PEDIDO_DA_IMAGEM_MAX)
      return { erro: `Escreva o pedido da imagem completo (o que aparece, o texto exato, o estilo e as cores), de 20 a ${PEDIDO_DA_IMAGEM_MAX} letras.` };
    // C10a: a imagem agora leva números da loja ("R$ 18.420 / 14.900 / 6.500"): a trava pega telefone, CPF, CNPJ e e-mail pelo
    // jeito de cada um, não por "10 dígitos com qualquer separador" (que barrava uma lista de valores).
    if (pareceDadoPessoalNaImagem(pedido)) return { erro: 'O pedido da imagem não pode levar telefone, e-mail, CPF ou CNPJ. Tire isso e mande de novo.' };
    const proporcao = String(en.proporcao ?? '1:1') as ProporcaoDaImagem;
    if (!PROPORCOES_DA_IMAGEM.includes(proporcao)) return { erro: 'A proporção é 1:1 (feed), 9:16 (story ou cartaz vertical) ou 16:9 (horizontal).' };
    return { parametros: { acao, pedido, proporcao }, resumo: pedido };
  }
  if (acao === 'movimentar_estoque') {
    const item = String(en.item ?? '').trim().replace(/\s+/g, ' ');
    if (item.length < 2 || item.length > 80) return { erro: 'Diga o produto do estoque como ele aparece em Estoque › Produtos.' };
    const tipo = String(en.tipo ?? '') as TipoDoMovimento;
    if (!TIPOS_DO_MOVIMENTO.includes(tipo)) return { erro: 'O movimento é entrada, saida ou ajuste (o saldo que a pessoa contou).' };
    const motivo = typeof en.motivoDoMovimento === 'string' && en.motivoDoMovimento.trim() ? en.motivoDoMovimento.trim().replace(/\s+/g, ' ').slice(0, 120) : null;
    if (tipo === 'ajuste') {
      const saldoContado = numeroDoEstoque(en.saldoContado);
      if (saldoContado === null) return { erro: 'Para acertar o saldo, diga quanto foi contado (zero ou mais), na unidade do produto.' };
      return { parametros: { acao, item, tipo, quantidade: null, saldoContado, motivo }, resumo: `Acertar o saldo de "${item}" para ${quantidadeBr(saldoContado)}.` };
    }
    const quantidade = numeroDoEstoque(en.quantidade);
    if (quantidade === null || quantidade <= 0) return { erro: 'Diga a quantidade (maior que zero), na unidade do produto.' };
    return { parametros: { acao, item, tipo, quantidade, saldoContado: null, motivo }, resumo: `${tipo === 'entrada' ? 'Dar entrada de' : 'Dar saída de'} ${quantidadeBr(quantidade)} em "${item}".` };
  }
  if (acao === 'mudar_preco') {
    const produto = String(en.produto ?? '').trim().replace(/\s+/g, ' ');
    if (produto.length < 2 || produto.length > 80) return { erro: 'Diga o produto como ele aparece no cardápio.' };
    // O canal nunca se supõe: o preço de cada canal é um valor diferente.
    const brutos = Array.isArray(en.canais) ? en.canais : en.canal !== undefined ? [en.canal] : [];
    const lidos = [...new Set(brutos.map(lerCanalDoProduto))];
    if (!lidos.length || lidos.some((c) => c === null)) return { erro: 'Diga em qual canal muda o preço: regem (balcão e cardápio digital), ifood ou 99.' };
    const canais = (CANAIS_DO_PRODUTO as readonly CanalDoProduto[]).filter((c) => lidos.includes(c));
    const precoNovo = precoDaAcao(en.precoNovo);
    if (precoNovo === null) return { erro: 'Diga o preço final em reais, maior que zero e com até 2 casas (por exemplo 39,90).' };
    return { parametros: { acao, produto, canais, precoNovo }, resumo: `Mudar o preço de "${produto}" para ${reaisDaAcao(precoNovo)} ${ondeOProduto(canais)}.` };
  }
  if (acao === 'mudar_horario') {
    const lidos = (Array.isArray(en.dias) ? en.dias : []).map(lerDiaDaSemana);
    if (!lidos.length || lidos.some((d) => d === null)) return { erro: 'Diga os dias da semana (domingo, segunda, terça…). Para fechar só hoje, use a pausa dos canais.' };
    const dias = [...new Set(lidos as number[])].sort((a, b) => a - b);
    const fechado = en.fechado === true;
    if (fechado && (en.abre !== undefined || en.fecha !== undefined)) return { erro: 'O dia fica fechado ou com horário: diga um dos dois.' };
    let janela: JanelaDoDia | null = null;
    if (!fechado) {
      if (!ehHoraDoDia(en.abre) || !ehHoraDoDia(en.fecha)) return { erro: 'Diga a hora de abrir e a de fechar em HH:MM (por exemplo 18:00 e 23:00), ou que o dia fica fechado.' };
      if (en.abre === en.fecha) return { erro: 'A hora de abrir e a de fechar não podem ser iguais.' };
      janela = { abre: en.abre, fecha: en.fecha };
    }
    const bruto = en.horarioDe;
    if (bruto !== undefined && bruto !== null && bruto !== '' && bruto !== 'entrega' && bruto !== 'retirada') return { erro: 'O horário é o de entrega ou o de retirada.' };
    const horarioDe = bruto === 'entrega' || bruto === 'retirada' ? bruto : null;
    const nomes = dias.map((d) => NOMES_DOS_DIAS[d]);
    const lista = nomes.length <= 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
    return { parametros: { acao, dias, janela, horarioDe }, resumo: `Mudar o horário de ${lista} para ${textoDaJanela(janela)}.` };
  }
  if (acao === 'pagar_conta') {
    // Sem os curingas do ILIKE: "%" sozinho acharia todas as contas.
    const conta = String(en.conta ?? '').replace(/[%_\\]/g, '').trim().replace(/\s+/g, ' ');
    if (conta.length < 2 || conta.length > 60) return { erro: 'Diga qual conta: a descrição ou o fornecedor, como aparece em Contas a pagar.' };
    const forma = lerFormaDaBaixa(en.formaDePagamento);
    if (!forma) return { erro: 'Diga como foi pago: dinheiro, pix, cartao ou transferencia.' };
    const vazio = (v: unknown) => v === undefined || v === null || v === '';
    if (!vazio(en.venceEm) && !(typeof en.venceEm === 'string' && /^\d{2}\/\d{2}$/.test(en.venceEm))) return { erro: 'O vencimento vai em DD/MM (por exemplo 10/12).' };
    const venceEm = vazio(en.venceEm) ? null : String(en.venceEm);
    const pagoEm = vazio(en.pagoEm) ? null : lerDataDoPagamento(en.pagoEm, dataNoFuso(agora));
    if (!vazio(en.pagoEm) && !pagoEm) return { erro: 'A data do pagamento vai em AAAA-MM-DD, de hoje para trás, até 60 dias.' };
    const valorPago = vazio(en.valorPago) ? null : precoDaAcao(en.valorPago);
    if (!vazio(en.valorPago) && valorPago === null) return { erro: 'O valor pago vai em reais, maior que zero e com até 2 casas.' };
    return { parametros: { acao, conta, venceEm, forma, pagoEm, valorPago }, resumo: `Marcar como paga a conta "${conta}", em ${NOME_DA_FORMA[forma]}. ${SO_REGISTRA}` };
  }
  if (ehDadoInformado(acao)) {
    const centavos = centavosDoDado(en.valorInformado, TETO_DO_DADO[acao]);
    if (centavos === null) return { erro: `Diga ${NOME_DO_DADO[acao]} em reais: maior que zero, até ${reaisDaAcao(TETO_DO_DADO[acao])} e com até 2 casas.` };
    const hoje = dataNoFuso(agora);
    let dia = hoje;
    if (acao === 'informar_saldo' && en.dataDoSaldo !== undefined && en.dataDoSaldo !== null && en.dataDoSaldo !== '') {
      const lido = lerDiaDoSaldo(en.dataDoSaldo, hoje);
      if (!lido) return { erro: 'O dia do saldo vai em AAAA-MM-DD, de hoje até 7 dias atrás. Saldo mais velho que isso não vale: peça o de hoje.' };
      dia = lido;
    }
    let campanha: string | null = null;
    if (acao === 'informar_custo_campanha') {
      campanha = String(en.campanha ?? '').trim().replace(/\s+/g, ' ');
      if (campanha.length < 2 || campanha.length > 40) return { erro: 'Diga o código do cupom da campanha.' };
    }
    return { parametros: { acao, centavos, dia, campanha }, resumo: resumoDoDado(acao, centavos, dia, campanha) };
  }
  const numero = String(en.numero ?? '').trim().replace(/^#/, '');
  if (!numero || numero.length > 40) return { erro: 'Diga o número do pedido como aparece no painel do Delivery.' };
  return { parametros: { acao, numero }, resumo: '' };
}

/** A situação que cada ação de pedido exige, e o que a pessoa vê quando o pedido está em outra. */
export function pedidoServe(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', p: { status: string; tipo: string | null }): string | null {
  if (p.status === 'cancelado') return 'Esse pedido está cancelado.';
  if (acao === 'aceitar_pedido') return p.status === 'novo' ? null : 'Esse pedido já foi aceito.';
  if (p.status === 'novo') return 'Esse pedido ainda não foi aceito: aceite antes.';
  if (acao === 'pedido_pronto') return p.status === 'confirmado' ? null : 'Esse pedido não está em preparo (já ficou pronto ou já saiu).';
  if (p.tipo === 'retirada') return 'Esse pedido é para retirar: ele não sai para entrega.';
  return p.status === 'confirmado' || p.status === 'pronto' ? null : 'Esse pedido já saiu para a entrega.';
}

/** O "o que vou fazer" das ações de pedido (o pedido como aparece no quadro do Delivery). */
export function resumoDoPedido(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string): string {
  if (acao === 'aceitar_pedido') return `Aceitar o pedido ${pedido}.`;
  if (acao === 'pedido_pronto') return `Marcar o pedido ${pedido} como pronto.`;
  return `Despachar o pedido ${pedido} (saiu para a entrega).`;
}

/** A situação esperada depois de cada ação de pedido (a conferência do efeito). */
export function pedidoAndou(acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', status: string): boolean {
  const depois: Record<string, string[]> = {
    aceitar_pedido: ['confirmado', 'pronto', 'despachado', 'entregue', 'concluido'],
    pedido_pronto: ['pronto', 'despachado', 'entregue', 'concluido'],
    despachar_pedido: ['despachado', 'entregue', 'concluido'],
  };
  return depois[acao].includes(status);
}

export const TEXTOS_DAS_ACOES = {
  pergunta: (resumo: string, prazo: number) => `${resumo}\n\nAutorizo? A pergunta vale por ${prazo} minutos.`,
  autorizada: 'Autorizado. Fazendo agora…',
  perguntaDaImagem: (pedido: string, prazo: number) => `Vou pedir assim:\n\n${pedido}\n\nGero assim? Usa 1 da franquia de imagens do mês. A pergunta vale por ${prazo} minutos.`,
  semPermissaoEstoque: 'O seu perfil no Regem não permite lançar no estoque: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  itemNaoAchado: 'Não achei esse produto no estoque. Diga o nome como aparece em Estoque › Produtos.',
  itensDemais: (nomes: string) => `Achei mais de um produto com esse nome: ${nomes}. Diga qual.`,
  estoquePedeLoja: 'Cada loja tem o próprio estoque: diga de qual loja é esse lançamento.',
  estoqueOutraUnidade: (item: string, unidade: string) => `"${item}" é controlado em ${unidade}. Diga a quantidade em ${unidade}.`,
  imagemDesligada: 'A criação de imagem ainda não está ligada nesta instalação.',
  // Versão 10, C10c (mig 509): a imagem é por empresa. O caminho do menu conferido na página (V65: Mister › Avisos e relatórios,
  // grupo Conversa); o gráfico do Regem é o que se oferece no lugar.
  imagemDesligadaNaEmpresa:
    'A imagem na conversa está desligada nesta empresa. Quem liga é o presidente, em Mister › Avisos e relatórios › Conversa › "Imagem na conversa" (cerca de R$ 0,35 por imagem, pela franquia do DMS Graph). No lugar, dá para fazer o gráfico desenhado pelo Regem, que não custa (mostrar_grafico ou grafico_livre).',
  imagemDesligadaAoGerar: 'a imagem na conversa foi desligada nesta empresa depois do pedido. Nada foi gerado.',
  imagemGerando: 'Gerando a imagem. Pode levar até um minuto, e ela chega aqui.',
  imagemMudar: 'Certo, não gerei. Me diga o que mudar no pedido.',
  // C10a: o número do pedido da imagem tem de ter vindo de uma consulta desta pergunta ou da fala da pessoa.
  imagemNumeroSemOrigem: (numeros: string) =>
    `O pedido da imagem tem ${numeros}, que não veio de uma consulta desta pergunta nem do que a pessoa disse. Consulte o número agora (a imagem só leva o que o Regem trouxe) ou tire da imagem.`,
  semPermissao: 'O seu perfil no Regem não dá acesso ao Delivery: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  soGestor: 'Só o presidente e o gerente fazem ações pelo Mister.',
  semBotao: 'Pela conexão por QR Code a ação não tem o botão "Autorizar". Faça no Regem, no painel do Delivery.',
  naoAchado: 'Não achei esse pedido nas últimas 24 horas das suas lojas. Confira o número como aparece no painel do Delivery.',
  maisDeUm: 'Achei mais de um pedido com esse número. Diga o número como aparece no painel (com as letras, se tiver).',
  naoDisponivel: 'Esta pergunta não está mais disponível para você.',
  pausado: (canais: string) => `${canais} pausado(s) no Regem; o iFood e a 99 recebem a pausa em seguida.`,
  reaberto: (canais: string) => `${canais} reaberto(s).`,
  pedidoFeito: (acao: 'aceitar_pedido' | 'pedido_pronto' | 'despachar_pedido', pedido: string) =>
    acao === 'aceitar_pedido' ? `O pedido ${pedido} foi aceito.` : acao === 'pedido_pronto' ? `O pedido ${pedido} está pronto.` : `O pedido ${pedido} saiu para a entrega.`,
  naoAndou: (pedido: string, situacao: string) => `o pedido ${pedido} continua "${situacao}". Confira no painel do Delivery.`,
  recusado: (motivo: string) => `o Regem recusou: ${motivo.replace(/[.\s]+$/, '')}. Nada foi feito.`,
  // Lote 2.
  semPermissaoTarefas: 'O seu perfil no Regem não dá acesso às Tarefas: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semPermissaoLoja: 'O seu perfil no Regem não dá acesso ao cadastro dos produtos: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semPermissaoCupons: 'O seu perfil no Regem não dá acesso aos Cupons: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semPermissaoCadastros: 'O seu perfil no Regem não dá acesso aos Cadastros (Fornecedores): essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semPermissaoEscalas: 'O seu perfil no Regem não permite mudar a Escala: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  categoriaNaoAchada: 'Não achei essa categoria em Cadastros › Cardápio › Categorias. Diga o nome como está lá — ou peça para criar a categoria antes.',
  campanhaIndisponivel: 'As campanhas não estão disponíveis agora. Nada foi feito.',
  campanhaMudou: 'A campanha (ou o público dela) mudou desde a pergunta. Nada foi feito: peça de novo para ver os números certos.',
  categoriaJaExiste: (nome: string) => `Já existe a categoria "${nome}" em Cadastros › Cardápio.`,
  produtoJaExiste: (nome: string) => `Já existe o produto "${nome}" no cardápio. Para mudar, peça para mudar o produto.`,
  categoriasDemais: (nomes: string) => `Achei mais de uma categoria com esse nome: ${nomes}. Qual delas?`,
  pessoaNaoAchada: 'Não achei essa pessoa entre os colaboradores ativos da loja. Diga o nome como está em Pessoas.',
  pessoasDemais: (nomes: string) => `Achei mais de uma pessoa com esse nome: ${nomes}. Qual delas?`,
  foraDaEscala: (nome: string, dia: string) => `${nome} não está na escala de ${dia}. Confira o dia ou o nome.`,
  turnosDemais: (nome: string, turnos: string) => `${nome} tem mais de um turno nesse dia: ${turnos}. Qual deles?`,
  mesmaPessoa: 'Quem entra é a mesma pessoa que sai: diga quem vai no lugar.',
  escalaMudou: 'A escala desse turno mudou desde a pergunta (pela tela ou por outra conversa). Nada foi feito: peça de novo se ainda for preciso.',
  fornecedorComEsseNome: (nome: string) => `Já existe o fornecedor "${nome}". Escolha outro nome.`,
  bancoSoPresidente: 'Financeiro › Banco e repasses é só do presidente: essa ação não sai por aqui.',
  lancamentoNaoAchado: (valor: string, dia: string) => `Não achei lançamento de ${valor} no dia ${dia} em Financeiro › Banco e repasses. Confira o dia e o valor no extrato.`,
  lancamentosDemais: (lista: string) => `Achei mais de um lançamento com esse dia e valor: ${lista}. Diga um pedaço da descrição de qual é.`,
  lancamentoMudou: 'O lançamento mudou ou saiu de Financeiro › Banco e repasses desde a pergunta. Nada foi feito.',
  listaDeContagemNaoAchada: 'Não achei essa lista em Estoque › Contagem. Diga o nome como está lá.',
  listasDeContagemDemais: (nomes: string) => `Achei mais de uma lista de contagem com esse nome: ${nomes}. Qual delas?`,
  qualListaDeContagem: (nomes: string) => `Qual lista de Estoque › Contagem é essa? ${nomes}.`,
  semListaDeContagem: 'Não há lista em Estoque › Contagem. Crie a lista na tela primeiro (os insumos que entram nela).',
  foraDaListaDeContagem: (insumo: string, lista: string) => `"${insumo}" não está na lista "${lista}" de Estoque › Contagem. Confira o nome, ou ponha o insumo na lista pela tela.`,
  itensDaListaDemais: (insumo: string, nomes: string) => `"${insumo}" pode ser ${nomes}. Qual deles?`,
  contagemNaoConcluida: 'a contagem não ficou concluída. Confira em Estoque › Contagem.',
  semPermissaoCaixa: 'O seu perfil no Regem não dá acesso ao caixa (PDV): essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  semCaixaAberto: (qual: string) => `Não há caixa ${qual} aberto agora nas lojas desta conversa.`,
  caixasDemais: (lista: string) => `Há mais de um caixa do balcão aberto: ${lista}. Diga de quem é (o nome de quem abriu) ou o nome do terminal.`,
  caixaMudou: 'O caixa mudou desde a pergunta (foi fechado pela tela ou por outra conversa). Nada foi feito.',
  entregadorIndisponivel: 'O acerto dos entregadores não está disponível agora. Nada foi feito.',
  semPermissaoPonto: 'O seu perfil no Regem não permite ajustar o ponto: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  pontoIndisponivel: 'O ajuste de ponto não está disponível agora. Nada foi feito.',
  pessoaDoPontoNaoAchada: (nome: string) => `Não achei "${nome}" entre as pessoas ativas das lojas desta conversa. Diga o nome como está no cadastro.`,
  pessoasDoPonto: (lista: string) => `Há mais de uma pessoa com esse nome: ${lista}. Diga o nome inteiro.`,
  marcacaoRepetida: (doDia: string) => `Essa marcação já existe (até 5 minutos de diferença). No dia: ${doDia}.`,
  marcacaoNaoAchada: (doDia: string) => `Não achei essa marcação no dia. No dia: ${doDia}. Diga a hora como está lá.`,
  marcacoesDemais: (doDia: string) => `Há mais de uma marcação nessa hora. No dia: ${doDia}. Diga qual (entrada, saída, intervalo).`,
  pontoMudou: 'O ponto desse dia mudou desde a pergunta (outra marcação ou outro ajuste). Nada foi feito: peça de novo.',
  entregadorMudou: 'O acerto do entregador mudou desde a pergunta (entrega nova, pagamento pela tela ou o caixa de entregas). Nada foi feito: peça de novo para ver o valor certo.',
  caixaSoNaTela: 'Há mais de um caixa aberto sem terminal e o Regem não tem como escolher este pela conversa. Nada foi feito: feche pelo PDV.',
  pendenciasSemMotivo: (n: number) =>
    `${n === 1 ? 'Há 1 entrega pendente' : `Há ${n} entregas pendentes`} no turno do delivery. Para fechar mesmo assim, diga o motivo (pelo menos 10 letras): ele vai para a auditoria.`,
  agendadosNoTurno: (n: number) =>
    `${n === 1 ? 'Há 1 pedido agendado' : `Há ${n} pedidos agendados`} para depois no turno do delivery: diga na tela se cada um fica, muda de horário ou é cancelado antes de fechar.`,
  semPermissaoLancarConta: 'O seu perfil no Regem não permite lançar conta a pagar: falta o acesso ao Financeiro ou "Ver valores em R$". Quem muda o perfil é o presidente.',
  tarefaNaoAchada: 'Não achei essa tarefa na lista de hoje das suas lojas. Diga o título como aparece na lista de tarefas.',
  tarefasDemais: (titulos: string) => `Achei mais de uma tarefa de hoje com esse nome: ${titulos}. Diga qual.`,
  tarefaJaMarcada: (estado: string) => `Essa tarefa já está ${estado}.`,
  tarefaPedeFoto: 'Essa tarefa pede a foto de comprovação para ser marcada assim: marque pelo app ou pela tela de tarefas, com a foto.',
  tarefaFeita: (titulo: string, estado: string) => `A tarefa "${titulo}" ficou ${estado}.`,
  tarefaNaoFicou: (titulo: string, estado: string) => `a tarefa "${titulo}" continua ${estado}. Confira na lista de tarefas.`,
  produtoNaoAchado: 'Não achei esse produto no cardápio. Diga o nome como aparece no cardápio.',
  produtosDemais: (nomes: string) => `Achei mais de um produto com esse nome: ${nomes}. Diga qual.`,
  produtoFeito: (nome: string, pausado: boolean, onde: string) => `"${nome}" ${pausado ? 'pausado' : 'reativado'} ${onde}.`,
  produtoNaoFicou: (nome: string, onde: string) => `"${nome}" não ficou como pedido ${onde}. Confira no cardápio.`,
  // Lote 3.
  semPermissaoChecklist: 'O seu perfil no Regem não dá acesso aos checklists e tarefas: essa ação não sai por aqui. Quem muda o perfil é o presidente.',
  lojaDaTarefa: 'A empresa tem mais de uma loja: diga de qual loja é a tarefa.',
  funcaoNaoAchada: 'Não achei essa função no cadastro das funções. Diga o nome como está cadastrado.',
  funcoesDemais: (nomes: string) => `Achei mais de uma função com esse nome: ${nomes}. Diga qual.`,
  responsavelNaoAchado: 'Não achei essa pessoa entre os colaboradores ativos da loja. Diga o nome como está no cadastro, ou crie sem responsável.',
  responsaveisDemais: (nomes: string) => `Achei mais de uma pessoa com esse nome: ${nomes}. Diga qual.`,
  tarefaCriada: (titulo: string) => `A tarefa "${titulo}" foi criada para hoje.`,
  tarefaNaoCriada: (titulo: string) => `a tarefa "${titulo}" não apareceu na lista de hoje. Confira na lista de tarefas.`,
  // Lote 8.
  semPermissaoPreco: 'O seu perfil no Regem não permite mudar preço: falta o acesso ao cadastro dos produtos ou "Ver valores em R$". Quem muda o perfil é o presidente.',
  precoComVariacao: (nome: string) => `"${nome}" tem variações, cada uma com o próprio preço: por aqui eu não mudo. Mude em Cadastros › Cardápio.`,
  precoForaDoCanal: (nome: string, onde: string) => `"${nome}" não está ${onde}: lá não há preço para mudar.`,
  precoCanalDesligado: (onde: string) => `O preço ${onde} não está ligado nesta empresa: ele não muda pelo Regem.`,
  precoIgual: (nome: string, preco: string) => `"${nome}" já custa ${preco} nesse canal. Nada muda.`,
  linkDaAcao: (resumo: string, hora: string) => `${resumo}\n\nPara valer, autorize no Regem com o seu PIN. O pedido vale até ${hora}.`,
  precoFeito: (nome: string, preco: string, onde: string, temApp: boolean) =>
    `"${nome}" agora custa ${preco} ${onde}.${temApp ? ' O app recebe o preço novo pela fila de envio.' : ''}`,
  precoEmParte: (nome: string, preco: string, feito: string, falta: string, motivo: string | null) =>
    `"${nome}" ficou com ${preco} ${feito}, mas não mudou ${falta}${motivo ? ` (${motivo})` : ''}. Confira em Delivery › Gestão do catálogo.`,
  /** Rodada 7, MIS-D-07 (ERR-655): o preço mudou pela tela entre a pergunta e o PIN. */
  precoMudouDesdeAPergunta: (nome: string) => `o preço de "${nome}" mudou desde a pergunta (alguém mexeu pela tela). Nada foi gravado por cima: peça de novo para ver o preço de agora.`,
  precoNaoMudou: (nome: string, motivo: string | null) => `o preço de "${nome}" não mudou${motivo ? `: ${motivo}` : ''}. Nada foi feito.`,
  // Lote 9.
  semPermissaoHorario: 'O seu perfil no Regem não dá acesso às configurações da loja: o horário não muda por aqui. Quem muda o perfil é o presidente.',
  horarioPedeLoja: 'A empresa tem mais de um cardápio digital: diga de qual loja é o horário.',
  horarioSemCardapio: 'Esta loja não tem cardápio digital configurado.',
  horarioPedeQual: 'Esta loja tem um horário para entrega e outro para retirada: diga qual muda.',
  horarioIgual: 'O horário já é esse. Nada muda.',
  horarioFeito: (dias: string) => `O horário ficou assim: ${dias}. Vale no cardápio digital.`,
  horarioNaoFicou: 'o horário não ficou como pedido. Confira em Delivery › Configurações › Horários.',
  // Lote 10.
  semPermissaoConta: 'O seu perfil no Regem não permite marcar conta como paga: falta o acesso ao Financeiro ou "Ver valores em R$". Quem muda o perfil é o presidente.',
  contaPedePin: 'Para marcar uma conta como paga, confirme antes o seu PIN: o link vai logo depois desta resposta.',
  contaNaoAchada: 'Não achei essa conta em aberto nas contas a pagar. Diga a descrição ou o fornecedor como aparece em Financeiro › Contas a pagar.',
  contasDemais: (lista: string) => `Achei mais de uma conta em aberto: ${lista}. Diga qual pelo vencimento (DD/MM).`,
  contaRepetida: 'Há mais de uma conta com esse nome e esse vencimento: marque em Financeiro › Contas a pagar.',
  contaSemValor: 'Essa conta está sem valor: corrija em Financeiro › Contas a pagar.',
  contaOutroValor: (valor: string) => `Essa conta é de ${valor}. Para registrar um valor diferente, faça em Financeiro › Contas a pagar.`,
  contaNaoAberta: 'essa conta já não está em aberto. Nada foi lançado.',
  contaMudouDeValor: (valor: string) => `o valor da conta mudou para ${valor} depois do pedido. Nada foi lançado: me peça de novo.`,
  contaRecusada: (motivo: string) => `o financeiro recusou: ${motivo}. Nada foi lançado.`,
  contaNaoFicou: 'a baixa não apareceu no caixa. Confira em Financeiro › Contas a pagar.',
  // V7f.
  perguntaDoDado: (resumo: string, prazo: number) => `${resumo}\n\nPosso guardar? A pergunta vale por ${prazo} minutos.`,
  dadoGuardando: 'Guardando…',
  dadoCorrigir: 'Certo, não guardei. Me diga o valor certo.',
  dadoSoPresidente: 'Saldo, folha e custo de campanha só o presidente informa.',
  dadoEmpresaInteira: 'Esse dado é da empresa inteira, e o seu acesso é só a uma loja: quem informa é o presidente da empresa.',
  dadoPedePin: 'Para informar esse valor, confirme antes o seu PIN: o link vai logo depois desta resposta.',
  dadoSemBotao: 'Pela conexão por QR Code não tenho o botão "Guardar": esse dado não fica guardado por aqui.',
  dadoSemCampanha: 'Não achei campanha com esse cupom. Confira o código em Delivery › Marketing, aba "Campanhas".',
  dadoNaoGuardou: 'não consegui guardar. Nada foi gravado: me diga de novo.',
} as const;
