import type { Board, LayoutMode, Page, PageSource } from "../domain/model";
import type { DeviceFrame } from "./device-presets";

export type PagesById = Record<string, Page>;

export type MaybePromise<T> = T | Promise<T>;

export interface PageActionProps {
  onSelectPage?: (pageId: string) => void;
  onEditPage?: (page: Page) => void;
  onDeletePage?: (pageId: string) => MaybePromise<void>;
  onMovePage?: (pageId: string, targetBoardId: string) => MaybePromise<void>;
  onCopyPageToFigma?: (page: Page, deviceFrame?: DeviceFrame) => MaybePromise<void>;
}

export interface BoardActionProps {
  onSelectBoard?: (boardId: string) => void;
  onCreateBoard?: () => MaybePromise<void>;
  onRenameBoard?: (boardId: string, name: string) => MaybePromise<void>;
  onDeleteBoard?: (boardId: string, targetBoardId?: string) => MaybePromise<void>;
}

export interface PageFormValues {
  title: string;
  source: PageSource;
}

export interface BoardFormValues {
  name: string;
}

export interface BaseViewProps extends PageActionProps {
  pages: Page[];
  selectedPageId?: string | null;
  boards?: Board[];
  activeBoardId?: string;
}

export interface LayoutModeControlProps {
  mode: LayoutMode;
  onChange: (mode: LayoutMode) => void;
}
