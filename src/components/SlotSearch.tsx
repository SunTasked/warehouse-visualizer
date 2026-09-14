import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Slot } from "../types/warehouse";
import { useEditor } from "../state/EditorContext";
import { useViewFocus } from "../state/ViewFocusContext";
import { useAnalytics } from "../state/AnalyticsContext";
import { findBuildingForSlot } from "../lib/buildings";
import { levelsOf } from "../lib/stock";

/** Suggestions listed at once; the rest are counted, and narrowed by typing on. */
const MAX_SHOWN = 8;

interface Entry {
  slot: Slot;
  /** Upper-cased id, matched against. */
  key: string;
  building: string | undefined;
}

/** An id with the matched part marked. */
function highlight(id: string, needle: string): ReactNode {
  const at = id.toUpperCase().indexOf(needle);
  if (at === -1 || needle === "") return id;
  return (
    <>
      {id.slice(0, at)}
      <mark>{id.slice(at, at + needle.length)}</mark>
      {id.slice(at + needle.length)}
    </>
  );
}

const palletsIn = (slot: Slot) => slot.subSlots?.reduce((sum, subSlot) => sum + subSlot.pallets.length, 0) ?? 0;

/**
 * Finds a slot by its code, from the header's centre (specs.md §5.6):
 * suggestions from the first character typed — ids starting with it first,
 * then ids containing it — and choosing one takes you there: zoomed onto the
 * slot in view mode, selected and centred in edit mode. `/` jumps to the box.
 */
export function SlotSearch() {
  const { warehouse, mode, selectOnly, orbitRef } = useEditor();
  const { focusSlot } = useViewFocus();
  const { tab, setTab } = useAnalytics();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Built only while the box is in use: every stock change (a batch landing)
  // makes a new slots array, and nobody is searching then.
  const entries = useMemo<Entry[] | null>(() => {
    if (!open) return null;
    return warehouse.slots
      .map((slot) => ({ slot, key: slot.id.toUpperCase(), building: findBuildingForSlot(slot, warehouse.walls) }))
      .sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
  }, [open, warehouse.slots, warehouse.walls]);

  const { found, needle } = useMemo(() => {
    const typed = query.trim().toUpperCase();
    if (!entries || typed === "") return { found: [] as Entry[], needle: typed };
    const search = (text: string) => {
      const starting: Entry[] = [];
      const containing: Entry[] = [];
      for (const entry of entries) {
        const at = entry.key.indexOf(text);
        if (at === 0) starting.push(entry);
        else if (at > 0) containing.push(entry);
      }
      return [...starting, ...containing];
    };
    const direct = search(typed);
    // A code as the stock extract writes it: AA26Z for the slot AA26.
    if (direct.length === 0 && typed.length > 1 && typed.endsWith("Z")) {
      const stem = typed.slice(0, -1);
      return { found: search(stem), needle: stem };
    }
    return { found: direct, needle: typed };
  }, [entries, query]);

  const shown = found.slice(0, MAX_SHOWN);
  const listOpen = open && query.trim() !== "";
  const levels = levelsOf(warehouse.slotDefaults);

  // `/` from anywhere but a field puts the cursor in the box.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const choose = (entry: Entry) => {
    const { slot, building } = entry;
    setQuery(slot.id);
    setOpen(false);
    inputRef.current?.blur();
    if (tab !== "overview") setTab("overview");
    if (mode === "view") {
      focusSlot(slot.id, building);
      return;
    }
    // Edit mode has no drill-down: select the slot, and slide the orbit over
    // it without changing the angle or the distance.
    selectOnly(slot.id);
    const controls = orbitRef.current;
    if (controls) {
      const dx = slot.x - controls.target.x;
      const dz = -slot.y - controls.target.z;
      controls.target.x += dx;
      controls.target.z += dz;
      controls.object.position.x += dx;
      controls.object.position.z += dz;
      controls.update();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Kept to the box: Escape would otherwise also send the view back to the
    // plant, and Ctrl+Z undo the last edit.
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, shown.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const entry = shown[active] ?? shown[0];
      if (entry) choose(entry);
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (listOpen) {
        setOpen(false);
      } else {
        setQuery("");
        inputRef.current?.blur();
      }
    }
  };

  return (
    <div className="slot-search" role="search">
      <svg className="slot-search__icon" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.4 10.4 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        className="slot-search__input"
        type="text"
        placeholder="Find a slot…"
        aria-label="Find a slot"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls="slot-search-list"
        aria-autocomplete="list"
        aria-activedescendant={listOpen && shown[active] ? `slot-search-${shown[active].slot.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={(event) => {
          event.target.select();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {query === "" && (
        <kbd className="slot-search__key" aria-hidden="true">
          /
        </kbd>
      )}
      {listOpen && (
        // mousedown kept from blurring the box, so a click lands on the option.
        <ul id="slot-search-list" className="slot-search__list" role="listbox" onMouseDown={(event) => event.preventDefault()}>
          {shown.length === 0 ? (
            <li className="slot-search__empty">No slot matches “{query.trim()}”</li>
          ) : (
            shown.map((entry, i) => (
              <li
                key={entry.slot.id}
                id={`slot-search-${entry.slot.id}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "slot-search__option slot-search__option--active" : "slot-search__option"}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(entry)}
              >
                <span className="slot-search__id">{highlight(entry.slot.id, needle)}</span>
                <span className="slot-search__meta">
                  {entry.building ?? "no building"} · {palletsIn(entry.slot)}/{(entry.slot.subSlots?.length ?? 1) * levels} pallets
                </span>
              </li>
            ))
          )}
          {found.length > MAX_SHOWN && (
            <li className="slot-search__more">{(found.length - MAX_SHOWN).toLocaleString("en-US")} more — keep typing</li>
          )}
        </ul>
      )}
    </div>
  );
}
