import { Type } from 'class-transformer'
import { IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator'
import { DeviceInfoDto } from './auth.dto'

export class DeviceStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  deviceId!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto
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
