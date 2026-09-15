// 发布台核心逻辑行为验证（不经过 React）
import { MOCK_STAGES, MOCK_RADICALS, MOCK_LEXEMES } from '../src/utils/mockData';
import {
  buildReleasePackage,
  checkPath,
  arcBoundsViolation,
  diffPackages,
  parseReleasePackage,
  validateWritingSystem,
  checksumForSource,
  checksumForArtifact,
  ReleaseValidationError,
  ReleaseParseError,
} from '../src/utils/releaseUtils';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};
const eq = (a: unknown, b: unknown, msg: string) => ok(JSON.stringify(a) === JSON.stringify(b), msg);
const rejected = async (p: Promise<unknown>, msg: string) => {
  let r = false;
  try { await p; } catch (e) { r = e instanceof ReleaseParseError; }
  ok(r, msg);
};

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const base = () => ({
  stages: clone(MOCK_STAGES),
  radicals: clone(MOCK_RADICALS),
  lexemes: clone(MOCK_LEXEMES),
});

// ── 1. mock 数据应当发布成功（含路径全部在界内且语法合法） ────────
console.log('[1] 基线数据发布');
{
  const issues = validateWritingSystem(base());
  ok(issues.length === 0, `基线无校验问题（实际 ${issues.length}: ${issues.map((i) => i.code).join(',')}）`);
  for (const r of MOCK_RADICALS) {
    ok(checkPath(r.baseShape).length === 0, `baseShape 合法且界内: ${r.name}`);
    for (const v of r.variants) ok(checkPath(v.svgPath).length === 0, `variant 合法且界内: ${r.name}`);
  }
}

// ── 2. 确定性：同一数据，包内容与校验值完全相同（去时间、去历史） ──
console.log('[2] 重复发布一致性（无时间、无存档依赖）');
{
  const pkg1 = await buildReleasePackage(base(), { sequence: 1, prev: null });
  const pkg2 = await buildReleasePackage(base(), { sequence: 99, prev: null });
  ok(pkg1.checksum === pkg2.checksum, '不同序号/无时间下全包校验值相同');
  ok(pkg1.contentChecksum === pkg2.contentChecksum, '内容校验值相同');
  eq(pkg1.payload, pkg2.payload, '语义快照一致');
  eq(pkg1.manifest, pkg2.manifest, '字形清单一致');
  eq(pkg1.fallbackRecords, pkg2.fallbackRecords, '阶段取形记录一致');
  eq(pkg1.report, pkg2.report, '校验报告一致');
  ok(!('publishedAt' in pkg1), '包内不存在时间戳字段');
  ok(pkg1.fallbackRecords.every((r) => r.status === 'exact'), '取形记录全部 exact，无不可达状态');
  const cs = await checksumForSource(base());
  ok(cs === pkg1.contentChecksum, '内容校验值可独立复算');
  // 输入顺序打乱，重建结果逐字段相同
  const shuffled = base();
  shuffled.radicals = [...shuffled.radicals].reverse();
  shuffled.stages = [...shuffled.stages].reverse();
  shuffled.lexemes = [...shuffled.lexemes].reverse();
  const pkg3 = await buildReleasePackage(shuffled, { sequence: 1, prev: null });
  eq(pkg3, pkg1, '输入顺序打乱后整个包逐字节相同（含序号一致时）');
}

