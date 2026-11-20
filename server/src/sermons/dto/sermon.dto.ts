import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class TranscriptSegmentDto {
  @IsString()
  @MaxLength(200)
  id!: string

  @IsString()
  @MaxLength(20_000)
  text!: string

  @IsInt()
  @Min(0)
  timestamp!: number

  @IsNumber()
  @Min(0)
  duration!: number

  /**
   * Word timings, stored but unread today — kept so a future build can sync the
   * transcript to audio without re-uploading every past sermon.
   *
   * Deliberately NOT `@ValidateNested`: a sermon carries tens of thousands of
   * words, and per-word class-transformer instances plus reflective validation
   * would block the event loop for seconds on every upload. The service reads
   * only four known fields off each entry, so nothing unvalidated is stored.
   */
  @IsArray()
  @ArrayMaxSize(60_000)
  words!: unknown[]
}

export class DetectedScriptureDto {
  @IsString()
  @MaxLength(200)
  reference!: string

  @IsOptional()
  @IsString()
  @MaxLength(50)
  translation?: string
}

export class UploadSermonDto {
  @IsString()
  @MaxLength(200)
  localId!: string

  @IsString()
  @MaxLength(300)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speaker?: string

  /** The sermon's own title, typed when the service ends. Used as the recap headline. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sermonTitle?: string

  @IsInt()
  @Min(0)
  startedAt!: number

  @IsInt()
  @Min(0)
  endedAt!: number

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TranscriptSegmentDto)
  @ArrayMaxSize(20_000)
  transcript!: TranscriptSegmentDto[]

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DetectedScriptureDto)
  @ArrayMaxSize(500)
  scriptures?: DetectedScriptureDto[]
}

export class SermonPointDto {
  @IsString()
  @MaxLength(200)
  title!: string

  @IsString()
  @MaxLength(2_000)
  explanation!: string
}

export class SermonScriptureDto {
  @IsString()
  @MaxLength(100)
  reference!: string

  @IsString()
  @MaxLength(1_000)
  connection!: string
}

/** An admin's edit of the recap: every part is replaced as sent. */
export class UpdateSermonNotesDto {
  @IsString()
  @MaxLength(200)
  headline!: string

  @IsString()
  @MaxLength(2_000)
  bigIdea!: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SermonPointDto)
  @ArrayMaxSize(20)
  keyPoints!: SermonPointDto[]

  @IsArray()
  @IsString({ each: true })
  @MaxLength(1_000, { each: true })
  @ArrayMaxSize(20)
  memorableQuotes!: string[]

  @IsArray()
  @IsString({ each: true })
  @MaxLength(1_000, { each: true })
  @ArrayMaxSize(20)
  takeaways!: string[]

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SermonScriptureDto)
  @ArrayMaxSize(30)
  keyScriptures!: SermonScriptureDto[]

  @IsString()
  @MaxLength(2_000)
  callToAction!: string
}

export class ListSermonsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number

  /** ISO date of the last item on the previous page. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cursor?: string

  @IsOptional()
  @IsIn(['today', '7d', '4w', '12w', '6m', 'ytd', 'all', 'custom'])
  range?: 'today' | '7d' | '4w' | '12w' | '6m' | 'ytd' | 'all' | 'custom'

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speaker?: string
}

export class StatsQueryDto {
  @IsOptional()
  @IsIn(['today', '7d', '4w', '12w', '6m', 'ytd', 'all', 'custom'])
  range?: 'today' | '7d' | '4w' | '12w' | '6m' | 'ytd' | 'all' | 'custom'

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speaker?: string
}

export class ShareSermonDto {
  @IsBoolean()
  enabled!: boolean

  /** Burns the old link — use when a share went somewhere it shouldn't have. */
  @IsOptional()
  @IsBoolean()
  rotate?: boolean
}

export class UpdateSermonDto {
  /** The booth's service name, e.g. "Sunday morning". */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  speaker?: string

  /** The recap headline. Only valid once a recap exists. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headline?: string
}
