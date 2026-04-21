// ── tutorial.js — チュートリアルフロー管理 ──────────────────────────────────
// kds.js の window.kdsApi を通じて通信する。

const BURGER = { name: 'バーガー', price: 390, prepTime: 50, category: 0, isSandwich: true };
const CHICKEN = { name: 'チキンサンド', price: 370, prepTime: 50, category: 0, isSandwich: true };

// ── State ─────────────────────────────────────────────────────────────────────
let step        = -1;
let pollTimer   = null;
let freePlayTimer = null;

// ── Step definitions ─────────────────────────────────────────────────────────
// getTarget: () => Element | null  — スポットライト対象 (null = センター吹き出し)
// title: 吹き出しタイトル
// text:  吹き出し本文 (HTML可)
// actions: [{id, label, primary}]  — ボタン ([] = ボタンなし)
// onAction(id): ボタン押下処理
// poll: () => boolean  — auto-advance 条件 (null = なし)
// pollNext: 次ステップ番号

const STEPS = [

  // ── 0: Welcome ──────────────────────────────────────────────────────────────
  {
    getTarget: null,
    title: 'チュートリアルへようこそ！',
    text:  'ランナーシミュレーターの基本操作を学びます。<br>バーガー1件のオーダーを受けて提供するところから始めましょう。',
    actions: [{ id: 'next', label: 'はじめる →', primary: true }],
    onAction(id) {
      if (id === 'next') {
        window.kdsApi.spawnOrder([BURGER]);
        goStep(1);
      }
    },
    poll: null,
  },

  // ── 1: Order arrived — wait until chaser button appears (~3s) ───────────────
  {
    getTarget: () => document.querySelector('#kds-grid .order-card'),
    title: 'オーダーが入りました',
    text:  'バーガーのオーダーです。バンズ焼成 → サンド製造が自動で始まります。<br>製造が進むと<strong>チェイサー</strong>オプションが現れます。',
    actions: [],
    onAction: null,
    poll:     () => !!document.querySelector('#kds-grid .btn-chaser[style*="inline-block"]'),
    pollNext: 2,
  },

  // ── 2: Chaser button ────────────────────────────────────────────────────────
  {
    getTarget: () => document.querySelector('#kds-grid .btn-chaser[style*="inline-block"]'),
    title:  'チェイサー',
    text:   '製造中のサンドをチェイサー（追いかけ担当）に引き継がせると、<strong>ⓣⓣⓢ（受注→完成）を短縮</strong>できます。<br>ただし発動中は WAIT / PRESENT / MGR / フライヤーが<strong>すべて無効</strong>になるため、RtoP が伸びるリスクもあります。<br>タイミングを見極めて使いましょう。',
    actions: [{ id: 'next', label: '了解！', primary: true }],
    onAction(id) { if (id === 'next') goStep(3); },
    poll: null,
  },

  // ── 3: Wait for PRESENT to light up ────────────────────────────────────────
  {
    getTarget: () => document.querySelector('#kds-grid .order-card'),
    title:  '商品が完成するまで待ちましょう',
    text:   'サンドの製造が完了すると <strong>PRESENT</strong> ボタンが緑に光ります。<br>光ったら押してお客様に提供しましょう！',
    actions: [],
    onAction: null,
    poll: () =>
      !!document.querySelector('#kds-grid .btn-present.active') ||
      document.querySelectorAll('#kds-grid .order-card').length === 0,
    pollNext: () =>
      document.querySelectorAll('#kds-grid .order-card').length === 0 ? 5 : 4,
  },

  // ── 4: PRESENT ready ────────────────────────────────────────────────────────
  {
    getTarget: () => document.querySelector('#kds-grid .btn-present.active'),
    title:  '商品が完成しました！',
    text:   '<strong>PRESENT</strong> ボタンを押してお客様に提供しましょう。',
    actions: [],
    onAction: null,
    poll:     () => document.querySelectorAll('#kds-grid .order-card').length === 0,
    pollNext: 5,
  },

  // ── 5: Fryer — spotlight on an empty fryer's start button ──────────────────
  {
    getTarget: () => document.querySelector('#fryer-row .btn-fry-start'),
    title:  'フライヤー（揚げ機）',
    text:   'ポテトを揚げる設備です。<strong>調理開始</strong>を押すとバット1本を揚げ始めます。<br>揚げ時間 約3分 → 塩かけ 約30秒 で完成し、ストックに追加されます。<br>サイズ（S/M/L）は調理完了時に需要ベースで自動決定されます。',
    actions: [{ id: 'next', label: '了解！', primary: true }],
    onAction(id) { if (id === 'next') goStep(6); },
    poll: null,
  },

  // ── 6: Potato convert button ────────────────────────────────────────────────
  {
    getTarget: () => document.querySelector('#potato-stock-display .btn-potato-conv'),
    title:  '再製造（サイズ変換）',
    text:   'ストックのポテトを別サイズに変換できます。<br>例：M×3 → S×5 のようにグラム換算で変換。<br>ただし期限は変換前の<strong>最も古いバッチ</strong>を引き継ぐため、廃棄リスクは下がりません。<br>-20pt のペナルティがあるため、必要最小限に。',
    actions: [{ id: 'next', label: '了解！', primary: true }],
    onAction(id) {
      if (id === 'next') goStep(7);
    },
    poll: null,
  },

  // ── 7: Free play (60s countdown) ────────────────────────────────────────────
  {
    getTarget: null,
    corner: true,
    freePlay: true,
    title:  '自由に操作してみよう！',
    text:   'ここまでの操作を自由に試してみましょう。<br>フライヤーを回したり、バーガーをプレゼントしたり。<br>残り <strong id="tut-countdown">60</strong>秒で自動的に次へ進みます。',
    actions: [],
    onAction: null,
    poll: null,
    onFreePlayStart() {
      window.kdsApi.spawnOrder([BURGER]);
      window.kdsApi.spawnOrder([BURGER]);
    },
    onFreePlayEnd() {
      for (let i = 0; i < 6; i++) window.kdsApi.spawnOrder([BURGER]);
      goStep(8);
    },
  },

  // ── 8: Danger Call — button is now lit (6 sandwiches just queued) ──────────
  {
    getTarget: () => document.getElementById('btn-danger'),
    title:  '🚨 デンジャーコール！',
    text:   'サンドが一気に6個以上溜まり、🚨ボタンが発動可能になりました。<br>発動すると全オーダーのサンドを<strong>最大6個同時製造</strong>に切り替え、ライン崩壊を防ぎます。<br>製造中サンドが<strong>2個以下</strong>まで減ると自動解除されます。<br>実戦でこのボタンが光ったら迷わず押しましょう！',
    actions: [{ id: 'next', label: '了解！', primary: true }],
    onAction(id) { if (id === 'next') goStep(9); },
    poll: null,
  },

  // ── 9: Free play after danger (60s countdown) ────────────────────────────────
  {
    getTarget: null,
    corner: true,
    freePlay: true,
    title:  'デンジャー解除まで捌こう！',
    text:   'デンジャーコールでラインが回復してきました。<br>引き続き自由に操作してみましょう。<br>残り <strong id="tut-countdown">60</strong>秒で次のシナリオへ進みます。',
    actions: [],
    onAction: null,
    poll: null,
    onFreePlayStart: null,
    onFreePlayEnd() { goStep(10); },
  },

  // ── 10: WAIT / MGR intro ────────────────────────────────────────────────────
  {
    getTarget: null,
    title:  'ナイス！次は WAIT と MGR',
    text:   'うまく提供できました！<br>次はオーダーの<strong>保留（WAIT）</strong>とマネージャー呼び出し<strong>（MGR）</strong>を練習しましょう。',
    actions: [{ id: 'next', label: '次へ →', primary: true }],
    onAction(id) {
      if (id === 'next') {
        window.kdsApi.spawnOrder([CHICKEN]);
        window.kdsApi.spawnOrder([CHICKEN]);
        window.kdsApi.spawnOrder([CHICKEN]);
        goStep(11);
      }
    },
    poll: null,
  },

  // ── 11: WAIT button (3枚目のカードを対象) ────────────────────────────────────
  {
    getTarget: () => {
      const cards = document.querySelectorAll('#kds-grid .order-card');
      const card  = cards[2] || cards[cards.length - 1];
      return card ? card.querySelector('.btn-wait') : null;
    },
    title:  '3枚目のオーダーをWAITしましょう',
    text:   '<strong>WAIT</strong> を押すとオーダーを一旦保留し、RtoPをその時点で確定できます。<br>製造はそのまま続くので、急いでいないお客様への対応に有効です。',
    actions: [],
    onAction: null,
    poll: () => {
      const cards = document.querySelectorAll('#kds-grid .order-card');
      const card  = cards[2] || cards[cards.length - 1];
      if (!card) return false;
      const badge = card.querySelector('.wait-badge');
      return !!(badge && badge.style.display !== 'none');
    },
    pollNext: 12,
  },

  // ── 12: Wait for MGR button to appear (WAIT中のカードを追跡) ─────────────────
  {
    getTarget: () => {
      const cards = Array.from(document.querySelectorAll('#kds-grid .order-card'));
      return cards.find(c => {
        const b = c.querySelector('.wait-badge');
        return b && b.style.display !== 'none';
      }) || null;
    },
    title:  'WAIT中のオーダー',
    text:   'RtoPが確定しました。製造が完成すると <strong>MGRを呼ぶ</strong> ボタンが現れます。',
    actions: [],
    onAction: null,
    poll: () => {
      const cards = Array.from(document.querySelectorAll('#kds-grid .order-card'));
      const waited = cards.find(c => {
        const b = c.querySelector('.wait-badge');
        return b && b.style.display !== 'none';
      });
      if (!waited) return false;
      const btn = waited.querySelector('.btn-call-mgr');
      return !!(btn && btn.style.display === 'inline-block');
    },
    pollNext: 13,
  },

  // ── 13: MGR button (WAIT中のカードを追跡) ───────────────────────────────────
  {
    getTarget: () => {
      const cards = Array.from(document.querySelectorAll('#kds-grid .order-card'));
      const waited = cards.find(c => {
        const b = c.querySelector('.wait-badge');
        return b && b.style.display !== 'none';
      });
      return waited ? waited.querySelector('.btn-call-mgr[style*="inline-block"]') : null;
    },
    title:  'MGRを呼びましょう',
    text:   '<strong>MGRを呼ぶ</strong> を押すとマネージャーが代わりに提供します。<br>PRESENTの7秒クーリング中でも使えるのが便利です！<br>MGR後は15秒のクーリングが入ります。',
    actions: [{ id: 'next', label: '了解！', primary: true }],
    onAction(id) { if (id === 'next') goStep(14); },
    poll: null,
  },

  // ── 14: Free play after MGR (60s countdown) ──────────────────────────────────
  {
    getTarget: null,
    corner: true,
    freePlay: true,
    title:  'お疲れ様！自由に操作してみよう',
    text:   'ここまでの操作をすべて使って自由に試してみましょう。<br>残り <strong id="tut-countdown">60</strong>秒で結果へ進みます。',
    actions: [],
    onAction: null,
    poll: null,
    onFreePlayStart: null,
    onFreePlayEnd() { goStep(15); },
  },

  // ── 15: Complete ─────────────────────────────────────────────────────────────
  {
    getTarget: null,
    title:  'チュートリアル完了！',
    text:   '基本操作をマスターしました。<br>実戦ではこれらを組み合わせながらスコアを伸ばしましょう！',
    actions: [
      { id: 'home',   label: 'ホームへ',       primary: false },
      { id: 'normal', label: 'ノーマルで開始', primary: true  },
      { id: 'expert', label: 'EXPERTで開始',   primary: false },
    ],
    onAction(id) {
      hideTutorial();
      if (id === 'home')   window.kdsApi.goHome();
      if (id === 'normal') window.kdsApi.startKDS(false);
      if (id === 'expert') window.kdsApi.startKDS(true);
    },
    poll: null,
  },
];

