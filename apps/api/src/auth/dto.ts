import {
  changeCredentialInputSchema,
  forgotPasswordInputSchema,
  inviteAcceptInputSchema,
  loginResultSchema,
  loginStaffInputSchema,
  loginWorkerInputSchema,
  meSchema,
  refreshInputSchema,
  resetPasswordInputSchema,
  signupInputSchema,
  verifyEmailInputSchema,
} from '@taskop/contracts';
import { createZodDto } from 'nestjs-zod';

export class SignupDto extends createZodDto(signupInputSchema) {}
export class LoginStaffDto extends createZodDto(loginStaffInputSchema) {}
export class LoginWorkerDto extends createZodDto(loginWorkerInputSchema) {}
export class RefreshDto extends createZodDto(refreshInputSchema) {}
export class VerifyEmailDto extends createZodDto(verifyEmailInputSchema) {}
export class InviteAcceptDto extends createZodDto(inviteAcceptInputSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordInputSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordInputSchema) {}
export class ChangeCredentialDto extends createZodDto(changeCredentialInputSchema) {}
export class LoginResultDto extends createZodDto(loginResultSchema) {}
export class MeDto extends createZodDto(meSchema) {}
