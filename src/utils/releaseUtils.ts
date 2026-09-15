import type {
  CompositionLayout,
  GlyphVariant,
  HistoricalStage,
  Lexeme,
  Radical,
  RadicalCategory,
  ReleaseCheckCode,
  ReleaseCheckIssue,
  ReleaseCheckReport,
  ReleaseDiff,
  GlyphManifestEntry,
  LexemeSnapshot,
  RadicalSnapshot,
  ReleasePackage,
  StageFallbackEntry,
  StageSnapshot,
} from '@/types';

// ── 常量 ────────────────────────────────────────────────────────────

/** 单个词条允许的最大构件（字根）数量 */
export const MAX_COMPONENTS = 24;
/** 字形画框范围：所有路径坐标必须落在 0–100 之间 */
export const PATH_BOUND = 100;
const PATH_EPS = 1e-6;

export const RELEASE_FORMAT = 'glyph-evolution-release' as const;
export const RELEASE_FORMAT_VERSION = 1;

/** 发布前五项硬性检查（顺序即报告中的展示顺序） */
export const CHECK_RULES: ReleaseCheckCode[] = [
  'broken-link',
  'missing-stage-glyph',
  'duplicate-name',
  'too-many-components',
  'path-out-of-bounds',
];

export const CHECK_LABELS: Record<ReleaseCheckCode, string> = {
  'broken-link': '断链',
  'missing-stage-glyph': '缺失阶段字形',
  'duplicate-name': '重名',
  'too-many-components': '构件超限',
  'path-out-of-bounds': '路径越界',
};

export const LAYOUT_NAMES: Record<CompositionLayout, string> = {
  horizontal: '左右排列',
  vertical: '上下堆叠',
  surround: '包围结构',
  overlay: '叠加重合',
};

// ── 输入结构 ────────────────────────────────────────────────────────

export interface ReleaseSource {
  stages: Array<Pick<HistoricalStage, 'id' | 'name' | 'order' | 'description' | 'color'>>;
  radicals: Array<Omit<Radical, 'createdAt' | 'updatedAt'>>;
  lexemes: Array<Omit<Lexeme, 'createdAt'>>;
}

/** 校验失败：携带全部问题，调用方据此中止发布 */
export class ReleaseValidationError extends Error {
  issues: ReleaseCheckIssue[];
  constructor(issues: ReleaseCheckIssue[]) {
    super(`发布前校验未通过（${issues.length} 项问题）`);
    this.name = 'ReleaseValidationError';
    this.issues = issues;
  }
}

// ── 工具 ────────────────────────────────────────────────────────────

const byOrderThenId = (
  a: { order: number; id: string },
  b: { order: number; id: string }
) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byNameThenId = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name !== b.name ? (a.name < b.name ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const stripUndefined = <T extends object>(obj: T): T => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as T;
};

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

// ── 路径检查（严格语法 + 画框越界） ─────────────────────────────────

/** 每个路径命令每一轮消耗的数字个数 */
const COMMAND_ARGS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

type PathToken = { type: 'cmd'; cmd: string } | { type: 'num'; n: number };

export interface PathProblem {
  /** bounds = 坐标越界；syntax = 空路径/未知命令/残缺参数/非法数字/非法标志位 */
  kind: 'bounds' | 'syntax';
  message: string;
  x?: number;
  y?: number;
}

/**
 * 严格解析 SVG path：
 * - 空、含未知命令、数字残缺/非有限数、命令缺参数、A 弧标志位非 0/1 —— 一律判为非法；
 * - 所有落笔坐标（含相对命令解析后的绝对坐标、隐式重复命令、H/V/A 终点）必须落在 0–100。
 */
