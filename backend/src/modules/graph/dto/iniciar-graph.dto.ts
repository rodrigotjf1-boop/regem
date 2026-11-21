import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * O pedido de ligar ou de "pedir mais" ao DMS Graph. `pedir` = os recursos opcionais que o presidente quer agora; o serviço
 * confere contra a lista do Regem (`escopoDoPedido`). Declarado aqui porque o `ValidationPipe` descarta o que não está no DTO (V100).
 */
export class IniciarGraphDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  pedir?: string[];
}