// ── 3. 五项校验各自可被触发 ───────────────────────────────────────
console.log('[3] 五项发布前校验');
{
  let d = base();
  d.lexemes[0] = { ...d.lexemes[0], radicalIds: ['rad-sun', 'rad-ghost'] };
  ok(validateWritingSystem(d).some((i) => i.code === 'broken-link'), '断链：词条→缺失字根');

  d = base();
  d.radicals[0] = { ...d.radicals[0], variants: [...d.radicals[0].variants, { stageId: 'stage-x', svgPath: 'M0 0 L1 1' }] };
  ok(validateWritingSystem(d).some((i) => i.code === 'broken-link'), '断链：变体→缺失阶段');

  d = base();
  d.radicals[0] = { ...d.radicals[0], variants: d.radicals[0].variants.filter((v) => v.stageId !== 'stage-2') };
  {
    const iss = validateWritingSystem(d).filter((i) => i.code === 'missing-stage-glyph');
    ok(iss.length === 1 && iss[0].message.includes('青铜吉文'), '缺失阶段字形被检出');
  }

  d = base();
  d.radicals[1] = { ...d.radicals[1], name: d.radicals[0].name };
  ok(validateWritingSystem(d).some((i) => i.code === 'duplicate-name' && i.target === 'radical'), '字根重名');
  d = base();
  d.stages[1] = { ...d.stages[1], name: d.stages[0].name };
  ok(validateWritingSystem(d).some((i) => i.code === 'duplicate-name' && i.target === 'stage'), '阶段重名');

  d = base();
  d.lexemes[0] = { ...d.lexemes[0], radicalIds: Array(25).fill('rad-sun') };
  ok(validateWritingSystem(d).some((i) => i.code === 'too-many-components'), '构件 25 个被拦截');
  d = base();
  d.lexemes[0] = { ...d.lexemes[0], radicalIds: Array(24).fill('rad-sun') };
  ok(!validateWritingSystem(d).some((i) => i.code === 'too-many-components'), '构件 24 个放行');

  // 越界
  d = base();
  d.radicals[0] = { ...d.radicals[0], baseShape: 'M10 10 L120 40 Z' };
  ok(validateWritingSystem(d).some((i) => i.code === 'path-out-of-bounds' && i.message.includes('超出')), '坐标 120 越界');
  d = base();
  d.radicals[0] = { ...d.radicals[0], baseShape: 'M-5 10 L40 40 Z' };
  ok(validateWritingSystem(d).some((i) => i.code === 'path-out-of-bounds'), '坐标 -5 越界');
  d = base();
  d.radicals[0] = { ...d.radicals[0], baseShape: 'M0 0 l10 10 l-10 0 z' };
  ok(!validateWritingSystem(d).some((i) => i.code === 'path-out-of-bounds'), '相对命令解析后在界内放行');
}

