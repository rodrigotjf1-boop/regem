import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth-user';

// Rotas públicas de autenticação — com rate limit agressivo (anti brute-force/spam).
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
  }

  // Teto volumétrico (anti-flood), não a defesa anti brute-force: quem segura o
  // brute-force é o lockout por unidade no service (conta só FALHAS e independe
  // do IP, então não se contorna trocando de origem). Aqui o limite por IP
  // precisa caber na troca de turno — uma loja inteira bate ponto pelo mesmo IP
  // (NAT), e 5/min derrubava o 6º colaborador do minuto.
  @Post('pin')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  pin(@Body() dto: PinLoginDto) {
    return this.service.pinLogin(dto);
  }

  // Self-service: o próprio usuário troca sua senha de acesso (confere a atual).
  @Post('senha')
  @UseGuards(JwtAuthGuard)
  trocarSenha(
    @CurrentUser() user: AuthUser,
    @Body() dto: { senhaAtual: string; novaSenha: string },
  ) {
    return this.service.trocarPropriaSenha(user, dto);
  }
}
