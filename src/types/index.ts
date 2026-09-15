export interface HistoricalStage {
  id: string;
  name: string;
  order: number;
  description: string;
  color: string;
}

export interface GlyphVariant {
  stageId: string;
  svgPath: string;
  note?: string;
}

export interface Radical {
  id: string;
  name: string;
  meaning: string;
  pronunciation: string;
  category: RadicalCategory;
  baseShape: string;
  variants: GlyphVariant[];
  createdAt: number;
  updatedAt: number;
}

export type RadicalCategory = '象形' | '指事' | '会意' | '形声' | '假借' | '转注';

export type CompositionLayout = 'horizontal' | 'vertical' | 'surround' | 'overlay';

export interface Lexeme {
  id: string;
  radicalIds: string[];
  layout: CompositionLayout;
  pronunciation: string;
  meaning: string;
  example?: string;
  note?: string;
  writingRule?: string;
  createdAt: number;
}

// ── 发布台：只读发布包 ─────────────────────────────────────────────

/** 校验规则代码（发布前五项硬性检查） */
export type ReleaseCheckCode =
  | 'broken-link' // 断链：词条引用了不存在的字根，或字根变体引用了不存在的阶段
  | 'missing-stage-glyph' // 缺失阶段字形：字根在任一已发布阶段缺少变体
  | 'duplicate-name' // 重名：阶段或字根名称重复
  | 'too-many-components' // 构件超过二十四个：词条包含的字根数 > 24
  | 'path-out-of-bounds'; // 路径越界：SVG 路径坐标超出 0–100 画框

export type ReleaseCheckLevel = 'error';

export interface ReleaseCheckIssue {
  code: ReleaseCheckCode;
  level: ReleaseCheckLevel;
  /** 涉及对象类型 */
  target: 'stage' | 'radical' | 'lexeme' | 'variant';
  /** 涉及对象 id（可能已断链，故同时保留 name/ref 便于展示） */
  targetId?: string;
  /** 涉及对象的可读名称或被断链的引用值 */
  ref: string;
  message: string;
}

export interface ReleaseCheckReport {
  ok: boolean;
  rules: ReleaseCheckCode[];
  counts: Record<ReleaseCheckCode, number>;
  issues: ReleaseCheckIssue[];
  summary: {
    stages: number;
    radicals: number;
    lexemes: number;
    glyphs: number;
  };
}

/**
 * 单个字根在某阶段的取形记录。
 * 发布门禁已强制「每个字根在每个阶段都必须有专形」，
 * 因此合法发布包中只会出现 status='exact'；
 * 回退/基础/缺形状态在门禁下不可达，记录中不再保留。
 */
export interface StageFallbackEntry {
  radicalId: string;
  radicalName: string;
  stageId: string;
  stageName: string;
  /** exact = 该阶段存在专门字形（唯一合法状态） */
  status: 'exact';
}

/** 字形清单条目 */
export interface GlyphManifestEntry {
  radicalId: string;
  radicalName: string;
  pronunciation: string;
  category: RadicalCategory;
  baseShape: string;
  /** 阶段 id -> svgPath（快照，包自身只读自洽） */
  stageGlyphs: Record<string, string>;
  stageCount: number;
  variantCount: number;
}

/** 词条快照（发布时刻的完整内容） */
export interface LexemeSnapshot {
  id: string;
  radicalIds: string[];
  radicalNames: string[];
  layout: CompositionLayout;
  pronunciation: string;
  meaning: string;
  example?: string;
  note?: string;
  writingRule?: string;
}

/** 阶段快照 */
export interface StageSnapshot {
  id: string;
  name: string;
  order: number;
  description: string;
  color: string;
}

/** 字根快照 */
export interface RadicalSnapshot {
  id: string;
  name: string;
  meaning: string;
  pronunciation: string;
  category: RadicalCategory;
  baseShape: string;
  variants: GlyphVariant[];
}