// ── 4. 无效/残缺路径全部拦截 ───────────────────────────────────────
console.log('[4] 路径语法严格校验');
{
  const bad = [
    ['空路径', ''],
    ['纯空白', '   '],
    ['无 M 开头', 'L10 10 L20 20'],
    ['未知命令', 'M10 10 X20 20'],
    ['M 参数残缺', 'M10'],
    ['C 参数残缺', 'M0 0 C10 10 20 20'],
    ['数字孤立', '10 10 20 20'],
    ['非法字符', 'M10 10 L20 20 #'],
    ['非有限数', 'M0 0 L1e999 1'],
    ['弧标志位非 0/1', 'M0 0 A10 10 0 2 0 50 50'],
    ['只有 Z', 'Z'],
    ['坐标超 100', 'M100.5 0 L0 100'],
  ] as const;
  for (const [label, p] of bad) {
    const probs = checkPath(p);
    ok(probs.length > 0, `拦截：${label}`);
  }
  const good = [
    'M10 10 L90 90 Z',
    'M20 20 C30 10 70 10 80 20 S90 40 80 80 Z',
    'M10 50 H90 V80 H10 Z',
    'M10 10 a10 10 0 1 0 20 0 a10 10 0 1 1 -20 0',
    'M50 10 Q60 30 50 50 T50 90',
    'M50 50 m10 0 l10 10',
  ];
  for (const p of good) ok(checkPath(p).length === 0, `放行合法路径：${p.slice(0, 24)}…`);

  // ── 弧线主体几何：终点在框内、弧身鼓出画框必须被拦 ──
  // (40,50)→(60,50)，rx=ry=33：四种标志位组合中，取大弧时椭圆极值 x≈17..83、y≈17..83 在框内；
  // 改用更大半径 55：大弧一侧圆心约在 (50,≈22.4)/(50,≈77.6)，极值触及 y≈−32.6 / 132.6
  const arcBodies = [
    ['大弧+顺时针鼓出', 'M40 50 A55 55 0 1 1 60 50'],
    ['大弧+逆时针鼓出', 'M40 50 A55 55 0 1 0 60 50'],
    ['小弧近圆鼓出（负半径取绝对值）', 'M40 50 A-55 -55 0 1 1 60 50'],
    ['相对弧线同样按几何判定', 'M40 50 a55 55 0 1 1 20 0'],
    ['旋转椭圆鼓出', 'M50 30 A60 20 45 1 1 50 70'],
  ] as const;
  for (const [label, p] of arcBodies) {
    const probs = checkPath(p);
    ok(probs.some((x) => x.message.includes('弧身')), `拦截：${label}`);
  }
  // 小半径短弧（弧身完全在框内）放行；同一起终点的小弧不越界
  const arcOk = [
    'M40 50 A33 33 0 0 1 60 50',
    'M40 50 A33 33 0 0 0 60 50',
    'M10 10 a5 5 0 0 1 10 0',
    'M50 30 A30 12 0 0 1 50 70',
  ];
  for (const p of arcOk) ok(checkPath(p).length === 0, `放行弧身在框内：${p.slice(0, 26)}…`);
  // 端点本身越界仍要报（旧门禁不回退）
  ok(checkPath('M10 10 A20 20 0 0 1 130 50').some((x) => x.message.includes('超出')), '弧线终点越界仍拦截');
  // 端点重合：零长度弧不产生弧身
  ok(checkPath('M50 50 A60 60 0 1 1 50 50').length === 0, '端点重合零长度弧放行');

  // 数值交叉验证：解析极值 vs 2000 点采样的真实包围盒
  {
    const sampledExtent = (
      x1: number, y1: number, x2: number, y2: number,
      rx0: number, ry0: number, phiDeg: number, la: 0 | 1, sw: 0 | 1
    ) => {
      let rx = Math.abs(rx0), ry = Math.abs(ry0);
      const phi = (phiDeg * Math.PI) / 180;
      const c = Math.cos(phi), s = Math.sin(phi);
      const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
      const xp = c * dx + s * dy, yp = -s * dx + c * dy;
      const lam = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
      if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
      const num = Math.max(0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp);
      const den = rx * rx * yp * yp + ry * ry * xp * xp;
      let k2 = Math.sqrt(num / den);
      if (la === sw) k2 = -k2;
      const cxp = k2 * ((rx * yp) / ry), cyp = k2 * (-(ry * xp) / rx);
      const ccx = c * cxp - s * cyp + (x1 + x2) / 2;
      const ccy = s * cxp + c * cyp + (y1 + y2) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => {
        let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
      };
      const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
      let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
      if (sw === 0 && dt > 0) dt -= 2 * Math.PI;
      if (sw === 1 && dt < 0) dt += 2 * Math.PI;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let j = 0; j <= 2000; j++) {
        const t = t1 + (dt * j) / 2000;
        const x = ccx + c * rx * Math.cos(t) - s * ry * Math.sin(t);
        const y = ccy + s * rx * Math.cos(t) + c * ry * Math.sin(t);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    };

    let mismatch = 0;
    let total = 0;
    const ends: [number, number][] = [[10, 50], [40, 50], [50, 10], [50, 50], [90, 90], [20, 30], [80, 20]];
    const radii: [number, number][] = [[5, 5], [20, 8], [33, 33], [55, 55], [80, 30], [120, 120], [40, 60]];
    const phis = [0, 30, 45, 90];
    for (const [x1, y1] of ends) {
      for (const [x2, y2] of ends) {
        if (x1 === x2 && y1 === y2) continue;
        for (const [rx, ry] of radii) {
          for (const phi of phis) {
            for (const la of [0, 1] as const) {
              for (const sw of [0, 1] as const) {
                total++;
                const e = sampledExtent(x1, y1, x2, y2, rx, ry, phi, la, sw);
                const over = Math.max(-e.minX, e.maxX - 100, -e.minY, e.maxY - 100, 0);
                const realOut = over > 1e-4;
                const hit = !!arcBoundsViolation(x1, y1, x2, y2, rx, ry, phi, la, sw);
                if (hit !== realOut) {
                  mismatch++;
                  if (mismatch <= 5) console.log(`    几何不一致: (${x1},${y1})→(${x2},${y2}) r=${rx}/${ry} φ=${phi} la=${la} sw=${sw} over=${over.toFixed(3)} hit=${hit}`);
                }
              }
            }
          }
        }
      }
    }
    ok(mismatch === 0, `弧线几何判定与数值采样一致（${total} 组合，不一致 ${mismatch}）`);
  }

  // 语法问题也必须进入发布门禁
  const d = base();
  d.radicals[2] = { ...d.radicals[2], baseShape: 'M10 10 L20' };
  const iss = validateWritingSystem(d);
  ok(iss.some((i) => i.code === 'path-out-of-bounds' && i.message.includes('路径无效')), '残缺路径在发布门禁中报「路径无效」');
}

