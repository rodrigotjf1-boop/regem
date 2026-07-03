import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRegraDto {
  @IsString()
  @MinLength(2)
  tipo!: string;

  @IsString()
  @MinLength(1)
  gatilhos!: string; // palavras-chave separadas por vírgula

  @IsString()
  @MinLength(1)
  resposta!: string;

  @IsOptional()
  @IsIn(['nunca', 'sempre', 'condicional'])
  escala?: 'nunca' | 'sempre' | 'condicional';

  @IsOptional()
  @IsString()
  escalaCondicao?: string;

  @IsOptional()
  @IsBoolean()
  ativa?: boolean;
}
