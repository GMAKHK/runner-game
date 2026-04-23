import scenarios from './scenarios.js';
import { sfxCorrect, sfxWrong } from './sound.js';

const QUIZ_COUNT = 5;
let activeScenarios = [];
let currentIndex = 0;
let totalScore = 0;
let scoreLog = [];
let answered = false;

function pickScenarios() {
  const shuffled = [...scenarios].sort(() => Math.random() - 0.5);
  activeScenarios = shuffled.slice(0, QUIZ_COUNT);
}

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
  pickScenarios();
  showScreen('game');
  loadScenario();
}

function loadScenario() {
  answered = false;
  const s = activeScenarios[currentIndex];

  // Progress
  const pct = (currentIndex / activeScenarios.length) * 100;
  document.querySelector('.progress-bar').style.width = pct + '%';
  document.querySelector('.scenario-num').textContent =
    `${currentIndex + 1} / ${activeScenarios.length}`;
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

  // Reset feedback / next button
  document.getElementById('feedback-box').style.display = 'none';
  document.getElementById('btn-next').style.display = 'none';
}

function selectChoice(choiceIndex) {
  if (answered) return;
  answered = true;

  const s = activeScenarios[currentIndex];
  const chosen = s.choices[choiceIndex];
  const maxScore = Math.max(...s.choices.map(c => c.score));
  const earned = chosen.score;

  totalScore += earned;
  scoreLog.push({ title: s.title, score: earned });

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
  feedback.innerHTML = `<div class="points">+${chosen.score}pt</div>${chosen.feedback}`;
  feedback.style.display = 'block';

  document.querySelector('.score-display').textContent = `スコア: ${totalScore}`;
  document.getElementById('btn-next').style.display = 'block';
}

function nextScenario() {
  currentIndex++;
  if (currentIndex >= activeScenarios.length) {
    showResult();
  } else {
    loadScenario();
  }
}

function showResult() {
  showScreen('result');

  const maxPossible = activeScenarios.reduce((sum, s) => {
    return sum + Math.max(...s.choices.map(c => c.score));
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
    div.innerHTML = `<span>${item.title}</span><span class="pts">+${item.score}pt</span>`;
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
