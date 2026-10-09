import { IsOptional, Matches } from 'class-validator';

// "Gerar lista com o que faltou": a lista nova herda fornecedor, responsável e marcas da lista de
// origem; a única coisa que se informa é quando a falta deve chegar (opcional).
export class GerarFaltanteDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dataRecebimento deve ser YYYY-MM-DD' })
  dataRecebimento?: string;
}
