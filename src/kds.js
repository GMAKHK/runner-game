// ── KDS Simulator — Runner Training ─────────────────────────────────────────

import { sfxPotatoDone, sfxPresent, sfxCallMgr, sfxWait, sfxChaser,
         setVolume, getVolume, setSfxEnabled, getSfxEnabled } from './sound.js';

const CATEGORY = { SAND: 0, POTATO: 1, DRINK: 2, CONDIMENT: 3 };

// isSandwich: true のアイテムだけサンドラインのキュー管理対象
// サンド比率を高めるため SAND 系を多めに配置（シャッフル時に引かれやすくなる）
// SAND:POTATO:DRINK ≒ 5:6:3 でポテト比率を高める
const MENU = [
  { name: 'バーガー',         price: 390, prepTime: 50, category: CATEGORY.SAND,   isSandwich: true  },
  { name: 'チキンサンド',     price: 370, prepTime: 50, category: CATEGORY.SAND,   isSandwich: true  },
  { name: 'フィッシュサンド', price: 350, prepTime: 50, category: CATEGORY.SAND,   isSandwich: true  },
  { name: 'ダブルバーガー',   price: 490, prepTime: 50, category: CATEGORY.SAND,   isSandwich: true  },
  { name: 'チキンナゲット',   price: 280, prepTime: 10, category: CATEGORY.SAND,   isSandwich: false },
  { name: 'パイ',             price: 150, prepTime: 10, category: CATEGORY.DRINK                    },
  { name: 'ポテト S',         price: 220, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'ポテト S',         price: 220, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'ポテト M',         price: 280, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'ポテト M',         price: 280, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'ポテト L',         price: 330, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'ポテト L',         price: 330, prepTime: 10, category: CATEGORY.POTATO },
  { name: 'コーラ M',         price: 190, prepTime: 10, category: CATEGORY.DRINK  },
  { name: 'コーヒー',         price: 120, prepTime: 10, category: CATEGORY.DRINK  },
  { name: 'シェイク',         price: 200, prepTime: 10, category: CATEGORY.DRINK  },
];

const GAME_DURATION  = 600;

const TTS_GREEN      = 51;   // <51s (≤50s) → good
const TTS_YELLOW     = 51;   // カード警告色の開始
const TTS_RED        = 71;   // カード赤色・bad評価の開始
const R2P_DELIVERY   = 40;  // 秒: PRESENT後お客様到着までの想定時間
const R2P_GREAT      = 90;  // ≤90s:   GREAT  (+100pt)
const R2P_GOOD       = 120; // 91~120s: GOOD   (+50pt)
const R2P_NORMAL     = 200; // 121~200s: NORMAL (+15pt)
const R2P_BAD        = 270; // 201~270s: BAD    (+0pt) / >270s: GAME OVER
const R2P_GREEN      = R2P_GREAT;
const R2P_YELLOW     = R2P_GOOD;

// ── Potato / Fryer Constants ──────────────────────────────────────────────────

const FRYER_COUNT     = 4;
const FRYER_FRY_TIME  = 180;  // 揚げ時間 (秒)
const FRYER_SALT_TIME = 30;   // 塩かけ・攪拌 (秒)
const POTATO_BAG_TIME = 8;    // バギング 1個あたり (秒)
const POTATO_GRAM     = { S: 75, M: 143, L: 181 }; // 1個あたりのグラム数

// ── Sandwich Production ───────────────────────────────────────────────────────
const BUNS_TOAST_TIME = 10;   // バンズ焼成時間 (秒)
const SAND_MAKE_TIME  = 40;   // サンド製造時間 (秒)
const TUTORIAL_TOAST_TIME = BUNS_TOAST_TIME; // チュートリアル: 通常と同じ
const TUTORIAL_MAKE_TIME  = SAND_MAKE_TIME;  // チュートリアル: 通常と同じ
const TOAST_CAPACITY  = 4;    // 同時焼成可能数
const MAKE_CAPACITY   = 2;    // 同時製造可能数
// 1バスケット600g: S=75g→8個, M=143g→4個, L=181g→3個
const BASKET_YIELD    = { S: 8, M: 4, L: 3 };
const POTATO_HOLD_TIME = 420; // 廃棄までの保持時間 (秒 = 7分)

// ── State ────────────────────────────────────────────────────────────────────

let tickInterval     = null;
let spawnTimer       = null;
let orders           = [];
let presented        = [];
let orderSeq         = 0;
let gameTimeLeft     = 0;
let gameRunning      = false;
let chaserOrderId    = null;  // チェイサー中のオーダーID (同時1のみ)

// ── Sandwich Production Pipeline ────────────────────────────────────────────
// 各エントリ: { orderId, itemIdx, doneAt }
let toastingNow        = []; // 焼成中 (最大 TOAST_CAPACITY)
let toastWaitQ         = []; // 現在担当オーダーの焼成待ちスロット
let makingNow          = []; // 厨房製造中 (最大 MAKE_CAPACITY)
let makeWaitQ          = []; // 製造待ちキュー (焼成完了済み)
let chaserMaking       = []; // チェイサー製造中
let kitchenOrderId     = null; // 厨房が現在担当中のオーダーID
let kitchenOrderQueue  = []; // 厨房待機オーダーIDキュー
let nuggetWaiting      = []; // 製造完了済みだがサンド待ちのナゲット { orderId, itemIdx }
let inBurst           = false;
let burstLeft         = 0;
let ordersSpawned     = 0;
let potatoDiscarded      = 0; // 廃棄されたポテト個数
let potatoConvertCount   = 0; // ポテト再製造(変換)回数
let waitCount            = 0; // WAIT押下回数
let presentCooldownUntil = 0; // PRESENT後クーリング終了時刻(ms)
let mgrCooldownUntil     = 0; // MGR後クーリング終了時刻(ms)
let gameOverReason       = null; // GAME OVER 発生理由 (null = 通常終了)
let expertMode           = false; // エキスパートモード (客数 1.5倍)
let dangerActive         = false; // デンジャーコール発動中
let tutorialMode         = false; // チュートリアルモード
let tutorialFreePlay     = false; // チュートリアル自由プレイ中（オーダー自動スポーン許可）

// ── Potato State ─────────────────────────────────────────────────────────────
// potatoStock[size] = バッチ配列: { qty: number, expiresAt: ms }
// 調理完了から POTATO_HOLD_TIME 秒経過で廃棄
let potatoStock = { S: [], M: [], L: [] };
// fryer: { size: 'S'|'M'|'L'|null, phase: 'empty'|'frying'|'salting', phaseStart: ms }
let fryers = [];

