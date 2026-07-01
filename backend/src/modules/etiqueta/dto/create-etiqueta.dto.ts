import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
} from 'class-validator';

export class CreateEtiquetaDto {
  @IsUUID()
  setorId!: string;

  @IsUUID()
  funcaoId!: string;

  @IsString()
  @MinLength(1)
  sigla!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  contador?: number;

  @IsOptional()
  @IsString()
  cor?: string;

  @IsOptional()
  @IsString()
  icone?: string;

  @IsOptional()
  @IsUUID()
  titularPadraoColaboradorId?: string;
}
