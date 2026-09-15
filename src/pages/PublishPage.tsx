import React, { useMemo, useRef, useState } from 'react';
import { Stamp, Upload, PackageCheck, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { useWritingSystemStore } from '@/store/useWritingSystemStore';
import { CheckPanel } from '@/components/release/CheckPanel';
import { PackageDetail } from '@/components/release/PackageDetail';
import type { ReleasePackage } from '@/types';

export const PublishPage: React.FC = () => {
  const releases = useWritingSystemStore((s) => s.releases);
  const publishRelease = useWritingSystemStore((s) => s.publishRelease);
  const importReleasePackage = useWritingSystemStore((s) => s.importReleasePackage);
  const removeRelease = useWritingSystemStore((s) => s.removeRelease);
  const serializeRelease = useWritingSystemStore((s) => s.serializeRelease);

  const [publishing, setPublishing] = useState(false);
  const [unchangedHint, setUnchangedHint] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedChecksum, setSelectedChecksum] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...releases].sort((a, b) => a.sequence - b.sequence || a.checksum.localeCompare(b.checksum)),
    [releases]
  );
  const selected = sorted.find((p) => p.checksum === selectedChecksum) ?? sorted[sorted.length - 1] ?? null;

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    setUnchangedHint(false);
    try {
      const result = await publishRelease();
      if (!result.ok) {
        setPublishError(`发布中止：${result.issues.length} 项校验未通过，当前数据与既有发布包均未改动。`);
        return;
      }
      if (result.pkg) setSelectedChecksum(result.pkg.checksum);
      setUnchangedHint(!!result.unchanged);
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleExport = (pkg: ReleasePackage) => {
    const json = serializeRelease(pkg.checksum);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glyph-release-${String(pkg.sequence).padStart(2, '0')}-${pkg.checksum.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const pkg = await importReleasePackage(ev.target?.result as string);
        setImportMsg({ ok: true, text: `已导入第 ${String(pkg.sequence).padStart(2, '0')} 号发布包（重建与校验值验真通过）` });
        setSelectedChecksum(pkg.checksum);
      } catch (e) {
        setImportMsg({ ok: false, text: `导入被拒绝：${e instanceof Error ? e.message : '文件无效'}` });
      }
    };
    reader.readAsText(file);
  };

  const handleDelete = (pkg: ReleasePackage) => {
    if (
      confirm(
        `确定删除第 ${String(pkg.sequence).padStart(2, '0')} 号发布包吗？\n校验值：${pkg.checksum.slice(0, 16)}…\n删除后仅移除本地存档，不影响当前字根、词条与阶段数据。`
      )
    ) {
      removeRelease(pkg.checksum);
      if (selectedChecksum === pkg.checksum) setSelectedChecksum(null);
    }
  };

  const idx = selected ? sorted.findIndex((p) => p.checksum === selected.checksum) : -1;
  const prevPkg = idx > 0 ? sorted[idx - 1] : null;
  const nextPkg = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  return (
    <div className="container mx-auto px-6 py-8">
      <div className="mb-8 animate-fade-up">
        <h2 className="text-3xl font-kai text-ink-500 font-bold tracking-wider flex items-center gap-3 mb-2">
          <Stamp className="text-vermilion-500" size={28} />
          发布台
        </h2>
        <p className="text-ink-300 font-song text-sm">
          把当前字系编译成只读发布包：字形清单、阶段回退记录、校验报告与稳定校验值一次封存，此后改动字根、词条或阶段均不影响既有包。
        </p>
      </div>

      <div className="mb-6 animate-fade-up" style={{ animationDelay: '40ms' }}>
        <CheckPanel
          publishError={publishError}
          publishing={publishing}
          unchanged={unchangedHint}
          onPublish={handlePublish}
        />
      </div>

      <div className="flex items-center justify-between mb-4 animate-fade-up" style={{ animationDelay: '80ms' }}>
        <h3 className="font-kai text-xl font-bold text-ink-500 flex items-center gap-2">
          <PackageCheck size={20} className="text-bronze-500" />
          已发布存档
          <span className="text-sm font-song text-ink-300">（{sorted.length}）</span>
        </h3>
        <div className="flex items-center gap-2">
          {importMsg && (
            <span
              className={`text-xs font-song px-3 py-1.5 rounded-lg border ${
                importMsg.ok
                  ? 'bg-bronze-400/10 text-bronze-500 border-bronze-400/30'
                  : 'bg-vermilion-500/10 text-vermilion-500 border-vermilion-500/30'
              }`}
            >
              {importMsg.text}
            </span>
          )}
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-bronze-400/12 hover:bg-bronze-400/22 text-bronze-500 border border-bronze-400/30 font-kai text-sm transition-all"
          >
            <Upload size={15} />
            导入发布包
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-parchment-50 rounded-2xl p-16 text-center shadow-scroll border border-dashed border-parchment-300/70 animate-fade-up">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-parchment-100/70 flex items-center justify-center">
            <Inbox size={30} className="text-ink-200" />
          </div>
          <p className="font-kai text-xl text-ink-300 mb-2">尚无发布包</p>
          <p className="font-song text-sm text-ink-200">
            五项校验全部通过后，点击上方「编译并发布只读包」封存当前字系。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* 包列表 */}
          <div className="xl:col-span-3 animate-fade-up" style={{ animationDelay: '120ms' }}>
            <div className="bg-parchment-50 rounded-2xl shadow-scroll border border-parchment-300/40 p-3 sticky top-28">
              <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
                {[...sorted].reverse().map((p) => {
                  const active = selected?.checksum === p.checksum;
                  return (
                    <button
                      key={p.checksum}
                      onClick={() => setSelectedChecksum(p.checksum)}
                      className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all ${
                        active
                          ? 'bg-vermilion-500/10 border-vermilion-500/40 shadow-seal'
                          : 'bg-parchment-100/40 border-transparent hover:border-parchment-300/60 hover:bg-parchment-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`font-kai text-base font-bold ${active ? 'text-vermilion-500' : 'text-ink-500'}`}>
                          第 {String(p.sequence).padStart(2, '0')} 号
                        </span>
                        <span className="text-[10px] text-ink-200 font-mono">
                          {p.contentChecksum.slice(0, 10)}
                        </span>
                      </div>
                      <div className="text-[10px] text-ink-300 font-song mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>{p.report.summary.radicals} 字根</span>
                        <span>·</span>
                        <span>{p.report.summary.lexemes} 词条</span>
                        {p.diff?.unchanged && (
                          <span className="px-1 rounded bg-bronze-400/15 text-bronze-500">同上包</span>
                        )}
                      </div>
                      <code className="block text-[9px] font-mono text-ink-200 mt-1 truncate">{p.checksum}</code>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 详情 */}
          <div className="xl:col-span-9 space-y-4">
            {sorted.length > 1 && selected && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => prevPkg && setSelectedChecksum(prevPkg.checksum)}
                  disabled={!prevPkg}
                  className="flex items-center gap-1 text-xs font-kai px-3 py-1.5 rounded-lg text-ink-400 disabled:opacity-30 hover:bg-parchment-50 border border-parchment-300/50"
                >
                  <ChevronLeft size={14} />
                  更早一包（第 {prevPkg ? String(prevPkg.sequence).padStart(2, '0') : '—'} 号）
                </button>
                <button
                  onClick={() => nextPkg && setSelectedChecksum(nextPkg.checksum)}
                  disabled={!nextPkg}
                  className="flex items-center gap-1 text-xs font-kai px-3 py-1.5 rounded-lg text-ink-400 disabled:opacity-30 hover:bg-parchment-50 border border-parchment-300/50"
                >
                  更新一包（第 {nextPkg ? String(nextPkg.sequence).padStart(2, '0') : '—'} 号）
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
            {selected && (
              <PackageDetail
                key={selected.checksum}
                pkg={selected}
                allPackages={sorted}
                onExport={handleExport}
                onDelete={handleDelete}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
