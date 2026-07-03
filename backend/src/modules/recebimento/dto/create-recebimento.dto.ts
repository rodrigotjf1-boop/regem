import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class RecebimentoItemDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsNumber()
  qtdEsperada?: number;

  @IsOptional()
  @IsNumber()
  qtdRecebida?: number;

  @IsOptional()
  @IsNumber()
  custoUnitario?: number;

  @IsOptional()
  @IsIn(['ok', 'parcial', 'nao_veio', 'danificado', 'excedente'])
  divergencia?: string;

  @IsOptional()
  @IsDateString()
  validade?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  @IsOptional()
  @IsString()
  obs?: string;
}

export class CreateRecebimentoDto {
  @IsOptional()
  @IsUUID()
  fornecedorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsDateString()
  data?: string;

  @IsOptional()
  @IsString()
  notaRef?: string;

  @IsOptional()
  @IsString()
  notaFotoRef?: string;

  @IsOptional()
  @IsString()
  obs?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecebimentoItemDto)
  itens!: RecebimentoItemDto[];
}
