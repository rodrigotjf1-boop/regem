import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Formato das rotas de CUPONS da API de integração — só para o contrato OpenAPI
// (`docs/openapi.json`). O contrato que vale é o do Liame (`docs/integracoes/cupons.md`, v1);
// estes tipos o descrevem, campo a campo. O corpo do POST NÃO passa pelo ValidationPipe (a rota
// recebe o JSON cru e confere cada campo — campo desconhecido é recusado, nunca descartado calado).

export class CondicoesCupomIntegracao {
  @ApiProperty({ description: 'Só cliente sem pedido anterior (cliente novo).' })
  somente_novos!: boolean;

  @ApiProperty({ nullable: true, type: Number, description: 'Usos por cliente (null = sem limite; 0 = bloqueado).' })
  max_por_cliente!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Cliente há mais de N dias sem comprar (null = sem condição).' })
  min_dias_sem_compra!: number | null;
}

export class CupomIntegracao {
  @ApiProperty({ description: 'Id do cupom no Regem.' })
  id!: string;

  @ApiProperty({ description: 'Só cresce a cada mudança (inclusive a contagem de usos).' })
  versao!: number;

  @ApiProperty({ description: 'Carimbo do cursor (nuvem, microssegundos).' })
  atualizado_em!: string;

  @ApiProperty({ example: 'COMBOSEXTA', description: 'Sempre em maiúsculas.' })
  codigo!: string;

  @ApiProperty({ nullable: true, type: String })
  nome!: string | null;

  @ApiProperty({
    enum: ['percentual', 'valor', 'frete_gratis', 'outro'],
    description: '"outro" = regra que o contrato não modela (ex.: percentual fora de (0, 100] gravado na tela).',
  })
  tipo!: string;

  @ApiProperty({ nullable: true, type: String, example: '10.00', description: 'Só no percentual: texto com 2 casas, de 0,01 a 100.' })
  percentual!: string | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Só no tipo valor, em centavos.' })
  valor_centavos!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Teto do desconto percentual, em centavos.' })
  teto_desconto_centavos!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Pedido mínimo, em centavos.' })
  pedido_minimo_centavos!: number | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-10-01', description: 'Primeiro dia (AAAA-MM-DD, no `fuso`).' })
  valido_de!: string | null;

  @ApiProperty({ nullable: true, type: String, example: '2026-10-31', description: 'Último dia em que o cupom vale.' })
  valido_ate!: string | null;

  @ApiProperty({ example: 'America/Sao_Paulo', description: 'Fuso em que o Regem aplica as datas do cupom.' })
  fuso!: string;

  @ApiProperty()
  ativo!: boolean;

  @ApiProperty({ nullable: true, type: Number, description: 'Limite de usos somados (null = sem limite; 0 = bloqueado).' })
  max_usos!: number | null;

  @ApiProperty({ description: 'Usos do cupom em todas as lojas da empresa (é o que o max_usos confere).' })
  usos!: number;

  @ApiProperty({ type: CondicoesCupomIntegracao })
  condicoes!: CondicoesCupomIntegracao;

  @ApiProperty({
    description:
      'Informativo: cadastrado para a empresa inteira (sem loja). Hoje o Regem aceita o cupom em qualquer loja da empresa.',
  })
  todas_as_lojas!: boolean;

  @ApiProperty({ description: 'Lápide: o cupom foi apagado no Regem (mesmo id, versão nova).' })
  removido!: boolean;
}

export class PaginaCuponsIntegracao {
  @ApiProperty({ type: [CupomIntegracao] })
  itens!: CupomIntegracao[];

  @ApiProperty({ nullable: true, type: String, description: 'Cursor opaco da próxima leitura.' })
  proximo_cursor!: string | null;

  @ApiProperty()
  tem_mais!: boolean;
}

export class UsoCupomIntegracao {
  @ApiProperty({ description: 'Id do uso no Regem.' })
  id!: string;

  @ApiProperty()
  versao!: number;

  @ApiProperty()
  atualizado_em!: string;

  @ApiProperty()
  cupom_id!: string;

  @ApiProperty()
  codigo!: string;

  @ApiProperty({ nullable: true, type: String, description: 'Id da venda (pedido_externo) — o mesmo de GET /pedidos.' })
  pedido_id!: string | null;

  @ApiProperty()
  usado_em!: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Desconto do cupom no pedido, em centavos (frete grátis: o frete que ele zerou). null = não se sabe.',
  })
  desconto_centavos!: number | null;

  @ApiProperty({ description: 'Lápide: o uso foi apagado (ex.: o pedido foi cancelado).' })
  removido!: boolean;
}

export class PaginaUsosCupomIntegracao {
  @ApiProperty({ type: [UsoCupomIntegracao] })
  itens!: UsoCupomIntegracao[];

  @ApiProperty({ nullable: true, type: String })
  proximo_cursor!: string | null;

  @ApiProperty()
  tem_mais!: boolean;
}

export class CondicoesCriarCupomIntegracao {
  @ApiPropertyOptional({ description: 'Só cliente novo.' })
  somente_novos?: boolean;

  @ApiPropertyOptional({ description: 'Inteiro maior que 0.' })
  max_por_cliente?: number;

  @ApiPropertyOptional({ description: 'Inteiro maior que 0.' })
  min_dias_sem_compra?: number;
}

export class CriarCupomIntegracao {
  @ApiProperty({ example: 'LIAMEMETA10', description: 'De 3 a 30 letras (A-Z) ou números; gravado em maiúsculas.' })
  codigo!: string;

  @ApiPropertyOptional({ example: 'Meta · Combo de sexta', description: 'Até 300 caracteres.' })
  nome?: string;

  @ApiProperty({ enum: ['percentual', 'valor', 'frete_gratis'] })
  tipo!: string;

  @ApiPropertyOptional({ example: '10.00', description: 'Obrigatório no percentual: maior que 0 e até 100, até 2 casas.' })
  percentual?: string;

  @ApiPropertyOptional({ description: 'Obrigatório no tipo valor: centavos, maior que 0.' })
  valor_centavos?: number;

  @ApiPropertyOptional({ description: 'Só no percentual: centavos, maior que 0.' })
  teto_desconto_centavos?: number;

  @ApiPropertyOptional({ description: 'Centavos (0 = sem mínimo).' })
  pedido_minimo_centavos?: number;

  @ApiPropertyOptional({ example: '2026-10-01' })
  valido_de?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Último dia; não pode estar no passado (fuso America/Sao_Paulo).' })
  valido_ate?: string;

  @ApiPropertyOptional({ description: 'Inteiro maior que 0 (sem limite: não mande o campo).' })
  max_usos?: number;

  @ApiPropertyOptional({ type: CondicoesCriarCupomIntegracao })
  condicoes?: CondicoesCriarCupomIntegracao;
}
