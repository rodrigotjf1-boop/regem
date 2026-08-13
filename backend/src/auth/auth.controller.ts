import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth-user';
import { setCookieSessao, limparCookieSessao } from './cookie-sessao';

// Rotas públicas de autenticação — com rate limit agressivo (anti brute-force/spam).
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.register(dto);
    // Nuvem: também grava o cookie httpOnly (o edge/cliente ignora e usa o Bearer).
    if (r?.access_token) setCookieSessao(res, r.access_token);
    return r;
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.login(dto);
    if (r?.access_token) setCookieSessao(res, r.access_token);
    return r;
  }

  // Teto volumétrico (anti-flood), não a defesa anti brute-force: quem segura o
  // brute-force é o lockout por unidade no service (conta só FALHAS e independe
  // do IP, então não se contorna trocando de origem). Aqui o limite por IP
  // precisa caber na troca de turno — uma loja inteira bate ponto pelo mesmo IP
  // (NAT), e 5/min derrubava o 6º colaborador do minuto.
  // PIN é do Terminal de Ponto (dispositivo) → segue no Bearer, sem cookie.
  @Post('pin')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  pin(@Body() dto: PinLoginDto) {
    return this.service.pinLogin(dto);
  }

  // Encerra a sessão da nuvem: apaga o cookie httpOnly no servidor (o JS não
  // consegue apagá-lo sozinho). Idempotente — não exige estar autenticado.
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    limparCookieSessao(res);
    return { ok: true };
  }

  // Identidade do usuário logado — para os gates de UI no modo cookie, onde o front
  // não decodifica mais o JWT. Mesmo shape que o front lia do payload (cat/nome/
  // func/perm/uni/perfil). Autoridade de segurança segue no servidor (guards).
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    const u = user as any;
    return {
      cat: u.categoria ?? null,
      nome: u.nome ?? u.suporte?.nome ?? null,
      func: u.func ?? null,
      perm: u.permissoes ?? {},
      uni: u.unidadeId ?? null,
      perfil: u.perfil ?? null,
    };
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
