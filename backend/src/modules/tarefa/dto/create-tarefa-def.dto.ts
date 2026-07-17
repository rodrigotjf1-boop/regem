import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MinLength,
} from 'class-validator';

export class CreateTarefaDefDto {
  @IsUUID()
  unidadeId!: string;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  // Função-alvo da tarefa (obrigatória no cadastro manual pelo card/Meu Dia).
  @IsOptional()
  @IsUUID()
  funcaoId?: string;

  @IsOptional()
  @IsIn(['recorrente', 'avulsa'])
  origem?: string;

  @IsString()
  @MinLength(2)
  titulo!: string;

  // Horário previsto (HH:MM) — posiciona a tarefa na linha do tempo do dia.
  @IsOptional()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'horário inválido (HH:MM)' })
  horario?: string;

  @IsOptional()
  @IsString()
  descricao?: string;

  @IsOptional()
  @IsUUID()
  etiquetaId?: string;

  @IsOptional()
  @IsUUID()
  colaboradorOverrideId?: string;

  @IsOptional()
  @IsString()
  recorrenciaTipo?: string;

  @IsOptional()
  @IsBoolean()
  proibidaNoPico?: boolean;

  @IsOptional()
  @IsBoolean()
  antecipavel?: boolean;
}