export function checkPath(svgPath: string): PathProblem[] {
  const problems: PathProblem[] = [];
  const raw = svgPath ?? '';
  if (typeof raw !== 'string' || !raw.trim()) {
    return [{ kind: 'syntax', message: '路径为空' }];
  }

  const tokens: PathToken[] = [];
  const tokenRe = /[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(raw))) {
    if (/[a-zA-Z]/.test(tm[0])) tokens.push({ type: 'cmd', cmd: tm[0] });
    else tokens.push({ type: 'num', n: Number(tm[0]) });
  }

  // 命令之间允许空白与逗号，出现其余符号即为非法
  const separators = raw.match(/[^a-zA-Z0-9eE+\-.\s,]/g);
  if (separators) {
    return [{ kind: 'syntax', message: `路径含非法字符“${separators[0]}”` }];
  }
  for (const t of tokens) {
    if (t.type === 'num' && !Number.isFinite((t as { n: number }).n)) {
      return [{ kind: 'syntax', message: '路径含非有限数字' }];
    }
  }
  if (tokens.length === 0 || tokens[0].type !== 'cmd') {
    return [{ kind: 'syntax', message: '路径必须以移动命令 M/m 开头' }];
  }

  const inBounds = (v: number) => v >= -PATH_EPS && v <= PATH_BOUND + PATH_EPS;
  const flagBounds = (x: number, y: number) => {
    if (!inBounds(x) || !inBounds(y)) {
      problems.push({
        kind: 'bounds',
        x,
        y,
        message: `坐标 (${round6(x)}, ${round6(y)}) 超出 0–${PATH_BOUND} 画框`,
      });
    }
  };

  let cx = 0;
  let cy = 0;
  let i = 0;
  let started = false;

  while (i < tokens.length) {
    const t = tokens[i++];
    if (t.type !== 'cmd') {
      return [{ kind: 'syntax', message: '路径含缺少命令前缀的数字' }];
    }
    const upper = t.cmd.toUpperCase();
    if (!(upper in COMMAND_ARGS)) {
      return [{ kind: 'syntax', message: `未知路径命令“${t.cmd}”` }];
    }
    const rel = t.cmd !== upper;
    const argc = COMMAND_ARGS[upper];

    // 数字命令可隐式重复（如 M 后多对坐标）；Z 不消费数字
    let firstRound = true;
    do {
      if (upper === 'Z') {
        if (!firstRound) break;
        firstRound = false;
        break;
      }
      firstRound = false;

      const nums: number[] = [];
      while (nums.length < argc && i < tokens.length && tokens[i].type === 'num') {
        nums.push((tokens[i] as { type: 'num'; n: number }).n);
        i++;
      }
      if (nums.length < argc) {
        return [
          {
            kind: 'syntax',
            message: `命令 ${t.cmd} 参数残缺（需 ${argc} 个数字，实得 ${nums.length} 个）`,
          },
        ];
      }
      const resolve = (idx: number, cur: number) => round6(rel ? cur + nums[idx] : nums[idx]);

      switch (upper) {
        case 'M': {
          if (!started) started = true;
          const x = resolve(0, cx);
          const y = resolve(1, cy);
          flagBounds(x, y);
          cx = x; cy = y;
          break;
        }
        case 'L':
        case 'T': {
          const x = resolve(0, cx);
          const y = resolve(1, cy);
          flagBounds(x, y);
          cx = x; cy = y;
          break;
        }
        case 'H': {
          const x = resolve(0, cx);
          flagBounds(x, cy);
          cx = x;
          break;
        }
        case 'V': {
          const y = resolve(0, cy);
          flagBounds(cx, y);
          cy = y;
          break;
        }
        case 'C': {
          for (let p = 0; p < 3; p++) flagBounds(resolve(p * 2, cx), resolve(p * 2 + 1, cy));
          cx = resolve(4, cx); cy = resolve(5, cy);
          break;
        }
        case 'S':
        case 'Q': {
          flagBounds(resolve(0, cx), resolve(1, cy));
          const x = resolve(2, cx);
          const y = resolve(3, cy);
          flagBounds(x, y);
          cx = x; cy = y;
          break;
        }
        case 'A': {
          // 两个大弧/扫描标志位必须为 0 或 1
          if (nums[3] !== 0 && nums[3] !== 1) {
            return [{ kind: 'syntax', message: `弧线大弧标志位非法：${nums[3]}（只允许 0 或 1）` }];
          }
          if (nums[4] !== 0 && nums[4] !== 1) {
            return [{ kind: 'syntax', message: `弧线扫描标志位非法：${nums[4]}（只允许 0 或 1）` }];
          }
          const x = resolve(5, cx);
          const y = resolve(6, cy);
          flagBounds(x, y);
          cx = x; cy = y;
          break;
        }
      }
    } while (i < tokens.length && tokens[i].type === 'num');
  }

  if (!started) {
    return [{ kind: 'syntax', message: '路径缺少移动命令 M/m' }];
  }
  return problems;
}

// ── 发布前校验 ──────────────────────────────────────────────────────

