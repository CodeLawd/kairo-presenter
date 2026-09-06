import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class DeviceStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  deviceId!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string
}

export class DeviceTokenDto {
  @IsString()
  @MaxLength(200)
  deviceCode!: string
}

export class DeviceApproveDto {
  @IsString()
  @MaxLength(40)
  userCode!: string
}
