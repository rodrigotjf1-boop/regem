import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateDesperdicioDto {
  @IsString()
  @MinLength(2)
  descricao!: string;

  @IsOptional()
  @IsNumber()
  quantidade?: number;

  @IsOptional()
  @IsString()
  unidadeMedida?: string;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsUUID()
  colaboradorId?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;
}
