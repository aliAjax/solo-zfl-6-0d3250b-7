import React, { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronRight, ScanSearch, Loader2 } from 'lucide-react';
import { useWritingSystemStore } from '@/store/useWritingSystemStore';
import { CHECK_LABELS, CHECK_RULES, validateWritingSystem } from '@/utils/releaseUtils';
import type { ReleaseCheckCode, ReleaseCheckIssue } from '@/types';

const ISSUE_BADGE: Record<ReleaseCheckCode, string> = {
  'broken-link': 'bg-vermilion-500/12 text-vermilion-500 border-vermilion-500/30',
  'missing-stage-glyph': 'bg-[#8B5A2B]/12 text-[#8B5A2B] border-[#8B5A2B]/30',
  'duplicate-name': 'bg-bronze-500/12 text-bronze-500 border-bronze-500/30',
  'too-many-components': 'bg-parchment-400/20 text-parchment-500 border-parchment-400/40',
  'path-out-of-bounds': 'bg-ink-400/12 text-ink-400 border-ink-400/30',
};

const groupIssues = (issues: ReleaseCheckIssue[]) => {
  const map = new Map<ReleaseCheckCode, ReleaseCheckIssue[]>();
  for (const code of CHECK_RULES) map.set(code, []);
  for (const i of issues) map.get(i.code)?.push(i);
  return map;
};

export const CheckPanel: React.FC<{
  /** 最近一次发布尝试的结果（仅用于提示），校验始终基于当前实时数据 */
  publishError: string | null;
  publishing: boolean;
  unchanged: boolean;
  onPublish: () => void;
}> = ({ publishError, publishing, unchanged, onPublish }) => {
  const stages = useWritingSystemStore((s) => s.stages);
  const radicals = useWritingSystemStore((s) => s.radicals);
  const lexemes = useWritingSystemStore((s) => s.lexemes);

  const [expanded, setExpanded] = useState(true);

  const issues = useMemo(
    () => validateWritingSystem({ stages, radicals, lexemes }),
    [stages, radicals, lexemes]
  );
  const groups = useMemo(() => groupIssues(issues), [issues]);
  const ok = issues.length === 0;

  return (
    <div
      className={`bg-parchment-50 rounded-2xl shadow-scroll border-2 overflow-hidden animate-fade-up ${
        ok ? 'border-bronze-400/40' : 'border-vermilion-500/40'
      }`}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-parchment-100/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          {ok ? (
            <ShieldCheck size={24} className="text-bronze-500" />
          ) : (
            <ShieldAlert size={24} className="text-vermilion-500" />
          )}
          <div>
            <h3 className="font-kai text-lg font-bold text-ink-500 flex items-center gap-2">
              发布前校验
              <span
                className={`text-xs px-2 py-0.5 rounded-full border font-song ${
                  ok
                    ? 'bg-bronze-400/12 text-bronze-500 border-bronze-400/30'
                    : 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30'
                }`}
              >
                {ok ? '五项全过' : `${issues.length} 项待修`}
              </span>
            </h3>
            <p className="text-xs text-ink-300 font-song mt-0.5">
              断链 · 缺失阶段字形 · 重名 · 构件超过二十四个 · 路径越界
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {expanded ? <ChevronDown size={18} className="text-ink-300" /> : <ChevronRight size={18} className="text-ink-300" />}
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {CHECK_RULES.map((code) => {
              const count = groups.get(code)?.length ?? 0;
              const pass = count === 0;
              return (
                <div
                  key={code}
                  className={`rounded-xl border px-3 py-2.5 text-center ${
                    pass
                      ? 'bg-bronze-400/8 border-bronze-400/25'
                      : 'bg-vermilion-500/6 border-vermilion-500/25'
                  }`}
                >
                  <div className={`text-lg font-bold font-kai ${pass ? 'text-bronze-500' : 'text-vermilion-500'}`}>
                    {pass ? '过' : count}
                  </div>
                  <div className="text-[11px] font-song text-ink-300 mt-0.5">{CHECK_LABELS[code]}</div>
                </div>
              );
            })}
          </div>

          {!ok && (
            <div className="max-h-64 overflow-y-auto rounded-xl border border-parchment-300/50 bg-parchment-100/40 divide-y divide-parchment-300/40">
              {[...groups.entries()].map(([code, list]) =>
                list.length === 0 ? null : (
                  <div key={code} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-md border font-kai ${ISSUE_BADGE[code]}`}>
                        {CHECK_LABELS[code]}
                      </span>
                      <span className="text-[11px] text-ink-300 font-song">{list.length} 条</span>
                    </div>
                    <ul className="space-y-1">
                      {list.slice(0, 50).map((it, idx) => (
                        <li key={idx} className="text-xs font-song text-ink-400 flex items-start gap-2">
                          <span className="text-vermilion-500 mt-0.5">✕</span>
                          <span>{it.message}</span>
                        </li>
                      ))}
                      {list.length > 50 && (
                        <li className="text-[11px] text-ink-200 font-song pl-5">……其余 {list.length - 50} 条略</li>
                      )}
                    </ul>
                  </div>
                )
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-ink-300 font-song flex items-center gap-1.5">
              <ScanSearch size={14} />
              校验基于当前字系实时计算；任一项失败时，发布将中止，当前数据与既有发布包均不变。
            </p>
            <button
              onClick={onPublish}
              disabled={!ok || publishing}
              className={`flex items-center gap-2 px-7 py-3 rounded-xl font-kai text-base border-2 transition-all duration-300 ${
                !ok || publishing
                  ? 'bg-parchment-200/60 text-ink-200 border-parchment-300/50 cursor-not-allowed'
                  : 'bg-vermilion-500 hover:bg-vermilion-600 text-parchment-50 border-vermilion-600/30 shadow-seal hover:scale-105 active:scale-95'
              }`}
            >
              {pendingIcon(publishing)}
              {ok ? '编译并发布只读包' : '存在校验问题，无法发布'}
            </button>
          </div>

          {unchanged && !publishError && (
            <p className="mt-3 text-xs text-bronze-500 font-song text-right">
              当前字系与上一发布包内容一致（校验值相同），未生成重复新包。
            </p>
          )}
          {publishError && (
            <p className="mt-3 text-xs text-vermilion-500 font-song text-right">{publishError}</p>
          )}
        </div>
      )}
    </div>
  );
};

const pendingIcon = (publishing: boolean) =>
  publishing ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />;
