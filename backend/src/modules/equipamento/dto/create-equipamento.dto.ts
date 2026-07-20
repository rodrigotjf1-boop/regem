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

  // Impressora: conexão 'rede' (IP:porta) ou 'local' (USB/instalada no Windows).
  @IsOptional()
  @IsIn(['rede', 'local'])
  conexao?: string;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  porta?: number;

  // Impressora local: nome exato da impressora no Windows.
  @IsOptional()
  @IsString()
  dispositivo?: string;

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

  // KDS — impressão guiada por etapa (mig 129): o ticket só sai quando o pedido
  // AVANÇA para `imprimeNoStatus` neste KDS, indo para `impressoraDestinoId`.
  @IsOptional()
  @IsBoolean()
  imprimeAoAvancar?: boolean;

  @IsOptional()
  @IsIn(['recebido', 'preparo', 'pronto', 'entregue'])
  imprimeNoStatus?: string;

  @IsOptional()
  @IsUUID()
  impressoraDestinoId?: string;
}
