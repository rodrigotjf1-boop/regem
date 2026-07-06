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

  // Ids das opções de complemento escolhidas (opcionais/adicionais).
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  complementos?: string[];

  // Observação livre do item ("sem sal", "bem passado").
  @IsOptional()
  @IsString()
  observacao?: string;
}

export class PagamentoDto {
  @IsString()
  forma!: string; // rótulo/tipo da forma (livre — vem do cadastro)
  @IsNumber()
  valor!: number;
  @IsOptional()
  @IsUUID()
  formaPagamentoId?: string;
}

export class VendaBalcaoDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VendaItemDto)
  itens!: VendaItemDto[];

  @IsOptional()
  @IsIn(['dinheiro', 'pix', 'cartao', 'transferencia'])
  forma?: string;

  // Multi-pagamento / dividir conta: várias formas somando o total.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PagamentoDto)
  pagamentos?: PagamentoDto[];

  @IsOptional()
  @IsNumber()
  taxaServicoPct?: number;

  @IsOptional()
  @IsString()
  mesa?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  // Chave idempotente do cliente (offline-first): reenvio da mesma venda não duplica.
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
