import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateEquipamentoDto {
  @IsIn(['kds', 'terminal_ponto', 'servidor_local', 'impressora', 'pdv'])
  tipo!: string;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsString()
  mac?: string;

  @IsOptional()
  @IsIn(['producao', 'avisos', 'entrega'])
  escopo?: string;

  @IsOptional()
  @IsIn(['producao', 'cupom'])
  papel?: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  porta?: number;

  // Impressora: largura do papel (58 | 80 mm) e setores que ela atende.
  @IsOptional()
  @IsIn([58, 80])
  largura?: number;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  setoresAtendidos?: string[];

  // Marca esta impressora como a PADRÃO da unidade (fallback de produção).
  @IsOptional()
  @IsBoolean()
  padrao?: boolean;

  // Terminal de PDV: impressora de cupom (via do cliente) amarrada a este terminal.
  @IsOptional()
  @IsUUID()
  impressoraPadraoId?: string;
}
