import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ServiceTimeDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'Time must be HH:MM' })
  time!: string

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string
}

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceTimeDto)
  serviceTimes?: ServiceTimeDto[]
}
