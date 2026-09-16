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
  Min,
  ValidateNested,
} from 'class-validator';

// Conferência de UMA linha da compra: o que de fato chegou.
export class ConferenciaItemDto {
  @IsUUID()
  compraItemId!: string;

  // 0 é válido — é o "não veio". O que não pode é entrar no estoque a quantidade
  // PEDIDA quando chegou outra coisa, que é o comportamento de hoje.
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

  // Opcional: o servidor deduz de qtdRecebida × quantidade pedida. Vem do cliente
  // só para o caso que a conta não enxerga (chegou tudo, mas danificado).
  @IsOptional()
  @IsIn(['ok', 'parcial', 'nao_veio', 'danificado', 'excedente'])
  divergencia?: string;
}

export class ReceberCompraDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ConferenciaItemDto)
  itens!: ConferenciaItemDto[];
}
