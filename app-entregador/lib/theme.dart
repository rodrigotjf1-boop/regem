import 'package:flutter/material.dart';

// Paleta Regem (mesma da marca): dourado = ação primária, navy = tinta, base clara, verde = ok.
const kOuro = Color(0xFFE2A340);
const kNavy = Color(0xFF0F2230);
const kBase = Color(0xFFEDF0F4);
const kVerde = Color(0xFF0E7C66);
const kTinta2 = Color(0xFF48586A); // texto secundário

// Tema claro moderno (Material 3) da marca Regem — cards arredondados, inputs preenchidos,
// botões cheios dourados, app bar limpa. Aplicado globalmente (todas as telas herdam).
ThemeData regemTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: kOuro,
    brightness: Brightness.light,
  ).copyWith(
    primary: kOuro,
    onPrimary: kNavy,
    surface: Colors.white,
    onSurface: kNavy,
    secondary: kNavy,
  );
  final base = ThemeData(useMaterial3: true, colorScheme: scheme, fontFamily: 'Roboto');
  return base.copyWith(
    scaffoldBackgroundColor: kBase,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: kNavy,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(color: kNavy, fontSize: 18, fontWeight: FontWeight.w800),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shadowColor: kNavy.withValues(alpha: 0.10),
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      margin: const EdgeInsets.symmetric(vertical: 6),
      clipBehavior: Clip.antiAlias,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: kBase,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: kOuro, width: 1.6),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: kOuro,
        foregroundColor: kNavy,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
        minimumSize: const Size(0, 52),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: kNavy,
        side: BorderSide(color: kNavy.withValues(alpha: 0.16)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
        minimumSize: const Size(0, 50),
      ),
    ),
    listTileTheme: const ListTileThemeData(iconColor: kNavy),
    dividerTheme: DividerThemeData(color: kNavy.withValues(alpha: 0.08), space: 1, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
