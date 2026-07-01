import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateChecklistItemDto {
  @IsString()
  @MinLength(2)
  descricao!: string;

  @IsOptional()
  @IsString()
  procedimento?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  ordem?: number;

  @IsOptional()
  @IsString()
  fotoRef?: string;
}
