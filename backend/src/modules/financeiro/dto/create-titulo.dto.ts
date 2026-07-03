import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateTituloDto {
  @IsOptional()
  @IsIn(['pagar', 'receber'])
  tipo?: string;

  @IsString()
  @MinLength(2)
  descricao!: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsNumber()
  valor!: number;

  @IsOptional()
  @IsString()
  vencimento?: string; // YYYY-MM-DD

  @IsOptional()
  @IsIn(['nenhuma', 'semanal', 'quinzenal', 'mensal'])
  recorrencia?: string;

  @IsOptional()
  @IsUUID()
  fornecedorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  fotoRef?: string;
}
