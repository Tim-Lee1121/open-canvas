import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Add01Icon,
  Agreement03Icon,
  AiFile01Icon,
  AlertCircleIcon,
  ArchiveArrowUpIcon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckIcon,
  CheckmarkCircle02Icon,
  ChevronDownIcon,
  CodeIcon,
  ComputerIcon,
  Copy01Icon,
  Comment01Icon,
  Delete01Icon,
  Delete02Icon,
  DragDropVerticalIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FitToScreenIcon,
  FolderAddIcon,
  FolderKanbanIcon,
  Globe02Icon,
  GripVerticalIcon,
  LayoutGridIcon,
  LoaderIcon,
  Menu01Icon,
  MessageSquareTextIcon,
  MoreHorizontalIcon,
  MoveToIcon,
  PanelRightOpenIcon,
  PencilEdit01Icon,
  RefreshIcon,
  SaveIcon,
  ScanIcon,
  SparklesIcon,
  SmartPhone01Icon,
  Tick02Icon,
  TriangleAlertIcon,
  Tag01Icon,
  WandSparklesIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hugeicons/core-free-icons";
import type { SVGProps } from "react";

/**
 * Keep icon usage compatible with the existing component call sites while
 * rendering the official Hugeicons data objects with one consistent stroke.
 */
export type HugeIconProps = Omit<SVGProps<SVGSVGElement>, "strokeWidth"> & {
  size?: number | string;
  strokeWidth?: number;
};

function createIcon(icon: IconSvgElement, displayName: string) {
  function Icon({ size = 16, strokeWidth = 1.5, ...props }: HugeIconProps) {
    return <HugeiconsIcon icon={icon} size={size} strokeWidth={strokeWidth} {...props} />;
  }
  Icon.displayName = displayName;
  return Icon;
}

export const Add = createIcon(Add01Icon, "Add");
export const Apply = createIcon(Tick02Icon, "Apply");
export const ProjectDocument = createIcon(Agreement03Icon, "ProjectDocument");
export const AlertCircle = createIcon(AlertCircleIcon, "AlertCircle");
export const AlertTriangle = createIcon(TriangleAlertIcon, "AlertTriangle");
export const ArrowRight = createIcon(ArrowRight01Icon, "ArrowRight");
export const Cancel = createIcon(Cancel01Icon, "Cancel");
export const Check = createIcon(CheckIcon, "Check");
export const CheckCircle2 = createIcon(CheckmarkCircle02Icon, "CheckCircle2");
export const ChevronDown = createIcon(ChevronDownIcon, "ChevronDown");
export const Code2 = createIcon(CodeIcon, "Code2");
export const Copy = createIcon(Copy01Icon, "Copy");
export const Comment = createIcon(Comment01Icon, "Comment");
export const MessageSquareText = createIcon(MessageSquareTextIcon, "MessageSquareText");
export const Delete = createIcon(Delete02Icon, "Delete");
export const DragVertical = createIcon(DragDropVerticalIcon, "DragVertical");
export const GripVertical = createIcon(GripVerticalIcon, "GripVertical");
export const ExternalLink = createIcon(ExternalLinkIcon, "ExternalLink");
export const FileCode2 = createIcon(FileCodeIcon, "FileCode2");
export const Focus = createIcon(FitToScreenIcon, "Focus");
export const BoardFile = createIcon(AiFile01Icon, "BoardFile");
export const FolderPlus = createIcon(FolderAddIcon, "FolderPlus");
export const FolderKanban = createIcon(FolderKanbanIcon, "FolderKanban");
export const Globe2 = createIcon(Globe02Icon, "Globe2");
export const LayoutGrid = createIcon(LayoutGridIcon, "LayoutGrid");
export const Loader2 = createIcon(LoaderIcon, "Loader2");
export const Menu = createIcon(Menu01Icon, "Menu");
export const MoreHorizontal = createIcon(MoreHorizontalIcon, "MoreHorizontal");
export const MoveRight = createIcon(MoveToIcon, "MoveRight");
// Figma's collapse glyph has a right-hand divider and a left-facing chevron.
export const PanelLeftClose = createIcon(PanelRightOpenIcon, "PanelLeftClose");
export const Pencil = createIcon(PencilEdit01Icon, "Pencil");
export const Plus = createIcon(Add01Icon, "Plus");
export const RefreshCw = createIcon(RefreshIcon, "RefreshCw");
export const Save = createIcon(SaveIcon, "Save");
export const Scan = createIcon(ScanIcon, "Scan");
export const Sparkles = createIcon(SparklesIcon, "Sparkles");
export const Trash2 = createIcon(Delete01Icon, "Trash2");
export const WandSparkles = createIcon(WandSparklesIcon, "WandSparkles");
export const X = createIcon(Cancel01Icon, "X");
export const ZoomIn = createIcon(ZoomInIcon, "ZoomIn");
export const ZoomOut = createIcon(ZoomOutIcon, "ZoomOut");

// Canvas-only affordances use names that describe the product action directly.
export const PageSize = createIcon(SmartPhone01Icon, "PageSize");
export const DesktopSize = createIcon(ComputerIcon, "DesktopSize");
export const MoveTo = createIcon(ArchiveArrowUpIcon, "MoveTo");
export const Trash = createIcon(Delete01Icon, "Trash");
export const Tag = createIcon(Tag01Icon, "Tag");
