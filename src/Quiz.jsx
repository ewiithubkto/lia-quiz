import { useEffect, useMemo, useRef, useState } from "react";
import kidsWords from "./data/kidsWords.json";

// ——— берём твою идею нормализации, но короче ———
function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  let maxId = raw.reduce((m, e) => (e && Number.isFinite(+e.id) ? Math.max(m, +e.id) : m), 0);
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    let id = +e.id;
    if (!Number.isFinite(id) || seen.has(id)) id = ++maxId;
    seen.add(id);
    out.push({
      id,
      word: typeof e.word === "string" ? e.word.trim() : "",
      translation: typeof e.translation === "string" ? e.translation.trim() : "",
      translationRu: typeof e.translationRu === "string" ? e.translationRu.trim() : "",
      transcription: typeof e.transcription === "string" ? e.transcription : "",
      learned: Boolean(e.learned),
      page: e.page,
    });
  }
  // сортируем сразу (page → id)
  return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.id ?? 0) - (b.id ?? 0));
}

// ——— утилиты квиза ———
function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function sample(arr, n) {
  const a = shuffle(arr);
  return a.slice(0, Math.min(n, a.length));
}

function isValidEnDe(e) {
  return typeof e.word === 'string' && e.word.trim() && typeof e.translation === 'string' && e.translation.trim();
}
function isValidDeEn(e) {
  return typeof e.translation === 'string' && e.translation.trim() && typeof e.word === 'string' && e.word.trim();
}
function unique(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}
function buildOptions(correct, poolVals, max = 4) {
  const distract = sample(poolVals.filter(v => v !== correct), 8);
  const opts = unique([correct, ...distract]).slice(0, max);
  return opts.length >= 2 ? shuffle(opts) : [];
}

function buildQuestions(entries, page, mode) {
  const scope = page === "all" ? entries : entries.filter((e) => e.page === Number(page));

  // валидные пары ТОЛЬКО из выбранной области (страницы или всех слов)
  const poolQuestions = (mode === 'en->de') ? scope.filter(isValidEnDe) : scope.filter(isValidDeEn);

  // пул для отвлекающих вариантов: если на странице мало, расширяем до всего словаря
  const poolOptions = poolQuestions.length >= 4
    ? poolQuestions
    : ((mode === 'en->de') ? entries.filter(isValidEnDe) : entries.filter(isValidDeEn));

  const questions = [];
  const sourceVals = (mode === 'en->de')
    ? poolOptions.map(e => e.translation.trim())
    : poolOptions.map(e => e.word.trim());
  for (const q of poolQuestions) {
    if (mode === 'en->de') {
      const correct = q.translation.trim();
      const options = buildOptions(correct, sourceVals, 4);
      if (options.length) questions.push({ id: q.id, prompt: q.word, correct, options, show: 'de' });
    } else {
      const correct = q.word.trim();
      const options = buildOptions(correct, sourceVals, 4);
      if (options.length) questions.push({ id: q.id, prompt: q.translation || '', correct, options, show: 'en' });
    }
  }
  return shuffle(questions); // смешаем порядок вопросов
}

function pickVoice(langPref) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
  const pref = (langPref || 'en').toLowerCase();
  const exact = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(pref));
  if (exact) return exact;
  const broad = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(pref.slice(0,2)));
  return broad || voices[0] || null;
}
function speakText(text, langPref = 'en') {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice(langPref);
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = langPref; }
  u.rate = 0.95;
  try { window.speechSynthesis.cancel(); } catch (E) { const _IGNORED_ERROR = E; }
  window.speechSynthesis.speak(u);
}

function getResultBoxStyle(pct) {
  const base = {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    border: "1px solid #ddd",
    color: "#1b2a14",
  };
  if (pct === 100) {
    return {
      ...base,
      background: "linear-gradient(135deg, #e6ffcc 0%, #bff2a1 100%)",
      color: "#1a2b12",
      border: "1px solid #78c27a",
    };
  }
  if (pct >= 70) {
    return { ...base, background: "#f1fae9", border: "1px solid #cbe9b9" };
  }
  if (pct >= 50) {
    return { ...base, background: "#f5f7fb", border: "1px solid #dce4ee" };
  }
  return { ...base, background: "#fff0eb", border: "1px solid #ffd0c2" };
}

