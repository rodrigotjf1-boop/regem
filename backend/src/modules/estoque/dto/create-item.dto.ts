import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
  // Nome comercial (mig 311): como o produto é COMPRADO — lista de compras, pedido e conferência.
  // Vazio = usa o nome do produto (que é o da ficha técnica).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nomeComercial?: string;
  // Marcas (mig 311). Quando enviado, substitui a lista. O estoque continua um só.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  marcas?: string[];

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

  // Setores onde o produto fica guardado (mig 307). Quando enviado, substitui a lista; o 1º
  // vira o principal (`setor_id`), os demais vão para `setores_extras`.
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  setorIds?: string[];

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
