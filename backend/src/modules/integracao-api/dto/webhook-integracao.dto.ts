import { ApiProperty } from '@nestjs/swagger';

// Formato das rotas do AVISO (webhook) da API de integração — só para o contrato OpenAPI
// (`docs/openapi.json`). O corpo do PUT NÃO passa pelo ValidationPipe (a rota recebe o JSON cru e
// confere cada campo — campo desconhecido é recusado, nunca descartado calado).

export class RegistrarWebhookIntegracao {
  @ApiProperty({
    example: 'https://api.agencialiame.com/v1/inbox/regem/0199c0de-7a11-7c3a-9f2e-5b1d2c3e4f50',
    description: 'Endereço da própria integração (até 500 caracteres), dentro da lista que a distribuição do Regem liberou para ela.',
  })
  url!: string;

  @ApiProperty({
    example: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    description: 'Segredo da assinatura no formato Standard Webhooks: "whsec_" + base64 de 24 a 64 bytes. Fica cifrado no Regem e nunca é devolvido.',
  })
  segredo!: string;
}

export class WebhookIntegracao {
  @ApiProperty()
  url!: string;

  @ApiProperty({ description: 'O último registro (PUT).' })
  registrado_em!: string;

  @ApiProperty({ description: 'Pausado: o destino falhou por dias, ou respondeu que a conexão não existe. Um PUT novo religa.' })
  pausado!: boolean;

  @ApiProperty({ nullable: true, type: String })
  pausado_em!: string | null;

  @ApiProperty({ nullable: true, type: String })
  motivo_pausa!: string | null;

  @ApiProperty({ nullable: true, type: String })
  ultimo_envio_em!: string | null;

  @ApiProperty({ nullable: true, type: Number })
  ultimo_status_http!: number | null;

  @ApiProperty()
  falhas_seguidas!: number;

  @ApiProperty({ description: 'Avisos entregues (2xx) desde o primeiro registro.' })
  entregues!: number;
}
