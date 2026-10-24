import { LIMITE_INTEGRACAO_POR_MINUTO } from '../../common/integracao-limite';
import { montarManifesto, type ManifestoDms, type PermissaoNoManifesto, type RotaNoManifesto } from '../../dms/integracao-dms';
import { PERMISSAO_NA_TELA } from './autorizacao-clique.regras';
import { ESCOPOS_DO_PARCEIRO, ESCOPOS_SENSIVEIS, ROTULO_ESCOPO, type EscopoIntegracao } from './escopos';
import { LIMITE_PARCEIRO_EMPRESA_POR_MINUTO } from './parceiros.regras';
import { corpoDoAviso, EVENTO_DO_RECURSO, EVENTO_DO_RETRATO, type Novidade } from './webhook-integracao';

// O MANIFESTO da porta de integração (Padrão DMS §13; F4, partes A e F; pacote 0.9.0): a documentação pública da porta,
// montada das tabelas do próprio código: os escopos (a frase da tela do clique; sem ela, o rótulo do console), o limite,
// as rotas de `/integracao` com os exemplos e os avisos (o corpo sai de `corpoDoAviso`). Servido SEM credencial em
// `/.well-known/dms-manifesto` (fora do prefixo, `ROTAS_FORA_DO_PREFIXO`) e guardado em `docs/dms-manifesto.json`: o teste
// confere que o arquivo é o mesmo que o código monta, e `ATUALIZAR_MANIFESTO=1` regrava.
//
// FICA DE FORA, de propósito: a troca do token pela ligação (`/integracao/dms-id/ligacao`) e os endereços do OAuth, que
// são o ciclo da credencial (Padrão §2 e §3), e não a porta de dados; as rotas do totem (fora de `/integracao`, só do
// GoGeM até a F6); e os avisos assinados ao GoGeM (contrato próprio, em `docs/integracao-gogem/`). O `rgm_it_` também não
// entra nas credenciais: é a credencial antiga dos produtos da DMS, que sai na F5 (parte E) e na F6. Os exemplos são
// fictícios (o repositório é público).

/** O endereço público da API: o manifesto é o mesmo em todo ambiente (o arquivo do repositório confere com ele). */
export const BASE_DO_MANIFESTO = 'https://api.dmsregem.com';

/** A versão do contrato da porta (Padrão §12). */
export const VERSAO_DO_CONTRATO = '1.0.0';

/** Os escopos da porta de integração: os do totem ficam de fora (não leem a API de integração). */
export const ESCOPOS_DA_PORTA = [
  'pedidos.ler',
  'clientes.telefone.ler',
  'custos.ler',
  'clientes.anonimizacao.ler',
  'cupons.ler',
  'cupons.uso.ler',
  'cupons.criar',
  'clientes.ler',
  'vendas.99food.ler',
  'catalogo.ler',
  'fichas.ler',
  'producao.ler',
] as const satisfies readonly EscopoIntegracao[];

/**
 * As permissões, com a classe que alcança cada uma: `dms` em todas (o console emite para o Liame, o RegemCast, o Farol e
 * o GoGeM) e `parceiro` nas do teto da classe (`ESCOPOS_DO_PARCEIRO`, o catálogo aprovado na F4). É o que o hub lê para
 * aprovar um aplicativo de parceiro e o simulador usa para gerar a porta de mentira; o Regem só passa a aceitar o
 * aplicativo de parceiro com o resto da parte F.
 */
function permissoes(): Record<string, PermissaoNoManifesto> {
  return Object.fromEntries(
    ESCOPOS_DA_PORTA.map((e) => [
      e,
      { frase: PERMISSAO_NA_TELA[e]?.frase ?? ROTULO_ESCOPO[e], classes: ESCOPOS_DO_PARCEIRO.includes(e) ? ['dms', 'parceiro'] : ['dms'], sensivel: ESCOPOS_SENSIVEIS.includes(e) },
    ]),
  );
}

// ─────────────────────────────── exemplos (fictícios) ───────────────────────────────

const LOJA = '1f0c2a3b-0000-4000-8000-000000000001';
const PEDIDO = '1f0c2a3b-0000-4000-8000-000000000003';
const CLIENTE = '1f0c2a3b-0000-4000-8000-000000000004';
const CUPOM = '1f0c2a3b-0000-4000-8000-000000000005';
const USO = '1f0c2a3b-0000-4000-8000-000000000006';
const PRODUTO = '1f0c2a3b-0000-4000-8000-000000000007';
const FICHA = '1f0c2a3b-0000-4000-8000-000000000008';
const SETOR = '1f0c2a3b-0000-4000-8000-000000000009';
const CATEGORIA = '1f0c2a3b-0000-4000-8000-000000000010';
const INSUMO = '1f0c2a3b-0000-4000-8000-000000000011';
const QUANDO = '2026-10-23T12:00:00.000Z';
const CURSOR = 'cursor-opaco-da-proxima-pagina';

