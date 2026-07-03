import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class ProduzirDto {
  @IsUUID()
  fichaId!: string;

  @IsNumber()
  @Min(0.0001)
  quantidade!: number;

  // Produto acabado/semiacabado que ENTRA no estoque (opcional: sem ele, só baixa insumos).
  @IsOptional()
  @IsUUID()
  itemSaidaId?: string;

  // Chave de idempotência (retry seguro). Se ausente, o servidor gera uma.
  @IsOptional()
  @IsUUID()
  refId?: string;
}
