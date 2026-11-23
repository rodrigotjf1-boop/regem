import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { CHAVES_DE_TIPO } from '../banco-repasses.regras';

// "Isso é o quê?" de um lançamento (Financeiro › Banco e repasses). Campo ausente mantém o que está gravado (V16); `tipo: null`
// limpa a classificação. O `whitelist` da API descarta o que não estiver aqui (V100).
export class ClassificarLancamentoDto {
  @IsOptional()
  @IsIn(CHAVES_DE_TIPO as string[], { message: 'Escolha um dos tipos da lista.' })
  tipo?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'Informe "lembrar" (true ou false).' })
  lembrar?: boolean;
}
