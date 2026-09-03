import 'package:flutter/material.dart';
import 'api.dart';
import 'theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.carregarToken();
  runApp(const RegemEntregadorApp());
}

class RegemEntregadorApp extends StatelessWidget {
  const RegemEntregadorApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Regem Entregador',
      debugShowCheckedModeBanner: false,
      theme: regemTheme(),
      home: Api.logado ? const HomeScreen() : const LoginScreen(),
    );
  }
}
