/* app.js — قارئ الشموع: يقرأ لقطة شاشة، يستخرج الشموع، ويحسب إشارة صعود/هبوط */

/* ============ النواة (لا تعتمد على المتصفح، وتُختبر في Node) ============ */
const Core = (() => {
  const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }

  // كشف تلقائي لأكثر لونين شيوعًا (أخضر/أزرق مخضر وأحمر) في الصورة
  function autoColors(img) {
    const { data, width, height } = img, bins = new Map();
    for (let i = 0; i < width * height; i++) {
      const p = i * 4, r = data[p], g = data[p + 1], b = data[p + 2], [h, s, v] = hsv(r, g, b);
      if (s < 0.35 || v < 0.3) continue;
      const kind = (h >= 65 && h <= 195) ? 'g' : ((h <= 25 || h >= 335) ? 'r' : null);
      if (!kind) continue;
      const key = kind + (((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      let e = bins.get(key); if (!e) { e = { k: kind, n: 0, r: 0, g: 0, b: 0 }; bins.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b;
    }
    let bg = null, br = null;
    bins.forEach(e => { if (e.k === 'g' && (!bg || e.n > bg.n)) bg = e; if (e.k === 'r' && (!br || e.n > br.n)) br = e; });
    const col = e => e ? [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)] : null;
    return { up: col(bg), down: col(br) };
  }

  // استخراج الشموع: opt = { up:[r,g,b], down:[r,g,b], tol, region:{x,y,w,h} }
  function extractCandles(img, opt) {
    const { data, width, height } = img, tol2 = (opt.tol || 60) ** 2;
    const R = opt.region || { x: 0, y: 0, w: width, h: height }, U = opt.up, D = opt.down;
    if (!U || !D) return [];
    const x0 = clamp(Math.floor(R.x), 0, width), y0 = clamp(Math.floor(R.y), 0, height);
    const x1 = clamp(Math.ceil(R.x + R.w), 0, width), y1 = clamp(Math.ceil(R.y + R.h), 0, height);
    const W = x1 - x0, H = y1 - y0; if (W < 10 || H < 10) return [];
    const cls = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = ((y + y0) * width + (x + x0)) * 4, r = data[p], g = data[p + 1], b = data[p + 2];
      const du = (r - U[0]) ** 2 + (g - U[1]) ** 2 + (b - U[2]) ** 2, dd = (r - D[0]) ** 2 + (g - D[1]) ** 2 + (b - D[2]) ** 2;
      if (du <= tol2 || dd <= tol2) cls[y * W + x] = du <= dd ? 1 : 2;
    }
    // حذف الخطوط الأفقية الطويلة (مثل خط السعر الحالي) حتى لا تدمج الشموع
    for (let y = 0; y < H; y++) {
      let c = 0; for (let x = 0; x < W; x++) if (cls[y * W + x]) c++;
      if (c > W * 0.5) for (let x = 0; x < W; x++) cls[y * W + x] = 0;
    }
    // الأعمدة المتصلة = شمعة
    const act = []; for (let x = 0; x < W; x++) { let n = 0; for (let y = 0; y < H; y++) if (cls[y * W + x]) n++; act.push(n >= 1); }
    const raw = []; let s = -1;
    for (let x = 0; x <= W; x++) { const a = x < W && act[x]; if (a && s < 0) s = x; if (!a && s >= 0) { raw.push([s, x - 1]); s = -1; } }
    let cl = raw.map(([a, b]) => {
      let up = 0, dn = 0, top = 1e9, bot = -1;
      for (let x = a; x <= b; x++) for (let y = 0; y < H; y++) { const v = cls[y * W + x]; if (v) { v === 1 ? up++ : dn++; if (y < top) top = y; if (y > bot) bot = y; } }
      return { a, b, w: b - a + 1, up, dn, top, bot };
    }).filter(c => c.bot - c.top >= 2);
    if (!cl.length) return [];
    const ws = cl.map(c => c.w).sort((p, q) => p - q), mw = ws[Math.floor(ws.length / 2)];
    cl = cl.filter(c => c.w <= mw * 2.2 && c.w >= Math.max(1, mw * 0.4)); // يستبعد الأزرار والنصوص
    return cl.map(c => {
      const type = c.up >= c.dn ? 'up' : 'down', rows = [];
      for (let y = c.top; y <= c.bot; y++) { let n = 0; for (let x = c.a; x <= c.b; x++) if (cls[y * W + x]) n++; rows.push(n); }
      const thr = c.w <= 2 ? 1 : Math.max(2, 0.55 * c.w); let bt = -1, bb = -1;
      rows.forEach((n, i) => { if (n >= thr) { if (bt < 0) bt = i; bb = i; } });
      if (bt < 0) { const mx = Math.max(...rows); rows.forEach((n, i) => { if (n >= mx * 0.6) { if (bt < 0) bt = i; bb = i; } }); }
      const bodyTop = c.top + bt, bodyBot = c.top + bb, P = y => -(y + y0);
      return { x: c.a + x0, w: c.w, type, h: P(c.top), l: P(c.bot), o: type === 'up' ? P(bodyBot) : P(bodyTop), c: type === 'up' ? P(bodyTop) : P(bodyBot), top: c.top + y0, bot: c.bot + y0 };
    });
  }

  // الإشارة: تصويت موزون لخمسة عناصر، كلها بلا وحدة (مقسومة على متوسط مدى الشمعة)
  function predict(cs, opt) {
    const hz = Math.max(1, (opt && opt.horizon) || 3);  // عدد الشموع القادمة المراد التنبؤ بها
    const n = cs.length, atr = mean(cs.map(c => c.h - c.l)) || 1e-9, closes = cs.map(c => c.c), last = cs[n - 1], prev = cs[n - 2];
    const mc = mean(closes), sd = Math.sqrt(mean(closes.map(x => (x - mc) ** 2))) || atr;
    const xs = closes.map((_, i) => i), mx = mean(xs), slope = xs.reduce((s, x, i) => s + (x - mx) * (closes[i] - mc), 0) / (xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1);
    const hiAll = Math.max(...cs.map(c => c.h)), loAll = Math.min(...cs.map(c => c.l)), pos = (last.c - loAll) / ((hiAll - loAll) || 1e-9);
    // نمط الشموع
    const body = c => Math.abs(c.c - c.o), range = c => (c.h - c.l) || 1e-9, upW = c => c.h - Math.max(c.o, c.c), loW = c => Math.min(c.o, c.c) - c.l;
    let pat = 0, patName = 'لا نمط واضح';
    if (prev.c < prev.o && last.c > last.o && last.o <= prev.c && last.c >= prev.o) { pat = 1; patName = 'ابتلاع شرائي'; }
    else if (prev.c > prev.o && last.c < last.o && last.o >= prev.c && last.c <= prev.o) { pat = -1; patName = 'ابتلاع بيعي'; }
    else if (loW(last) >= 2 * body(last) && upW(last) <= 0.5 * Math.max(body(last), 0.2 * range(last)) && pos < 0.5) { pat = 0.7; patName = 'مطرقة (ذيل سفلي طويل)'; }
    else if (upW(last) >= 2 * body(last) && loW(last) <= 0.5 * Math.max(body(last), 0.2 * range(last)) && pos > 0.5) { pat = -0.7; patName = 'شهاب (ذيل علوي طويل)'; }
    const comp = [
      { k: 'trend', name: 'الاتجاه العام', w: 0.25, f: Math.tanh(slope * n / (2 * atr * Math.sqrt(n / 15))), txt: 'ميل الإغلاقات خلال الشموع كلها' },
      { k: 'mom', name: 'الزخم الأخير', w: 0.20, f: Math.tanh((closes[n - 1] - closes[Math.max(0, n - 1 - hz)]) / (1.5 * atr * Math.sqrt(hz / 3))), txt: 'حركة آخر ' + hz + ' شموع' },
      { k: 'rev', name: 'الارتداد لمتوسط السعر', w: 0.25, f: -Math.tanh(((last.c - mc) / sd) / 1.5), txt: 'ابتعاد الإغلاق عن متوسط الشموع (التمدد يميل للعودة)' },
      { k: 'rng', name: 'موقع السعر في النطاق', w: 0.10, f: clamp((0.5 - pos) * 1.6, -1, 1), txt: 'قرب القمة يميل للهبوط وقرب القاع يميل للصعود' },
      { k: 'pat', name: 'نمط الشموع: ' + patName, w: 0.20, f: pat, txt: 'من آخر شمعتين' }
    ];
    const S = comp.reduce((s, c) => s + c.w * c.f, 0), dir = Math.abs(S) < 0.05 ? 'neutral' : (S > 0 ? 'up' : 'down');
    const agree = dir === 'neutral' ? 0 : comp.filter(c => Math.abs(c.f) > 0.1 && Math.sign(c.f) === Math.sign(S)).length;
    return { dir, score: S, strength: Math.round(clamp(Math.abs(S) / 0.6, 0, 1) * 100), agree, total: comp.length, comp, n };
  }

  function wilson(w, n) {
    if (!n) return [0, 1]; const z = 1.96, p = w / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
  }
  return { autoColors, extractCandles, predict, wilson };
})();
if (typeof module !== 'undefined') module.exports = Core;

/* ============ الواجهة ============ */
if (typeof document !== 'undefined') (function () {
  const $ = id => document.getElementById(id);
  const cv = $('cv'), ctx = cv.getContext('2d', { willReadFrequently: true });
  const st = { up: null, down: null, region: null, mode: null, tol: 60, n: 40, skipLast: false, cands: [], used: [], last: null };
  const J_KEY = 'cs_journal_v1', P_KEY = 'cs_payout';
  const HORIZON = 5;   // التنبؤ بالشموع الخمس القادمة (3 دقائق × 5 = 15 دقيقة)
  let src = null;
  const journal = () => { try { return JSON.parse(localStorage.getItem(J_KEY)) || []; } catch (e) { return []; } };
  const saveJ = a => { try { localStorage.setItem(J_KEY, JSON.stringify(a)); } catch (e) { /* تجاهل */ } };
  const say = t => { $('info').textContent = t; };
  const css = c => c ? 'rgb(' + c.join(',') + ')' : 'transparent';
  const bucket = s => s < 30 ? 'weak' : (s < 60 ? 'mid' : 'strong');
  const BN = { weak: 'ضعيفة (أقل من 30%)', mid: 'متوسطة (30–60%)', strong: 'قوية (60% فأكثر)' };

  // ---- الحساب التجريبي (محاكاة داخل الموقع): حجم الصفقة + إيقاف عند ربح/خسارة % ----
  const S_KEY = 'cs_sim_v1', DEF = { start: 1000, stakePct: 2, tp: 10, sl: 5 };
  let sim = (() => { try { return Object.assign({}, DEF, { sid: Date.now() }, JSON.parse(localStorage.getItem(S_KEY)) || {}); } catch (e) { return Object.assign({}, DEF, { sid: Date.now() }); } })();
  const saveSim = () => { try { localStorage.setItem(S_KEY, JSON.stringify(sim)); } catch (e) { /* تجاهل */ } };
  const payoutNow = () => (+$('payout').value || 85) / 100;
  function simStats() {
    const es = journal().filter(x => x.sid === sim.sid), pnl = es.reduce((s, x) => s + (x.pnl || 0), 0), bal = sim.start + pnl, pl = pnl / sim.start * 100;
    return { bal, pl, n: es.length, open: es.filter(x => !x.res).length, status: (pl >= sim.tp) ? 'tp' : ((pl <= -sim.sl || bal <= 0) ? 'sl' : 'active') };
  }
  function updateStakeTxt() {
    const t = $('stakeTxt');
    if (!st.last || st.last.dir === 'neutral') { t.textContent = ''; return; }
    const s = simStats();
    t.textContent = s.status !== 'active' ? 'الجلسة التجريبية متوقفة؛ لا صفقة جديدة.' : 'حجم الصفقة المقترح: ' + (s.bal * sim.stakePct / 100).toFixed(2) + ' (' + sim.stakePct + '% من الرصيد)';
  }
  function renderSim() {
    const s = simStats(), ul = $('simBox'); ul.textContent = '';
    const msg = { active: 'الجلسة نشطة.', tp: 'تم الوصول إلى هدف الربح: الجلسة متوقفة. راجع نتائجك ثم ابدأ جلسة جديدة.', sl: 'تم الوصول إلى حد الخسارة: الجلسة متوقفة. لا تعوّض الخسارة بزيادة الحجم.' }[s.status];
    ['الرصيد: ' + s.bal.toFixed(2) + ' (' + (s.pl >= 0 ? '+' : '') + s.pl.toFixed(1) + '%)', 'صفقات الجلسة: ' + s.n + (s.open ? ' (بانتظار النتيجة: ' + s.open + ')' : ''), msg]
      .forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.append(li); });
    ul.className = 'stats ' + s.status;
    $('simWarn').textContent = sim.stakePct > 5 ? 'حجم الصفقة أكبر من 5% من الرصيد: سلسلة خسائر قصيرة قد تنهي الجلسة بسرعة.' : '';
    updateStakeTxt();
  }
  const num = (id, lo, hi, d) => { const v = parseFloat($(id).value); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  $('simStart').value = sim.start; $('simStake').value = sim.stakePct; $('simTP').value = sim.tp; $('simSL').value = sim.sl;
  ['simStake', 'simTP', 'simSL'].forEach(id => { $(id).onchange = () => {
    sim.stakePct = num('simStake', 0.1, 100, 2); sim.tp = num('simTP', 0.1, 1000, 10); sim.sl = num('simSL', 0.1, 100, 5);
    $('simStake').value = sim.stakePct; $('simTP').value = sim.tp; $('simSL').value = sim.sl; saveSim(); renderJournal();
  }; });
  $('bSim').onclick = () => { sim.start = num('simStart', 1, 1e9, 1000); $('simStart').value = sim.start; sim.sid = Date.now(); saveSim(); renderJournal(); };

  function loadFile(f) {
    if (!f || !/^image\//.test(f.type)) return say('اختر ملف صورة.');
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / im.width); cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      ctx.drawImage(im, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      src = ctx.getImageData(0, 0, cv.width, cv.height);
      const a = Core.autoColors(src); st.up = a.up; st.down = a.down; st.region = null; st.mode = null;
      $('work').hidden = false; syncSwatches(); analyze();
    };
    im.onerror = () => say('تعذّر قراءة الصورة.');
    im.src = url;
  }
  function syncSwatches() { $('sUp').style.background = css(st.up); $('sDown').style.background = css(st.down); }

  function draw() {
    if (!src) return; ctx.putImageData(src, 0, 0);
    const usedSet = new Set(st.used);
    st.cands.forEach(c => {
      ctx.lineWidth = 2; ctx.strokeStyle = usedSet.has(c) ? '#f5c242' : 'rgba(255,255,255,.25)';
      ctx.strokeRect(c.x - 2, c.top - 2, c.w + 4, c.bot - c.top + 4);
    });
    st.used.forEach((c, i) => { ctx.fillStyle = '#f5c242'; ctx.font = '12px sans-serif'; ctx.fillText(String(i + 1), c.x, Math.max(12, c.top - 6)); });
    if (st.region) { ctx.setLineDash([6, 4]); ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 2; ctx.strokeRect(st.region.x, st.region.y, st.region.w, st.region.h); ctx.setLineDash([]); }
  }

  function analyze() {
    if (!src) return;
    if (!st.up || !st.down) { draw(); $('result').hidden = true; return say('لم أستطع تحديد ألوان الشموع تلقائيًا. اضغط «لون الصاعدة» ثم اضغط على شمعة صاعدة، وكرر مع الهابطة.'); }
    st.cands = Core.extractCandles(src, { up: st.up, down: st.down, tol: st.tol, region: st.region });
    let use = st.skipLast ? st.cands.slice(0, -1) : st.cands; use = use.slice(-st.n); st.used = use; draw();
    if (use.length < 5) { $('result').hidden = true; return say('قرأتُ ' + st.cands.length + ' شمعة فقط. حدّد منطقة الشموع فقط (بدون الأزرار والأرقام)، أو كبّر الشموع قليلًا، أو عدّل حساسية اللون.'); }
    say('قرأتُ ' + st.cands.length + ' شمعة واستخدمتُ آخر ' + use.length + (use.length < st.n ? ' (أقل من ' + st.n + ' المطلوبة).' : '.') + ' راجع المربعات الصفراء على الصورة للتأكد.');
    show(Core.predict(use, { horizon: HORIZON }));
  }

  function show(r) {
    st.last = r; $('result').hidden = false;
    const d = $('dir'); d.className = 'dir ' + r.dir;
    d.textContent = r.dir === 'up' ? 'صعود ↑' : (r.dir === 'down' ? 'هبوط ↓' : 'محايد — لا إشارة واضحة');
    $('bar').style.width = r.strength + '%'; $('bar').className = r.dir;
    $('strengthTxt').textContent = 'قوة الإشارة: ' + r.strength + '%';
    $('agreeTxt').textContent = r.dir === 'neutral' ? 'العناصر متعادلة؛ الأفضل عدم الدخول.' : 'اتفق ' + r.agree + ' من ' + r.total + ' عناصر على هذا الاتجاه.';
    const ul = $('why'); ul.textContent = '';
    r.comp.forEach(c => {
      const li = document.createElement('li'), v = Math.round(c.f * 100);
      li.textContent = c.name + ': ' + (Math.abs(v) < 10 ? 'محايد' : (v > 0 ? 'يميل للصعود' : 'يميل للهبوط')) + ' (' + Math.abs(v) + '%) — ' + c.txt;
      li.className = Math.abs(v) < 10 ? 'n' : (v > 0 ? 'u' : 'd'); ul.append(li);
    });
    $('bRecord').disabled = r.dir === 'neutral'; renderJournal();
  }

  // ---- الإشارات على الصورة ----
  function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    if (!src || !st.mode) return; const p = pos(e);
    if (st.mode === 'crop') { drag = p; st.region = { x: p.x, y: p.y, w: 0, h: 0 }; cv.setPointerCapture(e.pointerId); }
    else {
      const x = Math.min(src.width - 1, Math.max(0, Math.round(p.x))), y = Math.min(src.height - 1, Math.max(0, Math.round(p.y))), i = (y * src.width + x) * 4;
      st[st.mode] = [src.data[i], src.data[i + 1], src.data[i + 2]]; setMode(null); syncSwatches(); analyze();
    }
  });
  cv.addEventListener('pointermove', e => { if (!drag) return; const p = pos(e); st.region = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; draw(); });
  cv.addEventListener('pointerup', () => { if (!drag) return; drag = null; setMode(null); if (st.region.w < 20 || st.region.h < 20) st.region = null; analyze(); });
  function setMode(m) { st.mode = m; cv.classList.toggle('pick', !!m); }
  $('bUp').onclick = () => { setMode('up'); say('اضغط على جسم شمعة صاعدة في الصورة.'); };
  $('bDown').onclick = () => { setMode('down'); say('اضغط على جسم شمعة هابطة في الصورة.'); };
  $('bCrop').onclick = () => { setMode('crop'); say('اسحب بإصبعك مستطيلًا حول الشموع فقط.'); };
  $('bAuto').onclick = () => { if (!src) return; const a = Core.autoColors(src); st.up = a.up; st.down = a.down; st.region = null; syncSwatches(); analyze(); };
  $('tol').oninput = e => { st.tol = +e.target.value; $('tolV').textContent = st.tol; analyze(); };
  $('nCount').onchange = e => { st.n = Math.max(5, Math.min(60, +e.target.value || 40)); e.target.value = st.n; analyze(); };
  $('skipLast').onchange = e => { st.skipLast = e.target.checked; analyze(); };

  // ---- رفع الصورة: اختيار / سحب / لصق ----
  $('file').onchange = e => loadFile(e.target.files[0]);
  const dz = $('drop');
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', e => { const f = [...(e.clipboardData ? e.clipboardData.files : [])][0]; if (f) loadFile(f); });

  // ---- سجل التنبؤات: المعايرة الحقيقية للنسبة ----
  function stats(list) {
    const dec = list.filter(x => x.res), w = dec.filter(x => x.res === 'win').length, n = dec.length;
    return { n, w, rate: n ? w / n : 0, ci: Core.wilson(w, n) };
  }
  $('payout').value = localStorage.getItem(P_KEY) || 85;
  $('payout').onchange = () => { localStorage.setItem(P_KEY, $('payout').value); renderJournal(); };
  $('bRecord').onclick = () => {
    if (!st.last || st.last.dir === 'neutral') return;
    const s = simStats(), m = $('bRecord'), back = () => { m.textContent = 'سجّل هذا التنبؤ في السجل'; };
    if (s.status !== 'active') { m.textContent = 'الجلسة متوقفة'; setTimeout(back, 1800); return; }
    const a = journal();
    a.push({ id: Date.now(), t: Date.now(), dir: st.last.dir, strength: st.last.strength, res: null, sid: sim.sid, stake: +(s.bal * sim.stakePct / 100).toFixed(2), pnl: null });
    saveJ(a); renderJournal(); m.textContent = 'تم التسجيل ✓'; setTimeout(back, 1500);
  };
  function renderJournal() { renderJournal0(); renderSim(); }
  function renderJournal0() {
    const a = journal(), tb = $('jBody'); tb.textContent = '';
    a.slice().reverse().forEach(x => {
      const tr = document.createElement('tr'), t = new Date(x.t), cell = txt => { const td = document.createElement('td'); td.textContent = txt; tr.append(td); return td; };
      cell(t.toLocaleString('ar', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }));
      cell(x.dir === 'up' ? 'صعود' : 'هبوط'); cell(x.strength + '%'); cell(x.stake != null ? x.stake.toFixed(2) : '–');
      const td = cell(''), mk = (label, val, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = 'mini ' + cls; b.onclick = () => { x.res = val; x.pnl = val === 'win' ? (x.stake || 0) * payoutNow() : (val === 'loss' ? -(x.stake || 0) : null); saveJ(a); renderJournal(); }; td.append(b); };
      if (x.res) { td.textContent = (x.res === 'win' ? 'ربح' : 'خسارة') + (x.pnl != null ? ' (' + (x.pnl >= 0 ? '+' : '') + x.pnl.toFixed(2) + ')' : ''); td.className = x.res; mk('تراجع', null, 'u'); }
      else { mk('ربح', 'win', 'w'); mk('خسارة', 'loss', 'l'); }
      const del = document.createElement('button'); del.type = 'button'; del.className = 'mini u'; del.textContent = 'حذف'; del.onclick = () => { saveJ(a.filter(y => y !== x)); renderJournal(); }; const tdd = document.createElement('td'); tdd.append(del); tr.append(tdd);
      tb.append(tr);
    });
    if (!a.length) { const tr = tb.insertRow(), td = tr.insertCell(); td.colSpan = 6; td.className = 'empty'; td.textContent = 'لا توجد تنبؤات مسجّلة بعد.'; }
    const s = stats(a), p = (+$('payout').value || 85) / 100, be = 1 / (1 + p), box = $('stats');
    let v = 'سجّل نتائج 30 تنبؤًا على الأقل ليظهر تقييم.';
    if (s.n >= 30) v = s.ci[0] > be ? 'نسبتك أعلى من نقطة التعادل بثقة 95%.' : (s.ci[1] < be ? 'نسبتك أقل من نقطة التعادل: الطريقة خاسرة إحصائيًا حتى الآن.' : 'لا يمكن الجزم: الفارق عن نقطة التعادل ضمن هامش الخطأ.');
    const rows = ['weak', 'mid', 'strong'].map(k => { const b = stats(a.filter(x => bucket(x.strength) === k)); return BN[k] + ': ' + (b.n ? Math.round(b.rate * 100) + '% (' + b.w + '/' + b.n + ')' : 'لا بيانات'); });
    box.textContent = ''; [
      'نتائجك الفعلية: ' + (s.n ? Math.round(s.rate * 100) + '% (' + s.w + ' ربح من ' + s.n + ')' : 'لا نتائج بعد'),
      s.n ? 'هامش الخطأ 95%: من ' + Math.round(s.ci[0] * 100) + '% إلى ' + Math.round(s.ci[1] * 100) + '%' : '',
      'نقطة التعادل عند عائد ' + Math.round(p * 100) + '%: ' + (be * 100).toFixed(1) + '%', v, ...rows
    ].filter(Boolean).forEach(t => { const li = document.createElement('li'); li.textContent = t; box.append(li); });
  }
  renderJournal();
})();
