import React, { useMemo, useState } from 'react';
import {
  ScrollText,
  History,
  ShieldCheck,
  GitCompare,
  Copy,
  Check,
  Download,
  Trash2,
  Lock,
  Fingerprint,
  Layers,
} from 'lucide-react';
import type { ReleasePackage } from '@/types';
import { CHECK_LABELS, diffPackages, releaseLexemeLabel } from '@/utils/releaseUtils';
import { PackageGlyph } from './PackageGlyph';
import { DiffPanel } from './DiffPanel';

type Tab = 'manifest' | 'fallback' | 'report' | 'diff';

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'manifest', label: '字形清单', icon: <ScrollText size={15} /> },
  { key: 'fallback', label: '阶段取形记录', icon: <History size={15} /> },
  { key: 'report', label: '校验报告', icon: <ShieldCheck size={15} /> },
  { key: 'diff', label: '与上一包对照', icon: <GitCompare size={15} /> },
];

export const PackageDetail: React.FC<{
  pkg: ReleasePackage;
  allPackages: ReleasePackage[];
  onExport: (pkg: ReleasePackage) => void;
  onDelete: (pkg: ReleasePackage) => void;
}> = ({ pkg, allPackages, onExport, onDelete }) => {
  const [tab, setTab] = useState<Tab>('manifest');
  const [copied, setCopied] = useState(false);

  // 对照基准：默认为本包记录的上一包，可切换为任意更早的包
  const bases = useMemo(
    () => allPackages.filter((p) => p.checksum !== pkg.checksum).sort((a, b) => b.sequence - a.sequence),
    [allPackages, pkg.checksum]
  );
  const [basisChecksum, setBasisChecksum] = useState<string | null>(
    pkg.diff?.fromChecksum ?? null
  );
  const basis =
    bases.find((p) => p.checksum === basisChecksum) ??
    bases.find((p) => p.checksum === pkg.diff?.fromChecksum) ??
    bases[0] ??
    null;

  const liveDiff = useMemo(
    () => (basis ? diffPackages(basis, pkg) : pkg.diff),
    [basis, pkg]
  );

  const sortedStages = useMemo(() => [...pkg.payload.stages].sort((a, b) => a.order - b.order), [pkg]);

  const copyChecksum = async () => {
    try {
      await navigator.clipboard.writeText(pkg.checksum);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默 */
    }
  };

  return (
    <div className="bg-parchment-50 rounded-2xl shadow-scroll border border-parchment-300/40 overflow-hidden animate-ink-spread">
      {/* 包封签 */}
      <div className="px-6 py-5 bg-gradient-to-b from-ink-500 to-ink-600 text-parchment-100">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Lock size={16} className="text-bronze-300" />
              <h3 className="font-kai text-2xl font-bold tracking-wider">
                第 {String(pkg.sequence).padStart(2, '0')} 号发布包
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-parchment-300/30 text-parchment-300/80 font-song flex items-center gap-1">
                <Lock size={10} />
                只读
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs text-parchment-300/70 font-song flex-wrap">
              <span className="flex items-center gap-1">
                <Layers size={12} />
                {pkg.report.summary.stages} 阶段 · {pkg.report.summary.radicals} 字根 ·{' '}
                {pkg.report.summary.lexemes} 词条 · {pkg.report.summary.glyphs} 字形
              </span>
              <span className="font-mono text-[10px] text-parchment-300/50">
                content {pkg.contentChecksum.slice(0, 16)}…
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onExport(pkg)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-parchment-100/10 hover:bg-parchment-100/20 border border-parchment-300/20 text-parchment-100 text-xs font-kai transition-all"
            >
              <Download size={14} />
              导出此包
            </button>
            <button
              onClick={() => onDelete(pkg)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-vermilion-500/20 hover:bg-vermilion-500/40 border border-vermilion-500/30 text-vermilion-400 text-xs font-kai transition-all"
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        </div>

        <button
          onClick={copyChecksum}
          title="点击复制校验值"
          className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-black/25 border border-parchment-300/15 hover:border-parchment-300/35 transition-all text-left group"
        >
          <Fingerprint size={14} className="text-bronze-300 shrink-0" />
          <code className="text-[11px] md:text-xs text-parchment-200/90 font-mono break-all leading-relaxed">
            {pkg.checksum}
          </code>
          {copied ? (
            <Check size={14} className="text-bronze-300 ml-auto shrink-0" />
          ) : (
            <Copy size={13} className="text-parchment-300/50 group-hover:text-parchment-200 ml-auto shrink-0" />
          )}
        </button>
      </div>

      {/* 标签栏 */}
      <div className="flex items-center gap-1 px-4 pt-3 border-b border-parchment-300/50 bg-parchment-100/40 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-t-lg font-kai text-sm whitespace-nowrap border-b-2 transition-all ${
              tab === t.key
                ? 'text-vermilion-500 border-vermilion-500 bg-parchment-50'
                : 'text-ink-300 border-transparent hover:text-ink-500'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-6">
        {tab === 'manifest' && <ManifestTab pkg={pkg} stages={sortedStages.map((s) => s.id)} />}
        {tab === 'fallback' && <FallbackTab pkg={pkg} />}
        {tab === 'report' && <ReportTab pkg={pkg} />}
        {tab === 'diff' && (
          <div>
            {bases.length > 0 && (
              <div className="flex items-center gap-2 mb-4 text-xs font-song text-ink-300 flex-wrap">
                <span>对照基准：</span>
                <select
                  value={basis?.checksum ?? ''}
                  onChange={(e) => setBasisChecksum(e.target.value || null)}
                  className="px-3 py-1.5 rounded-lg bg-parchment-100/60 border border-parchment-300/50 text-ink-500 font-kai focus:outline-none focus:ring-2 focus:ring-vermilion-500/30"
                >
                  {bases.map((p) => (
                    <option key={p.checksum} value={p.checksum}>
                      第 {String(p.sequence).padStart(2, '0')} 号包 · {p.report.summary.radicals} 字根 · {p.contentChecksum.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <span className="text-ink-200">（可任选已存档的另一包对照查看）</span>
              </div>
            )}
            <DiffPanel next={pkg} prev={basis} diff={liveDiff} />
            {basis && <SideBySideGlyphs next={pkg} prev={basis} />}
          </div>
        )}
      </div>
    </div>
  );
};

// ── 字形清单 ─────────────────────────────────────────────────────────

const ManifestTab: React.FC<{ pkg: ReleasePackage; stages: string[] }> = ({ pkg, stages }) => (
  <div>
    <p className="text-xs font-song text-ink-300 mb-4">
      共 {pkg.manifest.totalRadicals} 个字根、{pkg.manifest.totalGlyphs} 个阶段字形。下列字形全部取自本包快照，此后字根的任何改动都不会影响此包。
    </p>
    <div className="space-y-3">
      {pkg.manifest.entries.map((e) => (
        <div
          key={e.radicalId}
          className="rounded-xl border border-parchment-300/50 bg-parchment-100/30 p-4 flex items-start gap-4 flex-wrap"
        >
          <div className="flex items-center gap-3 min-w-[180px]">
            <div className="bg-parchment-50 rounded-lg border border-parchment-300/40 p-1.5 shadow-inner">
              <PackageGlyph pkg={pkg} radicalId={e.radicalId} size={52} strokeWidth={2.2} />
            </div>
            <div>
              <div className="font-kai text-xl font-bold text-ink-500 leading-tight">{e.radicalName}</div>
              <div className="text-[11px] text-vermilion-500 font-kai">[{e.pronunciation}]</div>
              <div className="text-[10px] text-ink-300 font-song">{e.category}字 · {e.variantCount} 字形</div>
            </div>
          </div>
          <div className="flex-1 flex items-end gap-2 flex-wrap">
            {stages.map((sid) => {
              const stage = pkg.payload.stages.find((s) => s.id === sid)!;
              const path = e.stageGlyphs[sid];
              return (
                <div key={sid} className="text-center">
                  <div className="text-[10px] font-kai mb-0.5" style={{ color: stage.color }}>
                    {stage.name}
                  </div>
                  <div
                    className={`rounded-lg border p-1 ${
                      path ? 'bg-parchment-50 border-parchment-300/40' : 'bg-parchment-100/40 border-parchment-300/20 opacity-40'
                    }`}
                  >
                    {path ? (
                      <PackageGlyph pkg={pkg} radicalId={e.radicalId} stageId={sid} size={40} strokeWidth={2} />
                    ) : (
                      <div className="w-10 h-10 flex items-center justify-center text-[10px] text-ink-200 font-kai">缺</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ── 阶段回退记录 ─────────────────────────────────────────────────────

const FallbackTab: React.FC<{ pkg: ReleasePackage }> = ({ pkg }) => {
  const stages = useMemo(() => [...pkg.payload.stages].sort((a, b) => a.order - b.order), [pkg]);
  const byStage = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of pkg.fallbackRecords) {
      const set = map.get(r.stageId) ?? new Set<string>();
      set.add(r.radicalId);
      map.set(r.stageId, set);
    }
    return map;
  }, [pkg]);

  return (
    <div>
      <p className="text-xs font-song text-ink-300 mb-4">
        记录每个字根在各阶段的取形来源。发布门禁要求每个字根在每个阶段都有专形，
        因此合法包内记录全部为
        <span className="text-bronze-500 font-kai"> 本相 </span>
        —— 回退/基础/缺形在门禁下不可达，不会进入发布包。共 {pkg.fallbackRecords.length} 条（
        {pkg.report.summary.radicals} 字根 × {stages.length} 阶段）。
      </p>

      <div className="overflow-x-auto rounded-xl border border-parchment-300/50">
        <table className="w-full text-sm border-collapse min-w-[560px]">
          <thead>
            <tr className="bg-parchment-100/60">
              <th className="text-left px-4 py-2.5 font-kai text-ink-400 text-xs border-b border-parchment-300/50">字根</th>
              {stages.map((stage) => (
                <th key={stage.id} className="px-3 py-2.5 font-kai text-xs border-b border-parchment-300/50" style={{ color: stage.color }}>
                  {stage.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pkg.manifest.entries.map((e) => (
              <tr key={e.radicalId} className="hover:bg-parchment-100/30">
                <td className="px-4 py-2 font-kai text-ink-500 border-b border-parchment-300/30 whitespace-nowrap">
                  <span className="inline-flex items-center gap-2">
                    <PackageGlyph pkg={pkg} radicalId={e.radicalId} size={22} strokeWidth={2} />
                    {e.radicalName}
                  </span>
                </td>
                {stages.map((stage) => {
                  const present = byStage.get(stage.id)?.has(e.radicalId);
                  return (
                    <td key={stage.id} className="px-3 py-2 text-center border-b border-parchment-300/30">
                      <span
                        title="该阶段专形"
                        className={`inline-block px-2 py-0.5 rounded-md border text-[10px] font-kai ${
                          present
                            ? 'bg-bronze-400/12 text-bronze-500 border-bronze-400/30'
                            : 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30'
                        }`}
                      >
                        {present ? '本相' : '缺形'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── 校验报告 ─────────────────────────────────────────────────────────

const ReportTab: React.FC<{ pkg: ReleasePackage }> = ({ pkg }) => {
  const { report } = pkg;
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl border font-kai text-sm ${
            report.ok
              ? 'bg-bronze-400/10 text-bronze-500 border-bronze-400/30'
              : 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30'
          }`}
        >
          <ShieldCheck size={16} />
          {report.ok ? '校验通过 · 五项硬性检查全部合格' : `校验未通过 · ${report.issues.length} 项问题`}
        </span>
        <span className="text-[11px] text-ink-200 font-song">报告由包内快照重新生成并纳入全包校验值</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {report.rules.map((code) => (
          <div key={code} className="rounded-xl border border-parchment-300/50 bg-parchment-100/30 px-3 py-2.5 text-center">
            <div className={`text-lg font-bold font-kai ${report.counts[code] === 0 ? 'text-bronze-500' : 'text-vermilion-500'}`}>
              {report.counts[code] === 0 ? '过' : report.counts[code]}
            </div>
            <div className="text-[11px] text-ink-300 font-song mt-0.5">{CHECK_LABELS[code]}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          ['阶段数', report.summary.stages],
          ['字根总数', report.summary.radicals],
          ['词条总数', report.summary.lexemes],
          ['阶段字形总数', report.summary.glyphs],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-ink-500 text-parchment-100 px-4 py-3 text-center">
            <div className="font-kai text-2xl font-bold">{value}</div>
            <div className="text-[10px] text-parchment-300/70 font-song mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {report.issues.length > 0 && (
        <div className="rounded-xl border border-vermilion-500/25 bg-vermilion-500/5 p-4">
          <h4 className="font-kai text-sm font-bold text-vermilion-500 mb-2">问题明细</h4>
          <ul className="space-y-1 max-h-56 overflow-y-auto">
            {report.issues.map((it, i) => (
              <li key={i} className="text-xs font-song text-ink-400 flex items-start gap-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-vermilion-500/30 text-vermilion-500 font-kai shrink-0">
                  {CHECK_LABELS[it.code]}
                </span>
                {it.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 rounded-xl border border-parchment-300/50 bg-parchment-100/30 p-4 space-y-3">
        <div>
          <h4 className="font-kai text-sm font-bold text-ink-500 mb-1.5 flex items-center gap-1.5">
            <Fingerprint size={14} className="text-vermilion-500" />
            全包校验值（SHA-256 · 验真用）
          </h4>
          <p className="text-[11px] font-song text-ink-300 mb-2">
            覆盖快照、字形清单、阶段取形记录、校验报告与差异；制品内任一字段被改动，导入都会被拒绝。
          </p>
          <code className="block text-[11px] font-mono text-ink-400 bg-parchment-50 border border-parchment-300/50 rounded-lg p-3 break-all">
            {pkg.checksum}
          </code>
        </div>
        <div>
          <h4 className="font-kai text-xs font-bold text-ink-400 mb-1">内容校验值（同字系判定用）</h4>
          <p className="text-[11px] font-song text-ink-300 mb-2">
            仅由阶段、字根、词条的语义内容决定；清空存档后同一份字系重新发布，必然得到相同结果，不受时间或历史存档影响。
          </p>
          <code className="block text-[11px] font-mono text-bronze-500 bg-parchment-50 border border-parchment-300/50 rounded-lg p-3 break-all">
            {pkg.contentChecksum}
          </code>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-parchment-300/50 bg-parchment-100/30 p-4">
        <h4 className="font-kai text-sm font-bold text-ink-500 mb-2">词条索引（{pkg.payload.lexemes.length}）</h4>
        <div className="flex flex-wrap gap-1.5">
          {pkg.payload.lexemes.map((l) => (
            <span key={l.id} className="text-xs px-2 py-0.5 rounded-lg bg-parchment-50 border border-parchment-300/50 font-kai text-vermilion-500">
              {releaseLexemeLabel(pkg, l.id)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── 路径变化字形并排对照 ─────────────────────────────────────────────

const SideBySideGlyphs: React.FC<{ next: ReleasePackage; prev: ReleasePackage }> = ({ next, prev }) => {
  const changed = useMemo(() => diffPackages(prev, next).paths, [prev, next]);
  if (changed.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-ink-400/20 bg-parchment-100/20 p-4">
      <h4 className="font-kai text-sm font-bold text-ink-500 mb-1">路径变化字形对照</h4>
      <p className="text-[11px] font-song text-ink-300 mb-3">左为第 {prev.sequence} 包旧形，右为第 {next.sequence} 包新形。</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {changed.map((id) => {
          const name =
            next.payload.radicals.find((r) => r.id === id)?.name ??
            prev.payload.radicals.find((r) => r.id === id)?.name ??
            id;
          return (
            <div key={id} className="rounded-lg border border-parchment-300/50 bg-parchment-50 p-3">
              <div className="text-center font-kai text-sm text-ink-500 mb-2">{name}</div>
              <div className="flex items-center justify-center gap-2">
                <div className="text-center">
                  <PackageGlyph pkg={prev} radicalId={id} size={64} strokeColor="#6E5A44" strokeWidth={2.2} />
                  <div className="text-[10px] text-ink-200 font-song mt-1">旧</div>
                </div>
                <span className="text-vermilion-500 text-xs">→</span>
                <div className="text-center">
                  <PackageGlyph pkg={next} radicalId={id} size={64} strokeColor="#B23A29" strokeWidth={2.2} />
                  <div className="text-[10px] text-ink-200 font-song mt-1">新</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
