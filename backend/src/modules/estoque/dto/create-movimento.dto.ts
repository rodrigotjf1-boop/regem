import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateMovimentoDto {
  @IsUUID()
  itemId!: string;

  @IsIn(['entrada', 'saida', 'ajuste'])
  tipo!: string;

  // Entrada e saída: quanto entrou ou saiu. Ajuste: a diferença, com sinal — a não ser que
  // venha `saldoContado`, e aí o servidor calcula a diferença.
  @ValidateIf((o: CreateMovimentoDto) => o.saldoContado === undefined)
  @IsNumber()
  quantidade?: number;

  // Só no ajuste: o saldo que a pessoa CONTOU. O servidor grava a diferença para o saldo da
  // loja na hora de gravar — a tela não faz essa conta com um saldo que pode estar velho.
  @IsOptional()
  @IsNumber()
  @Min(0)
  saldoContado?: number;

  @IsOptional()
  @IsString()
  motivo?: string;

  @IsOptional()
  @IsDateString()
  data?: string;
}
