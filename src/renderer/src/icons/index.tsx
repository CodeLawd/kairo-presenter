/**
 * Lucide-compatible icon surface backed by Phosphor.
 *
 * Call sites keep existing names (`Search`, `Loader`, `Trash2`); under the hood
 * every glyph renders with Phosphor `weight="regular"` for a more crafted look.
 */
import {
  type Icon as PhosphorIcon,
  type IconProps,
  Pulse as PhPulse,
  WarningCircle as PhWarningCircle,
  Warning as PhWarning,
  TextAlignCenter as PhTextAlignCenter,
  TextAlignJustify as PhTextAlignJustify,
  TextAlignLeft as PhTextAlignLeft,
  TextAlignRight as PhTextAlignRight,
  ArrowDown as PhArrowDown,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUp as PhArrowUp,
  BookOpen as PhBookOpen,
  BookOpenText as PhBookOpenText,
  BookmarkSimple as PhBookmarkSimple,
  Brain as PhBrain,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUp as PhCaretUp,
  Circle as PhCircle,
  CircleDashed as PhCircleDashed,
  Gauge as PhGauge,
  Prohibit as PhProhibit,
  UserCircle as PhUserCircle,
  Clipboard as PhClipboard,
  Clock as PhClock,
  Cloud as PhCloud,
  Copy as PhCopy,
  CurrencyDollar as PhCurrencyDollar,
  DownloadSimple as PhDownloadSimple,
  PencilSimple as PhPencilSimple,
  Eraser as PhEraser,
  Eye as PhEye,
  EyeSlash as PhEyeSlash,
  FilePlus as PhFilePlus,
  FileText as PhFileText,
  FilmStrip as PhFilmStrip,
  Folder as PhFolder,
  FolderOpen as PhFolderOpen,
  Globe as PhGlobe,
  DotsSixVertical as PhDotsSixVertical,
  Image as PhImage,
  ImagesSquare as PhImagesSquare,
  Key as PhKey,
  Keyboard as PhKeyboard,
  Translate as PhTranslate,
  Stack as PhStack,
  Books as PhBooks,
  Link as PhLink,
  ListChecks as PhListChecks,
  MusicNotes as PhMusicNotes,
  CircleNotch as PhCircleNotch,
  Lock as PhLock,
  SignOut as PhSignOut,
  ChatTeardropText as PhChatTeardropText,
  Microphone as PhMicrophone,
  MicrophoneSlash as PhMicrophoneSlash,
  Minus as PhMinus,
  Monitor as PhMonitor,
  MonitorPlay as PhMonitorPlay,
  Moon as PhMoon,
  DotsThree as PhDotsThree,
  DotsThreeVertical as PhDotsThreeVertical,
  Palette as PhPalette,
  Pause as PhPause,
  Play as PhPlay,
  Plus as PhPlus,
  Broadcast as PhBroadcast,
  ArrowsClockwise as PhArrowsClockwise,
  Repeat as PhRepeat,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  Path as PhPath,
  FloppyDisk as PhFloppyDisk,
  MagnifyingGlass as PhMagnifyingGlass,
  Scissors as PhScissors,
  PaperPlaneTilt as PhPaperPlaneTilt,
  GearSix as PhGearSix,
  SkipBack as PhSkipBack,
  SkipForward as PhSkipForward,
  SlidersHorizontal as PhSlidersHorizontal,
  Square as PhSquare,
  Star as PhStar,
  Sun as PhSun,
  Trash as PhTrash,
  TrendUp as PhTrendUp,
  LockOpen as PhLockOpen,
  UploadSimple as PhUploadSimple,
  VideoCamera as PhVideoCamera,
  SpeakerHigh as PhSpeakerHigh,
  SpeakerX as PhSpeakerX,
  WifiHigh as PhWifiHigh,
  WifiSlash as PhWifiSlash,
  X as PhX,
  XCircle as PhXCircle,
  Lightning as PhLightning,
  MagnifyingGlassPlus as PhMagnifyingGlassPlus,
  MagnifyingGlassMinus as PhMagnifyingGlassMinus,
} from '@phosphor-icons/react'
import { forwardRef, type ElementRef } from 'react'

type Props = IconProps & { size?: number | string }

function wrap(Ph: PhosphorIcon) {
  const Icon = forwardRef<ElementRef<'svg'>, Props>(function Icon(
    { weight = 'regular', size = 16, ...rest },
    ref,
  ) {
    return <Ph ref={ref} weight={weight} size={size} {...rest} />
  })
  Icon.displayName = Ph.displayName ?? 'Icon'
  return Icon
}

export type Icon = ReturnType<typeof wrap>
/** @deprecated Use `Icon` — kept while call sites migrate off Lucide naming. */
export type LucideIcon = Icon

