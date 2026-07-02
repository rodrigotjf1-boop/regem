import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateOcorrenciaDto {
  @IsUUID()
  colaboradorId!: string;

  @IsUUID()
  tipoId!: string;

  @IsOptional()
  @IsIn(['leve', 'grave'])
  gravidade?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsDateString()
  data?: string;
}
