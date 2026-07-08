import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateContagemListaDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsIn(['diaria', 'semanal', 'mensal', 'avulsa'])
  recorrencia?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  diaMes?: number;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'hora deve ser HH:MM' })
  hora?: string;

  @IsOptional()
  @IsUUID()
  delegadoId?: string;

  @IsOptional()
  @IsBoolean()
  enviarKds?: boolean;

  @IsOptional()
  @IsBoolean()
  enviarDashboard?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  itemIds!: string[];
}

export class SalvarContagemItemDto {
  @IsUUID()
  itemId!: string;

  contado!: number;
}
