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
  a.name !== b.name ? a.name < b.name ? -1 : 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const stripUndefined = <T extends object>(obj: T): T => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as T;
};

// ── 路径越界检查 ────────────────────────────────────────────────────

/** 每个路径命令每一轮消耗的数字个数（A 的 rx/ry/旋转/标志位不参与越界判断） */
const COMMAND_ARGS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

type PathToken = { type: 'cmd'; cmd: string } | { type: 'num'; n: number };

/**
 * 解析 SVG path，检查每个落笔画布的坐标是否在 0–100 画框内。
 * 支持绝对/绝对命令与隐式重复；返回越界坐标描述列表；空路径也算非法。
 */
export function checkPathBounds(
  svgPath: string
): { x: number; y: number; raw: string }[] {
  const violations: { x: number; y: number; raw: string }[] = [];
  const raw = svgPath ?? '';
  if (!raw.trim()) {
    return [{ x: NaN, y: NaN, raw: '' }];
  }

  const tokens: PathToken[] = [];
  const tokenRe = /[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g;
  let tm: RegExpExecArray | null;
  while ((tm = tokenRe.exec(raw))) {
    if (/[a-zA-Z]/.test(tm[0])) tokens.push({ type: 'cmd', cmd: tm[0] });
    else tokens.push({ type: 'num', n: Number(tm[0]) });
  }

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;

  const inBounds = (v: number) => v >= -PATH_EPS && v <= PATH_BOUND + PATH_EPS;
  const flag = (x: number, y: number) => {
    if (!inBounds(x) || !inBounds(y)) {
      violations.push({ x, y, raw: `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}` });
    }
  };
  const round1 = (v: number) => Math.round(v * 1e6) / 1e6;

  while (i < tokens.length) {
    const t = tokens[i++];
    if (t.type !== 'cmd') continue;
    const cmd = t.cmd.toUpperCase();
    const rel = t.cmd === t.cmd.toLowerCase() && t.cmd !== t.cmd.toUpperCase();
    const argc = COMMAND_ARGS[cmd];
    if (argc === undefined) continue;

    // 数字命令可隐式重复（如 M 后跟多对坐标）
    do {
      const nums: number[] = [];
      while (nums.length < argc && i < tokens.length && tokens[i].type === 'num') {
        nums.push((tokens[i] as { type: 'num'; n: number }).n);
        i++;
      }
      if (nums.length < argc) break;

      const resolve = (idx: number, cur: number) =>
        rel ? round1(cur + nums[idx]) : round1(nums[idx]);

      switch (cmd) {
        case 'M': {
          const x = resolve(0, cx);
          const y = resolve(1, cy);
          flag(x, y);
          cx = x; cy = y; sx = x; sy = y;
          break;
        }
        case 'L':
        case 'T': {
          const x = resolve(0, cx);
          const y = resolve(1, cy);
          flag(x, y);
          cx = x; cy = y;
          break;
        }
        case 'H': {
          const x = resolve(0, cx);
          flag(x, cy);
          cx = x;
          break;
        }
        case 'V': {
          const y = resolve(0, cy);
          flag(cx, y);
          cy = y;
          break;
        }
        case 'C': {
          for (let p = 0; p < 3; p++) flag(resolve(p * 2, cx), resolve(p * 2 + 1, cy));
          cx = resolve(4, cx); cy = resolve(5, cy);
          break;
        }
        case 'S':
        case 'Q': {
          flag(resolve(0, cx), resolve(1, cy));
          const x = resolve(2, cx);
          const y = resolve(3, cy);
          flag(x, y);
          cx = x; cy = y;
          break;
        }
        case 'A': {
          // 仅终点（最后两个参数）落笔画布
          const x = resolve(5, cx);
          const y = resolve(6, cy);
          flag(x, y);
          cx = x; cy = y;
          break;
        }
        case 'Z': {
          cx = sx; cy = sy;
          break;
        }
      }
    } while (i < tokens.length && tokens[i].type === 'num');
  }

  return violations;
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

  // 1. 重名（先做，后续报告按规则顺序汇总）
  const dupNameIssues: ReleaseCheckIssue[] = [];
  const seenStageName = new Map<string, string>();
  const seenStageId = new Set<string>();
  for (const s of stages) {
    const key = s.name.trim();
    const first = seenStageName.get(key);
    if (first) {
      dupNameIssues.push({
        code: 'duplicate-name',
        level: 'error',
        target: 'stage',
        targetId: s.id,
        ref: s.name,
        message: `阶段「${s.name}」与「${first}」重名`,
      });
    } else {
      seenStageName.set(key, s.name);
    }
    if (seenStageId.has(s.id)) {
      dupNameIssues.push({
        code: 'duplicate-name',
        level: 'error',
        target: 'stage',
        targetId: s.id,
        ref: s.id,
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
        code: 'duplicate-name',
        level: 'error',
        target: 'radical',
        targetId: r.id,
        ref: r.name,
        message: `字根「${r.name}」与「${first}」重名`,
      });
    } else {
      seenRadicalName.set(key, r.name);
    }
    if (seenRadicalId.has(r.id)) {
      dupNameIssues.push({
        code: 'duplicate-name',
        level: 'error',
        target: 'radical',
        targetId: r.id,
        ref: r.id,
        message: `字根 id 重复：${r.id}`,
      });
    }
    seenRadicalId.add(r.id);
  }

  // 词条重名：构件序列与读音均相同视为同一个词
  const seenLexemeKey = new Map<string, string>();
  const seenLexemeId = new Set<string>();
  for (const l of lexemes) {
    const key = `${l.radicalIds.join('>')}|${l.layout}|${l.pronunciation.trim()}`;
    const first = seenLexemeKey.get(key);
    const label = `【${l.pronunciation}】${l.meaning.split('；')[0]}`;
    if (first) {
      dupNameIssues.push({
        code: 'duplicate-name',
        level: 'error',
        target: 'lexeme',
        targetId: l.id,
        ref: label,
        message: `词条 ${label} 与 ${first} 重复（构件、布局、读音相同）`,
      });
    } else {
      seenLexemeKey.set(key, label);
    }
    if (seenLexemeId.has(l.id)) {
      dupNameIssues.push({
        code: 'duplicate-name',
        level: 'error',
        target: 'lexeme',
        targetId: l.id,
        ref: l.id,
        message: `词条 id 重复：${l.id}`,
      });
    }
    seenLexemeId.add(l.id);
  }

  // 同一字根在同一阶段登记多条字形
  for (const r of radicals) {
    const seen = new Set<string>();
    for (const v of r.variants) {
      if (seen.has(v.stageId)) {
        dupNameIssues.push({
          code: 'duplicate-name',
          level: 'error',
          target: 'variant',
          targetId: r.id,
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
        code: 'broken-link',
        level: 'error',
        target: 'lexeme',
        targetId: l.id,
        ref: l.meaning.split('；')[0] || l.id,
        message: `词条「${l.meaning.split('；')[0] || l.id}」未包含任何字根`,
      });
    }
    for (const rid of l.radicalIds) {
      if (!radicalIds.has(rid)) {
        brokenIssues.push({
          code: 'broken-link',
          level: 'error',
          target: 'lexeme',
          targetId: l.id,
          ref: rid,
          message: `词条「${l.meaning.split('；')[0] || l.id}」引用了不存在的字根 ${rid}`,
        });
      }
    }
  }
  for (const r of radicals) {
    for (const v of r.variants) {
      if (!stageIds.has(v.stageId)) {
        brokenIssues.push({
          code: 'broken-link',
          level: 'error',
          target: 'variant',
          targetId: r.id,
          ref: v.stageId,
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
          code: 'missing-stage-glyph',
          level: 'error',
          target: 'radical',
          targetId: r.id,
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
        code: 'too-many-components',
        level: 'error',
        target: 'lexeme',
        targetId: l.id,
        ref: l.meaning.split('；')[0] || l.id,
        message: `词条「${l.meaning.split('；')[0] || l.id}」包含 ${l.radicalIds.length} 个构件，超过上限 ${MAX_COMPONENTS} 个`,
      });
    }
  }

  // 5. 路径越界
  const pathIssues: ReleaseCheckIssue[] = [];
  const pushPath = (
    target: 'radical' | 'variant',
    r: Pick<Radical, 'id' | 'name' | 'baseShape' | 'variants'>,
    stageName: string | null,
    svgPath: string
  ) => {
    const violations = checkPathBounds(svgPath);
    for (const v of violations) {
      pathIssues.push({
        code: 'path-out-of-bounds',
        level: 'error',
        target,
        targetId: r.id,
        ref: stageName ? `${r.name}/${stageName}` : r.name,
        message:
          v.raw === '' && Number.isNaN(v.x)
            ? `字根「${r.name}」${stageName ? `在阶段「${stageName}」` : '的基础字形'}路径为空`
            : `字根「${r.name}」${stageName ? `在阶段「${stageName}」` : '的基础字形'}的路径坐标 (${v.raw}) 超出 0–${PATH_BOUND} 画框`,
      });
    }
  };
  for (const r of radicals) {
    pushPath('radical', r, null, r.baseShape);
    for (const v of r.variants) {
      const stage = stages.find((s) => s.id === v.stageId);
      pushPath('variant', r, stage?.name ?? v.stageId, v.svgPath);
    }
  }

  // 按固定规则顺序汇总，保证报告确定性
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

// ── 稳定序列化与校验值 ──────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** 仅纳入语义内容：时间戳、序号、报告、差异均不参与校验值 */
function semanticProjection(n: Normalized) {
  return {
    format: RELEASE_FORMAT,
    formatVersion: RELEASE_FORMAT_VERSION,
    stages: n.stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order,
      description: s.description,
      color: s.color,
    })),
    radicals: n.radicals.map((r) => ({
      id: r.id,
      name: r.name,
      meaning: r.meaning,
      pronunciation: r.pronunciation,
      category: r.category,
      baseShape: r.baseShape,
      variants: r.variants.map((v) => ({ stageId: v.stageId, svgPath: v.svgPath, note: v.note })),
    })),
    lexemes: n.lexemes.map((l) => ({
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
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // 非安全上下文兜底（同步 Node 环境不会走到这里，浏览器 http(s) 与 localhost 均为安全上下文）
  throw new Error('当前环境不支持 SHA-256 摘要计算');
}

export async function checksumForSource(src: ReleaseSource): Promise<string> {
  return sha256Hex(stableStringify(semanticProjection(normalize(src))));
}

/** 重新计算已发布包的校验值，用于导入时验真 */
export async function checksumForPackage(pkg: ReleasePackage): Promise<string> {
  return checksumForSource({
    stages: pkg.payload.stages,
    radicals: pkg.payload.radicals,
    lexemes: pkg.payload.lexemes.map((l) => ({
      id: l.id,
      radicalIds: l.radicalIds,
      layout: l.layout,
      pronunciation: l.pronunciation,
      meaning: l.meaning,
      example: l.example,
      note: l.note,
      writingRule: l.writingRule,
      createdAt: 0,
    })),
  });
}

// ── 字形清单与阶段回退记录 ──────────────────────────────────────────

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

function buildFallbackRecords(n: Normalized): StageFallbackEntry[] {
  const records: StageFallbackEntry[] = [];
  for (const s of n.stages) {
    const order = n.stageOrder.get(s.id) ?? 0;
    for (const r of n.radicals) {
      const exact = r.variants.find((v) => v.stageId === s.id);
      let entry: StageFallbackEntry;
      if (exact) {
        entry = { radicalId: r.id, radicalName: r.name, stageId: s.id, stageName: s.name, status: 'exact' };
      } else {
        // 回退到更早的最近阶段字形
        const earlier = n.stages
          .filter((es) => (n.stageOrder.get(es.id) ?? 0) < order)
          .reverse()
          .map((es) => ({ es, v: r.variants.find((v) => v.stageId === es.id) }))
          .find((x) => x.v);
        if (earlier?.v) {
          entry = {
            radicalId: r.id,
            radicalName: r.name,
            stageId: s.id,
            stageName: s.name,
            status: 'fallback',
            resolvedStageId: earlier.es.id,
            resolvedStageName: earlier.es.name,
          };
        } else if (r.baseShape.trim()) {
          entry = { radicalId: r.id, radicalName: r.name, stageId: s.id, stageName: s.name, status: 'base' };
        } else {
          entry = { radicalId: r.id, radicalName: r.name, stageId: s.id, stageName: s.name, status: 'missing' };
        }
      }
      records.push(entry);
    }
  }
  return records;
}

function buildReport(n: Normalized, issues: ReleaseCheckIssue[], now: string): ReleaseCheckReport {
  const counts = Object.fromEntries(CHECK_RULES.map((c) => [c, 0])) as Record<ReleaseCheckCode, number>;
  for (const i of issues) counts[i.code]++;
  return {
    ok: issues.length === 0,
    checkedAt: now,
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
  const byStage = new Map(r.variants.map((v) => [v.stageId, v.svgPath]));
  for (const [sid, path] of [...byStage.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
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
  // 字根增删改波及引用它的既有词条
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
    prev.checksum === next.checksum &&
    diff.stages.added.length + diff.stages.removed.length + diff.stages.changed.length === 0 &&
    diff.radicals.added.length + diff.radicals.removed.length + diff.radicals.changed.length === 0 &&
    diff.lexemes.added.length + diff.lexemes.removed.length + diff.lexemes.changed.length === 0;
  return diff;
}

// ── 构建发布包 ──────────────────────────────────────────────────────

export interface BuildReleaseOptions {
  sequence: number;
  prev: ReleasePackage | null;
  now: string;
}

/**
 * 编译只读发布包。
 * 任一硬性检查失败即抛出 ReleaseValidationError —— 调用方不得改动当前数据与旧包。
 */
export async function buildReleasePackage(
  src: ReleaseSource,
  opts: BuildReleaseOptions
): Promise<ReleasePackage> {
  const issues = validateWritingSystem(src);
  if (issues.length > 0) throw new ReleaseValidationError(issues);

  const n = normalize(src);
  const checksum = await sha256Hex(stableStringify(semanticProjection(n)));

  const base: ReleasePackage = {
    format: RELEASE_FORMAT,
    formatVersion: RELEASE_FORMAT_VERSION,
    sequence: opts.sequence,
    publishedAt: opts.now,
    checksum,
    payload: {
      stages: n.stages,
      radicals: n.radicals,
      lexemes: n.lexemes,
    },
    manifest: buildManifest(n),
    fallbackRecords: buildFallbackRecords(n),
    report: buildReport(n, issues, opts.now),
    diff: null,
  };
  base.diff = opts.prev ? diffPackages(opts.prev, base) : null;
  return base;
}

// ── 发布包解析与验真 ────────────────────────────────────────────────

export class ReleaseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseParseError';
  }
}

/** 解析并校验发布包文件（结构 + 稳定校验值） */
export async function parseReleasePackage(json: string): Promise<ReleasePackage> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ReleaseParseError('不是有效的 JSON 文件');
  }
  const pkg = raw as Partial<ReleasePackage>;
  if (!pkg || pkg.format !== RELEASE_FORMAT) {
    throw new ReleaseParseError('文件头标识不符，不是字形演化发布包');
  }
  if (pkg.formatVersion !== RELEASE_FORMAT_VERSION) {
    throw new ReleaseParseError(`不支持的发布包版本：${String(pkg.formatVersion)}`);
  }
  if (!pkg.checksum || typeof pkg.checksum !== 'string') {
    throw new ReleaseParseError('发布包缺少稳定校验值');
  }
  if (!pkg.payload || !Array.isArray(pkg.payload.stages) || !Array.isArray(pkg.payload.radicals) || !Array.isArray(pkg.payload.lexemes)) {
    throw new ReleaseParseError('发布包快照数据不完整');
  }
  if (!pkg.manifest || !Array.isArray(pkg.manifest.entries)) {
    throw new ReleaseParseError('发布包缺少字形清单');
  }
  if (!Array.isArray(pkg.fallbackRecords)) {
    throw new ReleaseParseError('发布包缺少阶段回退记录');
  }
  if (!pkg.report) {
    throw new ReleaseParseError('发布包缺少校验报告');
  }
  const actual = await checksumForPackage(pkg as ReleasePackage);
  if (actual !== pkg.checksum) {
    throw new ReleaseParseError('稳定校验值不一致：发布包内容可能已被篡改或损坏');
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
export function nameAcross(next: ReleasePackage, prev: ReleasePackage | null, kind: 'radical' | 'stage' | 'lexeme', id: string): string {
  if (kind === 'radical') {
    return next.payload.radicals.find((r) => r.id === id)?.name ??
      prev?.payload.radicals.find((r) => r.id === id)?.name ?? id;
  }
  if (kind === 'stage') {
    return next.payload.stages.find((s) => s.id === id)?.name ??
      prev?.payload.stages.find((s) => s.id === id)?.name ?? id;
  }
  const l = next.payload.lexemes.find((x) => x.id === id) ?? prev?.payload.lexemes.find((x) => x.id === id);
  return l ? `${l.pronunciation}【${l.radicalNames.join('')}】` : id;
}
