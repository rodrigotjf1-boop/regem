import 'package:flutter/material.dart';

import 'api.dart';
import 'avisos.dart';
import 'tema.dart';
import 'telas/inicio.dart';
import 'telas/parear.dart';
import 'telas/pin.dart';

// APP "REGEM ATENDIMENTO" (Onda 2 da central de atendimento; protótipo `mockups/regem-central-atendimento.html`, vista do
// app). Três etapas: o celular pareia UMA vez (código de Configurações › Equipamentos), cada pessoa entra com o PIN dela,
// e a fila da loja aparece — a mesma ordem do computador. Fala com o Regem na nuvem (decisão do dono, 02/11/2026).
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.carregar();
  await Avisos.iniciar();
  runApp(const AppAtendimento());
}

class AppAtendimento extends StatefulWidget {
  const AppAtendimento({super.key});

  @override
  State<AppAtendimento> createState() => _AppAtendimentoState();
}

class _AppAtendimentoState extends State<AppAtendimento> {
  String? _avisoNaEntrada;

  @override
  void initState() {
    super.initState();
    // Sessão vencida (12 h ou a pessoa foi bloqueada): volta ao PIN. Celular revogado em Equipamentos: esquece o
    // pareamento (o único caso em que o app esquece — V70) e volta ao "Primeira vez neste aparelho".
    Api.aoPerderAcesso = (e) async {
      if (e.revogado) {
        await Api.esquecerPareamento();
        _avisoNaEntrada = 'Este celular foi revogado no Regem. Peça um código novo ao gestor e pareie de novo.';
      } else {
        await Api.esquecerSessao();
        _avisoNaEntrada = e.mensagem.isNotEmpty ? e.mensagem : 'A sessão acabou. Entre de novo com o seu PIN.';
      }
      if (mounted) setState(() {});
    };
  }

  void _mudou() => setState(() => _avisoNaEntrada = null);

  @override
  Widget build(BuildContext context) {
    final Widget tela;
    if (!Api.pareado) {
      tela = TelaParear(aviso: _avisoNaEntrada, aoParear: _mudou);
    } else if (Api.sessao == null) {
      tela = TelaPin(aviso: _avisoNaEntrada, aoEntrar: _mudou, aoEsquecer: _mudou);
    } else {
      tela = TelaInicio(key: ValueKey(Api.sessao!.colaboradorId), aoSair: _mudou);
    }
    return MaterialApp(
      title: 'Regem Atendimento',
      debugShowCheckedModeBanner: false,
      theme: temaRegem(),
      home: tela,
    );
  }
}
