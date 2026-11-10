import 'package:flutter/material.dart';

// Paleta Regem (a mesma do app do entregador e da tela): dourado = ação primária, navy = tinta, base clara, verde = ok.
const kOuro = Color(0xFFE2A340);
const kNavy = Color(0xFF0F2230);
const kBase = Color(0xFFEDF0F4);
const kVerde = Color(0xFF0E7C66);
const kTinta2 = Color(0xFF48586A); // texto secundário
const kPerigo = Color(0xFFB42318);
const kAviso = Color(0xFF9A5B00);

/// A cor de cada canal no "chip" do caso (o nome vai escrito — a cor só ajuda a achar).
Color corDoCanal(String? canal) => switch (canal) {
      'whatsapp' => kVerde,
      'ifood' => const Color(0xFFC8102E),
      '99food' => const Color(0xFF8A5A00),
      // Os do computador, com o branco legível (Instagram 5,97:1; Messenger 4,82:1).
      'instagram' => const Color(0xFFB02E7A),
      'messenger' => const Color(0xFF0866FF),
      _ => kNavy,
    };

ThemeData temaRegem() {
  final scheme = ColorScheme.fromSeed(seedColor: kOuro, brightness: Brightness.light).copyWith(
    primary: kOuro,
    onPrimary: kNavy,
    surface: Colors.white,
    onSurface: kNavy,
    secondary: kNavy,
    error: kPerigo,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: 'Roboto');
  return base.copyWith(
    scaffoldBackgroundColor: kBase,
    appBarTheme: const AppBarTheme(
      backgroundColor: kNavy,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: kNavy.withValues(alpha: 0.08))),
      margin: const EdgeInsets.symmetric(vertical: 5),
      clipBehavior: Clip.antiAlias,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: kNavy.withValues(alpha: 0.16))),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: kNavy.withValues(alpha: 0.16))),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: kOuro, width: 1.6)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kOuro,
        foregroundColor: kNavy,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        minimumSize: const Size(0, 48),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: kNavy,
        side: BorderSide(color: kNavy.withValues(alpha: 0.2)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        minimumSize: const Size(0, 48),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: kOuro.withValues(alpha: 0.35),
      labelTextStyle: WidgetStateProperty.all(const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: kNavy)),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}

/// Um selo pequeno (canal, tipo, urgente, prazo).
class Selo extends StatelessWidget {
  final String texto;
  final Color cor;
  final bool cheio;
  const Selo(this.texto, {super.key, this.cor = kNavy, this.cheio = false});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: cheio ? cor : cor.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(99),
        ),
        child: Text(
          texto,
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cheio ? Colors.white : cor),
        ),
      );
}

/// Aviso de uma linha na tela (erro, informação).
void avisar(BuildContext context, String texto, {bool erro = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(texto), backgroundColor: erro ? kPerigo : kNavy));
}
