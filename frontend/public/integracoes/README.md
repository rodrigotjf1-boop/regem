# Logos das plataformas de integração

Coloque aqui os logos oficiais das plataformas. O card da tela **/delivery → Configurações →
Integrações** procura o arquivo por este nome exato; se não existir, cai num fallback
(quadrado na cor da marca com as iniciais), então nada quebra sem o arquivo.

## Arquivos esperados (nome exato)

| Plataforma      | Arquivo                     |
|-----------------|-----------------------------|
| iFood           | `ifood.svg`                 |
| 99Food          | `99food.svg`                |
| Delivery Direto | `delivery-direto.svg`       |
| Cardápio Web    | `cardapio-web.svg`          |
| Rappi           | `rappi.svg`                 |
| Anota Aí        | `anotaai.svg`               |
| Keeta           | `keeta.svg`                 |
| WhatsApp / n8n  | `n8n.svg`                   |
| Mercado Pago    | `mercadopago.svg`           |
| Iugu            | `iugu.svg`                  |

## Specs

- **Formato:** SVG (preferido) ou PNG com fundo transparente.
- **Proporção:** quadrado ou próximo (o card exibe em caixa ~48×48, `object-contain`).
- **Fundo:** transparente (o card já tem fundo claro; o ícone/monograma da marca aparece por cima).
- Se quiser trocar o nome do arquivo, ajuste o `logo` em `PLAT_META` no
  `frontend/src/components/delivery/config-panel.tsx`.
