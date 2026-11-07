/** Shared icon surface backed by Hugeicons free Stroke Rounded. */
import { forwardRef, type ComponentProps, type ElementRef } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { FilmStrip as PhFilm, VideoCamera as PhVideo, MonitorPlay as PhMonitorPlay, Play as PhPlay, Pause as PhPause, SkipBack as PhSkipBack, SkipForward as PhSkipForward, type Icon as PhosphorIcon } from '@phosphor-icons/react'
import {
  Activity01Icon,
  Alert02Icon,
  AlertCircleIcon,
  AlignBottomIcon,
  AlignHorizontalCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignVerticalCenterIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  AudioWaveformIcon,
  BookOpen01Icon,
  BookOpenCheckIcon,
  BookOpenTextIcon,
  Bookmark01Icon,
  Books01Icon,
  BrainIcon,
  Cancel01Icon,
  CancelCircleIcon,
  Chat01Icon,
  CheckIcon as HugeCheckIcon,
  CheckmarkCircle01Icon,
  ChevronDownIcon as HugeChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon as HugeChevronRightIcon,
  ChevronUpIcon as HugeChevronUpIcon,
  ChurchIcon,
  CircleDashedIcon,
  CircleGaugeIcon,
  CircleIcon,
  ClipboardPasteIcon,
  Clock01Icon,
  CloudIcon,
  CopyIcon,
  Cursor01Icon,
  DollarSignIcon,
  Download01Icon,
  DragDropVerticalIcon,
  EraserIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FileAddIcon,
  FileTextIcon,
  FlashIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  Folder01Icon,
  FolderOpenIcon,
  GlobeIcon,
  Image01Icon,
  ImagesIcon,
  Key01Icon,
  KeyboardIcon,
  LaptopIcon,
  Layers01Icon,
  LightbulbIcon,
  LinkIcon,
  ListChecksIcon,
  ListMusicIcon,
  Loading01Icon,
  LockIcon,
  LockOpenIcon,
  Logout01Icon,
  MessageSquareTextIcon,
  Mic01Icon,
  MicOff01Icon,
  MinusSignIcon,
  MonitorIcon,
  MonitorOffIcon,
  Moon01Icon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  MusicNote01Icon,
  PaletteIcon,
  PencilEdit01Icon,
  Playlist01Icon,
  PlusSignIcon,
  RadioTowerIcon,
  RedoIcon,
  RefreshCwIcon,
  RepeatIcon,
  RotateCcwIcon,
  Route01Icon,
  SaveIcon,
  ScissorsIcon,
  Search01Icon,
  SendIcon,
  Settings01Icon,
  SidebarLeftIcon,
  SlidersHorizontalIcon,
  SmartphoneIcon,
  Square01Icon,
  StarIcon,
  Sun01Icon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignRightIcon,
  TextIcon,
  TranslateIcon,
  TrashIcon,
  TrendingUpIcon,
  UndoIcon,
  Upload01Icon,
  UsbIcon,
  UserCircleIcon,
  VolumeHighIcon,
  VolumeMute01Icon,
  WifiHighIcon,
  WifiOff01Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@hugeicons/core-free-icons'

type Props = Omit<ComponentProps<typeof HugeiconsIcon>, 'icon'> & {
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
}

function wrap(glyph: IconSvgElement) {
  return forwardRef<ElementRef<'svg'>, Props>(function Icon(
    { weight, size = 16, fill: _fill, strokeWidth, ...rest }, ref,
  ) {
    return <HugeiconsIcon ref={ref} icon={glyph} size={size} strokeWidth={strokeWidth ?? (weight === 'fill' || weight === 'bold' ? 2 : undefined)} {...rest} />
  })
}

function wrapPhosphor(Glyph: PhosphorIcon) {
  return forwardRef<ElementRef<'svg'>, Props>(function Icon({ size = 16, ...rest }, ref) {
    return <Glyph ref={ref} size={size} {...rest} />
  })
}

const BibleIcon = forwardRef<ElementRef<'svg'>, Props>(function BibleIcon(
  { weight = 'regular', size = 16, ...rest },
  ref,
) {
  const filled = weight === 'fill'
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 0 : 16}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {filled ? (
        <path
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
          d="M64 40h128a24 24 0 0 1 24 24v136a24 24 0 0 1-24 24H64V40Zm8 0v184h8V40Zm72 24h-16v36h-28v16h28v52h16v-52h28v-16h-28V64Z"
        />
      ) : (
        <>
          <path d="M64 40h128a24 24 0 0 1 24 24v136a24 24 0 0 1-24 24H64V40Z" />
          <path d="M64 40v184" />
          <path d="M128 68v96M96 100h64" />
        </>
      )}
    </svg>
  )
})
BibleIcon.displayName = 'Bible'