export default function Quiz() {
  // 1) данные
  const entries = useMemo(() => normalizeEntries(kidsWords), []);
  const pages = useMemo(
    () => Array.from(new Set(entries.map((e) => e.page).filter((p) => p != null))).sort((a, b) => a - b),
    [entries]
  );

  // 2) настройки теста
  const [page, setPage] = useState("all");
  const [mode, setMode] = useState("en->de"); // en->de | de->en

  // 3) прогресс
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const lockRef = useRef(false);
  const [chosen, setChosen] = useState(null); // выбранный вариант
  const [wasCorrect, setWasCorrect] = useState(null); // true/false/null
  const current = questions[idx];

  // Подгрузка голосов для стабильной озвучки EN (без DE)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    // Тригернём загрузку голосов и подпишемся на событие для будущих вызовов
    try { window.speechSynthesis.getVoices(); } catch (E) { const _IGNORED_ERROR = E; }
    const handler = () => {
      // Ничего не делаем напрямую — просто держим событие подписанным,
      // чтобы голоса были готовы к моменту вызова speakText.
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
  }, []);

  function startQuiz() {
    setError("");
    const qs = buildQuestions(entries, page, mode);
    if (qs.length < 1) {
      setQuestions([]);
      setIdx(0);
      setScore(0);
      setError("Zu wenige passende Wörter für diese Seite und diesen Modus.");
      return;
    }
    setQuestions(qs);
    setIdx(0);
    setScore(0);
    setChosen(null);
    setWasCorrect(null);
    setLocked(false);
    lockRef.current = false;
    setStarted(true);
  }
  function answer(opt) {
    if (!current || locked || lockRef.current) return;
    const correct = opt === current.correct;
    setChosen(opt);
    setWasCorrect(correct);
    setLocked(true);
    lockRef.current = true;
    if (correct) setScore((s) => s + 1);

    setTimeout(() => {
      if (idx + 1 < questions.length) {
        setIdx((i) => i + 1);
      } else {
        setStarted(false); // конец
      }
      setChosen(null);
      setWasCorrect(null);
      setLocked(false);
      lockRef.current = false;
    }, 650);
  }

  return (
    <div className="quiz-container">
      {/* Hinweis entfernt: Auswahl очевидна из UI */}

      {/* Настройки перед стартом */}
      {!started && (
        <>
          <div className="settings-grid">
            <div>
              <select aria-label="Seite" value={page} onChange={(e) => setPage(e.target.value)} className="input-styled page-select">
                <option value="all">Alle Seiten</option>
                {pages.map((p) => (
                  <option key={p} value={p}>{`Seite ${p}`}</option>
                ))}
              </select>
            </div>
            <div>
              <button
                type="button"
                className="input-styled mode-toggle"
                aria-label="Modus umschalten"
                onClick={() => setMode((m) => (m === 'en->de' ? 'de->en' : 'en->de'))}
              >
                {mode === 'en->de' ? 'EN → DE' : 'DE → EN'}
              </button>
            </div>
            <div className="start-cell">
              <button onClick={startQuiz} className="input-styled">Starten</button>
            </div>
          </div>
          {error && (
            <div style={{ marginTop: 8, color: '#b00020' }}>{error}</div>
          )}
        </>
      )}

      {/* Экран вопроса */}
      {started && current && (
        <>
          <div className="quiz-topbar" style={{ display: "flex", justifyContent: "space-between", margin: "12px 0" }}>
            <div className="stat-pill">Frage {idx + 1} / {questions.length}</div>
            <div className="stat-pill">Punkte: {score}</div>
          </div>
          {/* removed mode chip; page will be shown at the bottom */}
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "#f6f6f8",
              fontSize: 22,
              fontWeight: 700,
              textAlign: "center",
              marginBottom: 12,
              position: 'relative',
              paddingRight: mode === 'en->de' ? 52 : 16, // reserve space for speaker
            }}
          >
            <span
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (mode === 'en->de') speakText(current.prompt, 'en'); }}
              className="tappable"
              style={{ cursor: mode === 'en->de' ? 'pointer' : 'default' }}
              title={mode === 'en->de' ? 'Zum Anhören tippen' : undefined}
            >
              {current.prompt}
            </span>
            {mode === 'en->de' && (
              <button
                type="button"
                onClick={() => speakText(current.prompt, 'en')}
                className="input-styled"
                title="Anhören"
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  padding: '6px 10px',
                  zIndex: 1,
                }}
              >
                🔊
              </button>
            )}
          </div>
          <div className="answer-grid" aria-busy={locked ? 'true' : 'false'}>
            {current.options.map((opt) => {
              const isSelected = chosen === opt;
              const stateClass = isSelected ? (wasCorrect ? 'is-correct' : 'is-wrong') : '';
              return (
                <button
                  key={opt}
                  onClick={() => answer(opt)}
                  className={`input-styled answer-btn ${isSelected ? 'is-selected' : ''} ${stateClass}`}
                  disabled={locked}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="meta-chip">{page === 'all' ? 'Alle Seiten' : `Seite ${page}`}</div>
            <button
              onClick={() => {
                setStarted(false);
                setQuestions([]);
                setScore(0);
                setIdx(0);
              }}
              className="input-styled"
            >
              Abbrechen
            </button>
          </div>
        </>
      )}

      {/* Итог */}
      {!started && questions.length > 0 && (
        (() => {
          const pct = Math.round((score / questions.length) * 100) || 0;
          return (
            <div style={getResultBoxStyle(pct)}>
              <div style={{ fontWeight: 700 }}>
                Ergebnis: {score} / {questions.length} ({pct}%)
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button onClick={startQuiz} className="input-styled">Noch einmal</button>
                <button onClick={() => { setQuestions([]); setScore(0); setIdx(0); setChosen(null); setWasCorrect(null); setLocked(false); lockRef.current = false; }} className="input-styled">Zurücksetzen</button>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
