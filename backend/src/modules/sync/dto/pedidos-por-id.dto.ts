import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

// Os pedidos que o servidor da loja pede pelo id na conferência rápida (ERR-280): só os que faltam lá ou estão mais
// velhos. O teto acompanha o da lista (`LIMITE_PEDIDOS_POR_ID` no serviço).
export class PedidosPorIdDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}
