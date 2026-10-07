import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { LoginResult } from '@taskop/contracts';
import type { Response } from 'express';
import { CurrentPrincipal, Public } from '../common/decorators';
import type { AppRequest, Principal } from '../common/request';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { type IssuedLogin, AuthService } from './auth.service';
import { clearRefreshCookie, REFRESH_COOKIE, setRefreshCookie } from './cookies';
import { CredentialService } from './credential.service';
import {
  ChangeCredentialDto,
  ForgotPasswordDto,
  InviteAcceptDto,
  LoginResultDto,
  LoginStaffDto,
  LoginWorkerDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from './dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialService,
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

  @Public()
  @Post('login/staff')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async loginStaff(@Body() body: LoginStaffDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.loginStaff(body), res);
  }

  @Public()
  @Post('login/worker')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async loginWorker(@Body() body: LoginWorkerDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.auth.loginWorker(body), res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async refresh(@Body() body: RefreshDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    try {
      return this.respond(await this.auth.refresh(body.refreshToken ?? cookieToken), res);
    } catch (e) {
      if (!body.refreshToken && cookieToken) clearRefreshCookie(res, this.config);
      throw e;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(p);
    clearRefreshCookie(res, this.config);
  }

  @ApiBearerAuth()
  @Post('verify-email/resend')
  @HttpCode(204)
  async resendVerification(@CurrentPrincipal() p: Principal): Promise<void> {
    await this.auth.resendVerification(p);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body() body: ForgotPasswordDto): Promise<void> {
    await this.credentials.forgotPassword(body.email);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: ResetPasswordDto): Promise<void> {
    await this.credentials.resetPassword(body.token, body.password);
  }

  @Public()
  @Post('invite/accept')
  @HttpCode(200)
  @ApiOkResponse({ type: LoginResultDto })
  async acceptInvite(@Body() body: InviteAcceptDto, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    return this.respond(await this.credentials.acceptInvite(body), res);
  }

  @ApiBearerAuth()
  @Post('credential/change')
  @HttpCode(204)
  async changeCredential(@CurrentPrincipal() p: Principal, @Body() body: ChangeCredentialDto): Promise<void> {
    await this.credentials.changeCredential(p, body);
  }

  private respond(issued: IssuedLogin, res: Response): LoginResult {
    if (issued.client === 'web') setRefreshCookie(res, issued.refreshToken, this.config);
    return issued.result;
  }
}
