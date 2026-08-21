# Regem Entregador (app Flutter)

App do entregador — Trilha B. O entregador é um **colaborador com função "entregador"**
(o lojista cadastra no Regem); o app **reusa o login de colaborador** (JWT Bearer).

## Estado atual (E0 — scaffold)

- **Login** (usuário + senha) → `POST /auth/login` → guarda o `access_token`.
- **Home** → `GET /entregador/perfil` (nome, função, `ehEntregador`, permissões).
- **Escanear** e **Meus pedidos** são placeholders — chegam no **E1**.

## Como rodar (você precisa do Flutter instalado)

Este diretório tem só o `lib/` + `pubspec.yaml`. Gere as pastas de plataforma
(android/ios) uma vez:

```bash
cd app-entregador
flutter create --org com.dmsregem --project-name regem_entregador .
flutter pub get
flutter run          # com um device/emulador Android conectado
```

> `flutter create .` gera `android/`, `ios/`, etc. **sem** apagar o `lib/` e o
> `pubspec.yaml` já existentes (ele pula arquivos que já existem). Se ele
> sobrescrever o `lib/main.dart`, é só restaurar este.

## Build do APK

```bash
flutter build apk --release
```

O APK sai em `build/app/outputs/flutter-apk/app-release.apk`.
Publicação no Google Play sob a conta de **organização** (DUNS).

## Configuração

- **API:** `lib/api.dart` → `Api.base` (padrão: produção `https://api.dmsregem.com/api/v1`).
  Para testar contra o dev local, troque pela URL da sua máquina na rede.

## Próximos passos (roadmap)

- **E1** — scanner (`mobile_scanner`) lê o QR do cupom (`/e/{token}`) → assume o
  pedido (status "em rota") + finalização com o código do cliente.
- **E2** — GPS em entrega ativa + mapa ao vivo na loja.
- **E3** — rotas (deep-link Waze/Maps). **E4** — alerta de chegada. **E5** — ganhos.
