import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A volta do DMS Graph (`/integracoes/graph/volta?code=…&state=…&iss=…`, ou `error=…`), que a página de volta repassa ao
 * `POST /graph/clique/concluir`. Os quatro campos declarados aqui: o `ValidationPipe` da API (`whitelist: true`) descarta
 * o que não está no DTO (V100). O serviço confere a forma de cada um (`lerVolta`).
 */
export class ConcluirGraphDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  iss?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  error?: string;
}