// ── Timing ───────────────────────────────────────────────────────────────────
// 吹き出しフェードアウト後にスポットライトを新ターゲットへ移動するまでの待機 (ms)
const SPOTLIGHT_MOVE_DELAY = 300;
// スポットライト移動後、吹き出しが出るまでの間 (ms)
const BUBBLE_SHOW_DELAY    = 300;
// ポーリング開始前の最低表示時間 (ms) — 吹き出し表示後さらに読む猶予
const POLL_START_DELAY     = 3000;
// 条件達成後、次ステップへ進むまでの待機時間 (ms)
const ADVANCE_DELAY        = 1200;

// ── Core ─────────────────────────────────────────────────────────────────────


function goStep(n) {
  step = n;
  clearInterval(pollTimer);
  pollTimer = null;
  clearInterval(freePlayTimer);
  freePlayTimer = null;

  const def = STEPS[n];
  if (!def) return;

  const overlay   = document.getElementById('tut-overlay');
  const spotlight = document.getElementById('tut-spotlight');
  const bubble    = document.getElementById('tut-bubble');

  overlay.style.display = '';

  // ① 吹き出しをフェードアウト、スポットライトの暗転も一旦リセット
  bubble.style.opacity = '0';
  bubble.style.display = '';
  document.getElementById('tut-restore').style.display = 'none';
  spotlight.classList.remove('lit');

  // ② SPOTLIGHT_MOVE_DELAY 後にスポットライトを新ターゲットへ移動
  //    直後に .lit を付けると box-shadow が 1.8s かけてゆっくり暗くなる
  setTimeout(() => {
    if (step !== n) return;
    if (def.getTarget) {
      const el = def.getTarget();
      if (el) {
        positionSpotlight(spotlight, el);
        // double-rAF で確実に 0→暗転 のトランジションを発火させる
        requestAnimationFrame(() =>
          requestAnimationFrame(() => spotlight.classList.add('lit'))
        );
      }
      // ターゲットなし: lit を付けないまま (透明のまま)
    }
  }, SPOTLIGHT_MOVE_DELAY);

  // ③ BUBBLE_SHOW_DELAY 後に吹き出しをフェードイン
  const isFirst = (n === 0);
  setTimeout(() => {
    if (step !== n) return;
    renderBubble(def);

    // 自由プレイ: オーダー自動スポーン開始 + 60秒カウントダウン
    if (def.freePlay) {
      if (def.onFreePlayStart) def.onFreePlayStart();
      window.kdsApi.setFreePlay(true);
      let remaining = 60;
      freePlayTimer = setInterval(() => {
        if (step !== n) { clearInterval(freePlayTimer); freePlayTimer = null; return; }
        remaining--;
        const el = document.getElementById('tut-countdown');
        if (el) el.textContent = remaining;
        if (remaining <= 0) {
          clearInterval(freePlayTimer);
          freePlayTimer = null;
          window.kdsApi.setFreePlay(false);
          if (def.onFreePlayEnd) def.onFreePlayEnd();
        }
      }, 1000);
    }

    // ④ ポーリングは吹き出し表示後さらに POLL_START_DELAY 待ってから開始
    if (def.poll) {
      setTimeout(() => {
        if (step !== n) return;
        pollTimer = setInterval(() => {
          // スポットライトをターゲットに追従（暗転は維持したまま位置だけ更新）
          if (def.getTarget) {
            const el = def.getTarget();
            if (el) positionSpotlight(spotlight, el);
          }
          if (def.poll()) {
            clearInterval(pollTimer);
            pollTimer = null;
            const nextStep = typeof def.pollNext === 'function' ? def.pollNext() : def.pollNext;
            setTimeout(() => {
              if (step === n) goStep(nextStep);
            }, ADVANCE_DELAY);
          }
        }, 150);
      }, POLL_START_DELAY);
    }
  }, isFirst ? 0 : BUBBLE_SHOW_DELAY);
}