export function validateWritingSystem(src: ReleaseSource): ReleaseCheckIssue[] {
  const issues: ReleaseCheckIssue[] = [];

  const stages = [...src.stages].sort(byOrderThenId);
  const radicals = [...src.radicals].sort(byNameThenId);
  const lexemes = [...src.lexemes].sort((a, b) =>
    a.pronunciation !== b.pronunciation
      ? a.pronunciation < b.pronunciation ? -1 : 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const stageIds = new Set(stages.map((s) => s.id));
  const radicalIds = new Set(radicals.map((r) => r.id));

  // 1. 重名
  const dupNameIssues: ReleaseCheckIssue[] = [];
  const seenStageName = new Map<string, string>();
  const seenStageId = new Set<string>();
  for (const s of stages) {
    const key = s.name.trim();
    const first = seenStageName.get(key);
    if (first) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'stage', targetId: s.id, ref: s.name,
        message: `阶段「${s.name}」与「${first}」重名`,
      });
    } else {
      seenStageName.set(key, s.name);
    }
    if (seenStageId.has(s.id)) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'stage', targetId: s.id, ref: s.id,
        message: `阶段 id 重复：${s.id}`,
      });
    }
    seenStageId.add(s.id);
  }

  const seenRadicalName = new Map<string, string>();
  const seenRadicalId = new Set<string>();
  for (const r of radicals) {
    const key = r.name.trim();
    const first = seenRadicalName.get(key);
    if (first) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'radical', targetId: r.id, ref: r.name,
        message: `字根「${r.name}」与「${first}」重名`,
      });
    } else {
      seenRadicalName.set(key, r.name);
    }
    if (seenRadicalId.has(r.id)) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'radical', targetId: r.id, ref: r.id,
        message: `字根 id 重复：${r.id}`,
      });
    }
    seenRadicalId.add(r.id);
  }

  const seenLexemeKey = new Map<string, string>();
  const seenLexemeId = new Set<string>();
  for (const l of lexemes) {
    const key = `${l.radicalIds.join('>')}|${l.layout}|${l.pronunciation.trim()}`;
    const first = seenLexemeKey.get(key);
    const label = `【${l.pronunciation}】${l.meaning.split('；')[0]}`;
    if (first) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'lexeme', targetId: l.id, ref: label,
        message: `词条 ${label} 与 ${first} 重复（构件、布局、读音相同）`,
      });
    } else {
      seenLexemeKey.set(key, label);
    }
    if (seenLexemeId.has(l.id)) {
      dupNameIssues.push({
        code: 'duplicate-name', level: 'error', target: 'lexeme', targetId: l.id, ref: l.id,
        message: `词条 id 重复：${l.id}`,
      });
    }
    seenLexemeId.add(l.id);
  }

  for (const r of radicals) {
    const seen = new Set<string>();
    for (const v of r.variants) {
      if (seen.has(v.stageId)) {
        dupNameIssues.push({
          code: 'duplicate-name', level: 'error', target: 'variant', targetId: r.id,
          ref: `${r.name}/${v.stageId}`,
          message: `字根「${r.name}」在阶段 ${v.stageId} 存在重复字形记录`,
        });
      }
      seen.add(v.stageId);
    }
  }

  // 2. 断链
  const brokenIssues: ReleaseCheckIssue[] = [];
  for (const l of lexemes) {
    if (l.radicalIds.length === 0) {
      brokenIssues.push({
        code: 'broken-link', level: 'error', target: 'lexeme', targetId: l.id,
        ref: l.meaning.split('；')[0] || l.id,
        message: `词条「${l.meaning.split('；')[0] || l.id}」未包含任何字根`,
      });
    }
    for (const rid of l.radicalIds) {
      if (!radicalIds.has(rid)) {
        brokenIssues.push({
          code: 'broken-link', level: 'error', target: 'lexeme', targetId: l.id, ref: rid,
          message: `词条「${l.meaning.split('；')[0] || l.id}」引用了不存在的字根 ${rid}`,
        });
      }
    }
  }
  for (const r of radicals) {
    for (const v of r.variants) {
      if (!stageIds.has(v.stageId)) {
        brokenIssues.push({
          code: 'broken-link', level: 'error', target: 'variant', targetId: r.id, ref: v.stageId,
          message: `字根「${r.name}」的字形引用了不存在的阶段 ${v.stageId}`,
        });
      }
    }
  }

  // 3. 缺失阶段字形：每个字根在每个阶段都必须有字形
  const missingIssues: ReleaseCheckIssue[] = [];
  for (const r of radicals) {
    const have = new Set(r.variants.map((v) => v.stageId));
    for (const s of stages) {
      if (!have.has(s.id)) {
        missingIssues.push({
          code: 'missing-stage-glyph', level: 'error', target: 'radical', targetId: r.id,
          ref: `${r.name}/${s.name}`,
          message: `字根「${r.name}」缺少阶段「${s.name}」的字形`,
        });
      }
    }
  }

  // 4. 构件超过二十四个
  const componentIssues: ReleaseCheckIssue[] = [];
  for (const l of lexemes) {
    if (l.radicalIds.length > MAX_COMPONENTS) {
      componentIssues.push({
        code: 'too-many-components', level: 'error', target: 'lexeme', targetId: l.id,
        ref: l.meaning.split('；')[0] || l.id,
        message: `词条「${l.meaning.split('；')[0] || l.id}」包含 ${l.radicalIds.length} 个构件，超过上限 ${MAX_COMPONENTS} 个`,
      });
    }
  }

  // 5. 路径越界 / 路径无效（语法错误也归入此门禁）
  const pathIssues: ReleaseCheckIssue[] = [];
  const emitPath = (
    target: 'radical' | 'variant',
    r: Pick<Radical, 'id' | 'name'>,
    stageName: string | null,
    svgPath: string
  ) => {
    for (const p of checkPath(svgPath)) {
      const where = stageName ? `在阶段「${stageName}」` : '的基础字形';
      pathIssues.push({
        code: 'path-out-of-bounds', level: 'error', target, targetId: r.id,
        ref: stageName ? `${r.name}/${stageName}` : r.name,
        message:
          p.kind === 'syntax'
            ? `字根「${r.name}」${where}路径无效：${p.message}`
            : `字根「${r.name}」${where}${p.message}`,
      });
    }
  };
  for (const r of radicals) {
    emitPath('radical', r, null, r.baseShape);
    for (const v of r.variants) {
      const stage = stages.find((s) => s.id === v.stageId);
      emitPath('variant', r, stage?.name ?? v.stageId, v.svgPath);
    }
  }

  for (const code of CHECK_RULES) {
    const bucket = {
      'broken-link': brokenIssues,
      'missing-stage-glyph': missingIssues,
      'duplicate-name': dupNameIssues,
      'too-many-components': componentIssues,
      'path-out-of-bounds': pathIssues,
    }[code];
    issues.push(...bucket);
  }

  return issues;
}

