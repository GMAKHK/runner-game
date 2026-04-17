import scenarios from './scenarios.js';
import { sfxCorrect, sfxWrong } from './sound.js';

let currentIndex = 0;
let totalScore = 0;
let scoreLog = [];
let timerInterval = null;
let timeLeft = 0;
let answered = false;

const screens = {
  start: document.getElementById('start-screen'),
  game: document.getElementById('game-screen'),
  result: document.getElementById('result-screen'),
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.style.display = 'none');
  screens[name].style.display = 'block';
}

function startGame() {
  currentIndex = 0;
  totalScore = 0;
  scoreLog = [];
  showScreen('game');
  loadScenario();
}

function loadScenario() {
  answered = false;
  const s = scenarios[currentIndex];

  // Progress
  const pct = (currentIndex / scenarios.length) * 100;
  document.querySelector('.progress-bar').style.width = pct + '%';
  document.querySelector('.scenario-num').textContent =
    `${currentIndex + 1} / ${scenarios.length}`;
  document.querySelector('.score-display').textContent = `スコア: ${totalScore}`;

  // Scenario content
  document.getElementById('scenario-title').textContent = s.title;
  document.getElementById('scenario-desc').textContent = s.description;

  // Choices
  const choicesEl = document.getElementById('choices');
  choicesEl.innerHTML = '';
  s.choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = c.text;
    btn.dataset.index = i;
    btn.addEventListener('click', () => selectChoice(i));
    choicesEl.appendChild(btn);
  });

  // Reset feedback / next button / timeout
  document.getElementById('feedback-box').style.display = 'none';
  document.getElementById('btn-next').style.display = 'none';
  document.getElementById('timeout-msg').style.display = 'none';

  // Timer
  timeLeft = s.timeLimit;
  updateTimerUI();
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 100);
}

function tickTimer() {
  timeLeft -= 0.1;
  updateTimerUI();
  if (timeLeft <= 0) {
    clearInterval(timerInterval);
    timeLeft = 0;
    updateTimerUI();
    onTimeout();
  }
}

function updateTimerUI() {
  const s = scenarios[currentIndex];
  const pct = Math.max(0, (timeLeft / s.timeLimit) * 100);
  const bar = document.getElementById('timer-bar');
  const num = document.getElementById('timer-num');
  bar.style.width = pct + '%';
  num.textContent = Math.ceil(timeLeft);

  bar.classList.remove('warning', 'danger');
  if (pct <= 30) bar.classList.add('danger');
  else if (pct <= 60) bar.classList.add('warning');
}

function onTimeout() {
  if (answered) return;
  answered = true;
  sfxWrong();

  // Disable all buttons
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.disabled = true;
    btn.classList.add('wrong');
  });

  document.getElementById('timeout-msg').style.display = 'block';

  const feedback = document.getElementById('feedback-box');
  feedback.innerHTML = '<div class="points">+0pt（時間切れ）</div>時間内に判断できませんでした。現場では素早い判断が求められます。';
  feedback.style.display = 'block';

  scoreLog.push({ title: scenarios[currentIndex].title, score: 0, timeout: true });

  document.getElementById('btn-next').style.display = 'block';
}

function selectChoice(choiceIndex) {
  if (answered) return;
  answered = true;
  clearInterval(timerInterval);

  const s = scenarios[currentIndex];
  const chosen = s.choices[choiceIndex];
  const maxScore = Math.max(...s.choices.map(c => c.score));

  // Speed bonus: up to +20 pts if answered quickly
  const timeRatio = timeLeft / s.timeLimit;
  const speedBonus = chosen.score === maxScore ? Math.round(timeRatio * 20) : 0;
  const earned = chosen.score + speedBonus;

  totalScore += earned;
  scoreLog.push({ title: s.title, score: earned, timeout: false });

  // Style buttons
  document.querySelectorAll('.choice-btn').forEach((btn, i) => {
    btn.disabled = true;
    const c = s.choices[i];
    if (i === choiceIndex) {
      btn.classList.add('selected');
      if (c.score === maxScore) { btn.classList.add('correct'); sfxCorrect(); }
      else if (c.score >= maxScore * 0.5) { btn.classList.add('partial'); sfxWrong(); }
      else { btn.classList.add('wrong'); sfxWrong(); }
    } else {
      btn.classList.add('wrong');
    }
  });

  // Feedback
  const feedback = document.getElementById('feedback-box');
  const speedText = speedBonus > 0 ? `<span style="color:#4caf50"> + スピードボーナス +${speedBonus}pt</span>` : '';
  feedback.innerHTML = `<div class="points">+${chosen.score}pt${speedText}</div>${chosen.feedback}`;
  feedback.style.display = 'block';

  document.querySelector('.score-display').textContent = `スコア: ${totalScore}`;
  document.getElementById('btn-next').style.display = 'block';
}

function nextScenario() {
  currentIndex++;
  if (currentIndex >= scenarios.length) {
    showResult();
  } else {
    loadScenario();
  }
}

function showResult() {
  showScreen('result');

  const maxPossible = scenarios.reduce((sum, s) => {
    return sum + Math.max(...s.choices.map(c => c.score)) + 20;
  }, 0);

  const pct = totalScore / maxPossible;
  let rank, rankClass;
  if (pct >= 0.9) { rank = 'S ランク'; rankClass = 'S'; }
  else if (pct >= 0.75) { rank = 'A ランク'; rankClass = 'A'; }
  else if (pct >= 0.55) { rank = 'B ランク'; rankClass = 'B'; }
  else { rank = 'C ランク'; rankClass = 'C'; }

  document.getElementById('final-score').textContent = `${totalScore} pt`;
  const rankEl = document.getElementById('rank');
  rankEl.textContent = rank;
  rankEl.className = `rank ${rankClass}`;

  const breakdown = document.getElementById('breakdown-list');
  breakdown.innerHTML = '';
  scoreLog.forEach(item => {
    const div = document.createElement('div');
    div.className = 'breakdown-item';
    div.innerHTML = `<span>${item.title}</span><span class="pts">${item.timeout ? '時間切れ' : '+' + item.score + 'pt'}</span>`;
    breakdown.appendChild(div);
  });
}

// Event listeners
document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-next').addEventListener('click', nextScenario);
document.getElementById('btn-retry').addEventListener('click', startGame);
document.getElementById('btn-quiz-home').addEventListener('click', () => {
  showScreen('start');
});
