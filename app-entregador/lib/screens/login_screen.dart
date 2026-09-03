import 'package:flutter/material.dart';
import '../api.dart';
import '../theme.dart';
import '../widgets/regem_mark.dart';
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
                const RegemMark(size: 78, fundo: kNavy),
                const SizedBox(height: 18),
                const Text('Regem',
                    style: TextStyle(
                        fontSize: 30, fontWeight: FontWeight.w800, color: kNavy, letterSpacing: -0.5, height: 1)),
                const Text('ENTREGADOR',
                    style: TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700, color: kOuro, letterSpacing: 3.5)),
                const SizedBox(height: 8),
                const Text('Entre com seu usuário da loja',
                    style: TextStyle(color: kTinta2, fontSize: 13.5)),
                const SizedBox(height: 28),
                TextField(
                  controller: _id,
                  decoration: const InputDecoration(labelText: 'Usuário'),
                  textInputAction: TextInputAction.next,
                  autocorrect: false,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _senha,
                  obscureText: true,
                  decoration: const InputDecoration(labelText: 'Senha'),
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