// ── 规范化快照（确定性：排序 + 固定键序 + 剥离易变字段） ─────────────

interface Normalized {
  stages: StageSnapshot[];
  radicals: RadicalSnapshot[];
  lexemes: LexemeSnapshot[];
  stageOrder: Map<string, number>;
}

function normalize(src: ReleaseSource): Normalized {
  const stages = [...src.stages].sort(byOrderThenId).map<StageSnapshot>((s) => ({
    id: s.id,
    name: s.name,
    order: s.order,
    description: s.description,
    color: s.color,
  }));
  const stageOrder = new Map(stages.map((s, i) => [s.id, i]));

  const radicals = [...src.radicals].sort(byNameThenId).map<RadicalSnapshot>((r) => ({
    id: r.id,
    name: r.name,
    meaning: r.meaning,
    pronunciation: r.pronunciation,
    category: r.category,
    baseShape: r.baseShape,
    variants: [...r.variants]
      .map<GlyphVariant>((v) => stripUndefined({ stageId: v.stageId, svgPath: v.svgPath, note: v.note }))
      .sort((a, b) => {
        const oa = stageOrder.get(a.stageId) ?? Number.MAX_SAFE_INTEGER;
        const ob = stageOrder.get(b.stageId) ?? Number.MAX_SAFE_INTEGER;
        return oa !== ob ? oa - ob : a.stageId < b.stageId ? -1 : a.stageId > b.stageId ? 1 : 0;
      }),
  }));

  const radicalName = new Map(radicals.map((r) => [r.id, r.name]));
  const lexemes = [...src.lexemes]
    .sort((a, b) =>
      a.pronunciation !== b.pronunciation
        ? a.pronunciation < b.pronunciation ? -1 : 1
        : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    )
    .map<LexemeSnapshot>((l) =>
      stripUndefined({
        id: l.id,
        radicalIds: [...l.radicalIds],
        radicalNames: l.radicalIds.map((id) => radicalName.get(id) ?? '∅'),
        layout: l.layout,
        pronunciation: l.pronunciation,
        meaning: l.meaning,
        example: l.example,
        note: l.note,
        writingRule: l.writingRule,
      })
    );

  return { stages, radicals, lexemes, stageOrder };
}

// ── 稳定序列化与双层校验值 ──────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 内容投影：仅字系语义，不随时间/序号/差异/报告变化 */
function semanticProjection(n: Normalized) {
  return {
    format: RELEASE_FORMAT,
    formatVersion: RELEASE_FORMAT_VERSION,
    stages: n.stages.map((s) => ({
      id: s.id, name: s.name, order: s.order, description: s.description, color: s.color,
    })),
    radicals: n.radicals.map((r) => ({
      id: r.id, name: r.name, meaning: r.meaning, pronunciation: r.pronunciation,
      category: r.category, baseShape: r.baseShape,
      variants: r.variants.map((v) => ({ stageId: v.stageId, svgPath: v.svgPath, note: v.note })),
    })),
    lexemes: n.lexemes.map((l) => ({
      id: l.id, radicalIds: l.radicalIds, layout: l.layout, pronunciation: l.pronunciation,
      meaning: l.meaning, example: l.example, note: l.note, writingRule: l.writingRule,
    })),
  };
}

/**
 * 制品投影：参与验真的全部内容——
 * 快照 payload、字形清单、阶段取形记录、校验报告、与上一包差异；
 * 只有序号不参与（导入时会重新编号）。
 */
