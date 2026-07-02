import {
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
  @IsNumber()
  ordem?: number;
}
