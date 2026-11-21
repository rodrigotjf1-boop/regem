import { ApiProperty } from '@nestjs/swagger';

// Formato da rota dos PÚBLICOS DO PERFIL da API de integração (Liame — escopo `clientes.audiencias.ler`, mig 483) — só
// para o contrato OpenAPI (`docs/openapi.json`). Só os números de cada público: nenhum cliente, nome, telefone ou código.

export class PublicoIntegracao {
  @ApiProperty({
    description:
      'A chave do público, estável: campeoes, leais, recentes, atencao, em_risco, inativos (o segmento pela recência, ' +
      'frequência e valor), atrasado (passou do próprio ritmo de pedir), dinheiro, feriado, comemorativa, loja (o que move o ' +
      'cliente: o dinheiro no bolso, feriado, data comemorativa, os eventos da loja) e olhou (olhou um produto e não pediu).',
    example: 'campeoes',
  })
  chave!: string;

  @ApiProperty({ description: 'O nome do público em pt-BR, como a loja vê no Regem.', example: 'Campeões' })
  rotulo!: string;

  @ApiProperty({ enum: ['segmento', 'ritmo', 'evento', 'interesse'], description: 'O grupo do público.' })
  grupo!: string;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Quantos clientes estão no público. null = de 1 a 4 (não se informa, para ninguém ser reconhecido); 0 = nenhum.',
  })
  clientes!: number | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Quantos deles receberiam hoje uma campanha montada com o perfil: aceitaram ofertas clicando (no cardápio ou no ' +
      'WhatsApp), não pediram para sair e têm telefone. null = de 1 a 4; 0 = nenhum.',
  })
  aceitaram_ofertas!: number | null;
}

export class AudienciasIntegracao {
  @ApiProperty({
    description: 'O módulo "Perfil do cliente" está ligado na empresa. false = nenhum público (a lista vem vazia).',
  })
  perfil_ligado!: boolean;

  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Quando o perfil foi calculado pela última vez (ISO 8601 UTC; o Regem recalcula toda manhã). null = nunca.',
  })
  calculado_em!: string | null;

  @ApiProperty({ description: 'O menor número informado: abaixo dele (e acima de zero) a contagem sai como null.', example: 5 })
  minimo!: number;

  @ApiProperty({
    nullable: true,
    type: Number,
    description:
      'Quantos clientes diretos da loja têm perfil (quem só pediu por aplicativo de entrega e quem pediu para não ser ' +
      'analisado ficam de fora). null = de 1 a 4.',
  })
  clientes_com_perfil!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: 'Quantos desses aceitaram ofertas clicando. null = de 1 a 4.' })
  aceitaram_ofertas!: number | null;

  @ApiProperty({ type: [PublicoIntegracao], description: 'Os públicos, sempre na mesma ordem.' })
  publicos!: PublicoIntegracao[];
}
