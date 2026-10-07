import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
  exports: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
})
export class AuthModule {}
