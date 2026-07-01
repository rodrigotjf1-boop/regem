import { IsOptional, IsString, IsUUID } from 'class-validator';

export class AplicarTemplateDto {
  @IsUUID()
  unidadeId!: string;

  @IsOptional()
  @IsString()
  ramo?: string;
}
