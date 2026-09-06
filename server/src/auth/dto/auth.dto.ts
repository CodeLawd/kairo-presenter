import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { MIN_PASSWORD_LENGTH } from '../password.service'

export class SignUpDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email!: string

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
  })
  @MaxLength(200)
  password!: string

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string

  @IsString()
  @MinLength(1, { message: 'Enter your church name' })
  @MaxLength(120)
  orgName!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string
}

export class SignInDto {
  @IsEmail()
  email!: string

  @IsString()
  @MaxLength(200)
  password!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceId?: string
}

export class RefreshDto {
  /** Desktop sends the token in the body; web sends it as a cookie. */
  @IsOptional()
  @IsString()
  refreshToken?: string
}

export class VerifyEmailDto {
  @IsString()
  token!: string
}

export class VerifyEmailCodeDto {
  @IsEmail()
  email!: string

  /** Six digits. Length is checked loosely here so "1 2 3 4 5 6" still arrives. */
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string
}

export class ResetPasswordDto {
  @IsString()
  token!: string

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password!: string
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string
}

export class ClientKindDto {
  @IsIn(['web', 'desktop'])
  clientKind!: 'web' | 'desktop'
}
