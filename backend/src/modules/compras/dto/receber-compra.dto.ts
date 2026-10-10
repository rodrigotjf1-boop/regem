import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Conferência de UMA linha da compra: o que de fato chegou.
export class ConferenciaItemDto {
  @IsUUID()
  compraItemId!: string;

  // 0 é válido — é o "não veio": é o que a tela manda para o item que ficou SEM o marcador de
  // recebido (aí validade e lote não são pedidos). O que não pode é entrar no estoque a
  // quantidade PEDIDA quando chegou outra coisa.
  @IsNumber()
  @Min(0)
  qtdRecebida!: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'validade deve ser YYYY-MM-DD' })
  validade?: string;

  // Escolha EXPLÍCITA de "este insumo não tem validade" (descartável, material de
  // limpeza). Não é o mesmo que deixar em branco: em branco é o estado de hoje, em
  // que ninguém preenche e o controle de validade morre calado.
  @IsOptional()
  @IsBoolean()
  validadeIndefinida?: boolean;

  // Código do lote do fabricante — é o que permite separar mercadoria numa troca
  // ou num recall sem abrir embalagem.
  @IsOptional()
  @IsString()
  loteCodigo?: string;

  // A marca que de fato veio (mig 312): a pedida, a 2ª opção ou outra do cadastro do produto.
  // Em branco, vale a pedida. O estoque continua um só — a marca fica no registro da compra.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  marcaRecebida?: string;

  // O valor unitário que veio na NOTA (mig 313). Informado, vira o custo da linha — é o que entra
  // no custo médio e na conta a pagar; em branco, vale o valor do pedido. Qualquer conferente
  // pode informar (decisão do dono): quem não vê valores em R$ digita o que está na nota.
  @IsOptional()
  @IsNumber()
  @Min(0)
  custoUnitario?: number;

  // Opcional: o servidor deduz de qtdRecebida × quantidade pedida. Vem do cliente
  // só para o caso que a conta não enxerga (chegou tudo, mas danificado).
  @IsOptional()
  @IsIn(['ok', 'parcial', 'nao_veio', 'danificado', 'excedente'])
  divergencia?: string;
}

export class ReceberCompraDto {
  // Número ou identificação da nota que veio com a entrega.
  @IsOptional()
  @IsString()
  @MaxLength(60)
  notaRef?: string;

  // Data de pagamento acertada na hora de receber — vence a que veio da criação.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'vencimento deve ser YYYY-MM-DD' })
  vencimento?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ConferenciaItemDto)
  itens!: ConferenciaItemDto[];
}
