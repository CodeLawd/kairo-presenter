import { InputPanel } from './InputPanel'
import { MatchPanel } from './MatchPanel'
import { PipelinePanel } from './PipelinePanel'
import { QueuePanel } from './QueuePanel'
import { RangePanel } from './RangePanel'
import { TranscriptPanel } from './TranscriptPanel'

/** One panel per walkthrough step, in the order the steps run. */
export const STAGE_PANELS = [TranscriptPanel, MatchPanel, QueuePanel] as const

/**
 * One panel per feature block. Deliberately different surfaces from the
 * walkthrough's — the two sections cover the same three areas of the app, so
 * showing the same three schematics twice would read as a repeat.
 */
export const FEATURE_PANELS = [InputPanel, RangePanel, PipelinePanel] as const
