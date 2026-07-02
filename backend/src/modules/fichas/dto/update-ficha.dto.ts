import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateFichaDto {
  @IsOptional()
  @IsString()
  nome?: string;

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
  @IsString()
  validade?: string;

  @IsOptional()
  @IsNumber()
  precoVenda?: number;

  @IsOptional()
  @IsNumber()
  metaCmv?: number;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  popId?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