// ── 4b. 闭合与子路径状态 ──────────────────────────────────────────
console.log('[4b] Z 回位、相对命令基准与子路径重置');
{
  // Z 之后相对命令必须以子路径起点为当前点：
  // M5 95（近角起点）→ l0 -90 → h90 → Z 回 (5,95) → l95 0 恰落 x=100（界内边界）
  ok(checkPath('M5 95 l0 -90 h90 Z l95 0').length === 0, 'Z 后相对命令从子路径起点计算（恰在边界内）');
  const hit = checkPath('M5 95 l0 -90 h90 Z l96 0');
  ok(hit.length === 1 && hit[0].kind === 'bounds' && Math.abs((hit[0].x ?? 0) - 101) < 1e-3,
    `Z 后相对命令以起点为基准判越界（实际 ${hit[0]?.x},${hit[0]?.y}）`);

  // 相对 V 同样以回位点为基准：Z 回 (10,90)，v10→y=100 边界内，v11→y=101 越界
  ok(checkPath('M10 90 l0 -80 h80 Z v10').length === 0, 'Z 后相对 V 从起点 y=90 计，到 100 恰在界内');
  const vHit = checkPath('M10 90 l0 -80 h80 Z v11');
  ok(vHit.some((q) => q.kind === 'bounds' && Math.abs((q.y ?? 0) - 101) < 1e-3),
    `Z 后相对 v 越界（y=101，实际 ${vHit.find((q) => q.kind === 'bounds')?.y}）`);

  // 未闭合时相对命令沿上一笔位置（不回位）
  ok(checkPath('M10 90 l0 -80 h80 l6 0').length === 0, '未闭合：(10,90)→(10,10)→(90,10)→(96,10) 全在界内');
  ok(checkPath('M10 90 l0 -80 h80 l11 0').some((q) => q.kind === 'bounds'), '未闭合时以上一笔终点为基准：(90,10)+l11→x=101');

  // 新 M 开始新子路径并重置起点：第二子路径 Z 回自己的 (10,10)
  ok(checkPath('M5 95 l0 -90 h90 Z M10 10 l80 0 l0 80 Z l0 5').length === 0,
    '新子路径 Z 回到各自起点（(10,10)+l0 5 到 15 界内）');
  const multiHit = checkPath('M5 95 l0 -90 h90 Z M10 10 l80 0 l0 80 Z l0 -11');
  // 若错误回到第一子路径起点 (5,95)，l0 -11→84 不越界；正确回 (10,10)→y=-1
  ok(multiHit.some((q) => q.kind === 'bounds' && Math.abs((q.y ?? 0) - -1) < 1e-3),
    `新子路径 Z 回该子路径自己的起点（y=-1，实际 ${multiHit.find((q) => q.kind === 'bounds')?.y}）`);

  // 隐式重复 M 的坐标对等同 L，不重置子路径起点
  ok(checkPath('M5 95 95 95 Z l95 0').length === 0, '隐式 M 坐标对不重置子路径起点（回 (5,95)，+95=100）');
  ok(checkPath('M5 95 95 95 Z l96 0').some((q) => q.kind === 'bounds'), '隐式 M 后 Z 回首起点，l96→x=101 越界');

  // 连续 Z 幂等：仍停在子路径起点
  ok(checkPath('M10 10 h80 v80 h-80 Z Z l0 -11').some((q) => q.kind === 'bounds'), '连续 Z 幂等回位，随后相对上移 y=-1 越界');
  ok(checkPath('M10 10 h80 v80 h-80 Z Z l5 0').length === 0, '连续 Z 后合法相对移动放行');

  // 多子路径既有图形仍合法（口字外框 + 两横）
  ok(checkPath('M28 30 L72 30 L78 78 L22 78 Z M32 46 L68 46 M34 60 L66 60').length === 0, '多子路径范例合法');
}

