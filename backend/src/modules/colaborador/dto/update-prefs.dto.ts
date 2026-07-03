import { IsIn, IsOptional } from 'class-validator';

// Patch parcial das preferências de UI do shell.
export class UpdatePrefsDto {
  @IsOptional()
  @IsIn(['expanded', 'collapsed'])
  sidebar?: 'expanded' | 'collapsed';

  @IsOptional()
  @IsIn(['left', 'right'])
  side?: 'left' | 'right';
}
