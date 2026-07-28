import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateIngredienteDto {
  @IsString()
  @MinLength(1)
  insumoNome: string;

  @IsOptional()
  @IsNumber()
  quantidade?: number;

  @IsOptional()
  @IsString()
  unidade?: string;

  @IsOptional()
  @IsNumber()
  fatorCorrecao?: number;

  @IsOptional()
  @IsNumber()
  custoUnitario?: number;

  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  subFichaId?: string;

  @IsOptional()
  @IsNumber()
  ordem?: number;

  // Linha só contabilizada em pedido externo (delivery) — embalagens etc.
  @IsOptional()
  @IsBoolean()
  somenteDelivery?: boolean;
}
