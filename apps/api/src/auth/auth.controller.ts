import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import type { LoginResult } from '@taskop/contracts';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { type IssuedLogin, AuthService } from './auth.service';
import { setRefreshCookie } from './cookies';
import { LoginResultDto, SignupDto, VerifyEmailDto } from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('signup')
  @ApiCreatedResponse({ type: LoginResultDto })
  async signup(@Body() body: SignupDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.signup(body), res);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(body.token);
  }

  private respond(issued: IssuedLogin, res: Response): LoginResult {
    if (issued.client === 'web') setRefreshCookie(res, issued.refreshToken, this.config);
    return issued.result;
  }
}
