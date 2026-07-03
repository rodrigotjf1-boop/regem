import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';

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

  @Post('pin')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  pin(@Body() dto: PinLoginDto) {
    return this.service.pinLogin(dto);
  }
}
