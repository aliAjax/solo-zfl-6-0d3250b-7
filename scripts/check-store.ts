// store 发布行为验证（内存 localStorage，无需浏览器）
class MemStorage {
  store: Record<string, string> = {};
  getItem(k: string) { return this.store[k] ?? null; }
  setItem(k: string, v: string) { this.store[k] = String(v); }
  removeItem(k: string) { delete this.store[k]; }
  clear() { this.store = {}; }
  key() { return null; }
  get length() { return Object.keys(this.store).length; }
}
(globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();

import { useWritingSystemStore } from '../src/store/useWritingSystemStore';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

const store = useWritingSystemStore.getState();
const firstRadical = store.radicals[0];
const firstName = firstRadical.name;

console.log('[S1] 首次发布（包无时间戳）');
const r1 = await store.publishRelease();
ok(r1.ok && !r1.unchanged, '首次发布成功');
ok(useWritingSystemStore.getState().releases.length === 1, '存档 1 个包');
const pkg1 = r1.pkg!;
ok(pkg1.sequence === 1 && !('publishedAt' in pkg1), '序号 1 且无时间戳字段');
ok(pkg1.diff === null, '首包无差异');

console.log('[S2] 同一份字系重复发布 → 返回同一包');
const r1b = await useWritingSystemStore.getState().publishRelease();
ok(r1b.ok && r1b.unchanged, '重复发布 unchanged');
ok(r1b.pkg!.checksum === pkg1.checksum, '全包校验值相同');
ok(useWritingSystemStore.getState().releases.length === 1, '不产生新包');

console.log('[S3] 改动字根后发布：旧包不变 + diff');
useWritingSystemStore.getState().updateRadical(firstRadical.id, { name: `${firstName}·新` });
const r2 = await useWritingSystemStore.getState().publishRelease();
ok(r2.ok && !r2.unchanged, '改动后发布为新包');
ok(r2.pkg!.sequence === 2, '序号 2');
ok(pkg1.payload.radicals.find((x) => x.id === firstRadical.id)!.name === firstName, '旧包字根名原样');
ok(r2.pkg!.payload.radicals.find((x) => x.id === firstRadical.id)!.name === `${firstName}·新`, '新包字根名为新值');
ok(r2.pkg!.diff!.radicals.changed.includes(firstRadical.id), 'diff 标记修改');

console.log('[S4] 校验失败：当前数据与旧包均不变');
const before = useWritingSystemStore.getState().releases.length;
useWritingSystemStore.getState().addRadical({
  name: '坏字根', meaning: 'x', pronunciation: 'x', category: '象形', baseShape: 'M10 10 L20', variants: [],
});
const rBad = await useWritingSystemStore.getState().publishRelease();
ok(!rBad.ok, '残缺路径+缺字形 → 发布失败');
ok(rBad.issues.some((i) => i.code === 'path-out-of-bounds'), '报路径问题（无效）');
ok(rBad.issues.some((i) => i.code === 'missing-stage-glyph'), '报缺失阶段字形');
ok(useWritingSystemStore.getState().releases.length === before, '旧包数量不变');
const bad = useWritingSystemStore.getState().radicals.find((x) => x.name === '坏字根')!;
useWritingSystemStore.getState().removeRadical(bad.id);

console.log('[S5] 布局变化进入 diff');
const lexId = useWritingSystemStore.getState().lexemes[0].id;
useWritingSystemStore.getState().updateLexeme(lexId, { layout: 'overlay' });
const r3 = await useWritingSystemStore.getState().publishRelease();
ok(r3.ok, '发布成功');
ok(r3.pkg!.diff!.layout.includes(lexId), '布局变化登记');

console.log('[S6] 导出 → 删除 → 导入往返（制品原样）');
const json = useWritingSystemStore.getState().serializeRelease(r2.pkg!.checksum);
const parsed = JSON.parse(json);
ok(parsed.checksum === r2.pkg!.checksum && parsed.sequence === 2, '导出保留序号与校验值');
useWritingSystemStore.getState().removeRelease(r2.pkg!.checksum);
ok(!useWritingSystemStore.getState().releases.some((p) => p.checksum === r2.pkg!.checksum), '已删除');
const imported = await useWritingSystemStore.getState().importReleasePackage(json);
ok(imported.checksum === r2.pkg!.checksum, '导入校验值一致');
ok(imported.sequence === 2, '导入包序号保持原样（不重新编号）');
ok(imported.diff !== null && imported.diff!.radicals.changed.includes(firstRadical.id), '导入包差异原样保留');

console.log('[S7] 重复/篡改/残缺导入被拒');
let rej = false;
try { await useWritingSystemStore.getState().importReleasePackage(json); } catch { rej = true; }
ok(rej, '重复导入拒绝');
for (const mutate of [
  (t: any) => { t.payload.radicals[0].name = '篡'; },
  (t: any) => { t.manifest.totalRadicals = 1; },
  (t: any) => { t.report.ok = false; },
  (t: any) => { t.fallbackRecords = []; },
  (t: any) => { t.contentChecksum = '0'.repeat(64); },
  (t: any) => { t.payload.radicals[0].baseShape = 'M0 0 L999 999'; },
  (t: any) => { t.payload.radicals[0].baseShape = 'M0 0 L50'; },
  (t: any) => { t.checksum = '1'.repeat(64); },
]) {
  const t = JSON.parse(json);
  mutate(t);
  let r = false;
  try { await useWritingSystemStore.getState().importReleasePackage(JSON.stringify(t)); } catch { r = true; }
  ok(r, '篡改包被拒绝');
}

console.log('[S8] 重置工作数据不影响存档；重置后同字系发布识别为同一内容');
const n = useWritingSystemStore.getState().releases.length;
useWritingSystemStore.getState().resetAll();
ok(useWritingSystemStore.getState().releases.length === n, `重置后 ${n} 个包仍在`);

console.log('[S9] 清空存档后同字系首包重建结果逐字节一致');
{
  useWritingSystemStore.setState({ releases: [] });
  const a = await useWritingSystemStore.getState().publishRelease();
  const jsonA = useWritingSystemStore.getState().serializeRelease(a.pkg!.checksum);
  useWritingSystemStore.setState({ releases: [] });
  const b = await useWritingSystemStore.getState().publishRelease();
  const jsonB = useWritingSystemStore.getState().serializeRelease(b.pkg!.checksum);
  ok(jsonA === jsonB, '两次「清空后首发」序列化结果完全相同');
  ok(a.pkg!.checksum === b.pkg!.checksum && a.pkg!.contentChecksum === b.pkg!.contentChecksum, '两层校验值均相同');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
