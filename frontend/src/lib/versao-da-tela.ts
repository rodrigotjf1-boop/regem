// A versão desta TELA: carimbada na montagem do pacote do servidor da loja (`backend/edge/build-web.mjs`, a mesma do
// instalador). O caixa, o garçom, o KDS e a TV a informam ao servidor; o ícone do servidor mostra quem ficou aberto na
// versão anterior ("feche e abra o Regem neste aparelho"). Na nuvem (sem carimbo) fica `null` e nada é informado.
export const VERSAO_DA_TELA: string | null = (process.env.NEXT_PUBLIC_APP_VERSION || '').trim() || null;
