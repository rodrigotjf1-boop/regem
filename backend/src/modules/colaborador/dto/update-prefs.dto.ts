import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

// Patch parcial das preferências de UI do shell e do PDV.
// ATENÇÃO: a API valida com `whitelist: true` (main.ts) — campo sem decorador aqui é DESCARTADO antes de chegar ao
// serviço. A ordem pessoal das categorias do Balcão (`pdvOrdemCategorias`) ficou de fora e nunca foi gravada (ERR-504,
// 17/11/2026): toda chave nova de `UiPrefs` (common/regras-negocio.ts) entra aqui também — o `prefs-dto.spec` confere.
export class UpdatePrefsDto {
  @IsOptional()
  @IsIn(['expanded', 'collapsed'])
  sidebar?: 'expanded' | 'collapsed';

  @IsOptional()
  @IsIn(['left', 'right'])
  side?: 'left' | 'right';

  /** Ordem PESSOAL das categorias no PDV · Balcão (o "Organizar"): ids de categoria. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  pdvOrdemCategorias?: string[];

  /** O tamanho dos cartões de produto no PDV · Balcão (17/11/2026). */
  @IsOptional()
  @IsIn(['grande', 'compacto'])
  pdvCartoes?: 'grande' | 'compacto';
}
