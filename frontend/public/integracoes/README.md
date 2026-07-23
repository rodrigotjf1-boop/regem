# Logos das plataformas de integração

Coloque aqui os logos oficiais das plataformas. O card da tela **/delivery → Configurações →
Integrações** procura o arquivo por este nome exato; se não existir, cai num fallback
(quadrado na cor da marca com as iniciais), então nada quebra sem o arquivo.

## Arquivos esperados (nome exato — em PNG)

| Plataforma      | Arquivo                     |
|-----------------|-----------------------------|
| iFood           | `ifood.png`                 |
| 99Food          | `99food.png`                |
| Delivery Direto | `delivery-direto.png`       |
| Cardápio Web    | `cardapio-web.png`          |
| Rappi           | `rappi.png`                 |
| Anota Aí        | `anotaai.png`               |
| Keeta           | `keeta.png`                 |
| WhatsApp / n8n  | `n8n.png`                   |
| Mercado Pago    | `mercadopago.png`           |
| Iugu            | `iugu.png`                  |

## Specs

- **Formato:** PNG (quadrado, fundo transparente ou colorido). ~512×512 recomendado.
- **Proporção:** quadrado ou próximo (o card exibe em caixa ~48×48, `object-contain`).
- Se quiser usar SVG ou outro nome, ajuste o `logo` em `PLAT_META` no
  `frontend/src/components/delivery/config-panel.tsx`.
