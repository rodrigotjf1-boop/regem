import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class CreateColaboradorDto {
  @IsString()
  @MinLength(2)
  nome!: string;

  @IsOptional()
  @IsUUID()
  funcaoId?: string;

  @IsOptional()
  @IsIn(['clt', 'horista', 'diarista', 'pj', 'autonomo'])
  vinculo?: string;
}
