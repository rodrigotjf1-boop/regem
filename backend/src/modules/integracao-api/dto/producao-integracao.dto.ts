import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AcrescentaOpcaoIntegracao, RetiraOpcaoIntegracao } from './catalogo-integracao.dto';

// Formato da rota da FILA DE PRODUÇÃO da API de integração (Farol — escopo `producao.ler`) — só
// para o contrato OpenAPI (`docs/openapi.json`). O contrato em palavras está em
// `docs/integracao-farol.md`. Nenhum campo aqui é do cliente (nome, telefone, CPF, mesa, senha de
// retirada) nem de dinheiro.

export class VariacaoDoItemIntegracao {
  @ApiProperty({ description: 'A variação escolhida na venda. O id muda quando o produto é salvo de novo: use o nome ou o código.' })
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  nome!: string | null;

  @ApiProperty({ nullable: true, type: String })
  codigo!: string | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Quanto da ficha do produto a variação usa (1 = a ficha inteira).' })
  fator_ficha!: number | null;
}

export class EscolhaDoItemIntegracao {
  @ApiProperty({ enum: ['adicionar', 'remover'] })
  tipo!: string;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'A opção reutilizável de onde a escolha saiu — id fixo, o mesmo `opcao_id` do catálogo. null = opção criada só naquele produto.',
  })
  opcao_id!: string | null;

  @ApiProperty({ description: 'O nome da escolha como foi vendida.' })
  nome!: string;

  @ApiProperty({ description: 'Quantas vezes a escolha foi feita neste item ("+1 bacon" duas vezes = 2).' })
  vezes!: number;

  @ApiProperty({ nullable: true, type: () => AcrescentaOpcaoIntegracao, description: 'O que cada vez acrescentou, como ficou gravado na venda.' })
  acrescenta!: AcrescentaOpcaoIntegracao | null;

  @ApiProperty({ nullable: true, type: () => RetiraOpcaoIntegracao, description: 'O ingrediente da ficha que a escolha tirou.' })
  retira!: RetiraOpcaoIntegracao | null;
}

export class ItemProducaoIntegracao {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O produto do catálogo. null = item retirado da venda depois de pedido.' })
  produto_id!: string | null;

  @ApiProperty({ nullable: true, type: String, description: 'A ficha técnica do produto no momento da venda.' })
  ficha_id!: string | null;

  @ApiProperty({ nullable: true, type: () => VariacaoDoItemIntegracao })
  variacao!: VariacaoDoItemIntegracao | null;

  @ApiProperty({ description: 'O texto que a cozinha lê: o produto, ou "Produto · Variação".' })
  descricao!: string;

  @ApiProperty()
  quantidade!: number;

  @ApiProperty({ nullable: true, type: String, description: 'A observação do item, como foi escrita ("sem cebola", "bem passado").' })
  observacao!: string | null;

  @ApiProperty({ description: 'O item foi retirado do pedido depois de entrar na fila.' })
  removido!: boolean;

  @ApiProperty({ nullable: true, type: String, description: 'As escolhas em texto, como a cozinha lê: "+ 2x Bacon · sem Cebola".' })
  adicionais_texto!: string | null;

  @ApiProperty({ type: [EscolhaDoItemIntegracao] })
  adicionais!: EscolhaDoItemIntegracao[];
}

export class PedidoProducaoIntegracao {
  @ApiProperty()
  id!: string;

  @ApiProperty({ nullable: true, type: Number, description: 'O número do pedido na fila da loja, no dia.' })
  numero!: number | null;

  @ApiProperty({ enum: ['balcao', 'mesa', 'comanda', 'delivery', 'totem'] })
  origem!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O canal de onde o pedido veio, quando veio de fora: "iFood", "Cardápio", "Totem"…' })
  canal!: string | null;

  @ApiProperty({ nullable: true, type: String, enum: ['local', 'viagem'], description: 'Comer na loja ou levar. null = não informado.' })
  consumo!: string | null;

  @ApiProperty({ enum: ['recebido', 'preparo', 'pronto', 'entregue', 'cancelado'] })
  status!: string;

  @ApiProperty({ nullable: true, type: String })
  setor_id!: string | null;

  @ApiProperty({ nullable: true, type: Number, description: 'O maior tempo de preparo entre os produtos do pedido.' })
  tempo_preparo_min!: number | null;

  @ApiProperty({ description: 'O pedido foi alterado depois de entrar na fila.' })
  alterado!: boolean;

  @ApiProperty({ format: 'date-time' })
  criado_em!: string;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  iniciado_em!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  pronto_em!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  entregue_em!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  cancelado_em!: string | null;

  @ApiProperty({ type: [ItemProducaoIntegracao] })
  itens!: ItemProducaoIntegracao[];
}

export class ProducaoIntegracao {
  @ApiProperty({ description: 'A impressão deste retrato (32 caracteres). Mande de volta em `?versao=`.' })
  versao!: string;

  @ApiProperty({ description: 'false = nada mudou desde a versão informada: os outros campos não vêm.' })
  atualizado!: boolean;

  @ApiPropertyOptional({ description: 'Quando o retrato foi montado (ISO 8601, UTC).' })
  gerado_em?: string;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'A loja do token.' })
  loja_id?: string | null;

  @ApiPropertyOptional({
    type: [PedidoProducaoIntegracao],
    description: 'Os pedidos em produção (até 24 h de criados) e os concluídos ou cancelados nas últimas 2 horas, na ordem em que entraram.',
  })
  pedidos?: PedidoProducaoIntegracao[];
}
