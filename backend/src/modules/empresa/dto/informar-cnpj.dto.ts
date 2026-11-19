import { IsString, MaxLength } from 'class-validator';

/**
 * O CNPJ que o presidente informa quando a empresa está sem (GR-8 do DMS Graph). Só números ou com a máscara; o serviço
 * tira o que não é número e confere os dígitos. Declarado aqui: o `ValidationPipe` da API (`whitelist: true`) descarta o
 * que não está no DTO (V100).
 */
export class InformarCnpjDto {
  @IsString()
  @MaxLength(20)
  cnpj!: string;
}