function artifactProjection(p: Omit<ReleasePackage, 'checksum' | 'sequence'>) {
  return {
    format: p.format,
    formatVersion: p.formatVersion,
    contentChecksum: p.contentChecksum,
    payload: p.payload,
    manifest: p.manifest,
    fallbackRecords: p.fallbackRecords,
    report: p.report,
    diff: p.diff,
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('当前环境不支持 SHA-256 摘要计算');
}

/** 内容校验值：同一字系永远相同 */
export async function checksumForSource(src: ReleaseSource): Promise<string> {
  return sha256Hex(stableStringify(semanticProjection(normalize(src))));
}

/** 全包校验值：覆盖清单/取形记录/报告/差异 */
export async function checksumForArtifact(p: Omit<ReleasePackage, 'checksum' | 'sequence'>): Promise<string> {
  return sha256Hex(stableStringify(artifactProjection(p)));
}

// ── 字形清单与阶段取形记录 ──────────────────────────────────────────

function buildManifest(n: Normalized): ReleasePackage['manifest'] {
  const entries: GlyphManifestEntry[] = n.radicals.map((r) => {
    const stageGlyphs: Record<string, string> = {};
    for (const v of r.variants) stageGlyphs[v.stageId] = v.svgPath;
    return {
      radicalId: r.id,
      radicalName: r.name,
      pronunciation: r.pronunciation,
      category: r.category as RadicalCategory,
      baseShape: r.baseShape,
      stageGlyphs,
      stageCount: Object.keys(stageGlyphs).length,
      variantCount: r.variants.length,
    };
  });
  return {
    totalRadicals: entries.length,
    totalGlyphs: entries.reduce((sum, e) => sum + e.variantCount, 0),
    entries,
  };
}

/**
 * 阶段取形记录。
 * 门禁保证每个字根×每个阶段都有专形；这里只生成 exact 记录，
 * 若与门禁不一致则直接抛出（防御性，正常流程不可达）。
 */
function buildFallbackRecords(n: Normalized): StageFallbackEntry[] {
  const records: StageFallbackEntry[] = [];
  for (const s of n.stages) {
    for (const r of n.radicals) {
      if (!r.variants.some((v) => v.stageId === s.id)) {
        throw new ReleaseValidationError([
          {
            code: 'missing-stage-glyph', level: 'error', target: 'radical', targetId: r.id,
            ref: `${r.name}/${s.name}`,
            message: `字根「${r.name}」缺少阶段「${s.name}」的字形（取形记录与门禁不一致）`,
          },
        ]);
      }
      records.push({
        radicalId: r.id, radicalName: r.name, stageId: s.id, stageName: s.name, status: 'exact',
      });
    }
  }
  return records;
}

function buildReport(n: Normalized, issues: ReleaseCheckIssue[]): ReleaseCheckReport {
  const counts = Object.fromEntries(CHECK_RULES.map((c) => [c, 0])) as Record<ReleaseCheckCode, number>;
  for (const i of issues) counts[i.code]++;
  return {
    ok: issues.length === 0,
    rules: [...CHECK_RULES],
    counts,
    issues,
    summary: {
      stages: n.stages.length,
      radicals: n.radicals.length,
      lexemes: n.lexemes.length,
      glyphs: n.radicals.reduce((sum, r) => sum + r.variants.length, 0),
    },
  };
}

// ── 两包差异 ────────────────────────────────────────────────────────

function radicalShapeSignature(r: RadicalSnapshot): string {
  const parts = [r.baseShape];
  for (const [sid, path] of [...r.variants.map((v) => [v.stageId, v.svgPath] as [string, string])].sort(([a], [b]) =>
    a < b ? -1 : 1
  )) {
    parts.push(`${sid}=${path}`);
  }
  return parts.join('|');
}

/** 比较两个发布包（prev → next），按字根/词条/阶段/布局/路径列出增删变化 */
export function diffPackages(prev: ReleasePackage | null, next: ReleasePackage): ReleaseDiff {
  const empty = () => ({ added: [] as string[], removed: [] as string[], changed: [] as string[] });
  const diff: ReleaseDiff = {
    fromChecksum: prev?.checksum ?? null,
    fromSequence: prev ? prev.sequence : null,
    stages: empty(),
    radicals: empty(),
    lexemes: empty(),
    layout: [],
    paths: [],
    affectedRadicals: [],
    affectedLexemes: [],
    unchanged: false,
  };
  if (!prev) return diff;

  const pStages = new Map(prev.payload.stages.map((s) => [s.id, s]));
  const nStages = new Map(next.payload.stages.map((s) => [s.id, s]));
  for (const [id, s] of nStages) {
    const o = pStages.get(id);
    if (!o) diff.stages.added.push(id);
    else if (o.name !== s.name || o.order !== s.order || o.description !== s.description || o.color !== s.color)
      diff.stages.changed.push(id);
  }
  for (const id of pStages.keys()) if (!nStages.has(id)) diff.stages.removed.push(id);

  const pRad = new Map(prev.payload.radicals.map((r) => [r.id, r]));
  const nRad = new Map(next.payload.radicals.map((r) => [r.id, r]));
  for (const [id, r] of nRad) {
    const o = pRad.get(id);
    if (!o) {
      diff.radicals.added.push(id);
      continue;
    }
    if (
      o.name !== r.name ||
      o.meaning !== r.meaning ||
      o.pronunciation !== r.pronunciation ||
      o.category !== r.category ||
      o.baseShape !== r.baseShape
    ) {
      diff.radicals.changed.push(id);
    }
    if (radicalShapeSignature(o) !== radicalShapeSignature(r)) diff.paths.push(id);
  }
  for (const id of pRad.keys()) if (!nRad.has(id)) diff.radicals.removed.push(id);

  const pLex = new Map(prev.payload.lexemes.map((l) => [l.id, l]));
  const nLex = new Map(next.payload.lexemes.map((l) => [l.id, l]));
  const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  for (const [id, l] of nLex) {
    const o = pLex.get(id);
    if (!o) {
      diff.lexemes.added.push(id);
      continue;
    }
    const metaChanged =
      o.pronunciation !== l.pronunciation ||
      o.meaning !== l.meaning ||
      o.example !== l.example ||
      o.note !== l.note ||
      o.writingRule !== l.writingRule;
    const compsChanged = !sameIds(o.radicalIds, l.radicalIds);
    const layoutChanged = o.layout !== l.layout;
    if (metaChanged || compsChanged || layoutChanged) diff.lexemes.changed.push(id);
    if (layoutChanged) diff.layout.push(id);
  }
  for (const id of pLex.keys()) if (!nLex.has(id)) diff.lexemes.removed.push(id);

  // 受影响字根：自身增删改/路径变化，或出现在受影响词条中
  const affectedLex = new Set<string>([
    ...diff.lexemes.added,
    ...diff.lexemes.removed,
    ...diff.lexemes.changed,
  ]);
  const touchedRadicals = new Set<string>([
    ...diff.radicals.added,
    ...diff.radicals.removed,
    ...diff.radicals.changed,
    ...diff.paths,
  ]);
  for (const l of next.payload.lexemes) {
    if (l.radicalIds.some((id) => touchedRadicals.has(id))) affectedLex.add(l.id);
  }
  for (const l of prev.payload.lexemes) {
    if (l.radicalIds.some((id) => touchedRadicals.has(id))) affectedLex.add(l.id);
  }

  const affectedRad = new Set<string>(touchedRadicals);
  for (const id of affectedLex) {
    const l = nLex.get(id) ?? pLex.get(id);
    if (l) for (const rid of l.radicalIds) affectedRad.add(rid);
  }

  diff.affectedLexemes = [...affectedLex].sort();
  diff.affectedRadicals = [...affectedRad].sort();
  diff.unchanged =
    next.contentChecksum === prev.contentChecksum &&
    diff.stages.added.length + diff.stages.removed.length + diff.stages.changed.length === 0 &&
    diff.radicals.added.length + diff.radicals.removed.length + diff.radicals.changed.length === 0 &&
    diff.lexemes.added.length + diff.lexemes.removed.length + diff.lexemes.changed.length === 0;
  return diff;
}

// ── 构建发布包（制品是数据的纯函数：无时间、无随机、无存档依赖） ─────

export interface BuildReleaseOptions {
  sequence: number;
  prev: ReleasePackage | null;
}

export async function buildReleasePackage(
  src: ReleaseSource,
  opts: BuildReleaseOptions
): Promise<ReleasePackage> {
  const issues = validateWritingSystem(src);
  if (issues.length > 0) throw new ReleaseValidationError(issues);

  const n = normalize(src);
  const contentChecksum = await sha256Hex(stableStringify(semanticProjection(n)));

  // 组装占位草稿（checksum 不参与 artifactProjection，先留空）
  const draft: ReleasePackage = {
    format: RELEASE_FORMAT,
    formatVersion: RELEASE_FORMAT_VERSION,
    sequence: opts.sequence,
    contentChecksum,
    payload: { stages: n.stages, radicals: n.radicals, lexemes: n.lexemes },
    manifest: buildManifest(n),
    fallbackRecords: buildFallbackRecords(n),
    report: buildReport(n, issues),
    diff: null,
    checksum: '',
  };
  draft.diff = opts.prev ? diffPackages(opts.prev, draft) : null;
  const checksum = await checksumForArtifact(draft);

  return { ...draft, checksum };
}

// ── 发布包解析、重建与验真 ──────────────────────────────────────────

export class ReleaseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseParseError';
  }
}

