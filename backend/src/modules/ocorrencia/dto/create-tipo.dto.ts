import { IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTipoOcorrenciaDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsIn(['positiva', 'negativa'])
  sinal!: string;

  @IsOptional()
  @IsInt()
  pontos?: number;
}
