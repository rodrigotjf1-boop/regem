import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, ValidateNested } from 'class-validator';

export class LoteSyncDto {
  @IsString()
  tabela!: string;

  // Linhas cruas — saneadas no servidor (whitelist de colunas por introspecção).
  @IsArray()
  @ArrayMaxSize(5000)
  linhas!: Record<string, unknown>[];
}

export class SyncPushDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LoteSyncDto)
  lotes!: LoteSyncDto[];
}
