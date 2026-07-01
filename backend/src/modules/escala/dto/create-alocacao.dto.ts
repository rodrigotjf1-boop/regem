import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateAlocacaoDto {
  @IsDateString()
  data!: string;

  @IsUUID()
  turnoId!: string;

  @IsUUID()
  etiquetaId!: string;

  @IsOptional()
  @IsUUID()
  colaboradorId?: string;

  @IsOptional()
  @IsIn(['titular', 'diarista', 'cobertura', 'avulso'])
  tipo?: string;
}
