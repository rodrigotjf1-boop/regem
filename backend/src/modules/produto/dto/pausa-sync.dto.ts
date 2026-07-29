import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Pausa/despausa de item por CANAL vinda de um dispositivo (X-Sync-Token).
 * Casa o produto por `codigoPdv` (de-para). `canal` default = 'gogem'.
 */
export class PausaSyncDto {
  @IsString()
  @IsNotEmpty()
  codigoPdv!: string;

  @IsBoolean()
  pausado!: boolean;

  @IsOptional()
  @IsString()
  canal?: string;
}