function positionSpotlight(spotlight, el) {
  const r   = el.getBoundingClientRect();
  const pad = 6;
  spotlight.style.display = '';
  spotlight.style.top    = (r.top    - pad) + 'px';
  spotlight.style.left   = (r.left   - pad) + 'px';
  spotlight.style.width  = (r.width  + pad * 2) + 'px';
  spotlight.style.height = (r.height + pad * 2) + 'px';
}

function renderBubble(def) {
  const bubble  = document.getElementById('tut-bubble');
  const titleEl = document.getElementById('tut-bubble-title');
  const textEl  = document.getElementById('tut-bubble-text');
  const actEl   = document.getElementById('tut-bubble-actions');

  titleEl.innerHTML = `${def.title}<button class="tut-hide-btn" id="tut-hide-btn">−</button>`;
  textEl.innerHTML  = def.text;
  actEl.innerHTML   = (def.actions || []).map(a =>
    `<button class="tut-btn ${a.primary ? 'tut-btn-primary' : 'tut-btn-secondary'}" data-tut-id="${a.id}">${a.label}</button>`
  ).join('');

  bubble.style.display = '';
  bubble.style.opacity = ''; // goStep で 0 にした分をリセット
  // フェードインアニメーションをリセットして再生
  bubble.classList.remove('tut-fadein');
  void bubble.offsetWidth; // reflow
  bubble.classList.add('tut-fadein');

  if (def.corner) {
    bubble.style.top       = 'auto';
    bubble.style.left      = 'auto';
    bubble.style.bottom    = '24px';
    bubble.style.right     = '24px';
    bubble.style.transform = 'none';
    bubble.className       = '';
    return;
  }
  if (def.getTarget) {
    const el = def.getTarget();
    if (el) { positionBubbleNear(bubble, el.getBoundingClientRect()); return; }
  }
  // Centered
  bubble.style.top       = '50%';
  bubble.style.left      = '50%';
  bubble.style.bottom    = 'auto';
  bubble.style.right     = 'auto';
  bubble.style.transform = 'translate(-50%, -50%)';
  bubble.className       = '';
}

