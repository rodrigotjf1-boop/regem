import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateRegraDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  tipo?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  gatilhos?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  resposta?: string;

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