const pagina = (item: unknown) => ({ itens: [item], proximo_cursor: CURSOR, tem_mais: false });

const CUPOM_EXEMPLO = {
  id: CUPOM,
  versao: 1,
  atualizado_em: QUANDO,
  codigo: 'COMBODASEXTA',
  nome: 'Combo de sexta',
  tipo: 'percentual',
  percentual: '10.00',
  valor_centavos: null,
  teto_desconto_centavos: 1500,
  pedido_minimo_centavos: 4000,
  valido_de: '2026-10-23',
  valido_ate: '2026-10-25',
  fuso: 'America/Sao_Paulo',
  ativo: true,
  max_usos: 200,
  usos: 0,
  condicoes: { somente_novos: false, max_por_cliente: 1, min_dias_sem_compra: null },
  todas_as_lojas: false,
  removido: false,
};

const ESTADO_DO_AVISO = {
  url: 'https://app.exemplo.test/avisos/regem/conexao-1',
  registrado_em: QUANDO,
  pausado: false,
  pausado_em: null,
  motivo_pausa: null,
  ultimo_envio_em: null,
  ultimo_status_http: null,
  falhas_seguidas: 0,
  entregues: 0,
};

const I = '/api/v1/integracao';

/** As rotas da porta (`integracao-api.controller.ts`), na ordem do controller. */
export const ROTAS_DA_PORTA: readonly RotaNoManifesto[] = [
  {
    metodo: 'GET',
    caminho: `${I}/loja`,
    resumo: 'Loja do token: nome, fuso, moeda, escopos concedidos e o cardápio online.',
    permissao: null,
    exemploResposta: { loja_id: LOJA, loja_nome: 'Centro', empresa_nome: 'Hamburgueria Exemplo', fuso: 'America/Sao_Paulo', moeda: 'BRL', escopos: ['pedidos.ler', 'cupons.ler'], cardapio_url: null },
  },
  {
    metodo: 'POST',
    caminho: `${I}/autorizacao/revogar`,
    resumo: 'Revoga a própria credencial. Idempotente por natureza: a chamada seguinte já volta 401.',
    permissao: null,
    escrita: 'substituicao',
    exemploResposta: { revogado: true, revogado_em: QUANDO },
  },
  {
    metodo: 'PUT',
    caminho: `${I}/webhook`,
    resumo: 'Registra (ou troca) o endereço e o segredo do aviso desta credencial. Registrar de novo religa o que estava pausado.',
    permissao: null,
    escrita: 'substituicao',
    exemploPedido: { url: 'https://app.exemplo.test/avisos/regem/conexao-1', segredo: 'whsec_<o segredo, em base64>' },
    exemploResposta: ESTADO_DO_AVISO,
  },
  {
    metodo: 'GET',
    caminho: `${I}/webhook`,
    resumo: 'Situação do aviso desta credencial (nunca o segredo). Sem registro, 404.',
    permissao: null,
    exemploResposta: ESTADO_DO_AVISO,
  },
  {
    metodo: 'DELETE',
    caminho: `${I}/webhook`,
    resumo: 'Para de avisar (apaga o endereço e o segredo). Sem registro, responde 204 do mesmo jeito.',
    permissao: null,
    escrita: 'substituicao',
    status: 204,
  },
  {
    metodo: 'GET',
    caminho: `${I}/pedidos`,
    resumo: 'Vendas da loja com cursor (ordem por atualizado_em e id; só o carimbado há mais de 15 s).',
    permissao: 'pedidos.ler',
    exemploResposta: pagina({
      id: PEDIDO,
      versao: 2,
      atualizado_em: QUANDO,
      canal: 'cardapio',
      grupo_canal: 'cardapio',
      situacao: 'confirmado',
      receita_centavos: 6490,
      criado_em: QUANDO,
      confirmado_em: QUANDO,
      cancelado_em: null,
      itens: [{ id: '1f0c2a3b-0000-4000-8000-000000000012', produto_id: PRODUTO, nome: 'X-Burger', quantidade: '1', receita_centavos: 5990, custo_centavos: null }],
      unidade_id: LOJA,
      unidade_nome: 'Centro',
      tipo: 'entrega',
      taxa_entrega_centavos: 500,
    }),
  },
  {
    metodo: 'GET',
    caminho: `${I}/clientes/anonimizados`,
    resumo: 'Clientes anonimizados (excluídos) da empresa, com cursor: só o id.',
    permissao: 'clientes.anonimizacao.ler',
    exemploResposta: pagina({ id: CLIENTE, anonimizado_em: QUANDO, versao: 4, atualizado_em: QUANDO }),
  },
  {
    metodo: 'GET',
    caminho: `${I}/clientes`,
    resumo: 'Clientes da empresa com cursor (ordem por atualizado_em e id; só o carimbado há mais de 15 s).',
    permissao: 'clientes.ler',
    exemploResposta: pagina({
      id: CLIENTE,
      versao: 3,
      atualizado_em: QUANDO,
      nome: 'Cliente Exemplo',
      telefone: '+552133330000',
      canais: ['cardapio'],
      bairro: 'Centro',
      cidade: 'Rio de Janeiro',
      opt_out: { ativo: false, em: null, origem: null },
      aceite_marketing: { aceito: false, em: null, origem: null, texto: null },
      criado_em: QUANDO,
      removido: false,
    }),
  },
  {
    metodo: 'GET',
    caminho: `${I}/catalogo`,
    resumo: 'Catálogo da loja: categorias, setores, produtos, variações, combos e adicionais, sem preço.',
    permissao: 'catalogo.ler',
    exemploResposta: {
      versao: '9f2c1a0b7d6e5f4a3b2c1d0e9f8a7b6c',
      atualizado: true,
      gerado_em: QUANDO,
      loja_id: LOJA,
      categorias: [{ id: CATEGORIA, nome: 'Burgers', categoria_pai_id: null, ordem: 1, ativo: true }],
      setores: [{ id: SETOR, nome: 'Montagem' }],
      produtos: [
        {
          id: PRODUTO,
          codigo: 'XB',
          nome: 'X-Burger',
          descricao: 'Pão, blend e queijo',
          tipo: 'simples',
          unidade_medida: 'un',
          categoria_id: CATEGORIA,
          vai_para_producao: true,
          setor_producao_id: SETOR,
          tempo_preparo_min: 12,
          ficha_id: FICHA,
          ativo: true,
          variacoes: [],
          combo: [],
          adicionais: [],
        },
      ],
    },
  },
  {
    metodo: 'GET',
    caminho: `${I}/fichas`,
    resumo: 'Fichas técnicas da loja, com os ingredientes de cada uma, sem custo.',
    permissao: 'fichas.ler',
    exemploResposta: {
      versao: '41b7e0c9d8a7b6c5d4e3f2a1b0c9d8e7',
      atualizado: true,
      gerado_em: QUANDO,
      loja_id: LOJA,
      mesma_embalagem: false,
      fichas: [
        {
          id: FICHA,
          nome: 'X-Burger',
          categoria: 'lanche',
          rendimento: 1,
          rendimento_unidade: 'porção',
          porcao_tamanho: 1,
          porcao_unidade: 'unidade',
          setor_id: SETOR,
          ativo: true,
          ingredientes: [
            { ordem: 0, insumo_id: INSUMO, sub_ficha_id: null, nome: 'Pão brioche', quantidade: 1, unidade: 'unidade', quantidade_estoque: 1, unidade_estoque: 'unidade', fator_correcao: 1, so_delivery: false, so_balcao: false },
          ],
        },
      ],
    },
  },
  {
    metodo: 'GET',
    caminho: `${I}/producao`,
    resumo: 'Fila de produção da loja: os pedidos em produção e os concluídos das últimas 2 horas, sem o cliente e sem valores.',
    permissao: 'producao.ler',
    exemploResposta: {
      versao: 'c07d5e1f2a3b4c5d6e7f8a9b0c1d2e3f',
      atualizado: true,
      gerado_em: QUANDO,
      loja_id: LOJA,
      pedidos: [
        {
          id: '1f0c2a3b-0000-4000-8000-000000000013',
          numero: 41,
          origem: 'mesa',
          canal: null,
          consumo: 'local',
          status: 'preparo',
          setor_id: SETOR,
          tempo_preparo_min: 12,
          alterado: false,
          criado_em: QUANDO,
          iniciado_em: QUANDO,
          pronto_em: null,
          entregue_em: null,
          cancelado_em: null,
          itens: [{ id: '1f0c2a3b-0000-4000-8000-000000000014', produto_id: PRODUTO, ficha_id: FICHA, descricao: 'X-Burger', quantidade: 1 }],
        },
      ],
    },
  },
  {
    metodo: 'GET',
    caminho: `${I}/cupons`,
    resumo: 'Cupons da loja com regra, validade e usos, com cursor (só o carimbado há mais de 15 s).',
    permissao: 'cupons.ler',
    exemploResposta: pagina(CUPOM_EXEMPLO),
  },
  {
    metodo: 'GET',
    caminho: `${I}/cupons/usos`,
    resumo: 'Usos de cupom nos pedidos da loja, com cursor, sem dado do cliente.',
    permissao: 'cupons.uso.ler',
    exemploResposta: pagina({ id: USO, versao: 1, atualizado_em: QUANDO, cupom_id: CUPOM, codigo: 'COMBODASEXTA', pedido_id: PEDIDO, usado_em: QUANDO, desconto_centavos: 649, removido: false }),
  },
  {
    metodo: 'POST',
    caminho: `${I}/cupons`,
    resumo: 'Cria um cupom na loja da credencial (nunca atualiza cupom existente: código repetido, 409 codigo-em-uso).',
    permissao: 'cupons.criar',
    escrita: 'chave',
    status: 201,
    exemploPedido: {
      codigo: 'COMBODASEXTA',
      nome: 'Combo de sexta',
      tipo: 'percentual',
      percentual: '10.00',
      teto_desconto_centavos: 1500,
      pedido_minimo_centavos: 4000,
      valido_de: '2026-10-23',
      valido_ate: '2026-10-25',
      max_usos: 200,
      condicoes: { max_por_cliente: 1 },
    },
    exemploResposta: CUPOM_EXEMPLO,
  },
  {
    metodo: 'POST',
    caminho: `${I}/cupons/{id}/desativar`,
    resumo: 'Desativa um cupom criado pela integração. Já inativo, 200 sem mudança; cupom de outra origem, 404.',
    permissao: 'cupons.criar',
    escrita: 'chave',
    exemploResposta: { ...CUPOM_EXEMPLO, versao: 2, ativo: false },
  },
];

