import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  WritingSystemStore,
  Radical,
  Lexeme,
  CompositionLayout,
  PublishResult,
  ReleasePackage,
} from '@/types';
import { generateId } from '@/utils/glyphUtils';
import { MOCK_STAGES, MOCK_RADICALS, MOCK_LEXEMES } from '@/utils/mockData';
import { buildReleasePackage, parseReleasePackage } from '@/utils/releaseUtils';

const STORAGE_KEY = 'fictional-writing-system-v1';

const getInitialState = () => ({
  stages: MOCK_STAGES,
  radicals: MOCK_RADICALS,
  lexemes: MOCK_LEXEMES,
  releases: [] as ReleasePackage[],
  selectedRadicalId: null as string | null,
  selectedStageId: MOCK_STAGES[MOCK_STAGES.length - 1]?.id || null,
  composingRadicalIds: [] as string[],
  composingLayout: 'horizontal' as CompositionLayout,
});

export const useWritingSystemStore = create<WritingSystemStore>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      addStage: (s) =>
        set((state) => ({
          stages: [...state.stages, { ...s, id: generateId() }].sort((a, b) => a.order - b.order),
        })),

      updateStage: (id, patch) =>
        set((state) => ({
          stages: state.stages.map((st) => (st.id === id ? { ...st, ...patch } : st)),
        })),

      removeStage: (id) =>
        set((state) => ({
          stages: state.stages.filter((st) => st.id !== id),
          radicals: state.radicals.map((r) => ({
            ...r,
            variants: r.variants.filter((v) => v.stageId !== id),
          })),
          selectedStageId: state.selectedStageId === id ? null : state.selectedStageId,
        })),

      addRadical: (r) => {
        const id = generateId();
        const now = Date.now();
        const newRadical: Radical = {
          ...r,
          id,
          createdAt: now,
          updatedAt: now,
        };
        set((state) => ({
          radicals: [...state.radicals, newRadical],
        }));
        return id;
      },

      updateRadical: (id, patch) =>
        set((state) => ({
          radicals: state.radicals.map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r
          ),
        })),

      removeRadical: (id) =>
        set((state) => ({
          radicals: state.radicals.filter((r) => r.id !== id),
          lexemes: state.lexemes.map((l) => ({
            ...l,
            radicalIds: l.radicalIds.filter((rid) => rid !== id),
          })),
          selectedRadicalId: state.selectedRadicalId === id ? null : state.selectedRadicalId,
          composingRadicalIds: state.composingRadicalIds.filter((rid) => rid !== id),
        })),

      addLexeme: (l) => {
        const id = generateId();
        const newLexeme: Lexeme = {
          ...l,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          lexemes: [...state.lexemes, newLexeme],
        }));
        return id;
      },

      updateLexeme: (id, patch) =>
        set((state) => ({
          lexemes: state.lexemes.map((l) => (l.id === id ? { ...l, ...patch } : l)),
        })),

      removeLexeme: (id) =>
        set((state) => ({
          lexemes: state.lexemes.filter((l) => l.id !== id),
        })),

      selectRadical: (id) => set({ selectedRadicalId: id }),
      selectStage: (id) => set({ selectedStageId: id }),

      addToComposer: (radicalId) =>
        set((state) => ({
          composingRadicalIds: [...state.composingRadicalIds, radicalId],
        })),

      removeFromComposer: (index) =>
        set((state) => ({
          composingRadicalIds: state.composingRadicalIds.filter((_, i) => i !== index),
        })),

      clearComposer: () => set({ composingRadicalIds: [] }),

      moveInComposer: (fromIndex, toIndex) =>
        set((state) => {
          const arr = [...state.composingRadicalIds];
          if (fromIndex < 0 || fromIndex >= arr.length) return state;
          if (toIndex < 0 || toIndex >= arr.length) return state;
          const [moved] = arr.splice(fromIndex, 1);
          arr.splice(toIndex, 0, moved);
          return { composingRadicalIds: arr };
        }),

      setComposingLayout: (layout) => set({ composingLayout: layout }),

      exportData: () => {
        const state = get();
        return JSON.stringify(
          {
            stages: state.stages,
            radicals: state.radicals,
            lexemes: state.lexemes,
            exportedAt: new Date().toISOString(),
          },
          null,
          2
        );
      },

      importData: (json) => {
        try {
          const parsed = JSON.parse(json);
          if (!parsed.stages || !parsed.radicals || !parsed.lexemes) {
            throw new Error('Invalid data format');
          }
          set({
            stages: parsed.stages,
            radicals: parsed.radicals,
            lexemes: parsed.lexemes,
            selectedRadicalId: null,
            selectedStageId: parsed.stages[parsed.stages.length - 1]?.id || null,
            composingRadicalIds: [],
          });
        } catch (e) {
          console.error('Import failed:', e);
          throw e;
        }
      },

      resetAll: () =>
        set((state) => ({
          ...getInitialState(),
          // 已发布包为只读存档，重置工作数据时保留
          releases: state.releases,
        })),

      publishRelease: async () => {
        const state = get();
        // 上一包 = 序号最大者（删除中间包后序号可能不连续，max+1 保证唯一可比较）
        const prev = state.releases.reduce<ReleasePackage | null>(
          (m, p) => (!m || p.sequence > m.sequence ? p : m),
          null
        );
        const sequence = (prev?.sequence ?? 0) + 1;

        let pkg: ReleasePackage;
        try {
          pkg = await buildReleasePackage(
            { stages: state.stages, radicals: state.radicals, lexemes: state.lexemes },
            { sequence, prev }
          );
        } catch (e) {
          // 校验失败：当前数据与既有发布包均保持不变
          if (e instanceof Error && e.name === 'ReleaseValidationError') {
            const issues = (e as unknown as { issues: PublishResult['issues'] }).issues;
            return { ok: false, issues };
          }
          throw e;
        }

        // 同一份字系重复发布（含清空存档后重建）：内容校验值相同即返回既有包，
        // 不产生新包；空存档时构建结果是数据的纯函数，字节必然一致
        const existing = get().releases.find((r) => r.contentChecksum === pkg.contentChecksum);
        if (existing) {
          return { ok: true, pkg: existing, unchanged: true, issues: [] };
        }

        set((s) => ({ releases: [...s.releases, pkg] }));
        return { ok: true, pkg, unchanged: false, issues: [] };
      },

      importReleasePackage: async (json) => {
        // 若本地恰好存有该包差异引用的基准包，连差异也一起按快照重建比对
        let basis: ReleasePackage | null = null;
        try {
          const head = JSON.parse(json) as { diff?: { fromChecksum?: string | null } | null };
          const from = head?.diff?.fromChecksum ?? null;
          basis = from ? get().releases.find((r) => r.checksum === from) ?? null : null;
        } catch {
          // 交给 parseReleasePackage 报「非法 JSON」
        }
        // parseReleasePackage 已做：结构检查 + 发布门禁 + 重建比对 + 全包校验值复核（含差异）
        const pkg = await parseReleasePackage(json, { prev: basis });
        const state = get();
        if (state.releases.some((r) => r.checksum === pkg.checksum)) {
          throw new Error('该发布包已在发布台中（校验值相同）');
        }
        // 序号不参与全包校验值：缺失/越界/与本地冲突时重编为 max+1，
        // 保证删除中间包或跨存档导入后序号始终唯一、可比较。
        const used = new Set(state.releases.map((r) => r.sequence));
        const maxSeq = state.releases.reduce((m, r) => Math.max(m, r.sequence), 0);
        let stored = pkg;
        if (
          typeof pkg.sequence !== 'number' ||
          !Number.isInteger(pkg.sequence) ||
          pkg.sequence <= 0 ||
          used.has(pkg.sequence)
        ) {
          stored = { ...pkg, sequence: maxSeq + 1 };
        }
        set((s) => ({ releases: [...s.releases, stored] }));
        return stored;
      },

      removeRelease: (checksum) =>
        set((state) => ({
          releases: state.releases.filter((r) => r.checksum !== checksum),
        })),

      serializeRelease: (checksum) => {
        const pkg = get().releases.find((r) => r.checksum === checksum);
        if (!pkg) throw new Error('发布包不存在');
        return JSON.stringify(pkg, null, 2);
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({
        stages: state.stages,
        radicals: state.radicals,
        lexemes: state.lexemes,
        releases: state.releases,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 兼容旧版本存档：无发布包字段时补空数组；
          // 清理早期形态（缺 contentChecksum）的过渡发布包
          if (!Array.isArray(state.releases)) {
            state.releases = [];
          } else {
            state.releases = state.releases.filter(
              (r) => r && r.format === 'glyph-evolution-release' && typeof r.contentChecksum === 'string'
            );
          }
          if (!state.selectedStageId && state.stages.length > 0) {
            state.selectedStageId = state.stages[state.stages.length - 1].id;
          }
        }
      },
    }
  )
);
