import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

  @IsNumber()
  contado!: number;

  // Instante em que este item foi contado (ISO). O servidor limita ao intervalo
  // [abertura da contagem, agora] — relógio de cliente não define base de estoque.
  @IsOptional()
  @IsDateString()
  contadoEm?: string;
}

export class SalvarContagemDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => SalvarContagemItemDto)
  itens!: SalvarContagemItemDto[];

  @IsOptional()
  @IsBoolean()
  aplicarAjuste?: boolean;
}