export const Activity = wrap(PhPulse)
export const AlertCircle = wrap(PhWarningCircle)
export const AlertTriangle = wrap(PhWarning)
export const AlignCenter = wrap(PhTextAlignCenter)
export const AlignJustify = wrap(PhTextAlignJustify)
export const AlignLeft = wrap(PhTextAlignLeft)
export const AlignRight = wrap(PhTextAlignRight)
export const ArrowDown = wrap(PhArrowDown)
export const ExternalLink = wrap(PhArrowSquareOut)
export const ArrowUp = wrap(PhArrowUp)
export const BookOpen = wrap(PhBookOpen)
export const BookOpenText = wrap(PhBookOpenText)
export const BookOpenCheck = wrap(PhBookOpenText)
export const BookmarkSimple = wrap(PhBookmarkSimple)
export const Brain = wrap(PhBrain)
export const Check = wrap(PhCheck)
export const CheckCircle = wrap(PhCheckCircle)
export const CheckCircle2 = wrap(PhCheckCircle)
export const ChevronDown = wrap(PhCaretDown)
export const ChevronLeft = wrap(PhCaretLeft)
export const ChevronRight = wrap(PhCaretRight)
export const ChevronUp = wrap(PhCaretUp)
export const Circle = wrap(PhCircle)
export const CircleDashed = wrap(PhCircleDashed)
export const CircleGauge = wrap(PhGauge)
export const CircleOff = wrap(PhProhibit)
export const CircleUser = wrap(PhUserCircle)
export const ClipboardPaste = wrap(PhClipboard)
export const Clock = wrap(PhClock)
export const Cloud = wrap(PhCloud)
export const Copy = wrap(PhCopy)
export const DollarSign = wrap(PhCurrencyDollar)
export const Download = wrap(PhDownloadSimple)
export const Edit2 = wrap(PhPencilSimple)
export const Eraser = wrap(PhEraser)
export const Eye = wrap(PhEye)
export const EyeOff = wrap(PhEyeSlash)
export const FilePlus = wrap(PhFilePlus)
export const FileText = wrap(PhFileText)
export const Film = wrap(PhFilmStrip)
export const Folder = wrap(PhFolder)
export const FolderOpen = wrap(PhFolderOpen)
export const Globe = wrap(PhGlobe)
export const GripVertical = wrap(PhDotsSixVertical)
export const Image = wrap(PhImage)
export const MediaLibrary = wrap(PhImagesSquare)
export const Key = wrap(PhKey)
export const Keyboard = wrap(PhKeyboard)
export const Languages = wrap(PhTranslate)
export const Layers = wrap(PhStack)
export const Library = wrap(PhBooks)
export const Link2 = wrap(PhLink)
export const ListChecks = wrap(PhListChecks)
export const ListMusic = wrap(PhMusicNotes)
export const Loader = wrap(PhCircleNotch)
export const Loader2 = wrap(PhCircleNotch)
export const Lock = wrap(PhLock)
export const LogOut = wrap(PhSignOut)
export const MessageSquare = wrap(PhChatTeardropText)
export const Mic = wrap(PhMicrophone)
export const MicOff = wrap(PhMicrophoneSlash)
export const Minus = wrap(PhMinus)
export const MonitorOff = wrap(PhMonitor)
export const MonitorPlay = wrap(PhMonitorPlay)
export const Moon = wrap(PhMoon)
export const MoreHorizontal = wrap(PhDotsThree)
export const MoreVertical = wrap(PhDotsThreeVertical)
export const Music2 = wrap(PhMusicNotes)
export const Palette = wrap(PhPalette)
export const Pause = wrap(PhPause)
export const Pencil = wrap(PhPencilSimple)
export const Play = wrap(PhPlay)
export const Plus = wrap(PhPlus)
export const Radio = wrap(PhBroadcast)
export const RefreshCw = wrap(PhArrowsClockwise)
export const Repeat = wrap(PhRepeat)
export const RotateCcw = wrap(PhArrowCounterClockwise)
export const Route = wrap(PhPath)
export const Save = wrap(PhFloppyDisk)
export const ScanSearch = wrap(PhMagnifyingGlass)
export const Scissors = wrap(PhScissors)
export const Search = wrap(PhMagnifyingGlass)
export const Send = wrap(PhPaperPlaneTilt)
export const Settings = wrap(PhGearSix)
export const SkipBack = wrap(PhSkipBack)
export const SkipForward = wrap(PhSkipForward)
export const SlidersHorizontal = wrap(PhSlidersHorizontal)
export const Square = wrap(PhSquare)
export const Star = wrap(PhStar)
export const Sun = wrap(PhSun)
export const Trash2 = wrap(PhTrash)
export const TrendingUp = wrap(PhTrendUp)
export const Unlock = wrap(PhLockOpen)
export const Upload = wrap(PhUploadSimple)
export const Video = wrap(PhVideoCamera)
export const Volume2 = wrap(PhSpeakerHigh)
export const VolumeX = wrap(PhSpeakerX)
export const Wifi = wrap(PhWifiHigh)
export const WifiOff = wrap(PhWifiSlash)
export const X = wrap(PhX)
export const XCircle = wrap(PhXCircle)
export const Zap = wrap(PhLightning)
export const ZoomIn = wrap(PhMagnifyingGlassPlus)
export const ZoomOut = wrap(PhMagnifyingGlassMinus)

/** shadcn-style aliases used by shared UI primitives */
export const CheckIcon = Check
export const ChevronDownIcon = ChevronDown
export const ChevronUpIcon = ChevronUp
export const ChevronRightIcon = ChevronRight
