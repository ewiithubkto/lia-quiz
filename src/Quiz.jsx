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
function isValidEnDe(e) {
  return typeof e.word === 'string' && e.word.trim() && typeof e.translation === 'string' && e.translation.trim();
}
function isValidDeEn(e) {
  return typeof e.translation === 'string' && e.translation.trim() && typeof e.word === 'string' && e.word.trim();
}

function inferEntryCategory(entry) {
  const word = typeof entry.word === 'string' ? entry.word.trim() : '';
  const translation = typeof entry.translation === 'string' ? entry.translation.trim() : '';
  const translationLower = translation.toLowerCase();
  const translationRu = typeof entry.translationRu === 'string' ? entry.translationRu.trim() : '';

  const nounIndicators = [
    /^(der|die|das|den|dem|des|ein|eine|einen|einem|eines)\b/,
    /\b(der|die|das)\s+[a-zäöüß]/,
    /(\(pl\))/,
  ];
  const isNoun = nounIndicators.some((pattern) => pattern.test(translationLower))
    || /(\(pl\))/i.test(word);

  const ruStripped = translationRu
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[,;]/g, ' ')
    .trim();
  const isVerbByRu = /(?:ть|ться)$/i.test(ruStripped);
  const translationTokens = translationLower
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,;]+/)
    .filter(Boolean);
  const isVerbByDe = translationTokens.some((token) => token.length > 3 && token.endsWith('en'));
  const isVerbByEn = /^to\s/.test(word.toLowerCase()) || /\(to\)/.test(word.toLowerCase());
  const isVerb = isVerbByRu || (isVerbByDe && !isNoun) || isVerbByEn;

  if (isVerb && !isNoun) return 'verb';
  if (isNoun && !isVerb) return 'noun';
  if (isVerb) return 'verb';
  if (isNoun) return 'noun';
  return null;
}

function buildQuestions(entries, pagesFilter, mode) {
  const normalizedSelection = Array.isArray(pagesFilter) && pagesFilter.length
    ? pagesFilter
    : ['all'];
  const useAllPages = normalizedSelection.includes('all');
  const filterSet = useAllPages ? null : new Set(normalizedSelection.map((val) => String(val)));
  const scope = useAllPages
    ? entries
    : entries.filter((e) => {
        if (!filterSet || !filterSet.size) return false;
        if (e.page == null) return false;
        return filterSet.has(String(e.page));
      });

  // валидные пары ТОЛЬКО из выбранной области (страницы или всех слов)
  const poolQuestions = (mode === 'en->de') ? scope.filter(isValidEnDe) : scope.filter(isValidDeEn);
  return shuffle(
    poolQuestions
      .map((q) => {
        if (mode === 'en->de') {
          return {
            id: q.id,
            prompt: q.word,
            correct: q.translation.trim(),
            show: 'de',
            kind: inferEntryCategory(q),
          };
        }
        return {
          id: q.id,
          prompt: q.translation || '',
          correct: q.word.trim(),
          show: 'en',
          kind: inferEntryCategory(q),
        };
      })
      .filter((q) => q.correct)
  );
}

const OPTIONAL_PREFIXES = {
  noun: ['the ', 'a ', 'an '],
  verb: ['to '],
  default: [],
};
const CASE_SENSITIVE_WORDS = new Set([
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'montag','dienstag','mittwoch','donnerstag','freitag','samstag','sonntag',
  'january','february','march','april','may','june','july','august','september','october','november','december',
  'januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'
]);

function prepareForComparison(raw, prefixes = OPTIONAL_PREFIXES.default) {
  if (typeof raw !== 'string') {
    return { cleaned: '', lower: '', core: '', removedPrefix: '' };
  }
  let working = raw.trim();
  if (!working) {
    return { cleaned: '', lower: '', core: '', removedPrefix: '' };
  }

  let removedPrefix = '';
  let changed = true;
  while (changed) {
    changed = false;
    const lower = working.toLowerCase();
    for (const prefix of prefixes) {
      if (lower.startsWith(prefix) && lower.length > prefix.length) {
        const originalPrefix = working.slice(0, prefix.length);
        if (originalPrefix === prefix) {
          removedPrefix += originalPrefix;
          working = working.slice(prefix.length);
          changed = true;
          break;
        }
      }
    }
  }

  const core = working;
  const cleaned = core.trim();
  return { cleaned, lower: cleaned.toLowerCase(), core, removedPrefix };
}

