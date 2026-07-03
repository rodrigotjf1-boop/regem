import { IsString, MinLength } from 'class-validator';

export class PerguntarDto {
  @IsString()
  @MinLength(1)
  pergunta!: string;
}
