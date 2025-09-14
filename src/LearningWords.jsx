import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useState, useEffect, useMemo, useRef } from "react";
import kidsWords from "./data/kidsWords.json";

// Нормализация входных данных: уникальные id, базовая чистка полей
function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  let maxId = raw.reduce((m, e) => (e && typeof e.id === "number" && Number.isFinite(e.id) ? Math.max(m, e.id) : m), 0);
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    let id = Number(e.id);
    if (!Number.isFinite(id) || seen.has(id)) {
      id = ++maxId; // выдаём новый уникальный id
    }
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
  return out;
}

// Структура по страницам: группируем и сортируем слова по полю "page".
// - Хранение: localStorage по ключу "kidsWordsPages" (единый список слов).
// - Миграция: поддержка старых ключей
//     - "kidsWordsLessons" (группы-уроки) -> объединяем все записи в один список
//     - "kidsWords" (плоский список) -> используем как есть
// - Интерфейс: выбор страницы (или "Все страницы"), операции над словами в рамках выбранной страницы.

function WordCard({ entry, onToggleLearned, onDelete, attributes, listeners }) {
  const [isFlipped, setIsFlipped] = useState(false);
  const flipTimeoutRef = useRef(null);
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchEndX, setTouchEndX] = useState(null);
  const [showDelete, setShowDelete] = useState(false);

  const handleClick = () => {
    if (!isFlipped) {
      const utterance = new SpeechSynthesisUtterance(entry.word);
      utterance.lang = "en-US";
      utterance.rate = 0.85;
      utterance.pitch = 1.2;

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find((voice) =>
        /Google UK English Female|Google US English|Samantha|female/i.test(
          voice.name
        )
      );

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      // Fallback: если onend не сработал, перевернуть через таймаут
      if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = setTimeout(() => {
        setIsFlipped(true);
      }, 900);

      utterance.onend = () => {
        if (flipTimeoutRef.current) {
          clearTimeout(flipTimeoutRef.current);
          flipTimeoutRef.current = null;
        }
        setIsFlipped(true);
      };
      utterance.onerror = () => {
        if (flipTimeoutRef.current) {
          clearTimeout(flipTimeoutRef.current);
          flipTimeoutRef.current = null;
        }
        setIsFlipped(true);
      };

      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    } else {
      setIsFlipped(false);
    }
  };

  useEffect(() => () => {
    if (flipTimeoutRef.current) clearTimeout(flipTimeoutRef.current);
  }, []);

  const handleTouchStart = (e) => setTouchStartX(e.targetTouches[0].clientX);
  const handleTouchMove = (e) => setTouchEndX(e.targetTouches[0].clientX);
  const handleTouchEnd = () => {
    if (touchStartX !== null && touchEndX !== null) {
      const deltaX = touchEndX - touchStartX;
      if (deltaX < -100) {
        setShowDelete(true); // свайп влево
      } else if (deltaX > 100) {
        setShowDelete(false); // свайп вправо
      }
    }
    setTouchStartX(null);
    setTouchEndX(null);
  };

  return (
    <div
      onClick={handleClick}
      className={`card wide-block ${
        entry.learned ? "learned-card" : "unlearned-card"
      } ${isFlipped ? "flipped" : ""}`}
      style={{
        transform: showDelete ? "translateX(-60px)" : "translateX(0)",
        transition: "transform 0.3s ease",
      }}
      key={entry.id}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="card-inner">
        <div className="card-front">
          <span
            title="Als gelernt markieren"
            className={`star-icon ${entry.learned ? "star-active" : ""}`}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              fontSize: "22px",
              cursor: "grab",
              opacity: entry.learned ? 1 : 0.3,
              transition: "all 0.3s ease",
              color: entry.learned ? "gold" : "#888",
              transform: entry.learned ? "scale(1.2)" : "none",
              zIndex: 10,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLearned(entry.id);
            }}
            {...attributes}
            {...listeners}
          >
            ⭐
          </span>
          {showDelete && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onDelete(entry.id);
              }}
              title="Löschen"
              style={{
                position: "absolute",
                top: "50%",
                right: "-44px",
                transform: "translateY(-50%)",
                fontSize: "20px",
                cursor: "pointer",
                color: "#e74c3c",
                backgroundColor: "#fff",
                borderRadius: "50%",
                padding: "6px",
                boxShadow: "0 0 5px rgba(0,0,0,0.2)",
              }}
            >
              🧹
            </span>
          )}
          <div style={{ marginTop: 16 }}>
            <strong>{entry.word}</strong>
          </div>
        </div>

        <div className="card-back">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              textAlign: "center",
            }}
          >
            <div
              style={{ fontWeight: "bold", fontSize: "1.2rem", color: "#222" }}
            >
              {entry.translation || "Keine Übersetzung"}
            </div>
            {entry.translationRu && (
              <div style={{ fontSize: "1.05rem", color: "#444" }}>
                {entry.translationRu}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LearningWords() {
  const [entries, setEntries] = useState([]); // единый список слов с полем page
  const [currentPage, setCurrentPage] = useState("all"); // число или "all"
  const [learnedFilter, setLearnedFilter] = useState("all"); // all | learned | unlearned
  const [newWord, setNewWord] = useState("");
  const [newTranslation, setNewTranslation] = useState("");
  const [dragEnabled, setDragEnabled] = useState(true);
  const [iosMenuOpen, setIosMenuOpen] = useState(false);

  const isIOS = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua);
    const iPadOS13Plus = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return iOS || iPadOS13Plus;
  }, []);

  // Инициализация: загружаем по ключу "kidsWordsPages" или мигрируем
  useEffect(() => {
    const savedPages = localStorage.getItem("kidsWordsPages");
    if (savedPages) {
      try {
        const parsed = JSON.parse(savedPages);
        if (Array.isArray(parsed) && parsed.length) {
          const normalized = normalizeEntries(parsed);
          setEntries(normalized);
          localStorage.setItem("kidsWordsPages", JSON.stringify(normalized));
          return;
        }
      } catch {
        void 0;
      }
    }

    // Миграция с уроков -> плоский список
    const savedLessons = localStorage.getItem("kidsWordsLessons");
    if (savedLessons) {
      try {
        const parsedLessons = JSON.parse(savedLessons);
        if (Array.isArray(parsedLessons) && parsedLessons.length) {
          const flattened = parsedLessons.flatMap((l) => Array.isArray(l.entries) ? l.entries : []);
          if (flattened.length) {
            const normalized = normalizeEntries(flattened);
            setEntries(normalized);
            localStorage.setItem("kidsWordsPages", JSON.stringify(normalized));
            return;
          }
        }
      } catch {
        void 0;
      }
    }

    // Миграция со старого плоского ключа
    const legacy = localStorage.getItem("kidsWords");
    if (legacy) {
      try {
        const parsedLegacy = JSON.parse(legacy);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length) {
          const normalized = normalizeEntries(parsedLegacy);
          setEntries(normalized);
          localStorage.setItem("kidsWordsPages", JSON.stringify(normalized));
          return;
        }
      } catch {
        void 0;
      }
    }

    // Стартовые данные из JSON
    const normalized = normalizeEntries(kidsWords);
    setEntries(normalized);
    localStorage.setItem("kidsWordsPages", JSON.stringify(normalized));
  }, []);

  useEffect(() => {
    // Включаем DnD только на устройствах с точным указателем (обычно десктоп)
    try {
      const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
      const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      const touch = (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) || coarse;
      setDragEnabled(fine && !touch);
    } catch {
      setDragEnabled(true);
    }
  }, []);

  useEffect(() => {
    function loadVoices() {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) {
        setTimeout(loadVoices, 100);
      }
    }

    if (typeof window !== "undefined" && window.speechSynthesis) {
      loadVoices();
    }
  }, []);

  // Сохранение при изменениях (с дебаунсом)
  useEffect(() => {
    if (!entries || !entries.length) return;
    const t = setTimeout(() => {
      localStorage.setItem("kidsWordsPages", JSON.stringify(entries));
    }, 300);
    return () => clearTimeout(t);
  }, [entries]);

  // Список доступных страниц и отфильтрованные записи
  const pages = useMemo(() => {
    const set = new Set();
    for (const e of entries) {
      if (e && typeof e.page !== "undefined") set.add(e.page);
    }
    return Array.from(set).sort((a, b) => Number(a) - Number(b));
  }, [entries]);

  const pageEntries = useMemo(() => {
    if (currentPage === "all") return entries;
    const cp = String(currentPage);
    return entries.filter((e) => String(e.page) === cp);
  }, [entries, currentPage]);

  const visibleEntries = useMemo(() => {
    let list = pageEntries;
    if (learnedFilter === "learned") list = list.filter((e) => e.learned);
    else if (learnedFilter === "unlearned") list = list.filter((e) => !e.learned);
    // При показе всех страниц сортируем по номеру страницы, затем по id
    return [...list].sort((a, b) => {
      const ap = Number(a.page ?? 0);
      const bp = Number(b.page ?? 0);
      if (currentPage === "all") {
        if (ap !== bp) return ap - bp;
      }
      return Number((a.id ?? 0)) - Number((b.id ?? 0));
    });
  }, [pageEntries, learnedFilter, currentPage]);

  const handleDelete = (id) => {
    // Удаление как раньше — без подтверждения, по свайпу на карточке
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  return (
    <div>
      <h1 className="title wide-block">Lernen wir neue Wörter!</h1>

      {/* Выбор страницы */}
      <div className="wide-block" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, justifyContent: "center", position: "relative", zIndex: 1000 }}>
        {isIOS ? (
          <div style={{ position: "relative", width: "100%", maxWidth: 320 }}>
            <button
              type="button"
              className="input-styled page-select"
              style={{ width: "100%", textAlign: "left" }}
              onClick={() => setIosMenuOpen((v) => !v)}
              onTouchEnd={() => setIosMenuOpen((v) => !v)}
            >
              {currentPage === "all" ? "Alle Seiten" : String(currentPage)}
              <span style={{ float: "right" }}>▾</span>
            </button>
            {iosMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  background: "#fff",
                  border: "2px solid #a4d37f",
                  borderRadius: 12,
                  boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
                  zIndex: 9999,
                  maxHeight: 300,
                  overflowY: "auto",
                }}
                role="listbox"
              >
                <div
                  role="button"
                  tabIndex={0}
                  style={{ padding: "10px 14px", cursor: "pointer" }}
                  onClick={() => { setCurrentPage("all"); setIosMenuOpen(false); }}
                >
                  Alle Seiten
                </div>
                {pages.map((p) => (
                  <div
                    key={p}
                    role="button"
                    tabIndex={0}
                    style={{ padding: "10px 14px", cursor: "pointer" }}
                    onClick={() => { setCurrentPage(String(p)); setIosMenuOpen(false); }}
                  >
                    {p}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <select
            id="page-select"
            className="input-styled page-select"
            aria-label="Seite"
            style={{ border: "none", boxShadow: "none" }}
            value={String(currentPage)}
            onChange={(e) => {
              const v = e.target.value;
              setCurrentPage(v);
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <option value="all">Alle Seiten</option>
            {pages.map((p) => (
              <option key={p} value={String(p)}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Фильтр по изученности */}
      <div className="filters">
        <label>
          <input
            type="radio"
            name="learnedFilter"
            value="all"
            checked={learnedFilter === "all"}
            onChange={() => setLearnedFilter("all")}
          />
          <span>Alle</span>
        </label>
        <label>
          <input
            type="radio"
            name="learnedFilter"
            value="learned"
            checked={learnedFilter === "learned"}
            onChange={() => setLearnedFilter("learned")}
          />
          <span>Gelernt</span>
        </label>
        <label>
          <input
            type="radio"
            name="learnedFilter"
            value="unlearned"
            checked={learnedFilter === "unlearned"}
            onChange={() => setLearnedFilter("unlearned")}
          />
          <span>Nicht gelernt</span>
        </label>
      </div>

      {/* Прогресс */}
      <div className="hint">
        {(() => {
          const totalOnPage = pageEntries.length;
          const learnedOnPage = pageEntries.filter((e) => e.learned).length;
          return `Gelernt: ${learnedOnPage} von ${totalOnPage}`;
        })()}
      </div>

      {/* Форма для добавления новой карточки */}
      <div className="add-card-form">
        <div className="input-group">
          <input
            className="input-styled wide-block"
            type="text"
            placeholder="Englisches Wort"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
          />
        </div>
        <div className="input-group">
          <input
            className="input-styled wide-block"
            type="text"
            placeholder="Deutsche Übersetzung"
            value={newTranslation}
            onChange={(e) => setNewTranslation(e.target.value)}
          />
        </div>
        <button
          onClick={() => {
            if (newWord.trim() && newTranslation.trim()) {
              const assignedPage = currentPage === "all" ? (pages[0] ?? 1) : Number(currentPage);
              const newEntry = {
                id: Date.now(),
                word: newWord.trim(),
                translation: newTranslation.trim(),
                translationRu: "",
                learned: false,
                page: assignedPage,
              };
              setEntries((prev) => [newEntry, ...prev]);
              setNewWord("");
              setNewTranslation("");
            }
          }}
        >
          Neue Karte hinzufügen
        </button>
      </div>

      {dragEnabled ? (
        <DragDropContext
          onDragEnd={(result) => {
            if (!result.destination) return;
            // Перетаскивание включено только в рамках выбранной страницы
            if (currentPage === "all") return;
            const filtered = visibleEntries;
            const items = [...filtered];
            const [reordered] = items.splice(result.source.index, 1);
            items.splice(result.destination.index, 0, reordered);
            // Проецируем новый порядок обратно в общий список по этой странице
            setEntries((prev) => {
              const others = prev.filter((e) => e.page !== currentPage);
              return [...others, ...items];
            });
          }}
        >
          <Droppable droppableId="cards">
            {(provided) => (
              <div
                className="cards-container"
                ref={provided.innerRef}
                {...provided.droppableProps}
              >
                {visibleEntries.map((entry, index) => (
                  <Draggable
                    key={`${String(entry.page)}-${String(entry.id)}`}
                    draggableId={`${String(entry.page)}-${String(entry.id)}`}
                    index={index}
                  >
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className="draggable-card-wrapper"
                      >
                        <WordCard
                          entry={entry}
                          onToggleLearned={(id) => {
                            setEntries((prev) =>
                              prev.map((e) =>
                                e.id === id ? { ...e, learned: !e.learned } : e
                              )
                            );
                          }}
                          onDelete={handleDelete}
                          attributes={
                            provided.dragHandleProps
                              ? provided.dragHandleProps
                              : {}
                          }
                          listeners={{}}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className="cards-container">
          {visibleEntries.map((entry) => (
            <div key={`${String(entry.page)}-${String(entry.id)}`} className="draggable-card-wrapper">
              <WordCard
                entry={entry}
                onToggleLearned={(id) => {
                  setEntries((prev) =>
                    prev.map((e) => (e.id === id ? { ...e, learned: !e.learned } : e))
                  );
                }}
                onDelete={handleDelete}
                attributes={{}}
                listeners={{}}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
