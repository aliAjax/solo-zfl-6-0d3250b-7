// 真实浏览器冒烟（Playwright + headless Chromium，驱动 vite preview）
const { chromium } = require('playwright');

const BASE = 'http://localhost:4173/';
const STORAGE_KEY = 'fictional-writing-system-v1';
let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗ FAIL:', msg); }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  // 沙箱无外网：拦截 Google 字体，避免截图等待字体加载
  await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
  await page.route('**/fonts.gstatic.com/**', (r) => r.abort());
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // ── 1. 启动：字形网格正常渲染 ─────────────────────────────────
  console.log('[B1] 启动与既有页面兼容');
  await page.goto(BASE + '#/glyphs');
  await page.waitForSelector('text=字形库');
  await page.waitForSelector('svg[viewBox=\"0 0 100 100\"] path');
  ok((await page.locator('svg[viewBox=\"0 0 100 100\"] path').count()) > 30, '字根 SVG 路径渲染出来');

  // ── 2. 五个既有页面均可打开、无控制台错误 ─────────────────────
  for (const [hash, text] of [
    ['#/timeline', '演化时间线'],
    ['#/editor/radical', '字根编辑'],
    ['#/composer', '字根组合器'],
    ['#/lexicon', '词条库'],
  ]) {
    await page.goto(BASE + hash);
    await page.waitForSelector(`text=${text}`);
    ok(true, `页面可打开：${text}`);
  }

  // ── 3. 发布台：五项校验全过 ───────────────────────────────────
  console.log('[B2] 发布台首次发布');
  await page.goto(BASE + '#/publish');
  await page.waitForSelector('text=发布台');
  await page.waitForSelector('text=五项全过');
  ok((await page.locator('text=五项全过').count()) >= 1, '校验面板显示五项全过');
  const publishBtn = page.getByRole('button', { name: /编译并发布只读包/ });
  ok(await publishBtn.isEnabled(), '发布按钮可用');

  await publishBtn.click();
  await page.waitForSelector('text=第 01 号发布包');
  await page.waitForSelector('text=只读');
  ok(await page.locator('text=字形清单').count(), '包详情出现（字形清单标签）');
  const checksum = (await page.locator('button[title="点击复制校验值"] code').first().textContent()).trim();
  ok(/^[0-9a-f]{64}$/.test(checksum), `稳定校验值为 64 位 SHA-256：${checksum.slice(0, 16)}…`);
  await page.screenshot({ path: '/tmp/publish-01.png', fullPage: false });

  // ── 4. 字形清单 / 回退记录 / 校验报告标签内容 ─────────────────
  console.log('[B3] 包内四个标签页');
  await page.getByRole('button', { name: /阶段取形记录/ }).click();
  await page.waitForSelector('text=合法包内记录全部为');
  await page.waitForSelector('text=本相');
  ok(true, '取形记录：全部为本相，无不可达状态');
  await page.getByRole('button', { name: /校验报告/ }).click();
  await page.waitForSelector('text=校验通过');
  await page.waitForSelector('text=全包校验值（SHA-256');
  ok(true, '校验报告：通过且展示校验值');
  await page.getByRole('button', { name: /与上一包对照/ }).first().click();
  await page.waitForSelector('text=这是第一号发布包');
  ok(true, '首包对照页提示无更早包');
  await page.getByRole('button', { name: /字形清单/ }).click();
  await page.waitForSelector('text=共 12 个字根');
  ok(true, '字形清单列出 12 字根');

  // ── 5. 重复发布：不产生新包 ───────────────────────────────────
  console.log('[B4] 同一份数据重复发布');
  await page.getByRole('button', { name: /编译并发布只读包/ }).click();
  await page.waitForSelector('text=未生成重复新包');
  ok(true, '提示内容一致、未生成重复新包');
  ok((await page.locator('text=第 01 号发布包').count()) >= 1, '仍是第 01 号包');

  // ── 6. 第二包 + 差异对照：改一个词条布局 ───────────────────────
  console.log('[B5] 改动后发布并对照');
  await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const data = JSON.parse(raw);
    const lexemes = data.state.lexemes;
    lexemes[0].layout = lexemes[0].layout === 'horizontal' ? 'vertical' : 'horizontal';
    localStorage.setItem(key, JSON.stringify(data));
  }, STORAGE_KEY);
  await page.reload();
  await page.waitForSelector('text=五项全过');
  await page.getByRole('button', { name: /编译并发布只读包/ }).click();
  await page.waitForSelector('text=第 02 号发布包');
  await page.getByRole('button', { name: /与上一包对照/ }).click();
  await page.waitForSelector('text=与上一包对照');
  await page.waitForSelector('text=布局变化');
  const layoutRow = page.locator('li').filter({ hasText: '左右排列' }).filter({ hasText: '上下堆叠' });
  ok(await layoutRow.count() >= 1, '对照中显示布局前后值（左右排列 → 上下堆叠）');
  await page.waitForSelector('text=受影响词条');
  ok(true, '列出受影响字根/词条');
  await page.screenshot({ path: '/tmp/publish-02-diff.png', fullPage: false });

  // 旧包仍在且内容不变
  await page.locator('button', { hasText: '第 01 号' }).first().click();
  await page.waitForSelector('text=第 01 号发布包');
  await page.getByRole('button', { name: /校验报告/ }).click();
  const cs1 = (await page.locator('button[title="点击复制校验值"] code').first().textContent()).trim();
  ok(cs1 === checksum, '旧包校验值未随数据改动而变化');

  // ── 7. 校验失败时当前数据与旧包不变 ───────────────────────────
  console.log('[B6] 失败原子性（注入坏数据）');
  const releasesCountBefore = await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    return data.state.releases.length;
  }, STORAGE_KEY);
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    // 制造：缺失阶段字形 + 断链 + 路径越界
    data.state.radicals[0].variants = [];
    data.state.lexemes[0].radicalIds.push('rad-not-exist');
    data.state.radicals[1].baseShape = 'M0 0 L200 200';
    localStorage.setItem(key, JSON.stringify(data));
  }, STORAGE_KEY);
  await page.reload();
  await page.waitForSelector('text=项待修');
  const disabledBtn = page.getByRole('button', { name: /存在校验问题，无法发布/ });
  ok(await disabledBtn.isDisabled(), '存在问题时发布按钮禁用');
  await page.waitForSelector('text=断链');
  await page.waitForSelector('text=缺失阶段字形');
  await page.waitForSelector('text=路径越界');
  ok(true, '三类问题分别列出');
  const releasesCountAfter = await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    return data.state.releases.length;
  }, STORAGE_KEY);
  ok(releasesCountBefore === releasesCountAfter, `旧包数量不变（${releasesCountAfter} 个）`);

  // ── 8. 恢复干净数据，发布包导入导出往返（下载 → 重新导入） ─────
  console.log('[B7] 发布包导入导出');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload(); // 整页刷新：清空存档后回到初始 mock 数据
  await page.goto(BASE + '#/glyphs');
  await page.waitForSelector('text=字形库');
  await page.goto(BASE + '#/publish');
  await page.waitForSelector('text=五项全过');
  await page.getByRole('button', { name: /编译并发布只读包/ }).click();
  await page.waitForSelector('text=第 01 号发布包');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /导出此包/ }).click(),
  ]);
  const filePath = '/tmp/release-export.json';
  await download.saveAs(filePath);
  const fs = require('fs');
  const exported = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  ok(exported.format === 'glyph-evolution-release' && exported.formatVersion === 1, '导出文件格式标识正确');
  ok(/^[0-9a-f]{64}$/.test(exported.checksum), '导出文件含校验值');

  // 删除本地包后通过导入按钮导回
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /^删除$/ }).click();
  await page.waitForSelector('text=尚无发布包');
  await page.setInputFiles('input[type=file]', filePath);
  await page.waitForSelector('text=校验值验真通过');
  await page.waitForSelector('text=第 01 号发布包');
  ok(true, '删除后导入同一包成功（独立存档，当前字系未动）');

  // 重复导入被拒
  await page.setInputFiles('input[type=file]', filePath);
  await page.waitForSelector('text=该发布包已在发布台中');
  ok(true, '重复导入被拒绝');

  // 篡改导出文件后导入必须被拒（重建 + 全包校验值）
  const fs2 = require('fs');
  const tamperedPath = '/tmp/release-tampered.json';
  const t = JSON.parse(fs2.readFileSync(filePath, 'utf8'));
  t.manifest.totalRadicals = 1;
  fs2.writeFileSync(tamperedPath, JSON.stringify(t));
  await page.setInputFiles('input[type=file]', tamperedPath);
  await page.waitForSelector('text=导入被拒绝');
  ok(true, '篡改字形清单后导入被拒绝');

  // 残缺路径数据无法发布
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    data.state.radicals[0].baseShape = 'M10 10 L20';
    localStorage.setItem(key, JSON.stringify(data));
  }, STORAGE_KEY);
  await page.goto(BASE);
  await page.goto(BASE + '#/publish');
  await page.waitForSelector('text=项待修');
  ok(await page.getByRole('button', { name: /存在校验问题，无法发布/ }).isDisabled(), '残缺路径时发布按钮禁用');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  // 弧线主体越界（终点在框内、弧身鼓出画框）也必须被门禁拦截：重置后注入弧线
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.goto(BASE + '#/glyphs');
  await page.waitForSelector('text=字形库');
  // zustand 仅在状态变更后写盘：点一张字根卡触发持久化
  await page.locator('.group.relative.bg-parchment-50').first().click();
  await page.waitForFunction((key) => !!localStorage.getItem(key), STORAGE_KEY);
  await page.evaluate((key) => {
    const data = JSON.parse(localStorage.getItem(key));
    data.state.radicals[0].baseShape = 'M40 50 A55 55 0 1 1 60 50';
    localStorage.setItem(key, JSON.stringify(data));
  }, STORAGE_KEY);
  await page.goto(BASE);
  await page.goto(BASE + '#/publish');
  await page.waitForSelector('text=项待修');
  await page.waitForSelector('text=弧身');
  ok(await page.getByRole('button', { name: /存在校验问题，无法发布/ }).isDisabled(), '弧线主体越界时发布按钮禁用');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);

  // ── 9. 全局控制台错误 ─────────────────────────────────────────
  console.log('[B8] 浏览器控制台错误检查');
  const interesting = errors.filter((e) =>
    !e.includes('favicon') && !e.includes('trae') && !e.includes('speechSynthesis') && !e.includes('fonts.g') && !e.includes('ERR_FAILED')
  );
  ok(interesting.length === 0, `无脚本错误（${interesting.length}）${interesting[0] ? '：' + interesting[0] : ''}`);

  await browser.close();
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