/** Os avisos (Standard Webhooks, Padrão §9): o tipo e o escopo vêm das tabelas do aviso, e o exemplo, de `corpoDoAviso`. */
function avisos() {
  const descricao: Record<string, string> = {
    'pedido.alterado': 'Uma venda mudou: leia de novo pelo cursor de /pedidos.',
    'cliente.anonimizado': 'Um cliente pediu para ser esquecido: apague o que tiver dele.',
    'cupom.alterado': 'Um cupom mudou: leia de novo pelo cursor de /cupons.',
    'cupom.usado': 'Um cupom foi usado num pedido: leia o uso em /cupons/usos.',
    'catalogo.alterado': 'O catálogo da loja mudou: leia /catalogo com ?versao=.',
    'fichas.alterado': 'As fichas da loja mudaram: leia /fichas com ?versao=.',
  };
  const novidades: Novidade[] = [
    { recurso: 'venda', id: PEDIDO, versao: 3 },
    { recurso: 'cliente', id: CLIENTE, versao: 4 },
    { recurso: 'cupom', id: CUPOM, versao: 2 },
    { recurso: 'cupom_uso', id: USO, versao: 1, cupom_id: CUPOM, pedido_id: PEDIDO },
    { recurso: 'catalogo', id: null, versao: null },
    { recurso: 'fichas', id: null, versao: null },
  ];
  const tabela: Record<string, { tipo: string; escopo: EscopoIntegracao }> = { ...EVENTO_DO_RECURSO, ...EVENTO_DO_RETRATO };
  return novidades.map((n) => {
    const { tipo, escopo } = tabela[n.recurso];
    return { tipo, permissao: escopo, descricao: descricao[tipo] ?? tipo, exemplo: corpoDoAviso(n, LOJA) };
  });
}

let guardado: ManifestoDms | null = null;

/** O manifesto da porta (montado uma vez: é o mesmo enquanto o processo vive). */
export function manifestoDaPorta(): ManifestoDms {
  guardado ??= montarManifesto({
    produto: 'regem',
    versao: VERSAO_DO_CONTRATO,
    titulo: 'Porta de integração do Regem',
    descricao:
      'A API que os aplicativos ligados à loja chamam: as vendas, os clientes, os cupons, o catálogo, as fichas e a fila ' +
      'de produção, com o que a loja autorizou. Credencial: o token do DMS ID com o segredo da ligação (DMS-Ligacao).',
    base: BASE_DO_MANIFESTO,
    permissoes: permissoes(),
    // 60/min por ligação para todos; o aplicativo de parceiro tem também um teto por empresa (todas as lojas dele nela).
    limite: [
      { porMinuto: LIMITE_INTEGRACAO_POR_MINUTO, por: 'ligacao' },
      { porMinuto: LIMITE_PARCEIRO_EMPRESA_POR_MINUTO, por: 'empresa' },
    ],
    rotas: ROTAS_DA_PORTA,
    avisos: avisos(),
    credenciais: ['dms_id'],
  });
  return guardado;
}