// ── helpers ──────────────────────────────────────────────────────────────────

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function fmtTime(sec) {
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// ── Potato stock helpers ──────────────────────────────────────────────────────

// 全バッチの合計在庫数
function stockCount(size) {
  return potatoStock[size].reduce((s, b) => s + b.qty, 0);
}

// 最も古いバッチから1個消費。在庫なければ false
function consumeStock(size) {
  for (const batch of potatoStock[size]) {
    if (batch.qty > 0) { batch.qty--; return true; }
  }
  return false;
}

// 期限切れバッチを廃棄。廃棄があれば true を返す
function expirePotatoStock() {
  const now = Date.now();
  let discardCount = 0;
  for (const size of ['S', 'M', 'L']) {
    potatoStock[size] = potatoStock[size].filter(b => {
      if (b.qty > 0 && b.expiresAt <= now) { discardCount += b.qty; return false; }
      return b.qty > 0;
    });
  }
  if (discardCount > 0) {
    potatoDiscarded += discardCount;
    showToastDiscard(discardCount);
  }
  return discardCount > 0;
}

// 最も早く期限切れになるバッチの残り秒数（在庫なければ null）
function nearestExpirySec(size) {
  const now = Date.now();
  let nearest = null;
  for (const batch of potatoStock[size]) {
    if (batch.qty <= 0) continue;
    const rem = (batch.expiresAt - now) / 1000;
    if (nearest === null || rem < nearest) nearest = rem;
  }
  return nearest;
}

// ── order generation ─────────────────────────────────────────────────────────

function makeOrder(forceHeavySand = false, includeFrappe = false) {
  const now = Date.now();
  let selectedMenu;

  if (forceHeavySand) {
    // サンド3個以上を強制: サンドアイテムのみのプールから3〜4個選択
    const sandPool = MENU.filter(m => m.isSandwich);
    selectedMenu = [...sandPool].sort(() => Math.random() - 0.5).slice(0, rand(3, 4));
    // ドリンクかポテトを1個追加してリアリティを出す
    const extra = MENU.filter(m => m.category !== CATEGORY.SAND);
    if (extra.length) selectedMenu.push(extra[Math.floor(Math.random() * extra.length)]);
  } else {
    const count    = rand(1, 4);
    const shuffled = [...MENU].sort(() => Math.random() - 0.5);
    selectedMenu = shuffled.slice(0, count);
  }

  const hasDrink = selectedMenu.some(m => m.category === CATEGORY.DRINK);

  // Sort: ナゲット(SAND非サンド) → サンド → ポテト → ドリンク
  const sortKey = m => {
    if (m.category === CATEGORY.SAND) return m.isSandwich ? 1 : 0;
    return m.category + 1;
  };
  selectedMenu.sort((a, b) => sortKey(a) - sortKey(b));

  // ── Sandwich items: パイプラインで処理 (readyAt は生産エンジンが設定) ──────
  const sandwichItems = selectedMenu.filter(m => m.isSandwich);
  const sandCount     = sandwichItems.length;

  const items = selectedMenu.map(m => {
    let readyAt;
    let potatoSize = null;
    if (m.isSandwich) {
      readyAt = Infinity; // enqueueOrderSandwiches() で設定
    } else if (m.category === CATEGORY.SAND) {
      readyAt = Infinity; // ナゲット等: キッチン順番待ち
    } else if (m.category === CATEGORY.POTATO) {
      // ポテトはストックから引き当て。在庫があればバギング8秒、なければ無限待ち
      potatoSize = m.name.slice(-1); // 'S' | 'M' | 'L'
      if (consumeStock(potatoSize)) {
        readyAt = now + POTATO_BAG_TIME * 1000;
      } else {
        readyAt = Infinity; // ストック補充まで待機
      }
    } else {
      readyAt = now + Math.max(3, m.prepTime) * 1000;
    }
    return {
      name:        m.name,
      price:       m.price,
      prepTime:    m.prepTime || 0,
      category:    m.category,
      isSandwich:  m.isSandwich || false,
      potatoSize,
      ready:       false,
      readyAt,
    };
  });

  // フローズンドリンク注入 (7オーダーに1回)
  if (includeFrappe) {
    items.push({
      name:       'フローズンドリンク',
      price:      390,
      category:   CATEGORY.DRINK,
      isSandwich: false,
      potatoSize: null,
      ready:      false,
      readyAt:    now + 70 * 1000,
    });
  }

  // Condiment last when there's a drink
  if (hasDrink || includeFrappe) {
    items.push({
      name:     'コンディメント',
      price:    0,
      category: CATEGORY.CONDIMENT,
      ready:    true,
      readyAt:  now,
    });
  }

  return {
    id:            ++orderSeq,
    num:           String(orderSeq).padStart(3, '0'),
    receiptTime:   now,
    items,
    sandwichCount: sandCount,
    total:         items.reduce((s, i) => s + i.price, 0),
    presented:     false,
    presentTime:   null,
    waited:        false,
    waitedAt:      null,
    chased:        false,  // チェイサーに入ったか
    chasedAt:      null,
    tts:           null,
    ttsAt:         null, // TTS確定時刻 (最後のサンド完成 or チェイサー引き継ぎ)
    r2p:           null,
    allReadyAt:    null, // 全アイテム完了時刻
    lagSec:        null, // 完了→プレゼントまでの秒数
  };
}

// ── spawn ─────────────────────────────────────────────────────────────────────

function spawnOrder() {
  // 7オーダーに1回はサンド3個以上の重量オーダーを強制
  const forceHeavy    = (ordersSpawned % 7 === 6);
  // 7オーダーに1回フローズンドリンクを注入 (重量オーダーとずらして offset=3)
  const includeFrappe = (ordersSpawned % 7 === 3);
  const order = makeOrder(forceHeavy, includeFrappe);
  orders.push(order);
  ordersSpawned++;

  enqueueOrderSandwiches(order);
  scheduleNext();
}

function scheduleNext() {
  if (tutorialMode && !tutorialFreePlay) return; // チュートリアル中は自動スポーンなし（自由プレイ中は除く）
  if (!gameRunning || gameTimeLeft <= 30) return;

  let delay;
  if (inBurst && burstLeft > 0) {
    // ラッシュ中
    delay = expertMode ? rand(7, 13) * 1000 : rand(10, 20) * 1000;
    burstLeft--;
    if (burstLeft === 0) inBurst = false;
  } else {
    // 静止期
    delay     = expertMode ? rand(27, 53) * 1000 : rand(40, 80) * 1000;
    inBurst   = true;
    burstLeft = expertMode ? rand(3, 7) : rand(2, 5);
  }

  if (tutorialFreePlay) delay = Math.round(delay / 1.5);

  spawnTimer = setTimeout(() => {
    if (gameRunning && gameTimeLeft > 30) spawnOrder();
  }, delay);
}

// ── wait / present ────────────────────────────────────────────────────────────

function waitOrder(id) {
  const order = orders.find(o => o.id === id);
  if (!order || order.presented || order.waited) return;

  order.waited   = true;
  order.waitedAt = Date.now();
  waitCount++;
  sfxWait();
  // R2P凍結: WAIT押下時点のTTS + 40秒配達時間
  // サンドキューは継続（このオーダーのサンドが終わるまで次のサンドは製造不可）
  renderOrders();
}

function chaserOrder(id) {
  const order = orders.find(o => o.id === id);
  if (!order || order.chased || order.presented) return;
  if (chaserOrderId !== null) return;

  // 厨房が製造中のサンド（このオーダー分）を引き継ぐ
  const takeable = makingNow.filter(m => m.orderId === id);
  if (takeable.length === 0) return; // 製造中のものがなければ引き継ぎ不可

  // makingNow から除いてチェイサーの担当に移す（残り時間はそのまま引き継ぎ）
  takeable.forEach(t => {
    chaserMaking.push({ ...t });
    const idx = makingNow.findIndex(m => m.orderId === t.orderId && m.itemIdx === t.itemIdx);
    if (idx >= 0) makingNow.splice(idx, 1);
  });

  // 空いた厨房スロットを即時補充
  drainMakeQueue();

  const chaserNow = Date.now();
  order.chased   = true;
  order.chasedAt = chaserNow;
  chaserOrderId  = id;
  sfxChaser();

  // チェイサーが最後のサンドを引き継いだ場合 → TTS確定
  // (まだキューに残っているサンドがない = このオーダーの残り全サンドはチェイサーが担当)
  const stillQueued = toastWaitQ.some(t => t.orderId === id)
    || toastingNow.some(t => t.orderId === id)
    || makeWaitQ.some(t => t.orderId === id);
  if (!stillQueued && !order.ttsAt) {
    order.ttsAt = chaserNow;
  }

  // チェイサーが引き継いだことで厨房スロットが空き、次オーダーへ進める可能性
  checkKitchenAdvance();
  renderPotatoStation(); // フライヤーボタンを即時非表示
  renderOrders();
}

function activateDanger() {
  if (!gameRunning || dangerActive) return;
  if (countPendingSandwiches() < 6) return;
  dangerActive = true;

  // 焼成中・焼成待ちのサンドをトーストスキップして製造待ちキューへ即時移動
  toastingNow.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
  toastWaitQ.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
  toastingNow = [];
  toastWaitQ  = [];

  // キッチン待機中の全オーダーのサンド・ナゲットも直接製造待ちへ登録（トースト・FIFOをバイパス）
  kitchenOrderQueue.forEach(orderId => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    order.items.forEach((item, idx) => {
      if (item.category === CATEGORY.SAND) {
        makeWaitQ.push({ orderId, itemIdx: idx });
      }
    });
  });
  kitchenOrderQueue = [];

  drainMakeQueue(); // chaserMakingを含めて最大6枠まで即時製造開始
  updateDangerUI();
  renderOrders();
}

function deactivateDanger() {
  if (!dangerActive) return;
  dangerActive = false;
  updateDangerUI();
  renderOrders();
}

function updateDangerUI() {
  const btn = document.getElementById('btn-danger');
  if (!btn) return;
  btn.style.display = '';
  if (dangerActive) {
    btn.textContent = '🚨 DANGER 発動中';
    btn.classList.add('danger-active');
    btn.disabled    = true;
    btn.style.opacity = '';
  } else {
    btn.textContent = '🚨 デンジャーコール';
    btn.classList.remove('danger-active');
    const canUse = countPendingSandwiches() >= 6;
    btn.disabled      = !canUse;
    btn.style.opacity = canUse ? '' : '0.3';
  }
}

// デンジャー発動中にプレゼントした直後、製造スロットを即時補充する
function refreshDangerPipeline() {
  if (!dangerActive) return;
  drainToastQueue();     // toast → makeWaitQ（danger中はスキップ）
  checkKitchenAdvance(); // kitchen idle なら次オーダーを開始
  drainMakeQueue();      // 空きスロットを最大6まで補充
}

function callMgr(id) {
  // WAITオーダーのサンドが完成したらMGRに取り揃えを依頼して処理完了とみなす
  const order = orders.find(o => o.id === id);
  if (!order || !order.waited || order.presented) return;
  // クーリングタイム中は無効
  if (Date.now() < mgrCooldownUntil || Date.now() < presentCooldownUntil) return;
  // サンドが完成しているかチェック
  const sandwichesReady = order.items.every(i => !i.isSandwich || i.ready);
  if (!sandwichesReady) return;

  const now         = Date.now();
  mgrCooldownUntil  = now + 15 * 1000;
  sfxCallMgr();
  order.presented   = true;
  order.presentTime = now;
  // TTS = 受注 → 最後のサンド完成 or チェイサー引き継ぎ (サンドなしは計測なし)
  order.tts         = order.ttsAt ? (order.ttsAt - order.receiptTime) / 1000 : null;
  // R2P(WAIT) = 受注 → WAIT押下 + 10秒
  order.r2p         = (order.waitedAt - order.receiptTime) / 1000 + 10;
  order.lagSec      = order.allReadyAt ? (now - order.allReadyAt) / 1000 : 0;

  if (chaserOrderId === id) chaserOrderId = null;
  presented.push(order);
  orders = orders.filter(o => o.id !== id);

  updateMetrics();
  refreshDangerPipeline();
  renderOrders();
  showToast(order.r2p);
}

function presentOrder(id) {
  const order = orders.find(o => o.id === id);
  if (!order || order.presented) return;
  if (!order.items.every(i => i.ready)) return;
  // PRESENT クーリングタイム中は無効
  if (Date.now() < presentCooldownUntil) return;

  const now              = Date.now();
  presentCooldownUntil   = now + 7 * 1000;
  sfxPresent();
  order.presented   = true;
  order.presentTime = now;
  // TTS = 受注 → 最後のサンド完成 or チェイサー引き継ぎ (サンドなしは計測なし)
  order.tts         = order.ttsAt ? (order.ttsAt - order.receiptTime) / 1000 : null;
  order.lagSec      = order.allReadyAt ? (now - order.allReadyAt) / 1000 : 0;

  // R2P(WAIT) = 受注 → WAIT押下 / R2P(通常) = 受注 → PRESENT押下 + 10秒
  if (order.waited && order.waitedAt) {
    order.r2p = (order.waitedAt - order.receiptTime) / 1000 + 10;
  } else {
    order.r2p = (now - order.receiptTime) / 1000 + R2P_DELIVERY;
  }

  if (chaserOrderId === id) chaserOrderId = null;
  presented.push(order);
  orders = orders.filter(o => o.id !== id);

  updateMetrics();
  refreshDangerPipeline();
  renderOrders();
  showToast(order.r2p);
}

