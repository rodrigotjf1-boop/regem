import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ConversaoDto } from '../../estoque/dto/create-item.dto';
import { CreateIngredienteDto } from './create-ingrediente.dto';

export class CreateFichaDto {
  @IsString()
  @MinLength(2)
  nome: string;

  @IsOptional()
  @IsString()
  categoria?: string;

  @IsOptional()
  @IsNumber()
  rendimento?: number;

  @IsOptional()
  @IsString()
  rendimentoUnidade?: string;

  @IsOptional()
  @IsNumber()
  porcaoTamanho?: number;

  @IsOptional()
  @IsString()
  porcaoUnidade?: string;

  @IsOptional()
  @IsString()
  validade?: string;

  @IsOptional()
  @IsNumber()
  precoVenda?: number;

  @IsOptional()
  @IsNumber()
  metaCmv?: number;

  // Margem de perda em % (mig 318), somada ao custo inteiro da ficha. Vazio/`null` = sem margem.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  margemPerda?: number | null;

  @IsOptional()
  @IsUUID()
  setorId?: string;

  @IsOptional()
  @IsUUID()
  unidadeId?: string;

  @IsOptional()
  @IsUUID()
  popId?: string;

  // Conversões do RENDIMENTO (mig 319): "1 saco = 1,5 kg", "1 saco = 10 porção". Outra ficha que usa
  // esta como sub-receita informa a quantidade em qualquer dessas unidades. Ausente mantém; [] tira.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConversaoDto)
  conversoes?: ConversaoDto[];

  @IsOptional()
  @IsArray()
  ingredientes?: CreateIngredienteDto[];
}
