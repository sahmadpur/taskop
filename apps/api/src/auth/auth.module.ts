import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordHasher } from './crypto/password-hasher';
import { TokenService } from './crypto/token.service';
import { LoginLookup } from './login-lookup';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { OneTimeTokenService } from './one-time-token.service';
import { PermissionGuard } from './permission.guard';
import { PrincipalLoader } from './principal-loader';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordHasher,
    TokenService,
    SessionService,
    OneTimeTokenService,
    MeService,
    RateLimitService,
    LoginLookup,
    PrincipalLoader,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [AuthService, PasswordHasher, TokenService, SessionService, OneTimeTokenService, MeService, RateLimitService],
})
export class AuthModule {}
