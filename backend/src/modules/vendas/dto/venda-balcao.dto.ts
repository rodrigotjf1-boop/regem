import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class VendaItemDto {
  @IsUUID()
  produtoId!: string;

  @IsOptional()
  @IsUUID()
  variacaoId?: string;

  @IsNumber()
  quantidade!: number;
}

export class VendaBalcaoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendaItemDto)
  itens!: VendaItemDto[];

  @IsOptional()
  @IsIn(['dinheiro', 'pix', 'cartao', 'transferencia'])
  forma?: string;

  @IsOptional()
  @IsNumber()
  taxaServicoPct?: number;

  @IsOptional()
  @IsString()
  mesa?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;
}
