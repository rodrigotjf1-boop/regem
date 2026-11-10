# Regem Atendimento (app Android)

O app da central de atendimento no celular (Onda 2; protótipo `mockups/regem-central-atendimento.html`, vista do app).
Separado do app do entregador. Fala com o Regem na **nuvem** (decisão do dono, 02/11/2026: "nuvem agora, loja depois").

## Como funciona

1. **Parear (uma vez por celular):** no computador, Configurações › Equipamentos › Novo equipamento › "App de atendimento
   (celular)" → aparece um código de 6 números (vale 15 min). No app, tela "Primeira vez neste aparelho", digite o código.
   O celular guarda o id e o segredo no cofre do Android. Revogado em Equipamentos, o app esquece o pareamento e volta a
   pedir o código (só a revogação faz isso).
2. **Entrar com o PIN:** cada pessoa entra com o PIN dela (o mesmo do ponto). A sessão só vale com este celular.
3. **A fila:** a mesma ordem do computador — "Com prazo" (disputa do iFood, pedidos da 99) e "Na fila". "Disponível" ou
   "Ocupado: embalando" (ocupado, o app só toca para o que tem prazo). Abas Fila · Comigo · Feitos · Eu.
4. **O caso:** o resumo do robô, a conversa do WhatsApp com respostas prontas (gestão), Pegar · Passar · Aguardar ·
   Resolver. Disputa do iFood e pedido da 99: só gerente e presidente respondem, confirmando com o PIN.
   **Desde a 1.1 (10/11):** as conversas do caso como no computador — o chat do iFood e da 99 (a resposta entra na fila
   da ponte do PC da loja), o Direct do Instagram e o Messenger (saem na hora, dentro da janela de 24 h) — e o
   "✨ Sugerir resposta" do copiloto em todas (a sugestão vai para o campo; nada sai sozinho). Ler é de todos; responder,
   de presidente, gerente e supervisão (o servidor confere). Regras em `lib/conversa.dart`, tela em
   `lib/telas/conversa_do_canal.dart`.
5. **Avisos:** locais, com o app aberto ou recém-fechado (caso novo, urgente, "ninguém pegou" para o gerente). O toque com
   o app fechado vem com o push (Firebase), depois.

As rotas são as mesmas da tela Atendimento (`atendimento/*`), mais `atendimento/app/entrar`, `atendimento/app/presenca` e
`atendimento/app/sair` (backend, mig 353).

## Desenvolvimento

```bash
flutter pub get
flutter analyze
flutter test                      # modelo + fluxo contra um servidor falso (o teste de integração pula sem código)
flutter run --dart-define=API_URL=http://<ip do PC>:3056/api/v1   # contra um servidor de teste
```

Teste de integração contra um servidor de verdade (gere o código em Equipamentos desse servidor):

```bash
flutter test test/integracao_test.dart --dart-define=API_URL=http://localhost:3056/api/v1 \
  --dart-define=CODIGO=123456 --dart-define=PIN=<PIN de quem entra>
```

## APK

Gerar e publicar o APK é **sob comando do dono** (`RELEASES.md`). O caminho do APK de release:
`build/app/outputs/flutter-apk/app-release.apk` (`flutter build apk --release`).
