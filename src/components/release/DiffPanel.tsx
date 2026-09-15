import React from 'react';
import {
  GitCompare,
  PlusCircle,
  MinusCircle,
  PencilLine,
  LayoutGrid,
  Spline,
  AlertCircle,
  Minus,
} from 'lucide-react';
import type { ReleaseDiff, ReleasePackage } from '@/types';
import { LAYOUT_NAMES, nameAcross } from '@/utils/releaseUtils';

const nameOf = (
  next: ReleasePackage,
  prev: ReleasePackage | null,
  kind: 'radical' | 'stage' | 'lexeme',
  id: string
) => nameAcross(next, prev, kind, id);

const ChangeTag: React.FC<{ kind: 'added' | 'removed' | 'changed' }> = ({ kind }) => {
  const map = {
    added: { icon: <PlusCircle size={12} />, cls: 'bg-bronze-400/12 text-bronze-500 border-bronze-400/30', text: '新增' },
    removed: { icon: <MinusCircle size={12} />, cls: 'bg-ink-400/10 text-ink-400 border-ink-400/25', text: '删除' },
    changed: { icon: <PencilLine size={12} />, cls: 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30', text: '修改' },
  }[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border font-kai shrink-0 ${map.cls}`}>
      {map.icon}
      {map.text}
    </span>
  );
};

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  accent: string;
  rows: React.ReactNode[];
  emptyText: string;
}> = ({ title, icon, accent, rows, emptyText }) => (
  <div className="rounded-xl border border-parchment-300/50 bg-parchment-100/30 overflow-hidden">
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-parchment-300/40 bg-parchment-100/50">
      <span className={accent}>{icon}</span>
      <span className="font-kai text-sm font-bold text-ink-500">{title}</span>
      <span className="text-[11px] text-ink-200 font-song">{rows.length} 项</span>
    </div>
    {rows.length === 0 ? (
      <p className="px-4 py-4 text-xs text-ink-200 font-song flex items-center gap-1.5">
        <Minus size={12} />
        {emptyText}
      </p>
    ) : (
      <ul className="px-3 py-2.5 space-y-1.5 max-h-72 overflow-y-auto">{rows}</ul>
    )}
  </div>
);

/** 差异面板：next 相对于 prev（或发布时记录的 diff 基准）的变化 */
export const DiffPanel: React.FC<{
  next: ReleasePackage;
  prev: ReleasePackage | null;
  diff: ReleaseDiff | null;
}> = ({ next, prev, diff }) => {
  if (!diff) {
    return (
      <div className="rounded-2xl border border-dashed border-bronze-400/40 bg-bronze-400/6 p-8 text-center">
        <GitCompare size={28} className="mx-auto text-bronze-500 mb-2" />
        <p className="font-kai text-lg text-bronze-500">这是第一号发布包</p>
        <p className="font-song text-xs text-ink-300 mt-1">尚无更早的包可作对照。自第二号包起，此处将列出全部增删变化。</p>
      </div>
    );
  }

  const stageRows = [
    ...diff.stages.added.map((id) => ({ id, kind: 'added' as const })),
    ...diff.stages.removed.map((id) => ({ id, kind: 'removed' as const })),
    ...diff.stages.changed.map((id) => ({ id, kind: 'changed' as const })),
  ].map(({ id, kind }, i) => (
    <li key={`${kind}-${id}-${i}`} className="flex items-center gap-2 text-sm">
      <ChangeTag kind={kind} />
      <span className="font-kai text-ink-500">{nameOf(next, prev, 'stage', id)}</span>
      <span className="text-[10px] text-ink-200 font-song truncate">{id}</span>
    </li>
  ));

  const radicalRows = [
    ...diff.radicals.added.map((id) => ({ id, kind: 'added' as const })),
    ...diff.radicals.removed.map((id) => ({ id, kind: 'removed' as const })),
    ...diff.radicals.changed.map((id) => ({ id, kind: 'changed' as const })),
  ].map(({ id, kind }, i) => (
    <li key={`${kind}-${id}-${i}`} className="flex items-center gap-2 text-sm">
      <ChangeTag kind={kind} />
      <span className="font-kai text-ink-500">{nameOf(next, prev, 'radical', id)}</span>
      <span className="text-[10px] text-ink-200 font-song truncate">{id}</span>
    </li>
  ));

  const lexemeRows = [
    ...diff.lexemes.added.map((id) => ({ id, kind: 'added' as const })),
    ...diff.lexemes.removed.map((id) => ({ id, kind: 'removed' as const })),
    ...diff.lexemes.changed.map((id) => ({ id, kind: 'changed' as const })),
  ].map(({ id, kind }, i) => {
    return (
      <li key={`${kind}-${id}-${i}`} className="flex items-center gap-2 text-sm">
        <ChangeTag kind={kind} />
        <span className="font-kai text-vermilion-500">{nameOf(next, prev, 'lexeme', id)}</span>
      </li>
    );
  });

  const layoutRows = diff.layout.map((id, i) => {
    const before = prev?.payload.lexemes.find((x) => x.id === id);
    const after = next.payload.lexemes.find((x) => x.id === id);
    return (
      <li key={`${id}-${i}`} className="flex items-center gap-2 text-sm flex-wrap">
        <ChangeTag kind="changed" />
        <span className="font-kai text-ink-500">{nameOf(next, prev, 'lexeme', id)}</span>
        <span className="text-xs font-song text-ink-300">
          {before ? LAYOUT_NAMES[before.layout] : '—'}
          <span className="mx-1.5 text-vermilion-500">→</span>
          {after ? LAYOUT_NAMES[after.layout] : '—'}
        </span>
      </li>
    );
  });

  const pathRows = diff.paths.map((id, i) => (
    <li key={`${id}-${i}`} className="flex items-center gap-2 text-sm">
      <ChangeTag kind="changed" />
      <span className="font-kai text-ink-500">{nameOf(next, prev, 'radical', id)}</span>
      <span className="text-[10px] text-ink-200 font-song">基础字形或阶段字形路径有变化</span>
    </li>
  ));

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <GitCompare size={18} className="text-vermilion-500" />
        <h3 className="font-kai text-lg font-bold text-ink-500">与上一包对照</h3>
        {prev && (
          <span className="text-xs font-song text-ink-300">
            第 {prev.sequence} 包
            <span className="mx-1.5 text-vermilion-500">→</span>
            第 {next.sequence} 包
          </span>
        )}
        {diff.unchanged && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-bronze-400/12 text-bronze-500 border border-bronze-400/30 font-kai">
            两包内容一致
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="阶段" icon={<AlertCircle size={14} />} accent="text-[#8B5A2B]" rows={stageRows} emptyText="阶段无增删变化" />
        <Section title="字根" icon={<PencilLine size={14} />} accent="text-vermilion-500" rows={radicalRows} emptyText="字根无增删变化" />
        <Section title="词条" icon={<LayoutGrid size={14} />} accent="text-bronze-500" rows={lexemeRows} emptyText="词条无增删变化" />
        <Section title="布局变化" icon={<LayoutGrid size={14} />} accent="text-bronze-500" rows={layoutRows} emptyText="无词条布局变化" />
        <div className="lg:col-span-2">
          <Section title="路径变化（字形笔画）" icon={<Spline size={14} />} accent="text-ink-400" rows={pathRows} emptyText="无字形路径变化" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-vermilion-500/25 bg-vermilion-500/5 px-4 py-3">
          <h4 className="font-kai text-sm font-bold text-vermilion-500 mb-2">受影响字根（{diff.affectedRadicals.length}）</h4>
          {diff.affectedRadicals.length === 0 ? (
            <p className="text-[11px] text-ink-200 font-song">无</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {diff.affectedRadicals.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-lg bg-parchment-50 border border-parchment-300/60 font-kai text-ink-500"
                >
                  {next.payload.radicals.find((r) => r.id === id)?.name ??
                    prev?.payload.radicals.find((r) => r.id === id)?.name ??
                    id}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-bronze-500/25 bg-bronze-400/6 px-4 py-3">
          <h4 className="font-kai text-sm font-bold text-bronze-500 mb-2">受影响词条（{diff.affectedLexemes.length}）</h4>
          {diff.affectedLexemes.length === 0 ? (
            <p className="text-[11px] text-ink-200 font-song">无</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {diff.affectedLexemes.map((id) => {
                const l = next.payload.lexemes.find((x) => x.id === id) ?? prev?.payload.lexemes.find((x) => x.id === id);
                return (
                  <span
                    key={id}
                    className="text-xs px-2 py-0.5 rounded-lg bg-parchment-50 border border-parchment-300/60 font-kai text-vermilion-500"
                  >
                    {l ? `【${l.radicalNames.join('')}】${l.pronunciation}` : id}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
