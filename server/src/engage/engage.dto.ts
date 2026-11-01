import { IsBoolean, IsEmail, IsIn, IsInt, IsMongoId, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator'

export class EngagementIndexDto {
  @IsMongoId() orgId!: string
  @IsString() @MinLength(1) @MaxLength(128) id!: string
  @IsString() @MinLength(1) @MaxLength(32) code!: string
  @IsString() @MinLength(1) @MaxLength(200) name!: string
  @IsIn(['draft', 'open', 'closed']) status!: 'draft' | 'open' | 'closed'
  @IsOptional() @IsInt() @Min(0) startsAt!: number | null
  @IsOptional() @IsInt() @Min(0) endsAt!: number | null
  @IsOptional() @IsBoolean() deleted?: boolean
}

export class EngageInviteDto {
  @IsEmail() @MaxLength(320) to!: string
  @IsString() @MinLength(1) @MaxLength(200) engagementName!: string
  @IsOptional() @IsString() @MaxLength(200) orgName?: string
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false }) @MaxLength(2048) link!: string
}
