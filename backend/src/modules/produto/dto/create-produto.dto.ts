import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class VariacaoDto {
  @IsString()
  @MinLength(1)
  nome!: string;

  @IsOptional()
  @IsString()
  codigo?: string;

  @IsNumber()
  precoVenda!: number;

  @IsOptional()
  @IsNumber()
  fatorFicha?: number;
}

export class ComboItemDto {
  @IsUUID()
  componenteProdutoId!: string;

  @IsOptional()
  @IsNumber()
  quantidade?: number;
}

export class CreateProdutoDto {
  @IsOptional()
  @IsString()
  codigo?: string;

  @IsString()
  @MinLength(1)
  nome!: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @IsUUID()
  fichaId?: string;

  @IsOptional()
  @IsIn(['simples', 'variavel', 'combo'])
  tipo?: string;

  @IsOptional()
  @IsString()
  unidadeMedida?: string;

  @IsNumber()
  precoVenda!: number;

  @IsOptional()
  @IsNumber()
  precoCusto?: number;

  @IsOptional()
  @IsBoolean()
  controlaEstoque?: boolean;

  @IsOptional()
  @IsInt()
  validadeDias?: number;

  @IsOptional()
  @IsBoolean()
  vaiParaProducao?: boolean;

  @IsOptional()
  @IsUUID()
  setorProducaoId?: string;

  @IsOptional()
  @IsInt()
  tempoPreparoMin?: number;

  @IsOptional()
  @IsString()
  imagemRef?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariacaoDto)
  variacoes?: VariacaoDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComboItemDto)
  combo?: ComboItemDto[];
}
