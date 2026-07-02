import { IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePassoDto {
  @IsString()
  @MinLength(1)
  descricao: string;

  @IsOptional()
  @IsNumber()
  ordem?: number;

  @IsOptional()
  @IsString()
  mediaRef?: string;
}
