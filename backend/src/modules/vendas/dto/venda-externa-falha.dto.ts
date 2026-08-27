import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

// L-VEN-1 (falha) — pedido de totem que NÃO foi pago (erro no checkout do GoGeM).
// SÓ informativo/controle: entra na lista de Cupons como 'falha' + motivo, sem
// baixar estoque e sem lançar caixa. Endpoint SEPARADO da venda (via GoGeM,
// best-effort) para NUNCA virar venda por engano.

export class VendaExternaFalhaItemDto {
  @IsString()
  @IsNotEmpty()
  codigoPdv!: string; // casa com produto.codigo no Regem (só p/ descrição)

  @IsNumber()
  @Min(0.001)
  quantidade!: number;
}

export class VendaExternaFalhaDto {
  // Chave idempotente do totem — reenvio jamais duplica o registro de falha.
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendaExternaFalhaItemDto)
  itens!: VendaExternaFalhaItemDto[];

  // Motivo da falha (mostrado no cupom). Obrigatório.
  @IsString()
  @IsNotEmpty()
  motivo!: string;

  @IsOptional()
  @IsString()
  formaTentada?: string; // forma que o cliente tentou (credito/pix/...)

  @IsOptional()
  @IsInt()
  totalCentavos?: number; // total tentado, em centavos

  @IsOptional()
  @IsString()
  senhaPlataforma?: string; // nº do pedido no totem
}