function positionBubbleNear(bubble, r) {
  const bW  = 316;
  const bH  = bubble.offsetHeight || 200;
  const mar = 14;
  const arr = 14;
  const vW  = window.innerWidth;
  const vH  = window.innerHeight;

  bubble.style.bottom    = 'auto';
  bubble.style.right     = 'auto';
  bubble.style.transform = '';

  // Prefer below
  if (r.bottom + bH + arr + mar < vH) {
    bubble.style.top  = (r.bottom + arr + mar) + 'px';
    bubble.style.left = clamp(r.left, mar, vW - bW - mar) + 'px';
    bubble.className  = 'arr-up';
    return;
  }
  // Above
  if (r.top - bH - arr - mar > 0) {
    bubble.style.top  = (r.top - bH - arr - mar) + 'px';
    bubble.style.left = clamp(r.left, mar, vW - bW - mar) + 'px';
    bubble.className  = 'arr-down';
    return;
  }
  // Center fallback
  bubble.style.top       = '50%';
  bubble.style.left      = '50%';
  bubble.style.transform = 'translate(-50%, -50%)';
  bubble.className       = '';
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hideTutorial() {
  clearInterval(pollTimer);
  clearInterval(freePlayTimer);
  pollTimer   = null;
  freePlayTimer = null;
  step        = -1;
  document.getElementById('tut-overlay').style.display = 'none';
}

// ── Button clicks ─────────────────────────────────────────────────────────────

document.getElementById('tut-bubble-actions').addEventListener('click', e => {
  const btn = e.target.closest('[data-tut-id]');
  if (!btn) return;
  const def = STEPS[step];
  if (def && def.onAction) def.onAction(btn.dataset.tutId);
});

// 吹き出し最小化 / 復元
document.getElementById('tut-bubble').addEventListener('click', e => {
  if (!e.target.closest('#tut-hide-btn')) return;
  const bubble  = document.getElementById('tut-bubble');
  const restore = document.getElementById('tut-restore');
  bubble.style.display  = 'none';
  restore.style.display = 'flex';
});
document.getElementById('tut-restore').addEventListener('click', () => {
  const bubble  = document.getElementById('tut-bubble');
  const restore = document.getElementById('tut-restore');
  bubble.style.display  = '';
  restore.style.display = 'none';
});

// ── Entry point ───────────────────────────────────────────────────────────────

if (window.kdsApi) {
  window.kdsApi.onTutorialStart = () => goStep(0);
}
