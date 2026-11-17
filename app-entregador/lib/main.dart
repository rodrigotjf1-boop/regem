import 'package:flutter/material.dart';
import 'api.dart';
import 'location.dart';
import 'theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

/// O navegador do app, para a volta à tela de entrar quando a sessão vence (de qualquer tela).
final navegador = GlobalKey<NavigatorState>();

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.carregarToken();
  // A SESSÃO VENCEU (o login do Regem vale 12 h — revisão de 17/11/2026): antes o app ficava "logado" e tudo falhava com
  // "Usuário ou senha inválidos". Agora para o GPS, esquece o login e volta à tela de entrar, com o motivo. As entregas
  // guardadas sem sinal FICAM no celular e saem depois do novo login.
  Api.sessaoVencida.addListener(() async {
    if (!Api.sessaoVencida.value) return;
    LocationSender.parar();
    await Api.sair();
    navegador.currentState?.pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen(sessaoVencida: true)),
      (_) => false,
    );
  });
  runApp(const RegemEntregadorApp());
}

class RegemEntregadorApp extends StatelessWidget {
  const RegemEntregadorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: navegador,
      title: 'Regem Entregador',
      debugShowCheckedModeBanner: false,
      theme: regemTheme(),
      home: Api.logado ? const HomeScreen() : const LoginScreen(),
    );
  }
}
