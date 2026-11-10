/* ============================================================
   自在极意 · 桌面宠物（小塔菲）
   素材：assets/pet/*.png（透明底，统一画布 326×583）
   想换素材：同名覆盖即可，无需改代码

   行为分层：
     · 基础层  移动 / 拖拽 / 视线
     · 状态层  情绪值 mood、困倦、心流守护
     · 表演层  待机小动作、点击分级反应、粒子
   ============================================================ */
(function (global) {
  'use strict';

  const Pet = {};
  const BASE = 'assets/pet/';
  const RATIO = 326 / 583;   // 素材宽高比，用于估算未加载完成时的宽度

  const ASSET = {
    calm: BASE + 'front_calm.png',
    laugh: BASE + 'front_laugh.png',
    puzzle: BASE + 'front_puzzle.png',
    goofy: BASE + 'front_goofy.png',
    cry: BASE + 'front_cry.png',
    money: BASE + 'front_money.png',
    sulk: BASE + 'front_sulk.png',
    sleep: BASE + 'front_sleep.png',
    side: BASE + 'side.png',
    back: BASE + 'back.png'
  };

  /* ---------------- 台词库 ----------------
     统一口径：每句以「喵」收尾，语气是关心 + 自我吐槽，
     不出现任何暧昧/身体接触暗示（之前的「别停」「这里，对，这里」已删掉）。 */
  const LINES = {
    greetMorning: [
      '早安喵，今天也慢慢来就好喵。',
      '醒啦喵？先去喝口水喵。',
      '早上好喵，把今天最想做的事写下来喵。',
      '别急着开电脑喵，先伸个懒腰喵。'
    ],
    greetNoon: [
      '中午啦喵，站起来走两步喵。',
      '饭吃了没喵？不吃会没力气喵。',
      '别边吃边看屏幕喵，对胃不好喵。',
      '午后容易困喵，撑不住就闭眼三分钟喵。'
    ],
    greetEvening: [
      '天黑啦喵，收一收吧喵。',
      '今天做到这儿也可以喵。',
      '晚上好喵，把明天第一件事写下来喵。',
      '光线暗了喵，记得开灯喵。'
    ],
    greetNight: [
      '这么晚还没睡喵？',
      '夜深了喵，做完手头这件就收工喵。',
      '早点睡喵，明天还要用脑子喵。',
      '再熬下去，明天会还债的喵。'
    ],
    idleHigh: [
      '关注永雏塔菲喵！关注永雏塔菲谢谢喵！',
      '塔不灭，塔不灭喵！',
      'Taffy 不缺钱喵，雏草姬要理性消费喵，好好吃饭喵！',
      '左眼是用来记住你，右眼是用来忘记你喵。',
      '红叶最多情，塔菲不多情喵。',
      '你今天状态不错喵，塔菲都看在眼里喵。'
    ],
    idleMid: [
      '有点困喵……',
      '要不歇五分钟喵？',
      '塔菲在这儿发呆喵。',
      '伸个懒腰吧喵。',
      '喵……'
    ],
    idleLow: [
      '你最近都没理塔菲喵。',
      '塔菲有一点累了喵。',
      '摸摸头就好的喵。',
      '塔菲是不是做错什么了喵。'
    ],
    pat: [
      '嘿嘿喵。',
      '头发要被摸乱啦喵。',
      '再摸一下也可以喵。',
      '塔菲记住这一下了喵。',
      '摸头可以喵，别揪呆毛喵。'
    ],
    annoyed: [
      '别戳啦喵。',
      '呜喵——',
      '头会晕的喵。',
      '你够了喵。',
      '再戳塔菲要生气了喵。'
    ],
    rage: [
      '生气了喵！',
      '哼喵！',
      '不理你了喵。',
      '再戳塔菲就跑了喵。'
    ],
    celebrate: [
      '做完啦喵！',
      '漂亮喵！',
      '这件收工喵。',
      '干得不错喵，塔菲认可你喵。',
      '又少一件喵，塔不灭喵！'
    ],
    flowStart: [
      '塔菲要专心干活啦，杂念通通赶跑喵！',
      '集中精神，效率起飞喵！',
      '事情一件一件啃，总会做完的喵。',
      '安静了喵，塔菲在右下角守着喵。'
    ],
    flowEnd: [
      '辛苦啦喵。',
      '回来了喵？',
      '喝口水喵。',
      '刚才那段时间挺好的喵。'
    ],
    land: [
      '哎哟喵。',
      '放我下来喵……',
      '这里也行喵。',
      '晕喵。'
    ],
    recall: [
      '我在这儿喵。',
      '叫我喵？',
      '来了来了喵。',
      '怎么啦喵。'
    ],
    wake: [
      '唔……我睡着了喵？',
      '啊，我没睡喵！',
      '嗯喵？',
      '被你吵醒了喵。'
    ],
    peek: [
      '写得挺顺的喵。',
      '我不打扰喵，就看一眼喵。',
      '这段我没读懂喵。',
      '要不要歇会儿喵？',
      '嗯喵，继续喵。'
    ],
    overdue: [
      '这件超时了喵。',
      '要不要先做这个喵？',
      '看一眼这个吧喵。'
    ],
    money: [
      '金币掉下来了喵！',
      'Taffy 不缺钱喵，但还是收下喵。',
      '攒着攒着就多了喵。'
    ],
    emoteHappy: [
      '心情不错喵！',
      '今天塔菲状态很好喵。',
      '嘿嘿喵，没什么事喵。',
      '塔不灭喵！'
    ],
    emoteRich: [
      '金币要好好攒着喵，攒多了请你吃饭喵。',
      'Taffy 不缺钱喵，但也不嫌多喵。',
      '钱要花在吃饭上喵，别乱买喵。'
    ],
    emoteThink: [
      '在想晚饭吃什么喵……',
      '刚才要做什么来着喵？',
      '这件事有点难喵，让塔菲想想喵。',
      '嗯喵，塔菲在思考喵。'
    ],
    emoteGoofy: [
      '略略略喵～',
      '看什么看喵，没见过这么可爱的喵？',
      '塔菲在发呆喵，先别打扰喵。'
    ],
    emoteSulk: [
      '哼喵，先不看你喵。',
      '塔菲现在不太高兴喵。',
      '让塔菲安静一下喵。'
    ],
    emoteCry: [
      '呜喵……有点想哭喵。',
      '塔菲不委屈喵，一点都不委屈喵。'
    ],
    emoteCalm: [
      '就这样待着也挺好喵。',
      '安静一会儿喵。',
      '喵。'
    ]
  };

  /* ---------------- 状态 ---------------- */
  const S = {
    x: 0, y: 0,
    anchor: { x: 0, y: 0 },
    size: 180,
    expr: 'calm',
    flip: false,
    gaze: { x: 0, y: 0 },
    dragging: false,
    walking: false,
    visible: true,
    patTimer: null,
    roamTimer: null,
    fidgetTimer: null,
    stepTimer: null,
    bubbleTimer: null,
    signTimer: null,
    exprTimer: null,
    sayTimer: null,
    sayUntil: 0,
    clickReset: null,
    actTimers: [],
    lastAct: Date.now(),
    signShown: {},
    cryShown: {},
    moneyToday: '',
    mood: 74,
    clickBurst: 0,
    sleeping: false,
    flowGuard: false,
    follow: false,
    chatty: true,
    lastPeek: 0,
    vx: 0, vy: 0,
    lastPx: 0, lastPy: 0, lastPt: 0
  };

  let el, img, body, bubble, sign, signText, zzz, layer, logo, logoDot;

  /* ---------------- 小工具 ---------------- */
  function now() { return Date.now(); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /** 登记短动作计时器，切换场景时能一次清干净 */
  function after(ms, fn) {
    const t = setTimeout(fn, ms);
    S.actTimers.push(t);
    if (S.actTimers.length > 48) S.actTimers.splice(0, 24);
    return t;
  }
  function clearActs() {
    S.actTimers.forEach(clearTimeout);
    S.actTimers.length = 0;
  }
  /** 播放一次性动画类，允许重复触发 */
  function cls(name, ms) {
    body.classList.remove(name);
    void body.offsetWidth;
    body.classList.add(name);
    after(ms + 60, () => body.classList.remove(name));
  }

  /* ---------------- 定位 ---------------- */
  function size() {
    return { w: el.offsetWidth || S.size * RATIO, h: S.size };
  }

  function clampPos(x, y) {
    const s = size();
    const pad = 8;
    return {
      x: U.clamp(x, pad, Math.max(pad, window.innerWidth - s.w - pad)),
      y: U.clamp(y, pad, Math.max(pad, window.innerHeight - s.h - pad))
    };
  }

  function setPos(x, y, animate, dur) {
    const p = clampPos(x, y);
    S.x = p.x; S.y = p.y;
    if (animate) {
      el.style.transition = 'transform ' + (dur || 400) + 'ms cubic-bezier(.33,.02,.68,1)';
    } else {
      el.style.transition = 'none';
    }
    el.style.transform = 'translate3d(' + S.x + 'px,' + S.y + 'px,0)';
  }

  function defaultPos() {
    const s = size();
    return { x: window.innerWidth - s.w - 18, y: window.innerHeight - s.h - 26 };
  }

  function syncAnchor() {
    const s = size();
    S.anchor = { x: S.x + s.w / 2, y: S.y + s.h };
  }

  /* ---------------- 外观 ---------------- */
  function applyVisual() {
    const t = [];
    if (S.gaze.x || S.gaze.y) t.push('translate(' + S.gaze.x.toFixed(1) + 'px,' + S.gaze.y.toFixed(1) + 'px)');
    if (S.gaze.rot) t.push('rotate(' + S.gaze.rot.toFixed(2) + 'deg)');
    if (S.flip) t.push('scaleX(-1)');
    img.style.transform = t.join(' ');
  }

  function setView(v) {
    if (v === 'front') {
      S.flip = false;
      setExpr(S.expr, true);
    } else if (v === 'side-left') {
      S.flip = false;
      img.src = ASSET.side;
    } else if (v === 'side-right') {
      S.flip = true;
      img.src = ASSET.side;
    } else if (v === 'back') {
      S.flip = false;
      img.src = ASSET.back;
    }
    applyVisual();
  }

  function setExpr(name, silent) {
    // 睡着时除了闭眼脸，谁都不许改她的表情。
    // 超时举牌（showSign）会在 8 秒里反复触发，不加这道闸就会把她从睡相拽回哭脸。
    if (S.sleeping && name !== 'sleep') return;
    const key = ASSET[name] ? name : 'calm';
    S.expr = name;
    // 走路途中不要换成正面图：否则镜像中的侧身会突然跳回正面（看着像卡住）
    if (!S.walking) {
      img.src = ASSET[key];
      S.flip = false;
      applyVisual();
    }
    if (!silent) {
      clearTimeout(S.exprTimer);
      S.exprTimer = setTimeout(() => { if (!S.walking && !S.sleeping) setExpr('calm', true); }, 2600);
    }
  }
  Pet.setExpr = setExpr;
  /** 让她走到指定位置。dir: 1 向右 / -1 向左 / 省略则按位移判断。
      外部（引导、召回、活动）需要调度她移动时用这个，不必碰内部状态。 */
  Pet.walkTo = walkTo;
  /** 同上，但位移较大时走折线（先横后纵），看起来像真的绕过去而不是平移 */
  Pet.strideTo = strideTo;
  /** 播一段待机情绪（表情 + 小动作 + 台词），返回这次用到的表情名 */
  Pet.emote = playEmote;

  /* ---------------- 情绪 ---------------- */
  function loadMood() {
    const v = Store.setting('petMood');
    S.mood = (typeof v === 'number' && isFinite(v)) ? U.clamp(v, 0, 100) : 74;
    if (typeof v !== 'number') Store.setting('petMood', S.mood);
  }
  function addMood(d) {
    S.mood = U.clamp(S.mood + d, 0, 100);
    Store.setting('petMood', S.mood);
  }
  Pet.mood = () => S.mood;

  /* ---------------- 气泡 ---------------- */
  function bubbleHtml() {
    const doing = Store.byStatus('doing');
    if (!doing.length) {
      return '<div class="pb-head">现在</div><div class="pb-empty">手上没有事喵，戳我一下也行喵</div>';
    }
    const show = doing.slice(0, 3);
    let html = '<div class="pb-head">正在办理 · ' + doing.length + ' 项</div>';
    show.forEach((t) => {
      const od = Store.isOverdue(t);
      html += '<div class="pb-item' + (od ? ' is-overdue' : '') + '"><span class="pb-dot"></span>' +
        '<span class="pb-name">' + U.esc(t.title) + (od ? ' · 已超时喵' : '') + '</span></div>';
    });
    if (doing.length > 3) html += '<div class="pb-more">还有 ' + (doing.length - 3) + ' 项</div>';
    return html;
  }

  /** 气泡/举牌默认居中于她。贴近屏幕边缘时改成右/左对齐，尽量少往内容区压 */
  function alignEdge(node) {
    const s = size();
    const cx = S.x + s.w / 2;
    const vw = window.innerWidth;
    const bw = node.offsetWidth || 210;
    const pad = 10;
    let shift = 0;

    if (cx + bw / 2 > vw - pad) {
      shift = (s.w - bw) / 2;               // 右边缘对齐她的右边缘
      if (cx + shift - bw / 2 < pad) shift = pad - (cx - bw / 2);
    } else if (cx - bw / 2 < pad) {
      shift = pad - (cx - bw / 2);
    }
    node.style.setProperty('--bx', shift.toFixed(1) + 'px');
  }

  function placeBubble() { alignEdge(bubble); }

  function showBubble() {
    if (S.sayUntil > now()) return;      // 话还没说完，别抢
    bubble.classList.remove('is-say');
    bubble.style.width = '';             // 交回 CSS 的固定宽度
    bubble.innerHTML = bubbleHtml();
    bubble.hidden = false;
    placeBubble();
    requestAnimationFrame(() => bubble.classList.add('is-on'));
  }

  /** 说一句话（闲聊气泡，比任务气泡轻） */
  function say(text, dur) {
    if (!text) return;
    clearTimeout(S.sayTimer);
    bubble.classList.add('is-say');
    bubble.innerHTML = '<div class="pb-say">' + U.esc(text) + '</div>';
    // 窄父容器里 auto 宽度会被压扁，按字数给个明确宽度
    const len = Array.from(text).length;
    bubble.style.width = (len <= 7 ? Math.max(84, len * 14 + 34) : 176) + 'px';
    bubble.hidden = false;
    placeBubble();
    requestAnimationFrame(() => bubble.classList.add('is-on'));
    S.sayUntil = now() + (dur || 2600) + 220;
    S.sayTimer = setTimeout(() => hideBubble(), dur || 2600);
  }

  function hideBubble() {
    clearTimeout(S.sayTimer);
    S.sayUntil = 0;
    bubble.classList.remove('is-on');
    setTimeout(() => { if (!bubble.classList.contains('is-on')) bubble.hidden = true; }, 220);
  }

  function greetPool() {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return LINES.greetMorning;
    if (h >= 11 && h < 14) return LINES.greetNoon;
    if (h >= 17 && h < 23) return LINES.greetEvening;
    return LINES.greetNight;
  }

  function idleChat() {
    if (S.mood >= 72) return pick(LINES.idleHigh);
    if (S.mood >= 40) return pick(LINES.idleMid);
    return pick(LINES.idleLow);
  }

  /* ---------------- 粒子：金币 ---------------- */
  /** 掉金币。star=true 时给「高光金币」（更大、带光晕），用于完成待办这类大事件。 */
  function coins(n, star) {
    if (!S.visible) return;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'pet-coin' + (star ? ' is-shine' : '');
      c.innerHTML = '<i>¥</i>';
      const dx = Math.random() * 52 - 26;
      c.style.left = (28 + Math.random() * 44) + '%';
      c.style.setProperty('--dx', dx.toFixed(0) + 'px');
      c.style.setProperty('--dx1', (dx * 0.24).toFixed(0) + 'px');
      c.style.setProperty('--rot', (Math.random() * 40 - 20).toFixed(0) + 'deg');
      c.style.setProperty('--sc', (0.78 + Math.random() * 0.42).toFixed(2));
      c.style.animationDelay = (i * 80) + 'ms';
      el.appendChild(c);
      setTimeout(() => c.remove(), 1800 + i * 80);
    }
  }

  /* ---------------- 移动 ---------------- */
  /** 走一步。done 为空表示这是终点，收尾（回正、记锚点）在这里做；
      传了 done 就交给调用方接下一段，避免段与段之间闪一下正面。 */
  function moveStep(p, dur, dir, done) {
    // 她默认贴着右下角，往右的目标点会被 clamp 压到只剩几像素位移。
    // 这时若还按「目标 x 比当前 x 大就算向右」判断，看到的就永远是左侧身。
    // 所以漫游时直接把方向意图传进来，不靠位移反推。
    const goingRight = dir ? dir > 0 : p.x > S.x + 0.5;
    S.walking = true;
    body.classList.add('is-walk');
    setView(goingRight ? 'side-right' : 'side-left');
    setPos(p.x, p.y, true, dur);
    clearTimeout(S.stepTimer);
    S.stepTimer = setTimeout(() => {
      S.walking = false;
      if (done) { done(); return; }
      body.classList.remove('is-walk');
      setView('front');
      // 以落点为新的活动中心。否则活动范围永远围着最初那个锚点转，
      // 她默认又在右下角，于是每次都被挤成「只能往左走」。
      syncAnchor();
    }, dur + 24);
  }

  /** 走到指定位置（直线一程） */
  function walkTo(tx, ty, dur, dir) {
    moveStep(clampPos(tx, ty), dur, dir, null);
  }

  /** 走过去：位移够大时拆成两段，中途换一次步。
      单段 transition 只能走直线，纵向分量一小，看着就是在水平滑行。
      拆段后路径带一点横向外凸，像绕过眼前的东西，而不是横竖硬折成直角。 */
  function strideTo(tx, ty, dur, dir) {
    const p = clampPos(tx, ty);
    const dx = p.x - S.x, dy = p.y - S.y;
    if (Math.hypot(dx, dy) < 110 || Math.abs(dy) < 40) {
      walkTo(p.x, p.y, dur, dir);
      return;
    }
    const d1 = Math.round(dur * 0.58);
    const d2 = Math.max(120, dur - d1);
    const bend = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 16);
    const mid = clampPos(S.x + dx * 0.58 + bend, S.y + dy * 0.58);
    moveStep(mid, d1, dir, () => {
      moveStep(p, d2, dir, () => {
        body.classList.remove('is-walk');
        setView('front');
        syncAnchor();
      });
    });
  }

  function land() {
    body.classList.remove('is-land');
    void body.offsetWidth;
    body.classList.add('is-land');
    after(440, () => body.classList.remove('is-land'));
  }

  /** 甩出去：带惯性飞一段，落地回弹 */
  function fling() {
    const speed = Math.hypot(S.vx, S.vy);
    const k = Math.min(1, speed / 2.2);
    const dur = 300 + k * 320;
    const reach = 130 + k * 190;
    const p = clampPos(S.x + S.vx * reach, S.y + S.vy * reach);

    S.walking = true;
    body.classList.add('is-fling');
    el.style.transition = 'transform ' + dur + 'ms cubic-bezier(.14,.82,.36,1)';
    el.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
    S.x = p.x; S.y = p.y;

    setTimeout(() => {
      S.walking = false;
      body.classList.remove('is-fling');
      land();
      syncAnchor();
      Store.setting('petPos', { x: S.x, y: S.y });
      setExpr(pick(['goofy', 'puzzle', 'laugh']), true);
      if (k > .5 && Math.random() < .45) say(pick(LINES.land), 1600);
      after(1700, () => { if (!S.walking) setExpr('calm', true); });
      scheduleRoam();
    }, dur + 40);
  }

  function roam() {
    if (!S.visible || S.dragging || S.walking || S.sleeping) return;
    if (S.flowGuard) return;                 // 心流期间不乱跑
    if (S.follow) return;                    // 跟随模式下听鼠标的
    const s = size();
    // 重试到「真的挪得动」为止。贴边时 clamp 会把某个方向吃掉，
    // 不重试的话她要么永远只朝左走，要么只是在原地附近横着蹭。
    let tx = 0, ty = 0, dir = 0, ok = false;
    for (let i = 0; i < 10; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 120 + Math.random() * 240;
      // 纵向别再压到 0.4：那样几乎全部被压成水平位移，
      // 看起来就是「她只会在一条线上来回蹭」。桌面上的活动本该是二维的。
      const c = clampPos(
        S.anchor.x + Math.cos(ang) * dist - s.w / 2,
        S.anchor.y + Math.sin(ang) * dist * 0.72 - s.h
      );
      dir = Math.cos(ang) >= 0 ? 1 : -1;
      if (Math.abs(c.x - S.x) >= 56 || Math.abs(c.y - S.y) >= 52) {
        tx = c.x; ty = c.y; ok = true; break;
      }
    }
    if (!ok) return;                        // 实在挪不动，这次就不走了
    strideTo(tx, ty, 2400 + Math.random() * 3800, dir);
    S.lastAct = now();
  }

  function scheduleRoam() {
    clearTimeout(S.roamTimer);
    if (S.flowGuard || S.follow) return;
    const delay = 75000 + Math.random() * 135000;
    S.roamTimer = setTimeout(() => {
      roam();
      scheduleRoam();
    }, delay);
  }

  /* ---------------- 待机小动作 ---------------- */
  const FIDGET = {
    emote: 4.4, hop: 2.4, look: 2.6, stretch: 1.8,
    turn: 1.2, shy: 1.8, ponder: 1.4, groom: 1.6, peek: 1.4
  };

  /** 待机时的情绪小剧场：静止不动时不该只有「搞怪」这一种表情。
      mood 是这条表情对心情的倾向（正=讨喜，负=低落），用来按心情加权。 */
  const EMOTES = [
    { expr: 'laugh',  act: 'is-hop',  ms: 480,  line: 'emoteHappy', mood: 0.6,  w: 3.0 },
    { expr: 'money',  act: 'is-pat',  ms: 440,  line: 'emoteRich',  mood: 0.4,  w: 1.8 },
    { expr: 'puzzle', act: 'is-tilt', ms: 900,  line: 'emoteThink', mood: 0.1,  w: 2.2 },
    { expr: 'goofy',  act: 'is-hop',  ms: 480,  line: 'emoteGoofy', mood: 0.2,  w: 2.0 },
    { expr: 'sulk',   act: 'is-rage', ms: 560,  line: 'emoteSulk',  mood: -0.6, w: 0.8 },
    { expr: 'cry',    act: 'is-tilt', ms: 900,  line: 'emoteCry',   mood: -0.4, w: 0.25 },
    { expr: 'calm',   act: 'is-sway', ms: 1500, line: 'emoteCalm',  mood: 0.1,  w: 1.4 }
  ];

  function playEmote() {
    // 心情好就多笑、多数钱；心情差就多发呆、多摆臭脸。
    const hi = S.mood >= 70, lo = S.mood < 42;
    let total = 0;
    const wl = EMOTES.map((e) => {
      let w = e.w;
      if (hi && e.mood > 0) w *= 1.7;
      if (hi && e.mood < 0) w *= 0.35;
      if (lo && e.mood < 0) w *= 1.9;
      if (lo && e.mood > 0) w *= 0.5;
      total += w;
      return { e, w };
    });
    let r = Math.random() * total, chose = wl[0].e;
    for (let i = 0; i < wl.length; i++) {
      r -= wl[i].w;
      if (r <= 0) { chose = wl[i].e; break; }
    }

    setExpr(chose.expr, true);
    if (chose.act) cls(chose.act, chose.ms);
    if (chose.mood) addMood(chose.mood);
    if (S.chatty && Math.random() < 0.58) {
      after(260, () => {
        if (!S.walking && !S.sleeping) say(pick(LINES[chose.line]), 2500);
      });
    }
    after(chose.ms + 1600, () => {
      if (!S.walking && !S.sleeping) setExpr('calm', true);
    });
    return chose.expr;
  }

  function fidgetWeights() {
    const w = Object.assign({}, FIDGET);
    if (S.mood >= 72) { w.hop = 4; w.emote = 4.4; w.ponder = 0.8; }
    else if (S.mood < 40) { w.hop = 0.3; w.shy = 4.0; w.ponder = 3.0; w.emote = 4.2; }
    return w;
  }

  function runFidget() {
    if (!S.visible || S.dragging || S.walking || S.sleeping || S.flowGuard) return;
    const w = fidgetWeights();
    const keys = Object.keys(w);
    const total = keys.reduce((a, k) => a + w[k], 0);
    let r = Math.random() * total;
    let name = keys[0];
    for (let i = 0; i < keys.length; i++) {
      r -= w[keys[i]];
      if (r <= 0) { name = keys[i]; break; }
    }
    playFidget(name);
    S.lastAct = now();
  }

  function playFidget(k) {
    if (k === 'emote') {
      playEmote();
    } else if (k === 'hop') {
      cls('is-hop', 480);
      setExpr(pick(S.mood >= 66 ? ['laugh', 'money', 'goofy'] : ['goofy', 'laugh']), true);
      after(1600, () => { if (!S.walking) setExpr('calm', true); });
    } else if (k === 'look') {
      setView('side-left');
      after(580, () => setView('side-right'));
      after(1160, () => setView('front'));
    } else if (k === 'stretch') {
      cls('is-stretch', 1000);
      setExpr('laugh', true);
      after(1400, () => { if (!S.walking) setExpr('calm', true); });
    } else if (k === 'turn') {
      setView('back');
      after(1900, () => setView('front'));
    } else if (k === 'shy') {
      cls('is-shy', 900);
      setExpr('calm', true);
    } else if (k === 'ponder') {
      setExpr('puzzle', true);
      if (S.chatty) say('喵……', 1900);
      after(2300, () => { if (!S.walking) setExpr('calm', true); });
    } else if (k === 'groom') {
      setView('side-right');
      cls('is-shy', 760);
      after(900, () => setView('front'));
    } else if (k === 'peek') {
      // 朝鼠标方向小挪一步，像在偷看
      const tx = S.x + (Math.random() * 90 - 45);
      walkTo(tx, S.y + (Math.random() * 60 - 30), 900);
      after(1000, () => setExpr('goofy', true));
      after(2200, () => { if (!S.walking) setExpr('calm', true); });
    }
  }

  function scheduleFidget() {
    clearTimeout(S.fidgetTimer);
    const lo = 13000 + Math.random() * 21000;
    S.fidgetTimer = setTimeout(() => {
      runFidget();
      scheduleFidget();
    }, lo);
  }

  /* ---------------- 视线跟随 ---------------- */
  function onMouseMove(e) {
    if (!S.visible || S.dragging) return;

    // 睡着时靠近会惊醒
    if (S.sleeping) {
      const s = size();
      const d = Math.hypot(e.clientX - (S.x + s.w / 2), e.clientY - (S.y + s.h * .4));
      if (d < 150) wakeUp(true);
      return;
    }

    S.lastAct = now();
    if (S.follow) return;

    const s = size();
    const cx = S.x + s.w / 2, cy = S.y + s.h * 0.4;
    const dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist < 300) {
      const k = Math.min(1, (300 - dist) / 300);
      S.gaze.x = U.clamp(dx / 60, -4, 4) * k;
      S.gaze.y = U.clamp(dy / 90, -3, 3) * k;
      S.gaze.rot = U.clamp(-dx / 90, -3.5, 3.5) * k;
    } else if (S.gaze.x || S.gaze.y) {
      S.gaze.x = 0; S.gaze.y = 0; S.gaze.rot = 0;
    }
    applyVisual();
  }

  /* ---------------- 举牌 ---------------- */
  function showSign() {
    if (sign.classList.contains('is-on')) return;
    if (S.sleeping) return;      // 睡着不举牌，醒了再提醒
    const overdue = Store.byStatus('doing').concat(Store.byStatus('todo')).filter((t) => Store.isOverdue(t));
    const fresh = overdue.filter((t) => !S.signShown[t.id]);
    if (!fresh.length) return;
    fresh.forEach((t) => {
      S.signShown[t.id] = now();
      setTimeout(() => { checkCry(t.id); }, 3600 * 1000);
    });

    let text;
    if (fresh.length === 1) text = fresh[0].title;
    else text = fresh.length + ' 个任务已超时';

    sign.querySelector('.sign-tag').textContent = '超时喵';
    signText.textContent = text;
    sign.hidden = false;
    sign.classList.add('is-on');
    alignEdge(sign);
    el.classList.add('has-sign');
    setExpr('cry', true);
    setTimeout(() => setExpr('calm', true), 1200);

    clearTimeout(S.signTimer);
    S.signTimer = setTimeout(() => {
      sign.classList.remove('is-on');
      el.classList.remove('has-sign');
      setTimeout(() => { sign.hidden = true; }, 300);
      if (!S.walking) setView('front');
    }, 8000);
    S.lastAct = now();
  }

  function checkCry(taskId) {
    if (S.cryShown[taskId]) return;
    const t = Store.tasks().find((x) => x.id === taskId);
    if (!t || !Store.isOverdue(t)) return;
    S.cryShown[taskId] = true;
    setExpr('cry');
    setTimeout(() => setExpr('calm', true), 3000);
  }

  function refreshLogoDot() {
    if (!logoDot) return;
    const n = Store.activeTasks().filter((t) => Store.isOverdue(t)).length;
    logoDot.hidden = n === 0;
  }

  Pet.checkOverdue = function () {
    refreshLogoDot();
    if (!S.visible) return;
    if (S.flowGuard) return;          // 心流期间不打扰，只在导航头像上留个红点
    const overdue = Store.activeTasks().filter((t) => Store.isOverdue(t));
    if (overdue.some((t) => !S.signShown[t.id])) showSign();
  };

  /* ---------------- 互动：点击分级 ---------------- */
  function pat() {
    S.lastAct = now();
    if (S.sleeping) { wakeUp(); return; }
    cls('is-pat', 440);
    setExpr(pick(['laugh', 'goofy', 'laugh']), true);
    coins(2 + Math.floor(Math.random() * 2));
    addMood(2.4);
    if (Math.random() < .6) say(pick(LINES.pat), 1800);
    after(1500, () => { if (!S.walking && !S.sleeping) setExpr('calm', true); });
  }

  function annoyed() {
    setExpr('puzzle', true);
    cls('is-shy', 700);
    addMood(-1.2);
    say(pick(LINES.annoyed), 1900);
    after(1700, () => { if (!S.walking) setExpr('calm', true); });
  }

  function rage() {
    setExpr('sulk', true);
    cls('is-rage', 580);
    addMood(-4);
    say(pick(LINES.rage), 2200);

    const s = size();
    const cx = S.x + s.w / 2;
    const away = cx > window.innerWidth / 2 ? -1 : 1;     // 往远离屏幕中心的方向躲
    // 纵向必须真的挪开一段，否则「生气跑掉」看起来只是横着平移了一下。
    // 上下哪边空间大就往哪边躲。
    const upRoom = S.y - 20;
    const downRoom = window.innerHeight - s.h - 20 - S.y;
    const vdir = upRoom > downRoom ? -1 : 1;
    const room = Math.max(0, vdir < 0 ? upRoom : downRoom);
    // 上下都挤得没地方时就不强求纵向，免得被 clamp 压回原处还是横着滑
    const dy = room < 50 ? 0 : Math.max(56, Math.min(70 + Math.random() * 80, room));

    after(280, () => {
      strideTo(
        S.x + away * (150 + Math.random() * 110),
        S.y + vdir * dy,
        620, away
      );
    });
    after(2900, () => { if (!S.walking) setExpr('calm', true); });
  }

  function onTap() {
    S.lastAct = now();
    if (S.sleeping) { wakeUp(); return; }
    if (S.dragging) return;
    S.clickBurst++;
    clearTimeout(S.clickReset);
    S.clickReset = setTimeout(() => { S.clickBurst = 0; }, 1100);

    if (S.clickBurst >= 6) return rage();
    if (S.clickBurst >= 3) return annoyed();
    return pat();
  }

  Pet.celebrate = function () {
    if (!S.visible) return;
    if (S.sleeping) wakeUp();
    const today = U.dayKey(now());
    const expr = S.moneyToday === today ? 'laugh' : 'money';
    if (S.moneyToday !== today) S.moneyToday = today;
    setExpr(expr, true);
    cls('is-pat', 440);
    coins(3, true);
    addMood(6);
    if (Math.random() < .6) say(pick(LINES.celebrate), 2200);
    after(2600, () => { if (!S.walking) setExpr('calm', true); });
  };

  Pet.expressRandom = function () {
    const pool = ['laugh', 'puzzle', 'goofy', 'money', 'cry', 'sulk', 'calm'];
    setExpr(pool[Math.floor(Math.random() * pool.length)]);
  };

  /* ---------------- 睡眠 ---------------- */
  function enterSleep(manual) {
    if (S.sleeping) return;
    S.sleeping = true;
    clearActs();                 // 免得睡觉途中被上一个动作的回落计时器把脸换回 calm
    clearTimeout(S.exprTimer);
    // 走动途中点了「睡一会儿」：先停下。否则 setExpr 会被 S.walking 挡住不换图，
    // 结果是挂了 sleep 呼吸态、脸却还是侧身的行走图。
    if (S.walking) {
      S.walking = false;
      clearTimeout(S.stepTimer);
      body.classList.remove('is-walk');
      // 停在当前看到的那个位置，别让 transition 取消后弹回起点
      const r = el.getBoundingClientRect();
      el.style.transition = 'none';
      S.x = r.left; S.y = r.top;
      el.style.transform = 'translate3d(' + S.x + 'px,' + S.y + 'px,0)';
      syncAnchor();
    }
    body.classList.remove('is-watch');
    body.classList.remove('is-walk');
    body.classList.add('is-sleep');
    zzz.hidden = false;
    setView('front');
    setExpr('sleep', true);      // 闭眼脸。素材没这张就退回 calm（见 setExpr 的兜底）
    if (manual) say('那我眯一会儿喵……', 2000);
  }

  function wakeUp(soft) {
    if (!S.sleeping) return;
    S.sleeping = false;
    body.classList.remove('is-sleep');
    zzz.hidden = true;
    cls('is-wake', 640);
    setExpr(soft ? 'puzzle' : 'goofy', true);
    S.lastAct = now();
    if (Math.random() < .5) say(pick(LINES.wake), 1900);
    after(1700, () => { if (!S.walking) setExpr('calm', true); });
  }

  function idleLoop() {
    setInterval(() => {
      if (!S.visible) return;
      const idle = now() - S.lastAct;
      if (!S.sleeping && idle > 6.5 * 60 * 1000) enterSleep();
    }, 12000);
  }

  /** 让她睡下 / 叫醒。菜单、引导、自测都走这两个入口。 */
  Pet.sleep = function (manual) { enterSleep(manual !== false); };
  Pet.wake = function (soft) { wakeUp(soft); };

  /* ---------------- 心流联动 ---------------- */
  Pet.onFlowStart = function () {
    if (!S.visible) return;
    S.flowGuard = true;
    clearTimeout(S.fidgetTimer);
    clearTimeout(S.roamTimer);
    clearActs();
    hideBubble();
    wakeUp(true);
    body.classList.remove('is-walk');

    // 收掉正在举的牌，心流里只安静地待着
    if (sign.classList.contains('is-on')) {
      clearTimeout(S.signTimer);
      sign.classList.remove('is-on');
      el.classList.remove('has-sign');
      setTimeout(() => { sign.hidden = true; }, 300);
    }

    // 站到右下角偏内，避开「解除心流」按钮
    const s = size();
    walkTo(window.innerWidth - s.w - 122, window.innerHeight - s.h - 102, 900);
    after(980, () => {
      body.classList.add('is-watch');
      setExpr('calm', true);
      say(pick(LINES.flowStart), 3400);
    });
  };

  Pet.onFlowEnd = function () {
    if (!S.visible) return;
    S.flowGuard = false;
    body.classList.remove('is-watch');
    hideBubble();                      // 收掉「我在这儿守着你」这类守护台词
    setExpr('laugh', true);
    coins(3);
    addMood(3);

    // 从守护位挪回原来的落脚点附近
    const p = clampPos(S.anchor.x - size().w / 2, S.anchor.y - size().h);
    walkTo(p.x, p.y, 760);
    after(860, () => say(pick(LINES.flowEnd), 2600));
    after(2200, () => { if (!S.walking) setExpr('calm', true); });
    scheduleFidget();
    scheduleRoam();
  };

  /* ---------------- 跟随鼠标 ---------------- */
  function followStep(e) {
    if (!S.follow || !S.visible || S.dragging || S.walking || S.sleeping) return;
    if (S.gaze.x) { S.gaze.x = 0; S.gaze.y = 0; S.gaze.rot = 0; applyVisual(); }
    const s = size();
    const dx = e.clientX - (S.x + s.w / 2);
    const dy = e.clientY - (S.y + s.h / 2);
    const d = Math.hypot(dx, dy);
    if (d < 135) return;
    const step = Math.min(62, 12 + (d - 135) * 0.18);
    walkTo(S.x + (dx / d) * step, S.y + (dy / d) * step, 240);
    S.lastAct = now();
  }

  Pet.setFollow = function (v) {
    S.follow = !!v;
    Store.setting('petFollow', S.follow);
    if (S.follow) {
      clearTimeout(S.roamTimer);
      clearTimeout(S.fidgetTimer);
      setExpr('laugh', true);
      coins(1);
    } else {
      scheduleRoam();
      scheduleFidget();
    }
  };

  Pet.toggleFollow = function () {
    Pet.setFollow(!S.follow);
    if (S.follow) UI.toast('小塔菲跟着你了喵');
    else UI.toast('小塔菲自己玩去了');
  };

  Pet.comeHere = function () {
    if (!S.visible) {
      Store.setting('petHiddenUntil', 0);
      Store.setting('petVisible', true);
      Pet.setVisible(true);
    }
    wakeUp(true);
    const s = size();
    const tx = window.innerWidth * .5 - s.w / 2 + (Math.random() * 140 - 70);
    walkTo(tx, window.innerHeight - s.h - 96, 720);
    after(780, () => {
      setExpr('laugh', true);
      coins(2);
      say(pick(LINES.recall), 2200);
    });
    after(2400, () => { if (!S.walking) setExpr('calm', true); });
  };

  /* ---------------- 显示 / 隐藏 ---------------- */
  Pet.setVisible = function (v, reason) {
    S.visible = !!v;
    el.classList.toggle('is-hidden', !S.visible);
    const btn = U.$('#petToggle');
    if (btn) {
      btn.classList.toggle('is-off', !S.visible);
      btn.setAttribute('aria-label', S.visible ? '隐藏桌面宠物' : '显示桌面宠物');
      const lab = btn.querySelector('.rail-label');
      if (lab) lab.textContent = S.visible ? '隐藏桌宠' : '显示桌宠';
      const use = btn.querySelector('use');
      if (use) use.setAttribute('href', S.visible ? '#ic-eye' : '#ic-eye-off');
    }
    if (S.visible) {
      scheduleRoam();
      scheduleFidget();
      setExpr('calm', true);
    } else {
      clearTimeout(S.roamTimer);
      clearTimeout(S.fidgetTimer);
      clearActs();
      hideBubble();
      body.classList.remove('is-walk', 'is-watch', 'is-sleep');
      zzz.hidden = true;
      S.sleeping = false;
    }
  };

  Pet.setSize = function (px) {
    S.size = px;
    el.style.setProperty('--pet-size', px + 'px');
    requestAnimationFrame(() => {
      const p = clampPos(S.x, S.y);
      setPos(p.x, p.y, false);
      syncAnchor();
    });
  };

  /* ---------------- 拖拽 ---------------- */
  function bindDrag() {
    let startX = 0, startY = 0, origX = 0, origY = 0, moved = false, downAt = 0, pid = null;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.pet-bubble, .pet-sign')) return;
      // 上一次的抬手要是丢了（拖到一半窗口被藏起来、指针被系统抢走），
      // 状态会卡在 dragging 上，她就再也不漫游了。每次按下都从干净状态开始。
      if (S.dragging) {
        S.dragging = false;
        el.classList.remove('is-dragging');
        body.classList.remove('is-drag');
        body.style.setProperty('--drag-tilt', '0deg');
      }
      pid = e.pointerId;
      startX = e.clientX; startY = e.clientY;
      origX = S.x; origY = S.y;
      moved = false;
      downAt = now();
      S.vx = 0; S.vy = 0;
      S.lastPx = e.clientX; S.lastPy = e.clientY; S.lastPt = downAt;
      el.setPointerCapture(pid);
      S.lastAct = now();
      if (S.sleeping) wakeUp(true);
    });

    el.addEventListener('pointermove', (e) => {
      if (pid === null || e.pointerId !== pid) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;

      // 记录速度（px/ms），做指数平滑，松手时用来算甩出的距离
      const t = now();
      const dt = Math.max(12, t - S.lastPt);
      S.vx = S.vx * 0.55 + ((e.clientX - S.lastPx) / dt) * 0.45;
      S.vy = S.vy * 0.55 + ((e.clientY - S.lastPy) / dt) * 0.45;
      S.lastPx = e.clientX; S.lastPy = e.clientY; S.lastPt = t;

      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        S.dragging = true;
        el.classList.add('is-dragging');
        body.classList.add('is-drag');
        body.classList.remove('is-sleep');
        el.style.transition = 'none';
        hideBubble();
      }
      if (moved) {
        body.style.setProperty('--drag-tilt', U.clamp(dx / 34, -7, 7).toFixed(1) + 'deg');
        setPos(origX + dx, origY + dy, false);
        syncAnchor();
      }
    });

    el.addEventListener('pointerup', (e) => {
      if (pid === null) return;
      try { el.releasePointerCapture(pid); } catch (err) {}
      pid = null;
      const wasMoved = moved;
      moved = false;
      S.dragging = false;
      el.classList.remove('is-dragging');
      body.classList.remove('is-drag');
      body.style.setProperty('--drag-tilt', '0deg');

      if (wasMoved) {
        const speed = Math.hypot(S.vx, S.vy);
        if (speed > 0.55) {
          fling();
        } else {
          syncAnchor();
          land();
          Store.setting('petPos', { x: S.x, y: S.y });
          // 贴到边缘会有点困惑
          const s = size();
          if (S.x < 24 || S.y < 24 || S.x > window.innerWidth - s.w - 24) {
            setExpr('puzzle');
            after(2200, () => { if (!S.walking) setExpr('calm', true); });
          }
          scheduleRoam();
        }
      } else if (now() - downAt < 420) {
        onTap();
      }
      S.lastAct = now();
    });

    el.addEventListener('dblclick', () => {
      coins(3, true);
      setExpr('laugh');
      addMood(2);
      if (global.App) App.go('todo');
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      UI.menu(el, {
        align: 'left',
        items: [
          { label: '摸摸头', icon: 'star', onClick: () => pat() },
          { label: '叫她一声', icon: 'eye', onClick: () => Pet.comeHere() },
          { label: S.follow ? '别跟着我' : '跟着我走', icon: 'chev-r', onClick: () => Pet.toggleFollow() },
          { label: S.sleeping ? '叫醒她' : '睡一会儿', icon: 'moon',
            onClick: () => { S.sleeping ? wakeUp() : enterSleep(true); } },
          { label: '换个表情', icon: 'palette', onClick: () => Pet.expressRandom() },
          { sep: true },
          { label: '隐藏 1 小时', icon: 'eye-off', onClick: () => Pet.hideFor(60 * 60 * 1000) },
          { label: '打开设置', icon: 'gear', onClick: () => { if (global.App) App.go('settings'); } },
          { sep: true },
          { label: '退出桌宠', icon: 'x', danger: true, onClick: () => Pet.quit() }
        ]
      });
    });
  }

  Pet.hideFor = function (ms) {
    Store.setting('petHiddenUntil', now() + ms);
    Pet.setVisible(false);
    UI.toast('桌宠已隐藏，1 小时后自动回来');
  };

  Pet.quit = function () {
    Store.setting('petVisible', false);
    Pet.setVisible(false);
    UI.toast('桌宠已退出，可在设置里重新开启');
    if (global.Settings) Settings.render();
  };

  /* ---------------- 悬停气泡 ---------------- */
  function bindHover() {
    el.addEventListener('mouseenter', () => {
      S.lastAct = now();
      clearTimeout(S.bubbleTimer);
      if (S.flowGuard) return;          // 心流里不冒泡打扰
      // 有正在办理就看列表，没有就随便聊一句
      S.bubbleTimer = setTimeout(() => {
        if (S.sayUntil > now()) return;
        if (Store.byStatus('doing').length) showBubble();
        else if (S.chatty) say(idleChat(), 2400);
      }, 420);
    });
    el.addEventListener('mouseleave', () => {
      clearTimeout(S.bubbleTimer);
      if (S.sayUntil > now()) return;
      hideBubble();
    });
    sign.addEventListener('click', (e) => {
      e.stopPropagation();
      const overdue = Store.activeTasks().filter((t) => Store.isOverdue(t));
      sign.classList.remove('is-on');
      sign.hidden = true;
      if (global.App) App.go('todo');
      if (overdue.length && global.Todo) Todo.focusTask(overdue[0].id);
    });
  }

  /* ---------------- 导航头像 = 她的脑袋 ---------------- */
  function bindLogo() {
    logo = U.$('#railLogo');
    logoDot = U.$('#railLogoDot');
    if (!logo) return;

    logo.addEventListener('click', () => {
      logo.classList.remove('is-bounce');
      void logo.offsetWidth;
      logo.classList.add('is-bounce');
      setTimeout(() => logo.classList.remove('is-bounce'), 560);

      if (!S.visible) {
        Store.setting('petHiddenUntil', 0);
        Store.setting('petVisible', true);
        Pet.setVisible(true);
        setExpr('laugh', true);
        coins(2);
        say(pick(LINES.recall), 2200);
        return;
      }
      // 点她的脑袋，她也会看过来
      pat();
      if (!S.flowGuard) {
        const s = size();
        if (Math.random() < .5) {
          walkTo(window.innerWidth * .5 - s.w / 2, window.innerHeight - s.h - 96, 760);
        }
      }
    });

    refreshLogoDot();
  }

  /* ---------------- 初始化 ---------------- */
  Pet.init = function () {
    layer = U.$('#petLayer');
    el = U.$('#pet');
    img = U.$('#petImg');
    body = U.$('#petBody');
    bubble = U.$('#petBubble');
    sign = U.$('#petSign');
    signText = U.$('#petSignText');
    zzz = U.$('#petZzz');

    loadMood();
    S.follow = !!Store.setting('petFollow');
    S.chatty = Store.setting('petChatty') !== false;

    S.size = Store.setting('petSize') || 180;
    el.style.setProperty('--pet-size', S.size + 'px');

    const saved = Store.setting('petPos');
    const start = saved ? clampPos(saved.x, saved.y) : defaultPos();
    syncAnchor();

    img.src = ASSET.calm;
    img.addEventListener('load', () => {
      // 图片载入后宽度才确定，重新夹一次边界
      const p2 = clampPos(S.x, S.y);
      setPos(p2.x, p2.y, false);
      syncAnchor();
    });
    img.addEventListener('error', () => {
      img.style.opacity = '.35';
      if (global.UI) UI.toast('桌宠素材没找到：' + ASSET.calm, { warn: true });
    });

    setPos(start.x, start.y, false);
    syncAnchor();

    // 预加载
    Object.keys(ASSET).forEach((k) => { const i = new Image(); i.src = ASSET[k]; });

    const hiddenUntil = Store.setting('petHiddenUntil') || 0;
    const visible = Store.setting('petVisible') !== false && hiddenUntil < now();
    Pet.setVisible(visible);
    bindLogo();

    bindDrag();
    bindHover();
    scheduleRoam();
    scheduleFidget();
    idleLoop();
    setInterval(Pet.checkOverdue, 20000);
    setTimeout(Pet.checkOverdue, 1500);

    // 开局打个招呼（多等一会儿，别一进来就盖住内容）
    if (visible && S.chatty) {
      setTimeout(() => {
        if (!S.flowGuard && S.chatty && (Store.ui('lastView') || 'todo') === 'todo') {
          say(pick(greetPool()), 3200);
        }
      }, 7000);
    }

    document.addEventListener('mousemove', U.throttle(onMouseMove, 60));
    document.addEventListener('mousemove', U.throttle(followStep, 90));

    // 在笔记里写字时，隔一阵子凑过来看一眼（不打扰为主要目标）
    document.addEventListener('app:writing', () => {
      if (!S.visible || S.flowGuard || S.dragging || S.walking || S.sleeping) return;
      if (!S.chatty) return;
      if (now() - S.lastPeek < 7 * 60 * 1000) return;
      S.lastPeek = now();
      const s = size();
      const tx = Math.max(24, window.innerWidth * 0.32 - s.w / 2);
      walkTo(tx, window.innerHeight - s.h - 84, 1600);
      after(1700, () => {
        setExpr('goofy', true);
        say(pick(LINES.peek), 2800);
      });
      after(3600, () => { if (!S.walking) setExpr('calm', true); });
    });

    window.addEventListener('resize', U.throttle(() => {
      const c = clampPos(S.x, S.y);
      setPos(c.x, c.y, true, 200);
      syncAnchor();
      if (bubble.classList.contains('is-on')) placeBubble();
    }, 200));

    document.addEventListener('app:store', (e) => {
      const kind = e.detail && e.detail.kind;
      if (kind === 'task') {
        if (bubble.classList.contains('is-on') && !bubble.classList.contains('is-say')) {
          bubble.innerHTML = bubbleHtml();
        }
        refreshLogoDot();
        setTimeout(Pet.checkOverdue, 600);
      }
      if (kind === 'settings') {
        if (e.detail.key === 'petSize') Pet.setSize(Store.setting('petSize'));
        if (e.detail.key === 'petVisible') Pet.setVisible(Store.setting('petVisible'));
        if (e.detail.key === 'petFollow') S.follow = !!Store.setting('petFollow');
        if (e.detail.key === 'petChatty') S.chatty = Store.setting('petChatty') !== false;
      }
    });
  };

  global.Pet = Pet;
})(window);
