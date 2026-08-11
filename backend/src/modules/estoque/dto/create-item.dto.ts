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

  // Múltiplos fornecedores (N:N). Quando enviado, substitui a lista; o 1º vira o principal.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  fornecedorIds?: string[];

  @IsOptional()
  @IsUUID()
  categoriaItemId?: string;

  // Setor de estoque onde o insumo fica guardado (mig 178).
  @IsOptional()
  @IsUUID()
  setorId?: string;

  // Data de validade opcional (ISO yyyy-mm-dd do seletor nativo).
  @IsOptional()
  @IsString()
  validade?: string;

  // Validade após aberto, em DIAS (mig 182). Vazio = abrir não muda a validade.
  @IsOptional()
  @IsNumber()
  validadeAbertoDias?: number;

  // Conversões personalizadas: 1 unidadeDe = fator unidadePara.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConversaoDto)
  conversoes?: ConversaoDto[];
}
