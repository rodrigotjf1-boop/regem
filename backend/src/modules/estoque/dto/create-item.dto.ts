import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ConversaoDto {
  @IsString()
  unidadeDe!: string;

  @IsNumber()
  fator!: number;

  @IsString()
  unidadePara!: string;
}

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  nome!: string;

  @IsOptional()
  @IsString()
  unidadeMedida?: string;

  @IsOptional()
  @IsNumber()
  estoqueMinimo?: number;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  // Categoria como texto livre (compat) — a UI usa categoriaItemId.
  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsUUID()
  fornecedorId?: string;

  @IsOptional()
  @IsUUID()
  categoriaItemId?: string;

  // Data de validade opcional (ISO yyyy-mm-dd do seletor nativo).
  @IsOptional()
  @IsString()
  validade?: string;

  // Conversões personalizadas: 1 unidadeDe = fator unidadePara.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversaoDto)
  conversoes?: ConversaoDto[];
}