/** 与上一发布包的差异（发布时写入；导入包可能缺省） */
export interface ReleaseDiff {
  fromChecksum: string | null;
  fromSequence: number | null;
  stages: { added: string[]; removed: string[]; changed: string[] };
  radicals: { added: string[]; removed: string[]; changed: string[] };
  lexemes: { added: string[]; removed: string[]; changed: string[] };
  /** 仅布局发生变化的词条 */
  layout: string[];
  /** 路径变化（基础字形或任一阶段字形）的字根 */
  paths: string[];
  /** 受影响的字根（路径/布局变化经由词条构件反向关联） */
  affectedRadicals: string[];
  /** 受影响的词条（字根增删改、构件变化、布局变化波及的词条） */
  affectedLexemes: string[];
  /** 无任何变化 */
  unchanged: boolean;
}

export interface ReleasePackage {
  /** 固定格式标识 */
  format: 'glyph-evolution-release';
  formatVersion: 1;
  /** 发布序号（按发布次序递增，导入包重新编号，不参与任何校验值） */
  sequence: number;
  /**
   * 全包稳定校验值（SHA-256）：覆盖 payload、字形清单、阶段取形记录、校验报告与差异。
   * 制品内任一字段被改动，导入验真都会拒绝。
   */
  checksum: string;
  /**
   * 内容校验值（SHA-256）：仅由字系语义内容决定。
   * 用于判断「同一份字系重复发布」，不随序号/差异变化。
   */
  contentChecksum: string;
  /** 快照数据（只读，字根/词条/阶段之后的改动不影响此包） */
  payload: {
    stages: StageSnapshot[];
    radicals: RadicalSnapshot[];
    lexemes: LexemeSnapshot[];
  };
  /** 字形清单 */
  manifest: {
    totalRadicals: number;
    totalGlyphs: number;
    entries: GlyphManifestEntry[];
  };
  /** 阶段回退记录（按阶段顺序、字根 id 排序） */
  fallbackRecords: StageFallbackEntry[];
  /** 校验报告 */
  report: ReleaseCheckReport;
  /** 与上一包的差异（首个包为 null） */
  diff: ReleaseDiff | null;
}

export interface PublishResult {
  ok: boolean;
  /** ok=true 时为新包（unchanged 表示与上一包内容完全一致，未生成新包） */
  pkg?: ReleasePackage;
  unchanged?: boolean;
  issues: ReleaseCheckIssue[];
}

export interface WritingSystemState {
  stages: HistoricalStage[];
  radicals: Radical[];
  lexemes: Lexeme[];
  releases: ReleasePackage[];
  selectedRadicalId: string | null;
  selectedStageId: string | null;
  composingRadicalIds: string[];
  composingLayout: CompositionLayout;
}

export interface WritingSystemActions {
  addStage: (s: Omit<HistoricalStage, 'id'>) => void;
  updateStage: (id: string, patch: Partial<HistoricalStage>) => void;
  removeStage: (id: string) => void;

  addRadical: (r: Omit<Radical, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateRadical: (id: string, patch: Partial<Radical>) => void;
  removeRadical: (id: string) => void;

  addLexeme: (l: Omit<Lexeme, 'id' | 'createdAt'>) => string;
  updateLexeme: (id: string, patch: Partial<Lexeme>) => void;
  removeLexeme: (id: string) => void;

  selectRadical: (id: string | null) => void;
  selectStage: (id: string | null) => void;

  addToComposer: (radicalId: string) => void;
  removeFromComposer: (index: number) => void;
  clearComposer: () => void;
  moveInComposer: (fromIndex: number, toIndex: number) => void;
  setComposingLayout: (layout: CompositionLayout) => void;

  exportData: () => string;
  importData: (json: string) => void;
  resetAll: () => void;

  /** 编译当前字系为只读发布包；校验失败时返回 issues 且不改动任何数据/旧包 */
  publishRelease: () => Promise<PublishResult>;
  /** 导入单个发布包（独立存档，不影响当前编辑数据）；结构/重建/校验值任一不符都会拒绝 */
  importReleasePackage: (json: string) => Promise<ReleasePackage>;
  /** 删除一个发布包（按全包校验值定位，需二次确认） */
  removeRelease: (checksum: string) => void;
  /** 序列化单个发布包用于导出（按全包校验值定位） */
  serializeRelease: (checksum: string) => string;
}

export type WritingSystemStore = WritingSystemState & WritingSystemActions;