function showToast(r2p) {
  const el = document.getElementById('kds-feedback');
  if (!el) return;

  let msg, cls;
  const r2pSec = Math.round(r2p);
  if      (r2p <= R2P_GREAT)  { msg = `✓ RtoP ${r2pSec}s — GREAT!`;  cls = 'fb-green'; }
  else if (r2p <= R2P_GOOD)   { msg = `△ RtoP ${r2pSec}s — GOOD`;    cls = 'fb-yellow'; }
  else if (r2p <= R2P_NORMAL) { msg = `△ RtoP ${r2pSec}s — NORMAL`;  cls = 'fb-yellow'; }
  else if (r2p <= R2P_BAD)    { msg = `✗ RtoP ${r2pSec}s — BAD`;     cls = 'fb-red'; }
  else                        { msg = `💀 RtoP ${r2pSec}s — GAME OVER`; cls = 'fb-red'; }

  el.textContent   = msg;
  el.className     = 'kds-feedback-toast ' + cls;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ── metrics ───────────────────────────────────────────────────────────────────

function updateMetrics() {
  const count = presented.length;
  document.getElementById('kds-order-count').textContent = count;
  if (count === 0) return;

  const ttsOrders = presented.filter(o => o.tts !== null);
  const avgTTS = ttsOrders.length > 0 ? ttsOrders.reduce((s, o) => s + o.tts, 0) / ttsOrders.length : null;
  const avgR2P = presented.reduce((s, o) => s + o.r2p, 0) / count;
  const sales  = presented.reduce((s, o) => s + o.total, 0);
  const ac     = sales / count;

  document.getElementById('kds-tts-avg').textContent   = avgTTS !== null ? fmtTime(avgTTS) : '--:--';
  document.getElementById('kds-r2p-avg').textContent   = fmtTime(avgR2P);
  document.getElementById('kds-sales-val').textContent = `¥${sales.toLocaleString()}`;
  document.getElementById('kds-ac-val').textContent    = `¥${Math.round(ac).toLocaleString()}`;
}

// ── render ────────────────────────────────────────────────────────────────────

function buildCardHtml(order) {
  const itemsHtml = order.items.map((item, idx) => {
    const isCondiment = item.category === CATEGORY.CONDIMENT;
    return `<li data-idx="${idx}" class="${item.ready ? 'item-ready' : 'item-pending'}">
      <span class="item-icon">${item.ready ? '✅' : '⬜'}</span>
      <span class="item-name">${isCondiment ? '📦 ' : ''}${item.name}</span>
      ${(!item.ready && !isCondiment) ? `<span class="item-countdown">--s</span>` : ''}
    </li>`;
  }).join('');

  return `
    <div class="card-header">
      <span class="order-num">#${order.num}</span>
      <span class="tts-counter">⏱ 00:00</span>
    </div>
    <div class="wait-badge" style="display:none"></div>
    <ul class="item-list">${itemsHtml}</ul>
    <div class="card-footer">
      <div class="footer-actions">
        <button class="btn-wait" data-order-id="${order.id}">WAIT</button>
        <button class="btn-chaser" data-order-id="${order.id}" style="display:none">チェイサー</button>
        <button class="btn-call-mgr" data-order-id="${order.id}" style="display:none">MGRを呼ぶ</button>
        <button class="btn-present" data-order-id="${order.id}" disabled>準備中...</button>
      </div>
    </div>`;
}

function updateCardDom(card, order, now, chaserEligibleId) {
  const ttsNow     = (now - order.receiptTime) / 1000;
  const allReady   = order.items.every(i => i.ready);
  const ttsEl      = card.querySelector('.tts-counter');
  const badge      = card.querySelector('.wait-badge');
  const waitBtn    = card.querySelector('.btn-wait');
  const chaserBtn  = card.querySelector('.btn-chaser');
  const mgrBtn     = card.querySelector('.btn-call-mgr');
  const btn        = card.querySelector('.btn-present');

  if (order.waited) {
    // ── WAIT中: R2P確定、TTS はサンド完成/チェイサー引き継ぎ時点で確定 ──
    const frozenR2p       = (order.waitedAt - order.receiptTime) / 1000 + 10;
    const sandwichesReady = order.items.every(i => !i.isSandwich || i.ready);

    const newClass = 'order-card waited' + (sandwichesReady ? ' ready' : '');
    if (card.className !== newClass) card.className = newClass;

    if (ttsEl) {
      if (order.ttsAt) {
        // TTS確定済み（最後のサンド完成 or チェイサー引き継ぎ）
        const confirmedTts = (order.ttsAt - order.receiptTime) / 1000;
        ttsEl.textContent    = fmtTime(confirmedTts);
        ttsEl.style.color    = confirmedTts < TTS_GREEN ? '#4ade80'
                             : confirmedTts < TTS_RED   ? '#f59e0b' : '#ef4444';
        ttsEl.dataset.waited = '1';
      } else if (ttsEl.dataset.waited !== '1') {
        // まだサンドが完成していない — タイマーは走り続ける（通常表示に任せる）
        ttsEl.dataset.waited = '0';
      }
    }
    if (badge && badge.style.display === 'none') {
      badge.textContent   = `RtoP確定: ${Math.round(frozenR2p)}s`;
      badge.style.display = 'block';
    }
    if (waitBtn) waitBtn.style.display = 'none';
    if (btn)     btn.style.display     = 'none';

    // チェイサーボタン: 厨房製造中の最古オーダーにのみ表示、デンジャー中は非表示
    if (chaserBtn) {
      const show = order.id === chaserEligibleId && chaserOrderId === null && !dangerActive;
      chaserBtn.style.display = show ? 'inline-block' : 'none';
    }

    // MGRボタン: 全アイテム完了時のみ表示、デンジャー中は無効
    if (mgrBtn && allReady && mgrBtn.style.display === 'none') {
      mgrBtn.style.display = 'inline-block';
    }
    if (mgrBtn) mgrBtn.disabled = false;

  } else if (order.chased) {
    // ── チェイサー中: TTSは継続、キュー解放済み ───────────────
    let newClass = 'order-card chased';
    if      (ttsNow >= TTS_RED)    newClass += ' danger';
    else if (ttsNow >= TTS_YELLOW) newClass += ' warning';
    else if (allReady)             newClass += ' ready';
    if (card.className !== newClass) card.className = newClass;

    if (ttsEl) {
      ttsEl.textContent = `🏃 ${fmtTime(ttsNow)}`;
      ttsEl.style.color = '#fb923c';
    }
    if (badge && badge.style.display === 'none') {
      badge.textContent   = '🏃 チェイサー中 — 後続キュー解放済み';
      badge.style.display = 'block';
      badge.style.color   = '#fb923c';
    }
    if (waitBtn)   waitBtn.style.display   = 'none';
    if (chaserBtn) chaserBtn.style.display = 'none';

  } else {
    // ── 通常 ─────────────────────────────────────────────────
    // チェイサー完了後にバッジをリセット
    if (badge && badge.style.display !== 'none') badge.style.display = 'none';

    let newClass = 'order-card';
    if      (ttsNow >= TTS_RED)    newClass += ' danger';
    else if (ttsNow >= TTS_YELLOW) newClass += ' warning';
    else if (allReady)             newClass += ' ready';
    if (card.className !== newClass) card.className = newClass;

    const ttsColor = ttsNow >= TTS_RED    ? '#ef4444'
                   : ttsNow >= TTS_YELLOW ? '#f59e0b'
                   : ttsNow >= TTS_GREEN  ? '#fb923c'
                   : '#22c55e';
    if (ttsEl) {
      ttsEl.textContent = `⏱ ${fmtTime(ttsNow)}`;
      ttsEl.style.color = ttsColor;
    }

    // チェイサーボタン: 厨房製造中の最古オーダーにのみ表示、デンジャー中は非表示
    if (chaserBtn) {
      const show = order.id === chaserEligibleId && chaserOrderId === null && !dangerActive;
      chaserBtn.style.display = show ? 'inline-block' : 'none';
    }

    // チェイサー中は他のオーダーのWAITボタンを非表示
    if (waitBtn) {
      waitBtn.style.display = chaserOrderId !== null ? 'none' : '';
    }
  }

  // Items (common logic)
  order.items.forEach((item, idx) => {
    const li = card.querySelector(`[data-idx="${idx}"]`);
    if (!li) return;
    const isCondiment = item.category === CATEGORY.CONDIMENT;
    const isPotato    = item.category === CATEGORY.POTATO;

    // ポテトはPRESENT押下まで⬜表示（ready状態でもアイコンは変えない）
    const displayReady = item.ready && !isPotato;
    const targetClass = displayReady ? 'item-ready' : 'item-pending';
    if (li.className !== targetClass) {
      li.className = targetClass;
      const icon = li.querySelector('.item-icon');
      if (icon) icon.textContent = displayReady ? '✅' : '⬜';
    }

    if (!displayReady && !isCondiment) {
      let cd = li.querySelector('.item-countdown');
      if (!cd) {
        cd = document.createElement('span');
        cd.className = 'item-countdown';
        li.appendChild(cd);
      }
      const isNuggetWaiting = !item.isSandwich && item.category === CATEGORY.SAND
        && nuggetWaiting.some(w => w.orderId === order.id && w.itemIdx === idx);
      if (isNuggetWaiting) {
        cd.textContent = 'サンド待ち';
        cd.style.color = '#f59e0b';
      } else if (item.readyAt === Infinity) {
        cd.textContent = isPotato ? '🍟待ち' : '製造待ち';
        cd.style.color = '#888';
      } else if (isPotato && item.ready) {
        cd.textContent = '取出可';
        cd.style.color = '#22c55e';
      } else if (item.category === CATEGORY.SAND && !item.ready && item.readyAt <= now) {
        // 焼成完了済み or キッチン順番待ち・製造スロット待ち
        cd.textContent = '製造待ち';
        cd.style.color = '#888';
      } else {
        cd.textContent = `${Math.max(0, Math.ceil((item.readyAt - now) / 1000))}s`;
        cd.style.color = '';
      }
    } else {
      const cd = li.querySelector('.item-countdown');
      if (cd) cd.remove();
    }
  });

  // Present button — 初回アクティブ化: active クラスがない場合のみ（クーリング中の再有効化を防ぐ）
  if (btn && allReady && btn.disabled && !btn.classList.contains('active')) {
    btn.disabled = false;
    btn.style.display = '';
    btn.classList.add('active');
    btn.textContent = 'PRESENT';
  }

  // チェイサーアクティブ中はウエイト・プレゼント・MGRを全オーダーで非表示
  if (chaserOrderId !== null) {
    if (waitBtn) waitBtn.style.display = 'none';
    if (btn)     btn.style.display     = 'none';
    if (mgrBtn)  mgrBtn.style.display  = 'none';
  } else {
    // チェイサー解除後はプレゼントボタンを常に復元（disabled状態でも表示する）
    if (btn) btn.style.display = '';
  }

  // ── クーリングタイム制御 ─────────────────────────────────────
  const nowMs = Date.now();
  const inPresentCool = nowMs < presentCooldownUntil;
  const inMgrCool     = nowMs < mgrCooldownUntil;

  // PRESENT クーリング中: wait/chaser/mgr/fryer(via renderPotatoStation)を無効化
  if (inPresentCool) {
    const remainP = Math.ceil((presentCooldownUntil - nowMs) / 1000);
    if (waitBtn)   { waitBtn.disabled   = true; waitBtn.style.opacity   = '0.4'; }
    if (chaserBtn) { chaserBtn.disabled = true; chaserBtn.style.opacity = '0.4'; }
    if (mgrBtn && mgrBtn.style.display !== 'none') {
      mgrBtn.disabled = true; mgrBtn.style.opacity = '0.4';
    }
    // active クラス付き（準備完了済み）のボタンをクーリング中は無効化
    if (btn && btn.classList.contains('active')) {
      btn.textContent = `PRESENT (${remainP}s)`;
      btn.disabled = true; btn.style.opacity = '0.4';
    }
  } else {
    if (waitBtn)   { waitBtn.disabled   = false; waitBtn.style.opacity   = ''; }
    if (chaserBtn) { chaserBtn.disabled = false; chaserBtn.style.opacity = ''; }
    // クーリング解除後に active ボタンを復元
    if (btn && btn.classList.contains('active')) {
      if (btn.textContent.startsWith('PRESENT (')) btn.textContent = 'PRESENT';
      btn.disabled = false; btn.style.opacity = '';
    }
  }

  // MGR クーリング中: MGRボタンを無効化
  if (inMgrCool || inPresentCool) {
    const remainM = Math.ceil((Math.max(mgrCooldownUntil, presentCooldownUntil) - nowMs) / 1000);
    if (mgrBtn && mgrBtn.style.display !== 'none') {
      mgrBtn.disabled = true; mgrBtn.style.opacity = '0.4';
      mgrBtn.textContent = `MGRを呼ぶ (${remainM}s)`;
    }
  } else {
    if (mgrBtn) {
      mgrBtn.disabled = false; mgrBtn.style.opacity = '';
      if (mgrBtn.textContent.startsWith('MGRを呼ぶ (')) mgrBtn.textContent = 'MGRを呼ぶ';
    }
  }
}

function renderOrders() {
  const grid = document.getElementById('kds-grid');
  if (!grid) return;

  if (orders.length === 0) {
    grid.innerHTML = '<div class="kds-empty">オーダー待機中...</div>';
    return;
  }

  // Remove empty placeholder if present
  const emptyEl = grid.querySelector('.kds-empty');
  if (emptyEl) emptyEl.remove();

  const now        = Date.now();
  const currentIds = new Set(orders.map(o => o.id));

  // チェイサー対象: 厨房が製造中のサンドを持つ最古のオーダー
  const makingOrderIds = new Set(makingNow.map(m => m.orderId));
  let chaserEligibleId = null;
  for (const o of orders) {
    if (o.chased || o.presented) continue;
    if (makingOrderIds.has(o.id)) { chaserEligibleId = o.id; break; }
  }

  // Remove stale cards
  grid.querySelectorAll('.order-card').forEach(card => {
    if (!currentIds.has(Number(card.dataset.id))) card.remove();
  });

  // Add new / update existing
  orders.forEach(order => {
    let card = grid.querySelector(`[data-id="${order.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.dataset.id = order.id;
      card.className  = 'order-card';
      card.innerHTML  = buildCardHtml(order);
      grid.appendChild(card);
    }
    updateCardDom(card, order, now, chaserEligibleId);
  });
}

// ── Fryer / Potato Functions ──────────────────────────────────────────────────

function initFryers() {
  fryers = Array.from({ length: FRYER_COUNT }, (_, i) => ({
    id: i, size: null, phase: 'empty', phaseStart: 0,
  }));
  // 初期ストック: 通常 S=1,M=3,L=1 / エキスパート S=3,M=6,L=2
  const initExpiry = Date.now() + POTATO_HOLD_TIME * 1000;
  potatoStock = expertMode
    ? { S: [{ qty: 3, expiresAt: initExpiry }], M: [{ qty: 6, expiresAt: initExpiry }], L: [{ qty: 2, expiresAt: initExpiry }] }
    : { S: [{ qty: 1, expiresAt: initExpiry }], M: [{ qty: 3, expiresAt: initExpiry }], L: [{ qty: 1, expiresAt: initExpiry }] };
  // バット1をゲーム開始時から調理中（サイズは完了時に決定）
  fryers[0].size       = null;
  fryers[0].phase      = 'frying';
  fryers[0].phaseStart = Date.now();
}

function calcPotatoDemand() {
  const demand = { S: 0, M: 0, L: 0 };
  orders.forEach(order => {
    order.items.forEach(item => {
      if (!item.ready && item.potatoSize) demand[item.potatoSize]++;
    });
  });
  return demand;
}

function autoSelectSize() {
  const demand  = calcPotatoDemand();
  const stock   = { S: stockCount('S'), M: stockCount('M'), L: stockCount('L') };

  // 不足量 = max(0, 需要 - 在庫) が多いサイズを優先
  const shortage = { S: Math.max(0, demand.S - stock.S), M: Math.max(0, demand.M - stock.M), L: Math.max(0, demand.L - stock.L) };
  const totalShortage = shortage.S + shortage.M + shortage.L;

  if (totalShortage > 0) {
    let best = 'M', bestShortage = -1;
    for (const s of ['M', 'L', 'S']) {
      if (shortage[s] > bestShortage) { bestShortage = shortage[s]; best = s; }
    }
    return best;
  }

  // 不足なし: S:M:L = 1:3:1 の比率になるよう最も不足しているサイズを選択
  const TARGET = { S: 1, M: 3, L: 1 };
  const total  = stock.S + stock.M + stock.L;
  let best = 'M', bestDeficit = -Infinity;
  for (const s of ['S', 'M', 'L']) {
    const currentRatio = total > 0 ? stock[s] / total : 0;
    const targetRatio  = TARGET[s] / 5;
    const deficit      = targetRatio - currentRatio;
    if (deficit > bestDeficit) { bestDeficit = deficit; best = s; }
  }
  return best;
}

function startFryer(fryerIdx) {
  const fryer = fryers[fryerIdx];
  if (!fryer || fryer.phase !== 'empty') return;
  fryer.size       = null; // サイズは調理終了時に決定
  fryer.phase      = 'frying';
  fryer.phaseStart = Date.now();
  renderPotatoStation();
}

function fryerComplete(fryerIdx) {
  const fryer = fryers[fryerIdx];
  // 調理終了時点でストックが1:3:1になるようサイズを決定
  const size  = autoSelectSize();
  const yield_= BASKET_YIELD[size];
  const now   = Date.now();

  // 全量をストックへ追加してから在庫待ちオーダーに充当
  potatoStock[size].push({ qty: yield_, expiresAt: now + POTATO_HOLD_TIME * 1000 });
  fulfillPotatoWaiting(size);

  fryer.size       = null;
  fryer.phase      = 'empty';
  fryer.phaseStart = 0;
  renderPotatoStation();
  sfxPotatoDone();
  showToastPotato(size, yield_);
}

function showToastPotato(size, qty) {
  const el = document.getElementById('kds-feedback');
  if (!el) return;
  el.textContent   = `🍟 ポテト${size} ×${qty} 完成 → ストック補充`;
  el.className     = 'kds-feedback-toast fb-green';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// ストック補充後、在庫待ちのオーダーに充当する
function fulfillPotatoWaiting(size) {
  const now = Date.now();
  orders.forEach(order => {
    order.items.forEach(item => {
      if (!item.ready && item.potatoSize === size && item.readyAt === Infinity) {
        if (consumeStock(size)) {
          item.readyAt = now + POTATO_BAG_TIME * 1000;
        }
      }
    });
  });
}

function convertPotato(fromSize, toSize) {
  if (fromSize === toSize) return;
  const fromCount = stockCount(fromSize);
  if (fromCount === 0) return;
  const totalGram = fromCount * POTATO_GRAM[fromSize];
  const toCount   = Math.floor(totalGram / POTATO_GRAM[toSize]);
  if (toCount === 0) return;

  // 変換元の最も古い期限を引き継ぐ（鮮度を延長させない）
  const minExpiry = Math.min(...potatoStock[fromSize].map(b => b.expiresAt));

  potatoStock[fromSize] = []; // 変換元を全廃棄
  potatoStock[toSize].push({ qty: toCount, expiresAt: minExpiry });

  // 変換後のストックで待機中オーダーを充当
  fulfillPotatoWaiting(toSize);
  potatoConvertCount++;

  renderPotatoStation();
  const el = document.getElementById('kds-feedback');
  if (!el) return;
  el.textContent   = `🔄 ポテト${fromSize}×${fromCount} → ${toSize}×${toCount} 変換`;
  el.className     = 'kds-feedback-toast fb-yellow';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

function showToastDiscard(count) {
  const el = document.getElementById('kds-feedback');
  if (!el) return;
  el.textContent   = `🗑️ ポテト×${count} 廃棄！保持時間(7分)超過`;
  el.className     = 'kds-feedback-toast fb-red';
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ── Sandwich Production Engine ────────────────────────────────────────────────

function enqueueOrderSandwiches(order) {
  // サンド または 非サンドSANDカテゴリ（ナゲット・アップルパイ）があればキッチンへ
  const hasKitchenItem = order.items.some(i => i.category === CATEGORY.SAND);
  if (!hasKitchenItem) return;
  if (kitchenOrderId === null) {
    startKitchenOrder(order.id);
  } else {
    kitchenOrderQueue.push(order.id);
  }
}

// 厨房が指定オーダーの製造を開始する
function startKitchenOrder(orderId) {
  kitchenOrderId = orderId;
  const order = orders.find(o => o.id === orderId);
  if (!order) { advanceKitchen(); return; }
  order.items.forEach((item, idx) => {
    if (item.category !== CATEGORY.SAND) return;
    if (item.isSandwich) {
      toastWaitQ.push({ orderId, itemIdx: idx }); // バンズ焼成から
    } else {
      makeWaitQ.push({ orderId, itemIdx: idx });   // ナゲット等: 焼成なし・直接製造へ
    }
  });
  drainToastQueue();
  drainMakeQueue();
}

// 前のオーダーが完了/引き継ぎ済みなら次のオーダーへ
function checkKitchenAdvance() {
  if (kitchenOrderId === null) return;
  const busy = toastWaitQ.some(t => t.orderId === kitchenOrderId) ||
               toastingNow.some(t => t.orderId === kitchenOrderId) ||
               makeWaitQ.some(m => m.orderId === kitchenOrderId) ||
               makingNow.some(m => m.orderId === kitchenOrderId);
  if (busy) return;
  advanceKitchen();
}

function advanceKitchen() {
  kitchenOrderId = null;
  while (kitchenOrderQueue.length > 0) {
    const nextId = kitchenOrderQueue.shift();
    if (orders.find(o => o.id === nextId)) { startKitchenOrder(nextId); return; }
    // 既にプレゼント済みならスキップ
  }
}

function drainToastQueue() {
  const now = Date.now();
  // デンジャー中は焼成をスキップして直接製造待ちへ
  if (dangerActive) {
    toastingNow.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
    toastingNow = [];
    toastWaitQ.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
    toastWaitQ = [];
    return;
  }
  while (toastingNow.length < TOAST_CAPACITY && toastWaitQ.length > 0) {
    const next = toastWaitQ.shift();
    const doneAt = now + (tutorialMode ? TUTORIAL_TOAST_TIME : BUNS_TOAST_TIME) * 1000;
    toastingNow.push({ ...next, doneAt });
    // readyAt = 焼成完了時刻のみ。製造スロットに入った時点で更新される
    const order = orders.find(o => o.id === next.orderId);
    if (order) order.items[next.itemIdx].readyAt = doneAt;
  }
}

function effectiveMakeCapacity() {
  if (dangerActive) return 6;
  return MAKE_CAPACITY;
}

// 未製造・製造途中のサンド総数（デンジャー発動条件の判定に使用）
function countPendingSandwiches() {
  let count = 0;
  // 焼成待ち・焼成中（全てサンド）
  count += toastWaitQ.length + toastingNow.length;
  // 製造待ち（サンドのみ）
  makeWaitQ.forEach(m => {
    const order = orders.find(o => o.id === m.orderId);
    if (order && order.items[m.itemIdx].isSandwich) count++;
  });
  // 製造中（サンドのみ）
  makingNow.forEach(m => {
    const order = orders.find(o => o.id === m.orderId);
    if (order && order.items[m.itemIdx].isSandwich) count++;
  });
  // チェイサー製造中（サンド）
  chaserMaking.forEach(m => {
    const order = orders.find(o => o.id === m.orderId);
    if (order && order.items[m.itemIdx].isSandwich) count++;
  });
  // キッチン待機中オーダーの未完成サンド
  kitchenOrderQueue.forEach(orderId => {
    const order = orders.find(o => o.id === orderId);
    if (order) count += order.items.filter(i => i.isSandwich && !i.ready).length;
  });
  return count;
}

function drainMakeQueue() {
  const now = Date.now();

  // デンジャー中: 空きスロット分だけ kitchenOrderQueue からも直接補充
  if (dangerActive) {
    while (kitchenOrderQueue.length > 0 &&
           makingNow.length + makeWaitQ.length < effectiveMakeCapacity()) {
      const orderId = kitchenOrderQueue.shift();
      const order = orders.find(o => o.id === orderId);
      if (!order) continue;
      order.items.forEach((item, idx) => {
        if (item.category === CATEGORY.SAND) {
          makeWaitQ.push({ orderId, itemIdx: idx });
        }
      });
    }
  }

  while (makingNow.length < effectiveMakeCapacity() && makeWaitQ.length > 0) {
    const next = makeWaitQ.shift();
    const order = orders.find(o => o.id === next.orderId);
    // プレゼント済みでorderが存在しない場合はスキップ（幽霊スロットを防ぐ）
    if (!order) continue;
    // サンドは SAND_MAKE_TIME、ナゲット等は item の prepTime を使用
    const item = order.items[next.itemIdx];
    const makeTime = !item.isSandwich ? item.prepTime : (tutorialMode ? TUTORIAL_MAKE_TIME : SAND_MAKE_TIME);
    const doneAt = now + makeTime * 1000;
    makingNow.push({ ...next, doneAt });
    item.readyAt = doneAt;
  }
}

function sandwichTick() {
  const now = Date.now();

  // 1. 焼成完了 → 製造待ちキューへ（デンジャー中は残留分も即時フラッシュ）
  if (dangerActive) {
    toastingNow.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
    toastingNow = [];
  } else {
    const doneToasting = toastingNow.filter(t => t.doneAt <= now);
    toastingNow = toastingNow.filter(t => t.doneAt > now);
    doneToasting.forEach(t => makeWaitQ.push({ orderId: t.orderId, itemIdx: t.itemIdx }));
  }

  // 2. 焼成スロット補充（デンジャー中は toastWaitQ も即時 makeWaitQ へ）
  drainToastQueue();

  // ナゲット待機中: 同オーダーのサンドが全完成していれば ready に解放
  nuggetWaiting = nuggetWaiting.filter(w => {
    const order = orders.find(o => o.id === w.orderId);
    if (!order) return false;
    const sandsDone = order.items.every(i => !i.isSandwich || i.ready);
    if (sandsDone) {
      order.items[w.itemIdx].ready = true;
      return false;
    }
    return true; // まだ待機継続
  });

  // 3. 厨房製造完了
  const doneMaking = makingNow.filter(m => m.doneAt <= now);
  makingNow = makingNow.filter(m => m.doneAt > now);
  doneMaking.forEach(m => {
    const order = orders.find(o => o.id === m.orderId);
    if (!order) return;
    const item = order.items[m.itemIdx];
    // ナゲット: 同オーダーにまだ未完成サンドがあれば待機キューへ
    if (!item.isSandwich && item.category === CATEGORY.SAND) {
      const sandsDone = order.items.every(i => !i.isSandwich || i.ready);
      if (!sandsDone) {
        item.readyAt = m.doneAt; // 製造は完了しているが ready は保留
        nuggetWaiting.push({ orderId: m.orderId, itemIdx: m.itemIdx });
        return;
      }
    }
    item.ready   = true;
    item.readyAt = m.doneAt;
    // 全サンド完成 + TTS未確定 → TTS確定
    if (!order.ttsAt && order.items.every(i => !i.isSandwich || i.ready)) {
      order.ttsAt = m.doneAt;
    }
  });

  // 4. チェイサー製造完了
  const doneChaser = chaserMaking.filter(m => m.doneAt <= now);
  chaserMaking = chaserMaking.filter(m => m.doneAt > now);
  doneChaser.forEach(m => {
    const order = orders.find(o => o.id === m.orderId);
    if (order) {
      order.items[m.itemIdx].ready   = true;
      order.items[m.itemIdx].readyAt = m.doneAt;
      // 全サンド完成 + TTS未確定 → TTS確定、待機ナゲットも解放
      if (!order.ttsAt && order.items.every(i => !i.isSandwich || i.ready)) {
        order.ttsAt = m.doneAt;
      }
    }
  });
  // チェイサーの担当分がすべて完了したら解放 → order.chased をリセットして再発動可能に
  if (chaserOrderId !== null && !chaserMaking.some(x => x.orderId === chaserOrderId)) {
    const o = orders.find(x => x.id === chaserOrderId);
    if (o) o.chased = false; // 再度チェイサー発動を許可
    chaserOrderId = null;
    renderPotatoStation(); // フライヤーボタン再表示
  }

  // 5. 製造スロット補充
  drainMakeQueue();

  // 6. 厨房が現在担当オーダーを完了/引き継ぎ済みか確認し、次オーダーへ進める
  checkKitchenAdvance();
}

function fryerTick() {
  const now = Date.now();
  fryers.forEach((fryer, idx) => {
    if (fryer.phase === 'frying') {
      if ((now - fryer.phaseStart) / 1000 >= FRYER_FRY_TIME) {
        fryer.phase      = 'salting';
        fryer.phaseStart = now;
      }
    } else if (fryer.phase === 'salting') {
      if ((now - fryer.phaseStart) / 1000 >= FRYER_SALT_TIME) {
        fryerComplete(idx);
      }
    }
  });
  expirePotatoStock();
}

function renderPotatoStation() {
  const row = document.getElementById('fryer-row');
  if (!row) return;

  const now    = Date.now();
  const demand = calcPotatoDemand();
  const nextSize = autoSelectSize();

  // ── フライヤースロット ─────────────────────────────────────────
  fryers.forEach(fryer => {
    let slot = row.querySelector(`[data-fryer-id="${fryer.id}"]`);
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'fryer-slot';
      slot.dataset.fryerId = fryer.id;
      row.appendChild(slot);
    }

    if (fryer.phase === 'empty') {
      const fryDisabled = chaserOrderId !== null || now < presentCooldownUntil;
      const fryBtnAttr  = fryDisabled ? ' disabled style="opacity:0.4"' : '';
      const newHtml = `
        <div class="fryer-label">バット ${fryer.id + 1}</div>
        <div class="fryer-next-size">→ ${nextSize} ×${BASKET_YIELD[nextSize]}</div>
        <button class="btn-fry-start" data-fryer="${fryer.id}"${fryBtnAttr}>調理開始</button>`;
      if (slot.dataset.state !== 'empty') {
        slot.className = 'fryer-slot empty';
        slot.innerHTML = newHtml;
        slot.dataset.state = 'empty';
      } else {
        // Update next-size label and fry button state
        const nxt = slot.querySelector('.fryer-next-size');
        if (nxt) nxt.textContent = `→ ${nextSize} ×${BASKET_YIELD[nextSize]}`;
        const fryBtn = slot.querySelector('.btn-fry-start');
        if (fryBtn) { fryBtn.disabled = fryDisabled; fryBtn.style.opacity = fryDisabled ? '0.4' : ''; }
      }
    } else {
      const elapsed    = (now - fryer.phaseStart) / 1000;
      const isFrying   = fryer.phase === 'frying';
      const total      = isFrying ? FRYER_FRY_TIME : FRYER_SALT_TIME;
      const pct        = Math.min(100, (elapsed / total) * 100);
      const remain     = Math.max(0, Math.ceil(total - elapsed));
      const phaseLabel = isFrying ? '🔥 揚げ中' : '🧂 塩かけ中';
      const barClass   = isFrying ? 'fryer-bar frying' : 'fryer-bar salting';

      if (slot.dataset.state !== fryer.phase) {
        slot.className = `fryer-slot ${fryer.phase}`;
        slot.dataset.state = fryer.phase;
        const sizeTag = fryer.size ? fryer.size : '?';
        slot.innerHTML = `
          <div class="fryer-label">バット ${fryer.id + 1} <span class="fryer-size-tag">${sizeTag}</span></div>
          <div class="fryer-phase-label">${phaseLabel}</div>
          <div class="fryer-bar-bg"><div class="${barClass}" style="width:${pct}%"></div></div>
          <div class="fryer-remain">${remain}s</div>`;
      } else {
        const bar = slot.querySelector('.fryer-bar');
        if (bar) bar.style.width = pct + '%';
        const rem = slot.querySelector('.fryer-remain');
        if (rem) rem.textContent = remain + 's';
        const pl = slot.querySelector('.fryer-phase-label');
        if (pl) pl.textContent = phaseLabel;
      }
    }
  });

  // ── ストック & 需要表示 ────────────────────────────────────────
  const stockEl = document.getElementById('potato-stock-display');
  if (!stockEl) return;

  const mkStock = (size) => {
    const n   = stockCount(size);
    const icons = n > 0
      ? `<span class="stock-potato-icons">${'🍟'.repeat(Math.min(n, 8))}${n > 8 ? `<span class="stock-plus">+${n-8}</span>` : ''}</span>`
      : `<span class="stock-zero">なし</span>`;
    const expSec = nearestExpirySec(size);
    let expiryHtml = '';
    if (expSec !== null) {
      const expClass = expSec <= 60 ? 'expiry-danger' : expSec <= 120 ? 'expiry-warn' : 'expiry-ok';
      expiryHtml = `<div class="stock-expiry ${expClass}">廃棄 ${Math.ceil(expSec)}s</div>`;
    }
    const convDisabled = Date.now() < presentCooldownUntil ? ' disabled style="opacity:0.4"' : '';
    const convBtns = n > 0 ? ['S', 'M', 'L'].filter(t => t !== size).map(t => {
      const toCnt = Math.floor(n * POTATO_GRAM[size] / POTATO_GRAM[t]);
      return toCnt > 0
        ? `<button class="btn-potato-conv" data-from="${size}" data-to="${t}"${convDisabled}>→${t}×${toCnt}</button>`
        : '';
    }).join('') : '';
    return `
      <div class="stock-box">
        <div class="stock-size-label">${size}</div>
        ${icons}
        ${expiryHtml}
        ${convBtns ? `<div class="stock-conv-row">${convBtns}</div>` : ''}
      </div>`;
  };

  const dmTotal = demand.S + demand.M + demand.L;
  stockEl.innerHTML = `
    <div class="stock-grid">
      ${mkStock('S')}${mkStock('M')}${mkStock('L')}
    </div>
    <div class="demand-summary">
      📋 オーダー内ポテト: S:${demand.S} M:${demand.M} L:${demand.L}
      ${dmTotal === 0 ? '' : `<span class="demand-total">計${dmTotal}個</span>`}
    </div>`;
}

// ── tick ──────────────────────────────────────────────────────────────────────

function gameTick() {
  const now = Date.now();

  // サンド以外のアイテム (ポテト・ドリンク) の完了チェック
  orders.forEach(order => {
    order.items.forEach(item => {
      if (item.isSandwich) return; // サンドは sandwichTick() が管理
      if (!item.ready && item.readyAt !== Infinity && now >= item.readyAt) item.ready = true;
    });
    // 全アイテム完了した瞬間を記録
    if (!order.allReadyAt && order.items.every(i => i.ready)) {
      order.allReadyAt = now;
    }
  });

  sandwichTick();
  fryerTick();

  // デンジャー自動解除: 製造待ち・製造中のサンドが2個以下になった時点
  if (dangerActive && countPendingSandwiches() <= 2) deactivateDanger();
  updateDangerUI();

  if (!tutorialMode) {
    // ── GAME OVER チェック ──────────────────────────────────────────────────
    // ① ポテト廃棄累計4個以上
    if (potatoDiscarded >= (expertMode ? 10 : 4)) { triggerGameOver('potato'); return; }
    // ② 未提供オーダーが受注から270秒経過
    const now270 = Date.now();
    if (orders.some(o => (now270 - o.receiptTime) / 1000 > 270)) { triggerGameOver('r2p270'); return; }
    // ③ KDS上に未提供オーダーが同時滞留 (通常6件 / エキスパート10件)
    if (orders.length >= (expertMode ? 10 : 6)) { triggerGameOver('backlog'); return; }

    gameTimeLeft -= 0.1;
    if (gameTimeLeft <= 0) {
      gameTimeLeft = 0;
      endGame();
      return;
    }

    // フライヤーUIは2秒ごとに更新（毎tick更新は重い）
    if (Math.round(gameTimeLeft * 10) % 20 === 0) renderPotatoStation();

    document.getElementById('kds-countdown').textContent = fmtTime(gameTimeLeft);

    // 残り5秒カウントダウン表示
    const fcEl = document.getElementById('kds-final-countdown');
    if (gameTimeLeft <= 5 && gameTimeLeft > 0) {
      const n = Math.ceil(gameTimeLeft);
      if (fcEl.textContent !== String(n)) {
        fcEl.textContent = n;
        fcEl.classList.remove('pop');
        void fcEl.offsetWidth; // reflow でアニメーションリセット
        fcEl.classList.add('pop');
      }
      fcEl.style.display = 'flex';
    } else {
      fcEl.style.display = 'none';
    }
  } else {
    // チュートリアル中: 2秒おきにフライヤーUI更新
    if (Math.round(Date.now() / 100) % 20 === 0) renderPotatoStation();
  }

  renderOrders();
}

// ── start / end ───────────────────────────────────────────────────────────────

function startKDS(expert = false) {
  tutorialMode     = false;
  tutorialFreePlay = false;
  expertMode       = expert;
  orders        = [];
  presented     = [];
  orderSeq      = 0;
  gameTimeLeft  = GAME_DURATION;
  gameRunning   = true;
  chaserOrderId      = null;
  toastingNow        = [];
  toastWaitQ         = [];
  makingNow          = [];
  makeWaitQ          = [];
  chaserMaking       = [];
  kitchenOrderId     = null;
  kitchenOrderQueue  = [];
  nuggetWaiting      = [];
  inBurst          = true;
  burstLeft        = expertMode ? rand(3, 6) : rand(2, 4);
  ordersSpawned    = 0;
  potatoDiscarded      = 0;
  potatoConvertCount   = 0;
  waitCount            = 0;
  presentCooldownUntil = 0;
  mgrCooldownUntil     = 0;
  gameOverReason       = null;
  dangerActive         = false;

  initFryers();

  clearInterval(tickInterval);
  clearTimeout(spawnTimer);

  ['kds-tts-avg', 'kds-r2p-avg'].forEach(id => document.getElementById(id).textContent = '--:--');
  document.getElementById('kds-sales-val').textContent       = '¥0';
  document.getElementById('kds-ac-val').textContent          = '--';
  document.getElementById('kds-order-count').textContent     = '0';
  document.getElementById('kds-feedback').style.opacity      = '0';
  document.getElementById('kds-countdown').textContent       = fmtTime(GAME_DURATION);
  updateDangerUI();

  document.getElementById('start-screen').style.display      = 'none';
  document.getElementById('game-screen').style.display       = 'none';
  document.getElementById('result-screen').style.display     = 'none';
  document.getElementById('kds-result-screen').style.display = 'none';
  document.getElementById('app').style.display               = 'none';
  document.getElementById('kds-screen').style.display        = 'flex';

  const badge = document.getElementById('kds-mode-badge');
  badge.style.background = '';
  badge.style.color      = '';
  if (expertMode) {
    badge.textContent   = 'EXPERT';
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }

  // 通常モードではデンジャーボタンを復元
  const dangerBtnEl = document.getElementById('btn-danger');
  if (dangerBtnEl) dangerBtnEl.style.display = '';

  renderOrders();
  renderPotatoStation();
  setTimeout(spawnOrder, 4000);
  tickInterval = setInterval(gameTick, 100);
}

const GAME_OVER_MESSAGES = {
  potato:  '💀 GAME OVER — ポテト廃棄が4個に達しました。需要を読んだ調理計画が必要です。',
  r2p270:  '💀 GAME OVER — RtoPが270秒を超えるオーダーが発生しました。提供が遅すぎます。',
  backlog: '💀 GAME OVER — KDS上に6件以上のオーダーが同時に滞留しました。ライン崩壊です。',
};

function triggerGameOver(reason) {
  if (!gameRunning) return;
  gameOverReason = reason;
  gameRunning = false;
  clearInterval(tickInterval);
  clearTimeout(spawnTimer);

  const screen = document.getElementById('kds-screen');
  screen.classList.add('gameover-flash');
  setTimeout(() => {
    screen.classList.remove('gameover-flash');
    document.getElementById('kds-screen').style.display = 'none';
    showGameOverSplash();
  }, 800);
}

function showGameOverSplash() {
  const splash  = document.getElementById('gameover-splash');
  const content = document.getElementById('gameover-splash-content');
  const label   = document.getElementById('gameover-splash-label');

  content.innerHTML = '';
  splash.className  = 'go-splash-' + gameOverReason;
  label.textContent = GAME_OVER_MESSAGES[gameOverReason];

  if (gameOverReason === 'potato') {
    // 画面をポテトで埋め尽くす
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('span');
      el.className   = 'go-potato';
      el.textContent = '🍟';
      el.style.left  = Math.random() * 100 + 'vw';
      el.style.top   = Math.random() * 100 + 'vh';
      el.style.fontSize = (3 + Math.random() * 6) + 'rem';
      el.style.animationDelay    = (Math.random() * 0.6) + 's';
      el.style.animationDuration = (0.4 + Math.random() * 0.4) + 's';
      content.appendChild(el);
    }

  } else if (gameOverReason === 'r2p270') {
    // 怒り狂った客の顔
    content.innerHTML = `<div class="go-face go-angry">😡</div>
      <div class="go-face-sub">お客様をお待たせしすぎです！</div>`;

  } else if (gameOverReason === 'backlog') {
    // ぐるぐる目の自分の顔
    content.innerHTML = `<div class="go-face go-dizzy">😵</div>
      <div class="go-face-sub">処理しきれません…！</div>`;
  }

  splash.style.display = 'flex';
  setTimeout(() => {
    splash.style.display = 'none';
    showResult();
  }, 3000);
}

function startTutorial() {
  tutorialMode  = true;
  expertMode    = false;
  orders        = [];
  presented     = [];
  orderSeq      = 0;
  gameTimeLeft  = 9999;
  gameRunning   = true;
  chaserOrderId      = null;
  toastingNow        = [];
  toastWaitQ         = [];
  makingNow          = [];
  makeWaitQ          = [];
  chaserMaking       = [];
  kitchenOrderId     = null;
  kitchenOrderQueue  = [];
  nuggetWaiting      = [];
  inBurst          = false;
  burstLeft        = 0;
  ordersSpawned    = 0;
  potatoDiscarded      = 0;
  potatoConvertCount   = 0;
  waitCount            = 0;
  presentCooldownUntil = 0;
  mgrCooldownUntil     = 0;
  gameOverReason       = null;
  dangerActive         = false;

  initFryers();
  clearInterval(tickInterval);
  clearTimeout(spawnTimer);

  ['kds-tts-avg', 'kds-r2p-avg'].forEach(id => document.getElementById(id).textContent = '--:--');
  document.getElementById('kds-sales-val').textContent     = '¥0';
  document.getElementById('kds-ac-val').textContent        = '--';
  document.getElementById('kds-order-count').textContent   = '0';
  document.getElementById('kds-feedback').style.opacity    = '0';
  document.getElementById('kds-countdown').textContent     = 'TUTORIAL';

  // バッジ: TUTORIAL
  const badge = document.getElementById('kds-mode-badge');
  badge.textContent   = 'TUTORIAL';
  badge.style.display = 'inline-block';
  badge.style.background = '#0369a1';
  badge.style.color      = '#bae6fd';

  document.getElementById('start-screen').style.display      = 'none';
  document.getElementById('game-screen').style.display       = 'none';
  document.getElementById('result-screen').style.display     = 'none';
  document.getElementById('kds-result-screen').style.display = 'none';
  document.getElementById('app').style.display               = 'none';
  document.getElementById('kds-screen').style.display        = 'flex';

  renderOrders();
  renderPotatoStation();
  tickInterval = setInterval(gameTick, 100);
}

function spawnTutorialOrder(menuItems) {
  const now = Date.now();
  const items = menuItems.map(m => ({
    name:       m.name,
    price:      m.price,
    prepTime:   m.prepTime || 0,
    category:   m.category,
    isSandwich: m.isSandwich || false,
    potatoSize: null,
    ready:      false,
    readyAt:    m.isSandwich ? Infinity : now + (m.prepTime || 10) * 1000,
  }));
  const order = {
    id:           ++orderSeq,
    num:          String(orderSeq).padStart(3, '0'),
    receiptTime:  now,
    items,
    sandwichCount: items.filter(i => i.isSandwich).length,
    total:        items.reduce((s, i) => s + i.price, 0),
    presented:    false, presentTime:  null,
    waited:       false, waitedAt:     null,
    chased:       false, chasedAt:     null,
    tts: null, ttsAt: null, r2p: null,
    allReadyAt: null, lagSec: null,
  };
  orders.push(order);
  enqueueOrderSandwiches(order);
  renderOrders();
  return order.id;
}

function endGame() {
  gameRunning = false;
  clearInterval(tickInterval);
  clearTimeout(spawnTimer);
  showResult();
}

// ── score / result ────────────────────────────────────────────────────────────

function calcScore() {
  let score = 0;

  // R2P 評価 (主軸)
  presented.forEach(o => {
    if      (o.r2p <= R2P_GREAT)  score += 100;
    else if (o.r2p <= R2P_GOOD)   score += 50;
    else if (o.r2p <= R2P_NORMAL) score += 15;
    else                          score += 0;
  });

  // Sales ボーナス (主軸)
  const sales = presented.reduce((s, o) => s + o.total, 0);
  score += Math.floor(sales / 10);

  // WAIT 減点: 通常3回・エキスパート10回まで無料、以降は指数的に増加
  const waitFreeLimit = expertMode ? 10 : 3;
  const waitPenalty = waitCount > waitFreeLimit ? Math.round(30 * (Math.pow(2, waitCount - waitFreeLimit) - 1)) : 0;
  score -= waitPenalty;

  // 平均TTS > 平均R2P の場合は大幅ペナルティ (WAITを悪用した運用の検出)
  const count_ = presented.length;
  if (count_ > 0) {
    const ttsOrders_ = presented.filter(o => o.tts !== null);
    const avgTTS_ = ttsOrders_.length > 0 ? ttsOrders_.reduce((s, o) => s + o.tts, 0) / ttsOrders_.length : null;
    const avgR2P_ = presented.reduce((s, o) => s + o.r2p, 0) / count_;
    if (avgTTS_ !== null && avgTTS_ > avgR2P_) score -= 500;
  }

  // ポテト再製造(変換)ペナルティ: 1回 -20pt
  score -= potatoConvertCount * 20;

  // ポテト廃棄ペナルティ
  score -= potatoDiscarded * 30;

  // 未提供オーダーペナルティ: 3件まで無料
  score -= Math.max(0, orders.length - 3) * 20;

  return Math.max(0, score);
}

function showResult() {
  document.getElementById('kds-screen').style.display = 'none';
  document.getElementById('kds-result-screen').style.display = 'block';

  const count  = presented.length;

  // GAMEOVER バナー
  const goEl = document.getElementById('kds-gameover-banner');
  if (gameOverReason) {
    goEl.textContent    = GAME_OVER_MESSAGES[gameOverReason];
    goEl.style.display  = 'block';
  } else {
    goEl.style.display  = 'none';
  }

  const ttsOrders = presented.filter(o => o.tts !== null);
  const avgTTS = ttsOrders.length > 0 ? ttsOrders.reduce((s, o) => s + o.tts, 0) / ttsOrders.length : null;
  const avgR2P = count > 0 ? presented.reduce((s, o) => s + o.r2p, 0) / count : 0;
  const sales  = presented.reduce((s, o) => s + o.total, 0);
  const ac     = count > 0 ? sales / count : 0;
  const score  = calcScore();
  const missed = orders.length;
  const proj30 = count > 0 ? Math.round((count / GAME_DURATION) * 1800) : 0;

  // ランクは R2P 基準
  let r2pRank, r2pRankClass;
  if      (score >= 4000) { r2pRank = 'S'; r2pRankClass = 'S'; }
  else if (score >= 3200) { r2pRank = 'A'; r2pRankClass = 'A'; }
  else if (score >= 2500) { r2pRank = 'B'; r2pRankClass = 'B'; }
  else if (score >= 1800) { r2pRank = 'C'; r2pRankClass = 'C'; }
  else if (score >= 1200) { r2pRank = 'D'; r2pRankClass = 'D'; }
  else if (score >=  700) { r2pRank = 'E'; r2pRankClass = 'E'; }
  else                    { r2pRank = 'F'; r2pRankClass = 'F'; }

  document.getElementById('kds-res-score').textContent = `${score} pt`;
  const rankEl = document.getElementById('kds-res-rank');
  rankEl.textContent = `${r2pRank} ランク`;
  rankEl.className   = `rank ${r2pRankClass}`;

  const ttsClass  = avgTTS === null ? '' : avgTTS < TTS_GREEN ? 'good' : avgTTS < TTS_RED ? 'ok' : 'bad';
  const r2pClass  = avgR2P < R2P_GREEN  ? 'good' : avgR2P < R2P_YELLOW  ? 'ok' : 'bad';
  const waitFreeLimit = expertMode ? 10 : 3;
  const waitPenalty   = waitCount > waitFreeLimit ? Math.round(30 * (Math.pow(2, waitCount - waitFreeLimit) - 1)) : 0;
  const avgTtsOverR2p = avgTTS !== null && avgTTS > avgR2P;

  document.getElementById('kds-res-details').innerHTML = `
    <div class="res-metric"><span class="res-label">提供数</span>
      <span class="res-val">${count} / ${count + missed} オーダー</span></div>
    <div class="res-metric"><span class="res-label">平均 RtoP</span>
      <span class="res-val ${r2pClass}">${count ? Math.round(avgR2P) + 's' : '--'}</span></div>
    <div class="res-metric"><span class="res-label">平均 ⓣⓣⓢ</span>
      <span class="res-val ${ttsClass}">${avgTTS !== null ? Math.round(avgTTS) + 's' : '--'}</span></div>
    <div class="res-metric"><span class="res-label">売上 (Sales)</span>
      <span class="res-val">¥${sales.toLocaleString()}</span></div>
    <div class="res-metric"><span class="res-label">AC（客単価）</span>
      <span class="res-val">¥${Math.round(ac).toLocaleString()}</span></div>
    <div class="res-metric"><span class="res-label">30分換算 予測提供数</span>
      <span class="res-val">${proj30} オーダー</span></div>
    <div class="res-metric"><span class="res-label">WAIT 件数</span>
      <span class="res-val ${waitPenalty > 0 ? 'bad' : 'good'}">${waitCount} 回
      ${waitPenalty > 0 ? `(-${waitPenalty}pt)` : `(${waitFreeLimit}回以内 — 減点なし)`}</span></div>
    ${avgTtsOverR2p ? `
    <div class="res-metric"><span class="res-label">⚠ 平均ⓣⓣⓢ > 平均RtoP</span>
      <span class="res-val bad">WAIT過多による品質低下 (-500pt)</span></div>` : ''}
    <div class="res-metric"><span class="res-label">ポテト再製造</span>
      <span class="res-val ${potatoConvertCount > 0 ? 'bad' : 'good'}">${potatoConvertCount} 回
      ${potatoConvertCount > 0 ? `(-${potatoConvertCount * 20}pt)` : ''}</span></div>
    <div class="res-metric"><span class="res-label">ポテト廃棄</span>
      <span class="res-val ${potatoDiscarded > 0 ? 'bad' : 'good'}">${potatoDiscarded} 個
      ${potatoDiscarded > 0 ? `(-${potatoDiscarded * 30}pt)` : ''}</span></div>
    ${missed > 0 ? `<div class="res-metric"><span class="res-label">未提供</span><span class="res-val ${missed <= 3 ? 'ok' : 'bad'}">${missed} 件 ${missed <= 3 ? '(3件以内 — 減点なし)' : `(-${(missed - 3) * 20}pt)`}</span></div>` : ''}
  `;

  // ── フィードバック生成 ────────────────────────────────────────
  const feedbacks = [];
  const avgLag = count > 0
    ? presented.reduce((s, o) => s + (o.lagSec ?? 0), 0) / count
    : 0;
  const mgrUsed = presented.some(o => o.waited); // MGRボタン使用はwaitedオーダー

  // R2P 評価（5段階）
  if (count > 0) {
    const greatCount  = presented.filter(o => o.r2p <= R2P_GREAT).length;
    const goodCount   = presented.filter(o => o.r2p <= R2P_GOOD).length;
    const badCount    = presented.filter(o => o.r2p > R2P_NORMAL).length;
    const greatPct    = greatCount / count;
    const greatGoodPct = goodCount / count;
    const badPct      = badCount / count;

    if (greatPct >= 0.8)
      feedbacks.push({ type: 'good', text: `RtoP GREAT率${Math.round(greatPct * 100)}% — 提供スピードが非常に安定しています。ほぼ全オーダーを90秒以内に提供できており、ランナーとして理想的なペースです。` });
    else if (greatGoodPct >= 0.8)
      feedbacks.push({ type: 'good', text: `RtoP GREAT+GOOD率${Math.round(greatGoodPct * 100)}% — 提供タイミングの判断は良好です。GREAT率をさらに高めるには、サンド完成直後に素早くPRESENTする意識が重要です。` });
    else if (greatGoodPct >= 0.5)
      feedbacks.push({ type: 'ok',   text: `RtoP GREAT+GOOD率${Math.round(greatGoodPct * 100)}% — 提供タイミングはまずまずです。NORMAL以下のオーダーが${count - goodCount}件あります。取り揃えの優先順位とPRESENTのタイミングを意識しましょう。` });
    else if (badPct < 0.3)
      feedbacks.push({ type: 'ok',   text: `RtoP GREAT+GOOD率が${Math.round(greatGoodPct * 100)}%にとどまっています。多くのオーダーがNORMAL評価です。オーダーをさばく順番とWAITの活用を見直しましょう。` });
    else
      feedbacks.push({ type: 'bad',  text: `BAD評価が全体の${Math.round(badPct * 100)}%（${badCount}件）に達しています。提供が大幅に遅れるオーダーが続出しています。ボトルネックを特定し、チェイサーやWAITを活用してラインを立て直す練習が必要です。` });
  }

  // TTS フィードバック (サンドありオーダーが存在する場合のみ)
  if (avgTTS !== null) {
    if (avgTTS <= 50)
      feedbacks.push({ type: 'good', text: `平均ⓣⓣⓢ ${Math.round(avgTTS)}s — サンド製造が非常に速く、ライン全体がスムーズに回っています。この速度を維持できれば上位ランクも狙えます。` });
    else if (avgTTS <= 70)
      feedbacks.push({ type: 'ok',   text: `平均ⓣⓣⓢ ${Math.round(avgTTS)}s — サンド製造は概ね安定しています。バンズ焼成を早めに仕掛けることで、さらに短縮できる余地があります。` });
    else
      feedbacks.push({ type: 'bad',  text: `平均ⓣⓣⓢ ${Math.round(avgTTS)}s — サンド製造に時間がかかっています。バンズ焼成のタイミングを前倒しにする、または詰まったときは積極的にチェイサーに入ることを意識しましょう。` });
  }

  // WAIT 評価
  const wfl = expertMode ? 10 : 3;
  if (waitCount === 0)
    feedbacks.push({ type: 'ok',  text: 'WAITを一度も使いませんでした。混雑時は適度にWAITを活用してラインを安定させましょう。' });
  else if (waitCount <= wfl)
    feedbacks.push({ type: 'good', text: `WAITの活用回数(${waitCount}回)は減点なしの範囲です。必要な場面に絞った判断ができています。` });
  else if (waitCount <= wfl + 3)
    feedbacks.push({ type: 'ok',   text: `WAIT回数(${waitCount}回)が減点ライン(${wfl}回)を超えています。本当に必要な場面に絞りましょう。` });
  else
    feedbacks.push({ type: 'bad',  text: `WAIT回数(${waitCount}回)が過剰です。WAITの多用はオペレーション全体に負荷をかけ、結果的にⓣⓣⓢが延びる原因になります。本当に必要な場面に絞りましょう。` });

  // ⓣⓣⓢ > RtoP（WAIT悪用）
  if (avgTtsOverR2p)
    feedbacks.push({ type: 'bad',  text: '平均ⓣⓣⓢが平均RtoPを上回っています。WAITを多用してRtoPを短く見せても、実際の製造時間は短縮されていません。WAITは本来、製造が間に合わないときに使うものです。' });

  // 製造完了→プレゼントまでのラグ
  if (avgLag > 10)
    feedbacks.push({ type: 'bad',  text: `商品が完成してからプレゼントするまでの時間が平均${Math.round(avgLag)}秒と長めです。完成オーダーをすぐ確認・提供する意識を持ちましょう。` });
  else if (avgLag > 5)
    feedbacks.push({ type: 'ok',   text: `完成→提供のラグが平均${Math.round(avgLag)}秒あります。完成に気づいたら素早く提供しましょう。` });
  else if (count > 0)
    feedbacks.push({ type: 'good', text: '完成したオーダーをすばやく提供できています。提供動作のタイミングが良好です。' });

  // MGR活用フィードバック
  if (waitCount > 0 && !mgrUsed)
    feedbacks.push({ type: 'ok',   text: 'WAITオーダーにはMGRを呼ぶボタンが活用できます。PRESENTボタンには7秒のクーリングタイムがありますが、MGRボタンには別のクーリング(15秒)が適用されるため、連続提供を分散させるのに有効です。' });
  if (mgrUsed)
    feedbacks.push({ type: 'good', text: 'MGRボタンを活用できました。WAITオーダーをMGRに依頼することでPRESENTのクーリングを気にせず提供フローを回せます。' });

  // チェイサー評価
  const chaserUsedCount = presented.filter(o => o.chasedAt).length;
  if (chaserUsedCount === 0 && count > 3)
    feedbacks.push({ type: 'ok',   text: 'チェイサーを使いませんでした。チェイサーは製造中のサンドを引き継ぐことで厨房を次のオーダーへ早く進め、ⓣⓣⓢ短縮が見込めます。ただし発動中は他のアクションが一切できなくなるため、RtoPが伸びるきっかけにもなります。タイミングを見極めて使いましょう。' });
  else if (chaserUsedCount > 0)
    feedbacks.push({ type: 'good', text: `チェイサーを${chaserUsedCount}件活用しました。チェイサーはⓣⓣⓢ短縮が見込めますが、発動中は他のアクションが不可能なためRtoPが伸びるきっかけになりえます。注意して実行しましょう。` });

  // ポテト廃棄
  if (potatoDiscarded === 0)
    feedbacks.push({ type: 'good', text: 'ポテトの廃棄ゼロ！在庫管理と調理タイミングの判断が優れています。' });
  else if (potatoDiscarded <= 3)
    feedbacks.push({ type: 'ok',   text: `ポテト廃棄が${potatoDiscarded}個発生しました。オーダー動向を見ながら調理本数・サイズを調整する意識を持ちましょう。` });
  else
    feedbacks.push({ type: 'bad',  text: `ポテト廃棄が${potatoDiscarded}個と多めです。需要予測を意識し、調理前にオーダー状況を確認する習慣をつけましょう。` });

  // ポテト再製造
  if (potatoConvertCount > 2)
    feedbacks.push({ type: 'bad',  text: `ポテト再製造が${potatoConvertCount}回発生しています。調理完了時点で必要なサイズを正しく判断できるよう、オーダー内のポテト需要を常に確認しましょう。` });

  // 未提供
  if (missed === 0)
    feedbacks.push({ type: 'good', text: '全オーダーを時間内に提供できました。提供数と品質のバランスが取れています。' });
  else if (missed <= 3)
    feedbacks.push({ type: 'ok',   text: `未提供${missed}件は減点なしの範囲内です。ただし4件以上になると減点が発生するため、終盤の処理スピードも意識しましょう。` });
  else
    feedbacks.push({ type: 'bad',  text: `${missed}件が未提供でした（3件超過分 -${(missed - 3) * 20}pt）。優先度の高いオーダーから処理する判断力と、複数オーダーの並行管理を練習しましょう。` });

  // GAME OVER 時は良い評価コメントを除外
  const displayedFeedbacks = gameOverReason
    ? feedbacks.filter(f => f.type !== 'good')
    : feedbacks;

  // 前回フィードバックを削除してから新規挿入
  const oldFb = document.querySelector('.feedback-section');
  if (oldFb) oldFb.remove();

  const fbEl = document.createElement('div');
  fbEl.className = 'feedback-section';
  fbEl.innerHTML = `<h3>フィードバック</h3>` +
    displayedFeedbacks.map(f => `<div class="fb-item fb-${f.type}">${f.text}</div>`).join('');
  document.getElementById('kds-res-breakdown').before(fbEl);

  // オーダー番号順にソート、秒単位表示
  const sortedPresented = [...presented].sort((a, b) => a.id - b.id);
  const bd = document.getElementById('kds-res-breakdown');
  bd.innerHTML = '';
  sortedPresented.forEach(o => {
    const r2pCls = o.r2p <= R2P_GREAT  ? 'great'
                 : o.r2p <= R2P_GOOD   ? 'good'
                 : o.r2p <= R2P_NORMAL ? 'ok'
                 : o.r2p <= R2P_BAD    ? 'bad'
                 : 'gameover';
    const ttsCls = o.tts === null ? 'none' : o.tts < TTS_GREEN ? 'good' : o.tts < TTS_YELLOW ? 'ok' : 'bad';
    const div = document.createElement('div');
    div.className = 'breakdown-item';
    div.innerHTML = `<span>#${o.num}</span>
                     <span class="pts ${r2pCls}">RtoP ${Math.round(o.r2p)}s</span>
                     <span class="pts ${ttsCls}">${o.tts !== null ? `ⓣⓣⓢ ${Math.round(o.tts)}s` : 'ⓣⓣⓢ --'}</span>`;
    bd.appendChild(div);
  });
}

// ── event delegation ─────────────────────────────────────────────────────────

document.getElementById('kds-grid').addEventListener('click', e => {
  const waitBtn = e.target.closest('.btn-wait');
  if (waitBtn) {
    const id = Number(waitBtn.dataset.orderId);
    if (id) waitOrder(id);
    return;
  }
  const chaserBtn = e.target.closest('.btn-chaser');
  if (chaserBtn) {
    const id = Number(chaserBtn.dataset.orderId);
    if (id) chaserOrder(id);
    return;
  }
  const mgrBtn = e.target.closest('.btn-call-mgr');
  if (mgrBtn) {
    const id = Number(mgrBtn.dataset.orderId);
    if (id) callMgr(id);
    return;
  }
  const btn = e.target.closest('.btn-present.active');
  if (btn) {
    const id = Number(btn.dataset.orderId);
    if (id) presentOrder(id);
  }
});

// フライヤーボタン
document.getElementById('fryer-row').addEventListener('click', e => {
  const btn = e.target.closest('.btn-fry-start');
  if (btn && gameRunning) {
    startFryer(Number(btn.dataset.fryer));
  }
});

// ポテト変換ボタン
document.getElementById('potato-stock-display').addEventListener('click', e => {
  const btn = e.target.closest('.btn-potato-conv');
  if (btn && gameRunning && Date.now() >= presentCooldownUntil) convertPotato(btn.dataset.from, btn.dataset.to);
});

// ── wiring ────────────────────────────────────────────────────────────────────

function goHome() {
  gameRunning      = false;
  tutorialMode     = false;
  tutorialFreePlay = false;
  clearInterval(tickInterval);
  clearTimeout(spawnTimer);
  // チュートリアルオーバーレイを非表示
  const tutOverlay = document.getElementById('tut-overlay');
  if (tutOverlay) tutOverlay.style.display = 'none';
  document.getElementById('kds-screen').style.display        = 'none';
  document.getElementById('kds-result-screen').style.display = 'none';
  document.getElementById('app').style.display               = 'flex';
  document.getElementById('start-screen').style.display      = 'block';
}

document.getElementById('btn-kds-start').addEventListener('click',        () => startKDS(false));
document.getElementById('btn-kds-expert').addEventListener('click',       () => startKDS(true));
document.getElementById('btn-kds-tutorial').addEventListener('click',     () => {
  startTutorial();
  window.kdsApi.onTutorialStart?.();
});
document.getElementById('btn-kds-retry').addEventListener('click',        () => startKDS(expertMode));
document.getElementById('btn-back-home').addEventListener('click', goHome);
document.getElementById('btn-danger').addEventListener('click', activateDanger);

// ── window.kdsApi (tutorial.js との橋渡し) ──────────────────────────────────
window.kdsApi = {
  spawnOrder(menuItems) { return spawnTutorialOrder(menuItems); },
  goHome,
  startKDS,
  setFreePlay(enabled) { tutorialFreePlay = enabled; if (enabled) scheduleNext(); },
  onTutorialStart: null, // tutorial.js から上書き
};

// KDS ブランド → ホームへ
document.getElementById('btn-kds-home').addEventListener('click', () => {
  if (gameRunning) {
    if (!confirm('ゲームを中断してホームに戻りますか？')) return;
  }
  goHome();
});

// ── 設定モーダル ──────────────────────────────────────────────────────────────

const settingsModal  = document.getElementById('settings-modal');
const sfxToggle      = document.getElementById('sfx-toggle');
const sfxVolumeSlider = document.getElementById('sfx-volume');
const sfxVolumeLabel  = document.getElementById('sfx-volume-label');

// 初期値を localStorage から反映
sfxToggle.checked        = getSfxEnabled();
sfxVolumeSlider.value    = Math.round(getVolume() * 100);
sfxVolumeLabel.textContent = sfxVolumeSlider.value + '%';

document.getElementById('btn-kds-settings').addEventListener('click', () => {
  settingsModal.style.display = 'flex';
});
document.getElementById('btn-settings-close').addEventListener('click', () => {
  settingsModal.style.display = 'none';
});
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) settingsModal.style.display = 'none';
});

sfxToggle.addEventListener('change', () => {
  setSfxEnabled(sfxToggle.checked);
  sfxVolumeSlider.disabled = !sfxToggle.checked;
});

sfxVolumeSlider.addEventListener('input', () => {
  sfxVolumeLabel.textContent = sfxVolumeSlider.value + '%';
  setVolume(sfxVolumeSlider.value / 100);
});
