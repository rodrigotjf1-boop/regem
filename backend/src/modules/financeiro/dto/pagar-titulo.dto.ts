import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export class PagarTituloDto {
  @IsOptional()
  @IsString()
  data?: string; // data do pagamento (default hoje)

  @IsOptional()
  @IsIn(['dinheiro', 'pix', 'cartao', 'transferencia'])
  forma?: string;

  @IsOptional()
  @IsNumber()
  valor?: number; // default = valor do título
}
