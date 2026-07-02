import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVistoriaDto {
  @IsIn(['abertura', 'fechamento', 'padrao'])
  tipo!: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  observacao?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;

  @IsOptional()
  @IsDateString()
  data?: string;
}