// ── 4c. 平滑曲线 S/T 反射控制点 ───────────────────────────────────
console.log('[4c] S/T 反射点与曲线主体边界');
{
  // S 反射上一段 C 的第二控制点：合法样例（反射点 (90,30) 在界内）
  ok(checkPath('M20 20 C30 10 70 10 80 20 S90 40 80 80 Z').length === 0, 'S 反射 C 控制点，全部在界内放行');

  // 反射点越界：C 结束于 (10,50)、第二控制点 (80,50) → S 反射点 (−60,50)
  // 贝塞尔曲线在控制点凸包内，反射控制点越界意味着曲线主体必然越框
  let probs = checkPath('M50 50 C20 50 80 50 10 50 S30 50 50 50');
  ok(probs.some((q) => q.kind === 'bounds' && Math.abs((q.x ?? 0) - -60) < 1e-3),
    `S 反射点 (−60,50) 越界被拦（实际 ${probs.map((q) => `${q.x},${q.y}`).join(';')}）`);

  // 没有上一段曲线：S 第一控制点取当前点 (50,50)，合法
  ok(checkPath('M50 50 S10 10 90 50').length === 0, '无上一段时 S 第一控制点取当前点（合法）');
  // 显式第二控制点越界仍要拦
  ok(checkPath('M50 50 S-10 50 50 50').some((q) => q.kind === 'bounds'), 'S 显式控制点越界被拦');

  // L 打断平滑链：之后的 S 以当前点为第一控制点
  ok(checkPath('M10 50 L50 50 S10 10 90 50').length === 0, 'L 后 S 不反射，第一控制点为当前点');

  // T 反射上一段 Q 的控制点
  ok(checkPath('M50 10 Q60 30 50 50 T50 90').length === 0, 'T 反射 Q 控制点（反射点 (40,70) 界内）放行');
  // Q 结束 (90,50)、控制点 (50,10) → T 反射点 (130,90) 越界，终点 (90,50) 在界内
  probs = checkPath('M10 50 Q50 10 90 50 T90 50');
  ok(probs.some((q) => q.kind === 'bounds' && Math.abs((q.x ?? 0) - 130) < 1e-3),
    `T 反射点 (130,90) 越界被拦（实际 ${probs.map((q) => `${q.x},${q.y}`).join(';')}）`);

  // T 链：每段反射的是上一段 T 实际使用的控制点
  ok(checkPath('M10 80 Q10 10 50 10 T90 10 T90 80').length === 0, 'Q-T-T 平滑链界内放行');
  probs = checkPath('M10 80 Q10 10 50 10 T90 10 T90 80 T10 80');
  // 第三个 T 的反射控制点 = 2*(90,80) - (90,10) = (90,150)
  ok(probs.some((q) => q.kind === 'bounds' && Math.abs((q.y ?? 0) - 150) < 1e-3),
    `T 链继续反射，(90,150) 越界被拦（实际 ${probs.map((q) => `${q.x},${q.y}`).join(';')}）`);

  // 家族不匹配：T 前是 C 时不反射，取当前点
  ok(checkPath('M10 50 C30 10 70 10 90 50 T90 90').length === 0, 'T 前是 C：按当前点处理，合法');
  // 相对 s/t：反射基于绝对坐标，显式参数按相对当前点解析
  probs = checkPath('M50 50 C20 50 80 50 10 50 s20 0 40 0');
  ok(probs.some((q) => q.kind === 'bounds' && Math.abs((q.x ?? 0) - -60) < 1e-3), '相对 s 的反射点同样越界拦截');
  ok(checkPath('m50 10 q10 20 0 40 t0 40').length === 0, '相对 q/t 链界内放行');

  // Z 与新子路径都重置平滑状态
  ok(checkPath('M10 10 h80 v80 h-80 Z T90 90').length === 0, 'Z 后 T 无控制点可反射，按当前点处理');
  ok(checkPath('M10 50 Q50 10 90 50 M50 50 T90 50').length === 0, '新子路径 T 不跨 M 反射');

  // 曲线主体论证：凸包原理——所有控制点（含反射点）界内时曲线不可能越框
  // 构造控制点擦边但全部界内的 S，确认不误伤
  ok(checkPath('M0 50 C0 0 100 0 100 50 S0 100 0 50').length === 0, '控制点擦边（0/100）的 C-S 链放行');
}

