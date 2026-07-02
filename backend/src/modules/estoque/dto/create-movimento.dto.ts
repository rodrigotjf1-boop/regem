import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateMovimentoDto {
  @IsUUID()
  itemId!: string;

  @IsIn(['entrada', 'saida', 'ajuste'])
  tipo!: string;

  @IsNumber()
  quantidade!: number;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsDateString()
  data?: string;
}
