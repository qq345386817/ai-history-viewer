import { Clock, Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { filterSearchHistory } from "../hooks/useSearchHistory";

function HighlightSuggestion({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return <>{text}</>;
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return <>{text}</>;
  const end = index + needle.length;
  return (
    <>
      {text.slice(0, index)}
      <strong className="search-suggestion-match">{text.slice(index, end)}</strong>
      {text.slice(end)}
    </>
  );
}

export default function SearchBox({
  query,
  onQuery,
  searchRef,
  history,
  onRecordHistory,
  onRemoveHistory,
  onClearHistory,
}: {
  query: string;
  onQuery: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  history: string[];
  onRecordHistory: (term: string) => void;
  onRemoveHistory: (term: string) => void;
  onClearHistory: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [composing, setComposing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const suggestions = useMemo(
    () => filterSearchHistory(history, query),
    [history, query],
  );
  const showDropdown = open && suggestions.length > 0;

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (!open) setActiveIndex(-1);
    else if (activeIndex >= suggestions.length)
      setActiveIndex(suggestions.length - 1);
  }, [open, suggestions.length, activeIndex]);

  // Save a settled query automatically after the user pauses typing.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || composing) return;
    const timer = setTimeout(() => {
      onRecordHistory(trimmed);
    }, 1000);
    return () => clearTimeout(timer);
  }, [query, composing, onRecordHistory]);

  function selectSuggestion(term: string) {
    onQuery(term);
    onRecordHistory(term);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOpen(false);
    setActiveIndex(-1);
    if (query.trim() && !composing) onRecordHistory(query);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composing) return;
    if (event.key === "ArrowDown") {
      if (!suggestions.length) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((index) => (index + 1) % suggestions.length);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (!showDropdown) return;
      event.preventDefault();
      setActiveIndex((index) =>
        index <= 0 ? suggestions.length - 1 : index - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      if (showDropdown && activeIndex >= 0 && suggestions[activeIndex]) {
        event.preventDefault();
        selectSuggestion(suggestions[activeIndex]);
      } else if (query.trim()) {
        onRecordHistory(query);
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (event.key === "Escape" && showDropdown) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopPropagation();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeDescendant =
    showDropdown && activeIndex >= 0
      ? `${listId}-option-${activeIndex}`
      : undefined;

  return (
    <div
      ref={boxRef}
      className={`search-box ${showDropdown ? "is-open" : ""}`}
      onBlur={handleBlur}
    >
      <label className="search">
        <Search size={17} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder="搜索全部项目会话…"
          aria-label="搜索会话"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listId : undefined}
          aria-activedescendant={activeDescendant}
          autoComplete="off"
        />
        <kbd>⌘ K</kbd>
      </label>
      {showDropdown ? (
        <div className="search-suggestions">
          <div className="search-suggestions-header">
            <span>最近搜索</span>
            <button
              type="button"
              className="search-suggestions-clear"
              aria-label="清空搜索历史"
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClearHistory}
            >
              清空
            </button>
          </div>
          <ul
            id={listId}
            className="search-suggestions-list"
            role="listbox"
            aria-label="搜索历史"
          >
            {suggestions.map((item, index) => (
              <li
                key={item}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`search-suggestion-row ${index === activeIndex ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="search-suggestion-item"
                  title={item}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectSuggestion(item)}
                >
                  <Clock size={14} aria-hidden="true" />
                  <span>
                    <HighlightSuggestion text={item} query={query} />
                  </span>
                </button>
                <button
                  type="button"
                  className="search-suggestion-remove"
                  aria-label={`删除搜索记录：${item}`}
                  title="删除"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveHistory(item);
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
