import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { CreateIngredienteDto } from './create-ingrediente.dto';

export class CreateFichaDto {
  @IsString()
  @MinLength(2)
  nome: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsNumber()
  rendimento?: number;

  @IsOptional()
  @IsString()
  rendimentoUnidade?: string;

  @IsOptional()
  @IsNumber()
  porcaoTamanho?: number;

  @IsOptional()
  @IsString()
  porcaoUnidade?: string;

  @IsOptional()
  @IsString()
  validade?: string;

  @IsOptional()
  @IsNumber()
  precoVenda?: number;

  @IsOptional()
  @IsNumber()
  metaCmv?: number;

  // Margem de perda em % (mig 318), somada ao custo inteiro da ficha. Vazio/`null` = sem margem.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  margemPerda?: number | null;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsUUID()
  popId?: string;

  @IsOptional()
  @IsArray()
  ingredientes?: CreateIngredienteDto[];
}