export type Icon = ReturnType<typeof wrap>
/** @deprecated Use Icon. */
export type LucideIcon = Icon

export const FlipHorizontal = wrap(FlipHorizontalIcon)
export const FlipVertical = wrap(FlipVerticalIcon)
export const ObjectAlignLeft = wrap(AlignLeftIcon)
export const ObjectAlignCenter = wrap(AlignHorizontalCenterIcon)
export const ObjectAlignRight = wrap(AlignRightIcon)
export const ObjectAlignTop = wrap(AlignTopIcon)
export const ObjectAlignMiddle = wrap(AlignVerticalCenterIcon)
export const ObjectAlignBottom = wrap(AlignBottomIcon)
export const Bible = BibleIcon
export const Activity = wrap(Activity01Icon)
export const AlertCircle = wrap(AlertCircleIcon)
export const AlertTriangle = wrap(Alert02Icon)
export const AlignCenter = wrap(TextAlignCenterIcon)
export const AlignJustify = wrap(TextAlignJustifyIcon)
export const AlignLeft = wrap(TextAlignLeftIcon)
export const AlignRight = wrap(TextAlignRightIcon)
export const ArrowDown = wrap(ArrowDown01Icon)
export const ExternalLink = wrap(ExternalLinkIcon)
export const ArrowUp = wrap(ArrowUp01Icon)
export const BookOpen = wrap(BookOpen01Icon)
export const BookOpenText = wrap(BookOpenTextIcon)
export const BookOpenCheck = wrap(BookOpenCheckIcon)
export const BookmarkSimple = wrap(Bookmark01Icon)
export const ChatsCircle = wrap(Chat01Icon)
export const MousePointer = wrap(Cursor01Icon)
export const Brain = wrap(BrainIcon)
export const Check = wrap(HugeCheckIcon)
export const CheckCircle = wrap(CheckmarkCircle01Icon)
export const CheckCircle2 = wrap(CheckmarkCircle01Icon)
export const SidebarLeft = wrap(SidebarLeftIcon)
export const ChevronDown = wrap(HugeChevronDownIcon)
export const ChevronLeft = wrap(ChevronLeftIcon)
export const ChevronRight = wrap(HugeChevronRightIcon)
export const ChevronUp = wrap(HugeChevronUpIcon)
export const Circle = wrap(CircleIcon)
export const CircleDashed = wrap(CircleDashedIcon)
export const CircleGauge = wrap(CircleGaugeIcon)
export const CircleOff = wrap(CancelCircleIcon)
export const CircleUser = wrap(UserCircleIcon)
export const ClipboardPaste = wrap(ClipboardPasteIcon)
export const Clock = wrap(Clock01Icon)
export const Church = wrap(ChurchIcon)
export const Lightbulb = wrap(LightbulbIcon)
export const Laptop = wrap(LaptopIcon)
export const Usb = wrap(UsbIcon)
export const DeviceMobile = wrap(SmartphoneIcon)
export const Waveform = wrap(AudioWaveformIcon)
export const Cloud = wrap(CloudIcon)
export const Copy = wrap(CopyIcon)
export const DollarSign = wrap(DollarSignIcon)
export const Download = wrap(Download01Icon)
export const Edit2 = wrap(PencilEdit01Icon)
export const Eraser = wrap(EraserIcon)
export const Eye = wrap(EyeIcon)
export const EyeOff = wrap(EyeOffIcon)
export const FilePlus = wrap(FileAddIcon)
export const FileText = wrap(FileTextIcon)
export const Film = wrapPhosphor(PhFilm)
export const Folder = wrap(Folder01Icon)
export const FolderOpen = wrap(FolderOpenIcon)
export const Globe = wrap(GlobeIcon)
export const GripVertical = wrap(DragDropVerticalIcon)
export const Image = wrap(Image01Icon)
export const MediaLibrary = wrap(ImagesIcon)
export const Key = wrap(Key01Icon)
export const Keyboard = wrap(KeyboardIcon)
export const Languages = wrap(TranslateIcon)
export const Layers = wrap(Layers01Icon)
export const Library = wrap(Books01Icon)
export const Link2 = wrap(LinkIcon)
export const ListChecks = wrap(ListChecksIcon)
export const ListMusic = wrap(ListMusicIcon)
export const Loader = wrap(Loading01Icon)
export const Loader2 = wrap(Loading01Icon)
export const Lock = wrap(LockIcon)
export const LogOut = wrap(Logout01Icon)
export const MessageSquare = wrap(MessageSquareTextIcon)
export const Mic = wrap(Mic01Icon)
export const MicOff = wrap(MicOff01Icon)
export const Minus = wrap(MinusSignIcon)
export const Monitor = wrap(MonitorIcon)
export const MonitorOff = wrap(MonitorOffIcon)
export const Images = wrap(ImagesIcon)
export const Queue = wrap(Playlist01Icon)
export const MonitorPlay = wrapPhosphor(PhMonitorPlay)
export const Moon = wrap(Moon01Icon)
export const MoreHorizontal = wrap(MoreHorizontalIcon)
export const MoreVertical = wrap(MoreVerticalIcon)
export const Music2 = wrap(MusicNote01Icon)
export const Palette = wrap(PaletteIcon)
export const Pause = wrapPhosphor(PhPause)
export const Pencil = wrap(PencilEdit01Icon)
export const Play = wrapPhosphor(PhPlay)
export const Plus = wrap(PlusSignIcon)
export const Radio = wrap(RadioTowerIcon)
export const RefreshCw = wrap(RefreshCwIcon)
export const Repeat = wrap(RepeatIcon)
export const RotateCcw = wrap(RotateCcwIcon)
export const Undo = wrap(UndoIcon)
export const Redo = wrap(RedoIcon)
export const Route = wrap(Route01Icon)
export const Save = wrap(SaveIcon)
export const ScanSearch = wrap(Search01Icon)
export const Scissors = wrap(ScissorsIcon)
export const Search = wrap(Search01Icon)
export const Send = wrap(SendIcon)
export const Settings = wrap(Settings01Icon)
export const SkipBack = wrapPhosphor(PhSkipBack)
export const SkipForward = wrapPhosphor(PhSkipForward)
export const SlidersHorizontal = wrap(SlidersHorizontalIcon)
export const TextT = wrap(TextIcon)
export const Square = wrap(Square01Icon)
export const Star = wrap(StarIcon)
export const Sun = wrap(Sun01Icon)
export const Trash2 = wrap(TrashIcon)
export const TrendingUp = wrap(TrendingUpIcon)
export const Unlock = wrap(LockOpenIcon)
export const Upload = wrap(Upload01Icon)
export const Video = wrapPhosphor(PhVideo)
export const Volume2 = wrap(VolumeHighIcon)
export const VolumeX = wrap(VolumeMute01Icon)
export const Wifi = wrap(WifiHighIcon)
export const WifiOff = wrap(WifiOff01Icon)
export const X = wrap(Cancel01Icon)
export const XCircle = wrap(CancelCircleIcon)
export const Zap = wrap(FlashIcon)
export const ZoomIn = wrap(ZoomInIcon)
export const ZoomOut = wrap(ZoomOutIcon)

export const CheckIcon = Check
export const ChevronDownIcon = ChevronDown
export const ChevronUpIcon = ChevronUp
export const ChevronRightIcon = ChevronRight
