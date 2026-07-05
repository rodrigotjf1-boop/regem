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

  // Loja / cardápio (Fase L1)
  @IsOptional() @IsNumber() precoPromocional?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) selos?: string[];
  @IsOptional() @IsBoolean() disponivelCardapio?: boolean;
  @IsOptional() @IsInt() vendaMultiplo?: number;
  @IsOptional() @IsInt() duracaoMin?: number;
  @IsOptional() @IsString() gtin?: string;
  @IsOptional() @IsString() cstPis?: string;
  @IsOptional() @IsNumber() aliqPis?: number;
  @IsOptional() @IsString() cstCofins?: string;
  @IsOptional() @IsNumber() aliqCofins?: number;

  // Fiscais (Fase G)
  @IsOptional() @IsString() ncm?: string;
  @IsOptional() @IsString() cfop?: string;
  @IsOptional() @IsString() cest?: string;
  @IsOptional() @IsString() origem?: string;
  @IsOptional() @IsString() csosn?: string;
  @IsOptional() @IsString() cstIcms?: string;
  @IsOptional() @IsString() unidadeTrib?: string;
  @IsOptional() @IsNumber() aliqIcms?: number;

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