export interface ParseContext {
  /** 本地存档中可能存在的差异基准包；命中 diff.fromChecksum 时会逐字节复算差异 */
  prev?: ReleasePackage | null;
}

/**
 * 由包内快照重建规范制品，再与文件逐字段比对，并复核全包校验值。
 * 任一派生字段（清单/取形记录/报告/差异）或快照本身被改动都会拒绝。
 */
export async function parseReleasePackage(json: string, context?: ParseContext): Promise<ReleasePackage> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ReleaseParseError('不是有效的 JSON 文件');
  }
  const pkg = raw as Partial<ReleasePackage>;
  if (!pkg || typeof pkg !== 'object') throw new ReleaseParseError('发布包结构为空');
  if (pkg.format !== RELEASE_FORMAT) {
    throw new ReleaseParseError('文件头标识不符，不是字形演化发布包');
  }
  if (pkg.formatVersion !== RELEASE_FORMAT_VERSION) {
    throw new ReleaseParseError(`不支持的发布包版本：${String(pkg.formatVersion)}`);
  }
  if (typeof pkg.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.checksum)) {
    throw new ReleaseParseError('发布包缺少有效的全包校验值');
  }
  if (typeof pkg.contentChecksum !== 'string' || !/^[0-9a-f]{64}$/.test(pkg.contentChecksum)) {
    throw new ReleaseParseError('发布包缺少有效的内容校验值');
  }
  if (!pkg.payload || !Array.isArray(pkg.payload.stages) || !Array.isArray(pkg.payload.radicals) || !Array.isArray(pkg.payload.lexemes)) {
    throw new ReleaseParseError('发布包快照数据不完整');
  }
  if (!pkg.manifest || !Array.isArray(pkg.manifest.entries)) {
    throw new ReleaseParseError('发布包缺少字形清单');
  }
  if (!Array.isArray(pkg.fallbackRecords)) {
    throw new ReleaseParseError('发布包缺少阶段取形记录');
  }
  if (!pkg.report || typeof pkg.report !== 'object') {
    throw new ReleaseParseError('发布包缺少校验报告');
  }
  if (!('diff' in pkg)) {
    throw new ReleaseParseError('发布包缺少差异字段');
  }
  if (pkg.diff !== null && typeof pkg.diff !== 'object') {
    throw new ReleaseParseError('发布包差异字段已损坏');
  }
  // 封皮时间戳等游离字段不应出现在制品中
  const ALLOWED_KEYS = [
    'format', 'formatVersion', 'sequence', 'checksum', 'contentChecksum',
    'payload', 'manifest', 'fallbackRecords', 'report', 'diff',
  ];
  for (const k of Object.keys(pkg)) {
    if (!ALLOWED_KEYS.includes(k)) {
      throw new ReleaseParseError(`发布包含有不受校验的多余字段：${k}`);
    }
  }

  // 1) 包内快照本身必须通过当前发布门禁（残缺/越界路径在此被拦）
  const source: ReleaseSource = {
    stages: pkg.payload.stages as StageSnapshot[],
    radicals: pkg.payload.radicals as RadicalSnapshot[],
    lexemes: pkg.payload.lexemes.map((l) => ({
      id: l.id,
      radicalIds: l.radicalIds,
      layout: l.layout,
      pronunciation: l.pronunciation,
      meaning: l.meaning,
      example: l.example,
      note: l.note,
      writingRule: l.writingRule,
    })),
  };
  const gate = validateWritingSystem(source);
  if (gate.length > 0) {
    throw new ReleaseParseError(`发布包未通过发布门禁：${gate[0].message}`);
  }

  // 2) 由快照重建规范制品（序号与上一包引用以文件为准，不参与重建比对）
  const rebuilt = await buildReleasePackage(source, {
    sequence: typeof pkg.sequence === 'number' ? pkg.sequence : 0,
    prev: null,
  });

  const compare = (label: string, a: unknown, b: unknown) => {
    const sa = stableStringify(a);
    const sb = stableStringify(b);
    if (sa !== sb) {
      throw new ReleaseParseError(`发布包${label}与重建结果不一致，制品可能已被改动`);
    }
  };
  compare('的内容校验值', pkg.contentChecksum, rebuilt.contentChecksum);
  compare('快照', pkg.payload, rebuilt.payload);
  compare('的字形清单', pkg.manifest, rebuilt.manifest);
  compare('的阶段取形记录', pkg.fallbackRecords, rebuilt.fallbackRecords);

  // 报告：文件中的报告必须等于「对该快照重新校验」的报告
  compare('的校验报告', pkg.report, rebuilt.report);

  // 差异：校验结构完整；其字节已被全包校验值覆盖，篡改即导致校验值不符
  if (pkg.diff === null) {
    if (rebuilt.diff !== null) throw new ReleaseParseError('发布包差异字段与重建结果不一致');
  } else {
    const d = pkg.diff;
    for (const key of ['stages', 'radicals', 'lexemes'] as const) {
      const sec = d[key] as unknown;
      if (!sec || typeof sec !== 'object') throw new ReleaseParseError(`发布包差异.${key} 已损坏`);
      for (const k of ['added', 'removed', 'changed'] as const) {
        const arr = (sec as Record<string, unknown>)[k];
        if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
          throw new ReleaseParseError(`发布包差异.${key}.${k} 已损坏`);
        }
      }
    }
    for (const k of ['layout', 'paths', 'affectedRadicals', 'affectedLexemes'] as const) {
      const arr = d[k] as unknown;
      if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) {
        throw new ReleaseParseError(`发布包差异.${k} 已损坏`);
      }
    }
    if (
      typeof d.unchanged !== 'boolean' ||
      (d.fromChecksum !== null && typeof d.fromChecksum !== 'string') ||
      (d.fromSequence !== null && typeof d.fromSequence !== 'number')
    ) {
      throw new ReleaseParseError('发布包差异头部已损坏');
    }

    // 内部一致性：新增/修改项必须存在于本包，删除项必须不在本包；
    // unchanged=true 时所有增删改必须为空。
    const stageIds = new Set(pkg.payload.stages.map((s) => s.id));
    const radicalIds = new Set(pkg.payload.radicals.map((r) => r.id));
    const lexemeIds = new Set(pkg.payload.lexemes.map((l) => l.id));
    const checkSection = (
      label: string,
      sec: { added: string[]; removed: string[]; changed: string[] },
      ids: Set<string>
    ) => {
      for (const id of sec.added) if (!ids.has(id)) throw new ReleaseParseError(`差异.${label}.added 引用了包内不存在的对象 ${id}`);
      for (const id of sec.changed) if (!ids.has(id)) throw new ReleaseParseError(`差异.${label}.changed 引用了包内不存在的对象 ${id}`);
      for (const id of sec.removed) if (ids.has(id)) throw new ReleaseParseError(`差异.${label}.removed 与包内快照矛盾（对象仍存在）${id}`);
    };
    checkSection('stages', d.stages, stageIds);
    checkSection('radicals', d.radicals, radicalIds);
    checkSection('lexemes', d.lexemes, lexemeIds);
    for (const id of d.layout) if (!lexemeIds.has(id)) throw new ReleaseParseError(`差异.layout 引用了包内不存在的词条 ${id}`);
    for (const id of d.paths) if (!radicalIds.has(id)) throw new ReleaseParseError(`差异.paths 引用了包内不存在的字根 ${id}`);
    for (const id of d.affectedRadicals) {
      if (!radicalIds.has(id) && !d.radicals.removed.includes(id)) {
        throw new ReleaseParseError(`差异.affectedRadicals 引用无法解释：${id}`);
      }
    }
    for (const id of d.affectedLexemes) {
      if (!lexemeIds.has(id) && !d.lexemes.removed.includes(id)) {
        throw new ReleaseParseError(`差异.affectedLexemes 引用无法解释：${id}`);
      }
    }
    if (d.unchanged) {
      const total =
        d.stages.added.length + d.stages.removed.length + d.stages.changed.length +
        d.radicals.added.length + d.radicals.removed.length + d.radicals.changed.length +
        d.lexemes.added.length + d.lexemes.removed.length + d.lexemes.changed.length;
      if (total !== 0 || d.layout.length !== 0 || d.paths.length !== 0) {
        throw new ReleaseParseError('差异声称无变化，却列出了增删改条目');
      }
    }

    // 若本地正好存有差异基准包，则按两端快照重建差异并逐字节比对
    const basis = context?.prev ?? null;
    if (basis && d.fromChecksum === basis.checksum) {
      const rebuiltDiff = diffPackages(basis, pkg as ReleasePackage);
      if (stableStringify(rebuiltDiff) !== stableStringify(d)) {
        throw new ReleaseParseError('发布包差异与两端快照重建结果不一致');
      }
    }
  }

  // 3) 全包校验值：对除 sequence/checksum 外的全部字段复算
  const expectedChecksum = await checksumForArtifact({
    format: pkg.format,
    formatVersion: pkg.formatVersion,
    contentChecksum: pkg.contentChecksum,
    payload: pkg.payload,
    manifest: pkg.manifest,
    fallbackRecords: pkg.fallbackRecords,
    report: pkg.report,
    diff: pkg.diff,
  });
  if (expectedChecksum !== pkg.checksum) {
    throw new ReleaseParseError('全包校验值不一致：制品内容可能已被篡改或损坏');
  }

  return pkg as ReleasePackage;
}

