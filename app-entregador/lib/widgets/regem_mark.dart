import 'package:flutter/material.dart';
import '../theme.dart';

// Marca Regem: monograma R.O. em ÓRBITA — um "R" com um anel elíptico inclinado e um ponto
// orbitando. Usado no header do app e no login. Desenhado por código (sem asset).
class RegemMark extends StatelessWidget {
  final double size;
  final Color cor; // cor do R + anel
  final Color? fundo; // se != null, desenha um badge de fundo arredondado
  const RegemMark({super.key, this.size = 40, this.cor = kOuro, this.fundo});

  @override
  Widget build(BuildContext context) {
    final marca = CustomPaint(size: Size.square(size), painter: _RegemMarkPainter(cor));
    if (fundo == null) return marca;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: fundo,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      alignment: Alignment.center,
      child: CustomPaint(size: Size.square(size * 0.66), painter: _RegemMarkPainter(cor)),
    );
  }
}

class _RegemMarkPainter extends CustomPainter {
  final Color cor;
  _RegemMarkPainter(this.cor);

  @override
  void paint(Canvas canvas, Size s) {
    final c = Offset(s.width / 2, s.height / 2);

    // Órbita (elipse inclinada) + ponto orbitando.
    canvas.save();
    canvas.translate(c.dx, c.dy);
    canvas.rotate(-0.52);
    final anel = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = s.width * 0.055
      ..color = cor.withValues(alpha: 0.5);
    canvas.drawOval(
      Rect.fromCenter(center: Offset.zero, width: s.width * 0.98, height: s.width * 0.5),
      anel,
    );
    final ponto = Paint()..color = cor;
    canvas.drawCircle(Offset(s.width * 0.49, 0), s.width * 0.075, ponto);
    canvas.restore();

    // Letra "R".
    final tp = TextPainter(
      text: TextSpan(
        text: 'R',
        style: TextStyle(
          color: cor,
          fontSize: s.width * 0.62,
          fontWeight: FontWeight.w800,
          height: 1,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, c - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  bool shouldRepaint(covariant _RegemMarkPainter old) => old.cor != cor;
}
