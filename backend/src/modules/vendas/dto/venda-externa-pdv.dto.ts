import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

// L-VEN-1 — venda de origem externa PAGA por código PDV (totem/autoatendimento).
// Autenticada por X-Sync-Token (dispositivo servidor_local). Difere da venda de
// balcão: itens vêm por `codigoPdv` (de-para), o pagamento já foi capturado no
// totem (pré-pago, sem sessão de caixa) e o preço é resolvido no servidor.

export class VendaExternaPdvItemDto {
  @IsString()
  @IsNotEmpty()
  codigoPdv!: string; // casa com produto.codigo no Regem

  @IsNumber()
  @Min(0.001)
  quantidade!: number;

  @IsOptional()
  @IsString()
  observacao?: string;
}

export class VendaExternaPdvPagamentoDto {
  @IsString()
  @IsNotEmpty()
  forma!: string; // 'dinheiro' | 'pix' | 'credito' | 'debito' | ... (rótulo do cadastro)

  @IsNumber()
  valor!: number;

  @IsOptional()
  @IsString()
  nsu?: string; // TEF/PIX — comprovante

  @IsOptional()
  @IsString()
  autorizacao?: string; // TEF — código de autorização

  @IsOptional()
  @IsUUID()
  formaPagamentoId?: string;
}

export class VendaExternaPdvDto {
  // Chave idempotente gerada no totem — reenvio jamais duplica a venda.
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendaExternaPdvItemDto)
  itens!: VendaExternaPdvItemDto[];

  // Venda de totem é PRÉ-PAGA: pagamento obrigatório, soma tem de bater com o total.
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VendaExternaPdvPagamentoDto)
  pagamentos!: VendaExternaPdvPagamentoDto[];

  @IsOptional()
  @IsString()
  cpf?: string; // CPF na nota (opcional)

  @IsOptional()
  @IsString()
  cliente?: string;

  @IsOptional()
  @IsIn(['local', 'viagem'])
  consumo?: string; // 'local' (comer aqui) | 'viagem' — afeta cozinha/embalagem

  @IsOptional()
  @IsUUID()
  unidadeId?: string; // override; padrão = unidade do dispositivo (sync token)

  @IsOptional()
  @IsNumber()
  taxaServicoPct?: number;

  @IsOptional()
  @IsString()
  plataforma?: string; // ex.: "GoGeM Totem"

  @IsOptional()
  @IsString()
  senhaPlataforma?: string; // nº do pedido no totem
}