// ── 展示辅助 ────────────────────────────────────────────────────────

export function releaseRadicalName(pkg: ReleasePackage, id: string): string {
  return pkg.payload.radicals.find((r) => r.id === id)?.name ?? id;
}

export function releaseStageName(pkg: ReleasePackage, id: string): string {
  return pkg.payload.stages.find((s) => s.id === id)?.name ?? id;
}

/** 词条可读标签：读音【字根串】 */
export function releaseLexemeLabel(pkg: ReleasePackage, id: string): string {
  const l = pkg.payload.lexemes.find((x) => x.id === id);
  if (!l) return id;
  return `${l.pronunciation}【${l.radicalNames.join('')}】`;
}

/** 优先在新包中取名，找不到再查旧包 */
export function nameAcross(
  next: ReleasePackage,
  prev: ReleasePackage | null,
  kind: 'radical' | 'stage' | 'lexeme',
  id: string
): string {
  if (kind === 'radical') {
    return (
      next.payload.radicals.find((r) => r.id === id)?.name ??
      prev?.payload.radicals.find((r) => r.id === id)?.name ??
      id
    );
  }
  if (kind === 'stage') {
    return (
      next.payload.stages.find((s) => s.id === id)?.name ??
      prev?.payload.stages.find((s) => s.id === id)?.name ??
      id
    );
  }
  const l = next.payload.lexemes.find((x) => x.id === id) ?? prev?.payload.lexemes.find((x) => x.id === id);
  return l ? `${l.pronunciation}【${l.radicalNames.join('')}】` : id;
}
