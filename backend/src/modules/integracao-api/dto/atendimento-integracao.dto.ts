import { ApiProperty } from '@nestjs/swagger';

// Formato da rota dos CANAIS DA CENTRAL DE ATENDIMENTO da API de integração (Liame — escopo `atendimento.canais.ler`,
// mig 398) — só para o contrato OpenAPI (`docs/openapi.json`). Só QUAIS contas a Central atende: o id e o @. Nenhum
// acesso (token), nenhuma mensagem, nenhum dado de cliente.

export class CanalInstagramIntegracao {
  @ApiProperty({ description: 'O id da conta profissional do Instagram (o `entry.id` dos avisos da Meta).' })
  ig_user_id!: string;

  @ApiProperty({ nullable: true, type: String, description: 'O @ da conta, sem o @. null = a Meta não informou.' })
  usuario!: string | null;
}

export class CanalMessengerIntegracao {
  @ApiProperty({ description: 'O id da página do Facebook (o `entry.id` dos avisos da Meta).' })
  pagina_id!: string;
}

export class CanaisAtendimentoIntegracao {
  @ApiProperty({
    type: [CanalInstagramIntegracao],
    description: 'As contas do Instagram conectadas à Central da empresa (hoje, no máximo uma). Lista vazia = nenhuma.',
  })
  instagram!: CanalInstagramIntegracao[];

  @ApiProperty({
    type: [CanalMessengerIntegracao],
    description: 'As páginas do Facebook (Messenger) conectadas à Central da empresa (hoje, no máximo uma). Lista vazia = nenhuma.',
  })
  messenger!: CanalMessengerIntegracao[];
}
