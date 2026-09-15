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

console.log('[S1] 首次发布');
const r1 = await store.publishRelease();
ok(r1.ok && !r1.unchanged, '首次发布成功');
ok(useWritingSystemStore.getState().releases.length === 1, '存档中有 1 个包');
const pkg1 = r1.pkg!;
ok(pkg1.sequence === 1, '序号为 1');
ok(pkg1.diff === null, '首包无差异基准');

console.log('[S2] 同一份数据重复发布');
const r1b = await useWritingSystemStore.getState().publishRelease();
ok(r1b.ok && r1b.unchanged, '重复发布返回 unchanged');
ok(r1b.pkg!.checksum === pkg1.checksum, '校验值一致');
ok(useWritingSystemStore.getState().releases.length === 1, '不产生新包，存档仍为 1 个');

console.log('[S3] 发布后改动字根不影响旧包，并产生差异');
useWritingSystemStore.getState().updateRadical(firstRadical.id, { name: `${firstName}·新` });
const r2 = await useWritingSystemStore.getState().publishRelease();
ok(r2.ok && !r2.unchanged, '改动后发布成功且非 unchanged');
const pkg2 = r2.pkg!;
ok(pkg2.sequence === 2, '序号递增为 2');
ok(pkg1.payload.radicals.find((x) => x.id === firstRadical.id)!.name === firstName, '旧包字根名保持原样');
ok(pkg2.payload.radicals.find((x) => x.id === firstRadical.id)!.name === `${firstName}·新`, '新包字根名为新值');
ok(pkg2.diff!.radicals.changed.includes(firstRadical.id), 'diff 标记该字根已修改');
ok(pkg2.diff!.affectedRadicals.includes(firstRadical.id), '受影响字根包含它');

console.log('[S4] 校验失败：当前数据与旧包均不变');
const releasesBefore = useWritingSystemStore.getState().releases.length;
useWritingSystemStore.getState().addRadical({
  name: '坏字根', meaning: 'x', pronunciation: 'x', category: '象形', baseShape: '', variants: [],
});
const rBad = await useWritingSystemStore.getState().publishRelease();
ok(!rBad.ok, '发布失败');
ok(rBad.issues.length >= 2, `报出多项问题（实际 ${rBad.issues.length}）`);
ok(rBad.issues.some((i) => i.code === 'path-out-of-bounds'), '含路径越界/空路径');
ok(rBad.issues.some((i) => i.code === 'missing-stage-glyph'), '含缺失阶段字形');
ok(useWritingSystemStore.getState().releases.length === releasesBefore, '旧包数量不变');

console.log('[S5] 删除坏字根后再发布：词条布局变化进入 diff');
// 直接移除刚加的坏字根
const bad = useWritingSystemStore.getState().radicals.find((x) => x.name === '坏字根')!;
useWritingSystemStore.getState().removeRadical(bad.id);
const firstLexeme = useWritingSystemStore.getState().lexemes[0];
useWritingSystemStore.getState().updateLexeme(firstLexeme.id, { layout: 'overlay' });
const r3 = await useWritingSystemStore.getState().publishRelease();
ok(r3.ok, '修复后发布成功');
ok(r3.pkg!.diff!.layout.includes(firstLexeme.id), '布局变化已登记');
ok(r3.pkg!.diff!.affectedLexemes.includes(firstLexeme.id), '受影响词条已登记');

console.log('[S6] 单包导出 → 删除 → 导入往返');
const json = useWritingSystemStore.getState().serializeRelease(pkg2.sequence);
ok(JSON.parse(json).checksum === pkg2.checksum, '导出内容含校验值');
useWritingSystemStore.getState().removeRelease(pkg2.sequence);
ok(!useWritingSystemStore.getState().releases.some((p) => p.sequence === pkg2.sequence), '已删除该包');
const imported = await useWritingSystemStore.getState().importReleasePackage(json);
ok(imported.checksum === pkg2.checksum, '导入包校验值一致');
ok(useWritingSystemStore.getState().releases.some((p) => p.checksum === pkg2.checksum), '导入后存档中存在该包');

console.log('[S7] 重复导入与篡改包被拒');
let rejected = false;
try { await useWritingSystemStore.getState().importReleasePackage(json); } catch { rejected = true; }
ok(rejected, '重复导入同一包被拒绝');
const tampered = JSON.parse(json);
tampered.payload.radicals[0].name = '篡';
rejected = false;
try { await useWritingSystemStore.getState().importReleasePackage(JSON.stringify(tampered)); } catch { rejected = true; }
ok(rejected, '篡改包被校验值拦截');

console.log('[S8] 重置工作数据不影响发布存档');
const countBeforeReset = useWritingSystemStore.getState().releases.length;
useWritingSystemStore.getState().resetAll();
ok(useWritingSystemStore.getState().releases.length === countBeforeReset, `重置后 ${countBeforeReset} 个包仍在`);
ok(useWritingSystemStore.getState().radicals[0].name !== '日·新', '工作数据已回到初始 mock');
// 重置后工作数据与首包内容相同，再发布应为 unchanged
const rReset = await useWritingSystemStore.getState().publishRelease();
ok(rReset.unchanged, '重置后重复发布识别为同一份数据');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
