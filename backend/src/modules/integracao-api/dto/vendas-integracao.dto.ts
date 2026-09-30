import { ApiProperty } from '@nestjs/swagger';

// Formato das respostas de VENDAS da API de integração — só para o contrato OpenAPI
// (`docs/openapi.json`). O contrato que vale é o do Liame (`docs/integracoes/regem.md`, v1);
// estes tipos o descrevem, campo a campo.

export class ClienteVendaIntegracao {
  @ApiProperty({ description: 'Id do cliente no Regem.' })
  id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Telefone em E.164 (+55…), ou null quando não dá para ter certeza.' })
  telefone!: string | null;

  @ApiProperty({ nullable: true, type: Boolean, description: 'Primeiro pedido do cliente na loja (null = não se sabe).' })
  novo!: boolean | null;
}

export class ItemVendaIntegracao {
  @ApiProperty({ description: 'Id do item (comanda_item; sem comanda, "pedido:<posição>").' })
  id!: string;

  @ApiProperty({ nullable: true, type: String })
  produto_id!: string | null;

  @ApiProperty()
  nome!: string;

  @ApiProperty({ example: '2', description: 'Quantidade em texto, até 3 casas decimais.' })
  quantidade!: string;

  @ApiProperty({ description: 'Quantidade × preço cheio, em centavos. A soma dos itens NÃO é a receita da venda.' })
  receita_centavos!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Custo vigente na leitura × quantidade, em centavos. null sem ficha/custo ou sem o escopo custos.ler.',
  })
  custo_centavos!: number | null;
}

export class VendaIntegracao {
  @ApiProperty({ description: 'Id do pedido externo; venda de balcão/mesa/totem direto: id da comanda.' })
  id!: string;

  @ApiProperty({ description: 'Só cresce a cada mudança que altera algum campo da venda.' })
  versao!: number;

  @ApiProperty({ description: 'Carimbo do cursor (nuvem, microssegundos).' })
  atualizado_em!: string;

  @ApiProperty({ example: 'cardapio' })
  canal!: string;

  @ApiProperty({ enum: ['cardapio', 'whatsapp', 'presencial', 'marketplace', 'outro'] })
  grupo_canal!: string;

  @ApiProperty({ enum: ['confirmado', 'cancelado', 'removido'] })
  situacao!: string;

  @ApiProperty({ example: 'BRL' })
  moeda!: string;

  @ApiProperty({ example: 'America/Sao_Paulo' })
  fuso!: string;

  @ApiProperty({ description: 'Faturamento pela definição única do Regem (o do Painel), em centavos.' })
  receita_centavos!: number;

  @ApiProperty({ description: 'Desconto bancado pela loja (informativo; já descontado da receita).' })
  desconto_loja_centavos!: number;

  @ApiProperty({ description: 'Sempre 0 na v1: cancelar desfaz a venda inteira (vai pela situação).' })
  estornado_centavos!: number;

  @ApiProperty({ nullable: true, type: String })
  cupom!: string | null;

  @ApiProperty({ nullable: true, type: ClienteVendaIntegracao, description: 'Só com clientes.telefone.ler; marketplace: sempre null.' })
  cliente!: ClienteVendaIntegracao | null;

  @ApiProperty({ nullable: true, type: String })
  criado_em!: string | null;

  @ApiProperty()
  confirmado_em!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O instante que o Painel usa para pôr a venda no dia.' })
  faturado_em!: string | null;

  @ApiProperty({ nullable: true, type: String })
  cancelado_em!: string | null;

  @ApiProperty({ type: [ItemVendaIntegracao] })
  itens!: ItemVendaIntegracao[];

  @ApiProperty({ nullable: true, type: Object, description: 'Clique captado no cardápio (C3a) — null até existir.' })
  origem!: Record<string, unknown> | null;
}

export class PaginaVendasIntegracao {
  @ApiProperty({ type: [VendaIntegracao] })
  itens!: VendaIntegracao[];

  @ApiProperty({ nullable: true, type: String, description: 'Cursor opaco da próxima leitura.' })
  proximo_cursor!: string | null;

  @ApiProperty()
  tem_mais!: boolean;
}

export class ClienteAnonimizadoIntegracao {
  @ApiProperty({ description: 'Id do cliente no Regem.' })
  id!: string;

  @ApiProperty()
  anonimizado_em!: string;

  @ApiProperty()
  versao!: number;

  @ApiProperty()
  atualizado_em!: string;
}

export class PaginaClientesAnonimizadosIntegracao {
  @ApiProperty({ type: [ClienteAnonimizadoIntegracao] })
  itens!: ClienteAnonimizadoIntegracao[];

  @ApiProperty({ nullable: true, type: String })
  proximo_cursor!: string | null;

  @ApiProperty()
  tem_mais!: boolean;
}
