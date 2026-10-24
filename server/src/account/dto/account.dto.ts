import { ArrayMaxSize, IsArray, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator'

export class DeleteAccountDto {
  /** Required when the account has a password. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string

  /** The emailed six-digit code — required when the account has no password. */
  @IsOptional()
  @IsString()
  @MaxLength(12)
  code?: string

  /**
   * The churches the person agreed will be deleted with their account, as shown
   * by `GET /v1/account/deletion`. Must match exactly, so nobody loses a church
   * they were not shown.
   */
  @IsArray()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  deleteOrgIds!: string[]
}