// ── 5. 校验失败原子性 ─────────────────────────────────────────────
console.log('[5] 失败原子性');
{
  const d = base();
  d.radicals[0] = { ...d.radicals[0], baseShape: 'M999 999 Z' };
  let threw = false;
  try { await buildReleasePackage(d, { sequence: 1, prev: null }); }
  catch (e) { threw = e instanceof ReleaseValidationError; }
  ok(threw, '校验失败抛出 ReleaseValidationError');
}

// ── 6. 旧包不变性 + diff ──────────────────────────────────────────
console.log('[6] 旧包不变性与差异对照');
{
  const pkg1 = await buildReleasePackage(base(), { sequence: 1, prev: null });

  let d2 = base();
  d2.stages = [...d2.stages, { id: 'stage-5', name: '简化新文', order: 4, description: '新增', color: '#111' }];
  d2.radicals = d2.radicals.map((r) => ({
    ...r,
    variants: [...r.variants, { stageId: 'stage-5', svgPath: r.variants.find((v) => v.stageId === 'stage-4')!.svgPath }],
  }));
  const changedLexemeId = d2.lexemes[0].id;
  d2.lexemes[0] = { ...d2.lexemes[0], layout: 'vertical' };
  d2.radicals = d2.radicals.filter((r) => r.id !== 'rad-fire');
  d2.lexemes = [...d2.lexemes, {
    id: 'lx-new', radicalIds: ['rad-water', 'rad-mouth'], layout: 'overlay',
    pronunciation: 'new', meaning: '新词条', createdAt: 1,
  }];
  // 改 moon 的 stage-1 路径
  d2.radicals.find((r) => r.id === 'rad-moon')!.variants.find((v) => v.stageId === 'stage-1')!.svgPath =
    'M50 10 C70 10 90 30 90 50 C90 70 70 90 50 90 C30 90 10 70 10 50 C10 30 30 10 50 10 Z';

  const pkg2 = await buildReleasePackage(d2, { sequence: 2, prev: pkg1 });
  ok(pkg1.manifest.totalRadicals === 12, '旧包字根仍为 12');
  ok(pkg1.payload.stages.length === 4, '旧包阶段仍为 4');
  ok(
    pkg1.payload.radicals.find((r) => r.id === 'rad-moon')!.variants.find((v) => v.stageId === 'stage-1')!.svgPath ===
      MOCK_RADICALS.find((r) => r.id === 'rad-moon')!.variants.find((v) => v.stageId === 'stage-1')!.svgPath,
    '旧包 moon 路径保持原值'
  );

  const diff = pkg2.diff!;
  ok(diff.fromChecksum === pkg1.checksum, 'diff 引用上一包全包校验值');
  ok(diff.stages.added.includes('stage-5'), 'diff 新增阶段');
  ok(diff.radicals.removed.includes('rad-fire'), 'diff 删除字根');
  ok(diff.lexemes.added.includes('lx-new'), 'diff 新增词条');
  ok(diff.layout.includes(changedLexemeId), 'diff 布局变化');
  ok(diff.paths.includes('rad-moon'), 'diff 路径变化');
  ok(diff.affectedRadicals.includes('rad-moon') && diff.affectedRadicals.includes('rad-fire'), '受影响字根');
  ok(diff.affectedLexemes.includes(changedLexemeId) && diff.affectedLexemes.includes('lx-new'), '受影响词条');
  ok(diff.unchanged === false, 'unchanged=false');

  const sameAgain = await buildReleasePackage(base(), { sequence: 7, prev: null });
  ok(diffPackages(pkg1, sameAgain).unchanged, '相同两包 unchanged=true');
  ok(sameAgain.checksum === pkg1.checksum, '相同内容全包校验值相等（不受序号影响）');
}