function diffStrings(expected = '', actual = '', options = {}) {
  const { caseSensitive = false } = options;
  const a = Array.from(expected);
  const b = Array.from(actual);
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const match = caseSensitive ? a[i] === b[j] : a[i].toLowerCase() === b[j].toLowerCase();
      if (match) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const expectedSegments = [];
  const actualSegments = [];

  const pushSegment = (list, text, match) => {
    if (!text) return;
    const last = list[list.length - 1];
    if (last && last.match === match) {
      last.text += text;
    } else {
      list.push({ text, match });
    }
  };

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    const match = caseSensitive ? a[i] === b[j] : a[i].toLowerCase() === b[j].toLowerCase();
    if (match) {
      pushSegment(expectedSegments, a[i], true);
      pushSegment(actualSegments, b[j], true);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushSegment(expectedSegments, a[i], false);
      i += 1;
    } else {
      pushSegment(actualSegments, b[j], false);
      j += 1;
    }
  }

  while (i < m) {
    pushSegment(expectedSegments, a[i], false);
    i += 1;
  }

  while (j < n) {
    pushSegment(actualSegments, b[j], false);
    j += 1;
  }

  return { expected: expectedSegments, actual: actualSegments };
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
  const [selectedPages, setSelectedPages] = useState(['all']);
  const [mode, setMode] = useState("en->de"); // en->de | de->en

  // 3) прогресс
  const [started, setStarted] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const lastValidationRef = useRef(null);
  const [inputValue, setInputValue] = useState('');
  const [inputStatus, setInputStatus] = useState(null);
  const [lastResult, setLastResult] = useState(null);
  const current = questions[idx];
  const isAllPagesSelected = selectedPages.includes('all');
  const selectedPageNumbers = useMemo(() => {
    if (isAllPagesSelected) return pages;
    return selectedPages
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
  }, [isAllPagesSelected, selectedPages, pages]);
  const pageSummary = isAllPagesSelected
    ? 'Alle Seiten'
    : (selectedPageNumbers.length === 1
        ? `Seite ${selectedPageNumbers[0]}`
        : `Seiten ${selectedPageNumbers.join(', ')}`);

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

  function selectAllPages() {
    setError('');
    setSelectedPages(['all']);
  }

  function togglePageSelection(pageNumber) {
    setError('');
    setSelectedPages((prev) => {
      const key = String(pageNumber);
      if (prev.includes('all')) {
        return [key];
      }
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      if (next.size === 0) {
        return ['all'];
      }
      return Array.from(next).sort((a, b) => Number(a) - Number(b));
    });
  }

  function startQuiz() {
    setError("");
    const qs = buildQuestions(entries, selectedPages, mode);
    if (qs.length < 1) {
      setQuestions([]);
      setIdx(0);
      setScore(0);
      setError("Zu wenige passende Wörter für diese Auswahl und diesen Modus.");
      return;
    }
    setQuestions(qs);
    setIdx(0);
    setScore(0);
    setStarted(true);
    setInputValue('');
    setInputStatus(null);
    setLastResult(null);
    lastValidationRef.current = null;
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }
  useEffect(() => {
    if (!started || !current) return;
    setInputValue('');
    setInputStatus(null);
    lastValidationRef.current = null;
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [idx, started, current?.id]);

  function validateInput() {
    if (!current) return;
    if (lastValidationRef.current === current.id) return;
    const rawAnswer = inputValue;
    const sanitizedAnswer = rawAnswer.trim();
    if (!sanitizedAnswer) {
      setInputStatus('empty');
      return;
    }
    const expected = (current.correct || '').trim();
    const optionalPrefixes = current.kind && OPTIONAL_PREFIXES[current.kind]
      ? OPTIONAL_PREFIXES[current.kind]
      : OPTIONAL_PREFIXES.default;
    const expectedPrepared = prepareForComparison(expected, optionalPrefixes);
    const answerPrepared = prepareForComparison(sanitizedAnswer, optionalPrefixes);

    const requiresCaseMatch = CASE_SENSITIVE_WORDS.has(expectedPrepared.lower);
    const correct = answerPrepared.cleaned === expectedPrepared.cleaned;

    let diff = null;
    if (!correct) {
      const coreDiff = diffStrings(
        expectedPrepared.core,
        answerPrepared.core,
        { caseSensitive: true }
      );
      diff = {
        expected: [
          ...(expectedPrepared.removedPrefix
            ? [{ text: expectedPrepared.removedPrefix, match: true }]
            : []),
          ...coreDiff.expected,
        ],
        actual: [
          ...(answerPrepared.removedPrefix
            ? [{ text: answerPrepared.removedPrefix, match: true }]
            : []),
          ...coreDiff.actual,
        ],
      };
    }

    const feedback = {
      status: correct ? 'correct' : 'incorrect',
      prompt: current.prompt,
      expected,
      answer: rawAnswer,
      diff,
    };

    if (correct) {
      setScore((s) => s + 1);
    }

    setLastResult(feedback);
    setInputStatus(null);
    setInputValue('');
    lastValidationRef.current = current.id;

    if (idx + 1 < questions.length) {
      setIdx((i) => i + 1);
    } else {
      setStarted(false);
      setIdx(0);
      setInputValue('');
      setInputStatus(null);
      lastValidationRef.current = null;
      setTimeout(() => {
        inputRef.current?.blur();
      }, 0);
      return;
    }

    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  }

  function repeatCurrentPrompt() {
    if (!current) return;
    setInputStatus(null);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
    if (mode === 'en->de') {
      speakText(current.prompt, 'en');
    }
  }

  function handleInputChange(event) {
    setInputValue(event.target.value);
    if (inputStatus === 'empty') {
      setInputStatus(null);
    }
  }

  function renderDiffLine(label, segments, keyPrefix) {
    return (
      <div className="diff-line">
        <span className="diff-label">{label}</span>
        <span className="diff-text">
          {segments && segments.length > 0 ? (
            segments.map((seg, index) => (
              <span
                key={`${keyPrefix}-${index}`}
                className={`diff-segment ${seg.match ? 'match' : 'mismatch'}`}
              >
                {seg.text}
              </span>
            ))
          ) : (
            <span className="diff-segment mismatch">[leer]</span>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="quiz-container">
      {/* Hinweis entfernt: Auswahl очевидна из UI */}

      {/* Настройки перед стартом */}
      {!started && (
        <>
          <div className="settings-grid">
            <div className="pages-cell">
              <span className="field-label">Seiten</span>
              <div className="pages-chip-list" role="group" aria-label="Seiten auswählen">
                <button
                  type="button"
                  className={`input-styled page-chip ${isAllPagesSelected ? 'is-active' : ''}`}
                  onClick={selectAllPages}
                  aria-pressed={isAllPagesSelected}
                >
                  Alle
                </button>
                {pages.map((p) => {
                  const key = String(p);
                  const isActive = !isAllPagesSelected && selectedPages.includes(key);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={`input-styled page-chip ${isActive ? 'is-active' : ''}`}
                      onClick={() => togglePageSelection(p)}
                      aria-pressed={isActive}
                    >
                      {`Seite ${p}`}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mode-cell">
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
          <div className="input-mode-wrap">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              className="input-styled input-mode-field"
              placeholder={current.show === 'de' ? 'Übersetzung eingeben' : 'Wort eingeben'}
              aria-label="Antwort eingeben"
              aria-invalid={inputStatus === 'empty'}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  validateInput();
                }
              }}
            />
            <div className="input-mode-actions">
              <button type="button" onClick={validateInput} className="input-styled">
                Überprüfen
              </button>
              <button type="button" onClick={repeatCurrentPrompt} className="input-styled">
                Wiederholen
              </button>
            </div>
            {inputStatus === 'empty' && (
              <div className="input-feedback warning">Bitte gib eine Antwort ein.</div>
            )}
          </div>
          <div className="meta-row">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="meta-chip">{pageSummary}</span>
              <span className="meta-chip">{mode === 'en->de' ? 'EN → DE' : 'DE → EN'}</span>
              <span className="meta-chip">Freitext</span>
            </div>
            <button
              onClick={() => {
                setStarted(false);
                setQuestions([]);
                setScore(0);
                setIdx(0);
                setInputValue('');
                setInputStatus(null);
                setLastResult(null);
                lastValidationRef.current = null;
              }}
              className="input-styled"
            >
              Abbrechen
            </button>
          </div>
        </>
      )}

      {lastResult && (
        <div
          className={`input-feedback ${lastResult.status === 'correct' ? 'success' : 'error'}`}
          style={{ marginTop: started ? 16 : 24 }}
        >
          <div style={{ fontWeight: 600, marginBottom: lastResult.status === 'correct' ? 0 : 6 }}>
            {lastResult.status === 'correct'
              ? `Super! "${lastResult.prompt}" → ${lastResult.expected}`
              : `Nicht ganz. "${lastResult.prompt}" sollte so heißen:`}
          </div>
          {lastResult.status === 'incorrect' && lastResult.diff && (
            <>
              {renderDiffLine('Erwartet', lastResult.diff.expected, 'expected')}
              {renderDiffLine('Eingabe', lastResult.diff.actual, 'actual')}
            </>
          )}
        </div>
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
                <button
                  onClick={() => {
                    setQuestions([]);
                    setScore(0);
                    setIdx(0);
                    setInputValue('');
                    setInputStatus(null);
                    setLastResult(null);
                    lastValidationRef.current = null;
                  }}
                  className="input-styled"
                >Zurücksetzen</button>
              </div>
            </div>
          );
        })()
      )}
    </div>
  );
}
