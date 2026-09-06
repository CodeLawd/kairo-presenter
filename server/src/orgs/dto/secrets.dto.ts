import {
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator'

/**
 * Partial upsert. Omitted fields leave the stored value alone; `null` clears.
 * `updatedAt` is accepted for client bookkeeping but not enforced (LWW always).
 */
export class UpsertOrgSecretsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  deepgramApiKey?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  anthropicApiKey?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  deepseekApiKey?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  bibleApiKey?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  braveApiKey?: string | null

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(512)
  googleTranslateApiKey?: string | null

  @IsOptional()
  @IsString()
  updatedAt?: string
}
