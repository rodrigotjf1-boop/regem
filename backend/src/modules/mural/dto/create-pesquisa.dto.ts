import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreatePesquisaDto {
  @IsString()
  @MinLength(2)
  titulo!: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;
}