// ── 7. 重建式验真：正常往返 + 任一字段被改都拒绝 ──────────────────
console.log('[7] 导入重建与逐字段篡改检测');
{
  const pkg = await buildReleasePackage(base(), { sequence: 1, prev: null });
  const reparsed = await parseReleasePackage(JSON.stringify(pkg));
  eq(reparsed, pkg, '合法包导入往返一致');

  // 快照改动 → 重建不一致
  let t = JSON.parse(JSON.stringify(pkg));
  t.payload.radicals[0].name = ' Hack';
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改字根名 → 拒绝（重建不符）');

  // 清单改动（与快照不一致）→ 拒绝
  t = JSON.parse(JSON.stringify(pkg));
  t.manifest.totalRadicals = 999;
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改字形清单计数 → 拒绝');
  t = JSON.parse(JSON.stringify(pkg));
  t.manifest.entries[0].pronunciation = 'zzz';
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改清单条目 → 拒绝');

  // 取形记录改动
  t = JSON.parse(JSON.stringify(pkg));
  t.fallbackRecords[0].stageName = '伪阶段';
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改阶段取形记录 → 拒绝');
  t = JSON.parse(JSON.stringify(pkg));
  t.fallbackRecords.push({ radicalId: 'x', radicalName: 'x', stageId: 'x', stageName: 'x', status: 'exact' });
  await rejected(parseReleasePackage(JSON.stringify(t)), '增加取形记录 → 拒绝');

  // 报告改动
  t = JSON.parse(JSON.stringify(pkg));
  t.report.summary.radicals = 1;
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改校验报告 → 拒绝');
  t = JSON.parse(JSON.stringify(pkg));
  t.report.ok = false;
  await rejected(parseReleasePackage(JSON.stringify(t)), '翻转报告 ok → 拒绝');

  // 内容校验值改动
  t = JSON.parse(JSON.stringify(pkg));
  t.contentChecksum = 'a'.repeat(64);
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改内容校验值 → 拒绝（重建不符 + 全包校验值不符）');

  // 直接改 checksum
  t = JSON.parse(JSON.stringify(pkg));
  t.checksum = 'f'.repeat(64);
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改全包校验值本身 → 拒绝');

  // 注入未知顶层字段
  t = JSON.parse(JSON.stringify(pkg));
  t.publishedAt = '2026-01-01T00:00:00Z';
  await rejected(parseReleasePackage(JSON.stringify(t)), '注入时间戳字段 → 拒绝');

  // 快照内路径越界 → 门禁拒绝
  t = JSON.parse(JSON.stringify(pkg));
  t.payload.radicals[0].baseShape = 'M0 0 L999 999';
  await rejected(parseReleasePackage(JSON.stringify(t)), '快照内含越界路径 → 拒绝');
  // 快照内含残缺路径
  t = JSON.parse(JSON.stringify(pkg));
  t.payload.radicals[0].baseShape = 'M0 0 L50';
  await rejected(parseReleasePackage(JSON.stringify(t)), '快照内含残缺路径 → 拒绝');
  // 快照缺阶段字形（同时取形记录也对不上）
  t = JSON.parse(JSON.stringify(pkg));
  t.payload.radicals[0].variants = t.payload.radicals[0].variants.filter((v: { stageId: string }) => v.stageId !== 'stage-2');
  await rejected(parseReleasePackage(JSON.stringify(t)), '快照缺阶段字形 → 拒绝');

  // 格式错误
  await rejected(parseReleasePackage(JSON.stringify({ hello: 1 })), '非发布包 → 拒绝');
  await rejected(parseReleasePackage('{not json'), '非法 JSON → 拒绝');

  // 第二包（带 diff）：篡改 diff 也必须拒绝（全包校验值覆盖）
  const d2 = base();
  d2.lexemes[0] = { ...d2.lexemes[0], layout: 'vertical' };
  const pkgB = await buildReleasePackage(d2, { sequence: 2, prev: pkg });
  t = JSON.parse(JSON.stringify(pkgB));
  t.diff.layout = []; // 抹掉布局变化
  await rejected(parseReleasePackage(JSON.stringify(t)), '篡改差异内容 → 拒绝（全包校验值不符）');
  t = JSON.parse(JSON.stringify(pkgB));
  t.diff = null; // 破坏 diff 结构
  await rejected(parseReleasePackage(JSON.stringify(t)), '破坏差异字段 → 拒绝');
  const okB = await parseReleasePackage(JSON.stringify(pkgB));
  ok(!!okB.diff && okB.diff.layout.length === 1, '带差异的第二包正常导入');

  // 带基准上下文：篡改 diff（即使同步重算全包校验值也应被重建比对拦截）
  {
    const t = JSON.parse(JSON.stringify(pkgB));
    t.diff.paths = ['rad-sun']; // 伪造路径变化
    // 攻击者若只改 diff，全包校验值先就不符；这里模拟更狡猾情形：重算 checksum
    t.checksum = await checksumForArtifact({
      format: t.format, formatVersion: t.formatVersion, contentChecksum: t.contentChecksum,
      payload: t.payload, manifest: t.manifest, fallbackRecords: t.fallbackRecords,
      report: t.report, diff: t.diff,
    });
    await rejected(
      parseReleasePackage(JSON.stringify(t), { prev: pkg }),
      '基准包在场时，伪造 diff（并重算校验值）仍被重建比对拒绝'
    );
    // 同一份文件但无基准上下文：全包校验值自洽，结构校验放行
    const noBasis = await parseReleasePackage(JSON.stringify(t));
    ok(noBasis.checksum === t.checksum, '无基准上下文时仅做全包校验值与结构校验');
  }
}

// ── 8. 清空历史后同字系重建：完全相同的包 ─────────────────────────
console.log('[8] 无历史/无时间下的纯函数重建');
{
  const a = await buildReleasePackage(base(), { sequence: 1, prev: null });
  // 模拟「清空本地存档后，同一份字系再次发布第一包」
  const b = await buildReleasePackage(base(), { sequence: 1, prev: null });
  eq(a, b, '两次首包逐字节一致');
  ok(JSON.stringify(a) === JSON.stringify(b), '序列化结果完全相同');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
