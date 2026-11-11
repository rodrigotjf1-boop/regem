# Pedido do Regem ao Orzuni — R3 (Gestão do catálogo)

> Para copiar e mandar à sessão do Orzuni quando a implementação da R3 começar (depois da aprovação do protótipo
> `mockups/regem-conciliacao-ifood.html`). Escrito em 11/11/2026.

---

**Pedido do Regem para a porta MCP do Orzuni — R3 (Gestão do catálogo do Regem)**

Contexto: o Regem vai ter em Delivery › Gestão do catálogo a tela **"Produtos e preços"**, onde a loja muda o preço,
a pausa, o nome, a descrição e o código PDV dos produtos e dos complementos e manda aos apps ligados, e a tela
**"Conferir com os apps"** (a conciliação). Do Orzuni, o Regem já usa e continua usando: `cardapio_listar`,
`complementos_listar` e `item_ler` (leitura); `preco_definir`, `item_pausar`/`item_reativar`,
`complemento_preco_definir` e `complemento_pausar`/`complemento_reativar` (escrita). Preço e pausa já funcionam —
nada disso muda.

O que falta, em ordem de prioridade (siga a skill `mudanca-produto-dms`: tudo é aditivo no manifesto):

1. **Nome e descrição do item.** Uma ferramenta nova, por exemplo `item_editar { codigo_pdv, nome?, descricao?,
   chaveIdempotencia }` (pelo menos um dos dois), na permissão `catalogo.escrever`, com o envelope de sempre
   (`situacao`, `antes`/`depois` por campo, recusa com `codigo` + `pode_repetir`). Se o iFood limita o tamanho do nome
   ou da descrição, devolva o limite na recusa `dados_invalidos`.
2. **Nome da opção de complemento.** Por exemplo `complemento_nome_definir { codigo_pdv | opcao_id, nome,
   chaveIdempotencia }`, valendo para todas as opções com o código, como o preço. Se o iFood não deixar, diga.
3. **A foto do item e da opção.** Por exemplo `item_foto_definir { codigo_pdv, imagem_url, chaveIdempotencia }` e
   `complemento_foto_definir { codigo_pdv | opcao_id, imagem_url, chaveIdempotencia }`. O Regem passa o endereço
   público HTTPS da foto dele (a mesma que vai à 99); a porta baixa a imagem, sobe ao iFood e liga ao item. Baixar de
   endereço que vem de fora pede proteção: só HTTPS, sem seguir redirecionamento para rede interna, com limite de
   tamanho. Devolva os **requisitos de foto do iFood** (formatos, tamanho mínimo e máximo, peso) e recuse com
   `dados_invalidos` dizendo o que não serve — a tela do Regem confere antes de mandar. A leitura já traz `imagem`.
4. **A ordem do cardápio.** A tela mostra os produtos "como estão no iFood". Confirme se `cardapio_listar` e
   `categorias_listar` devolvem as categorias e os itens **na ordem do iFood**; se não, acrescente `ordem` (número) na
   categoria e no item. O mesmo em `complementos_listar`: a ordem dos grupos e das opções dentro de cada grupo.
5. **A descrição na leitura.** O campo `descricao` em `cardapio_listar` (e em `item_ler`), para a tela mostrar o que
   está no iFood antes de mudar.
6. **(Opcional, se o iFood permitir) Trocar o código PDV** de um item ou de uma opção, por exemplo
   `item_codigo_pdv_definir { codigo_pdv, codigo_pdv_novo, chaveIdempotencia }`, recusando quando o novo já existe.
   Hoje o Regem manda trocar no Gestor de Pedidos; se não der, tudo bem.

Devolva ao Regem: o nome final de cada ferramenta, a permissão, os limites e **um exemplo de resposta de cada uma**
(o Regem implementa e testa contra o exemplo). Registre a mudança no hub (`docs/mudancas-nos-produtos.md`).

Nada disso trava o começo da R3: até os itens 1 a 3 saírem, a tela do Regem diz "o nome (ou a foto) no iFood muda no
Gestor de Pedidos".
