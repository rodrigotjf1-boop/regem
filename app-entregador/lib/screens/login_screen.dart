import 'package:flutter/material.dart';
import '../api.dart';
import 'home_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _id = TextEditingController();
  final _senha = TextEditingController();
  bool _carregando = false;
  String? _erro;

  @override
  void dispose() {
    _id.dispose();
    _senha.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (_id.text.trim().isEmpty || _senha.text.isEmpty) {
      setState(() => _erro = 'Informe usuário e senha.');
      return;
    }
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      await Api.login(_id.text.trim(), _senha.text);
      if (mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => const HomeScreen()),
        );
      }
    } catch (e) {
      setState(() => _erro = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('🛵', style: TextStyle(fontSize: 52)),
                const SizedBox(height: 8),
                Text('Regem Entregador',
                    style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 4),
                Text('Entre com seu usuário da loja',
                    style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 28),
                TextField(
                  controller: _id,
                  decoration: const InputDecoration(
                      labelText: 'Usuário', border: OutlineInputBorder()),
                  textInputAction: TextInputAction.next,
                  autocorrect: false,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _senha,
                  obscureText: true,
                  decoration: const InputDecoration(
                      labelText: 'Senha', border: OutlineInputBorder()),
                  onSubmitted: (_) => _entrar(),
                ),
                const SizedBox(height: 16),
                if (_erro != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(_erro!,
                        style: const TextStyle(color: Colors.red),
                        textAlign: TextAlign.center),
                  ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: _carregando ? null : _entrar,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Text(_carregando ? 'Entrando…' : 'Entrar'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
