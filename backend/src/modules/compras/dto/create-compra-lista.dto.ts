import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CompraItemDto {
  @IsUUID()
  itemId!: string;

  @IsNumber()
  quantidade!: number;

  @IsOptional()
  @IsNumber()
  custoUnitario?: number;
}

export class CreateCompraListaDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsUUID()
  fornecedorId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataRecebimento deve ser YYYY-MM-DD' })
  dataRecebimento?: string;

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
  @ValidateNested({ each: true })
  @Type(() => CompraItemDto)
  itens!: CompraItemDto[];
}
