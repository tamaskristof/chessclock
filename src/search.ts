import { categoryFor, CATEGORIES, countryName, lookupPlayer, type Category, type ChessComPlayer } from "./chesscom";
import type { Side, TimeControl } from "./clock";
import { $ } from "./dom";
import { categoryLabel, sideLabel, tcLabel } from "./labels";
import type { RatingSource } from "./storage";

export interface PickedPlayer { name: string; rating: number | null; source: RatingSource | null; }

export interface SearchDeps {
  getTimeControl(): TimeControl;
  getRecent(): string[];
  /** Called after a successful lookup so the username lands in the recent list. */
  onLookedUp(username: string): void;
  onPick(side: Side, picked: PickedPlayer): void;
  onBack(): void;
}

const FALLBACK_ORDER: Category[] = ["blitz", "rapid", "bullet", "daily"];

export function initSearch(deps: SearchDeps): { open(side: Side, prefill?: string): void } {
  const form = $<HTMLFormElement>("search-form");
  const input = $<HTMLInputElement>("search-input");
  const go = $<HTMLButtonElement>("search-go");
  const msg = $("search-msg");
  const sideEl = $("search-side");
  const recent = $("recent");
  const recentChips = $("recent-chips");
  const card = $("search-card");
  const empty = $("search-empty");
  const emptyTitle = $("empty-title");
  const emptyText = $("empty-text");
  const avatar = $("card-avatar");
  const cardName = $("card-name");
  const cardSub = $("card-sub");
  const cats = $("card-cats");
  const note = $("card-note");
  const use = $<HTMLButtonElement>("card-use");

  let side: Side = "left";
  let player: ChessComPlayer | null = null;
  let selected: Category = "blitz";
  let token = 0;

  const EMPTY_TEXT = "Type the exact chess.com username. Needs an internet connection.";

  function setMessage(text: string, bad = false): void {
    msg.textContent = text;
    msg.style.color = bad ? "var(--flag)" : "var(--ink-muted)";
    input.classList.toggle("invalid", bad);
    input.classList.toggle("active", !bad);
  }
  function showEmpty(title: string, text: string): void {
    player = null;
    card.hidden = true;
    empty.hidden = false;
    emptyTitle.textContent = title;
    emptyText.textContent = text;
  }

  function renderRecent(): void {
    const list = deps.getRecent();
    recent.hidden = list.length === 0;
    recentChips.replaceChildren(
      ...list.map((u) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "chip-pill";
        b.textContent = u;
        b.addEventListener("click", () => {
          input.value = u;
          void search();
        });
        return b;
      }),
    );
  }

  function pickDefault(p: ChessComPlayer): Category {
    const auto = categoryFor(deps.getTimeControl());
    if (p.ratings[auto] !== null) return auto;
    return FALLBACK_ORDER.find((c) => p.ratings[c] !== null) ?? auto;
  }

  function renderCard(): void {
    if (!player) return;
    const p = player;
    const auto = categoryFor(deps.getTimeControl());
    const label = p.name ?? p.username;
    card.hidden = false;
    empty.hidden = true;
    avatar.textContent = label.charAt(0).toUpperCase();
    cardName.textContent = label;
    const country = countryName(p.country);
    cardSub.textContent = country ? `${p.username} · ${country}` : p.username;
    cats.replaceChildren(
      ...CATEGORIES.map((c) => {
        const r = p.ratings[c];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cat";
        b.disabled = r === null;
        b.setAttribute("aria-pressed", String(c === selected));
        b.innerHTML = '<span class="k"></span><span class="v"></span>';
        (b.querySelector(".k") as HTMLElement).textContent = categoryLabel(c);
        (b.querySelector(".v") as HTMLElement).textContent = r === null ? "–" : String(r);
        b.addEventListener("click", () => {
          selected = c;
          renderCard();
        });
        return b;
      }),
    );
    const tc = tcLabel(deps.getTimeControl());
    if (p.ratings[auto] === null) {
      note.textContent = p.ratings[selected] === null
        ? "No ratings found. You can still use the name."
        : `No ${categoryLabel(auto)} rating yet, so ${categoryLabel(selected)} is selected.`;
    } else {
      note.textContent = selected === auto
        ? `${categoryLabel(auto)} picked to match ${tc}. Tap another to use it instead.`
        : `${categoryLabel(selected)} selected. ${tc} would normally use ${categoryLabel(auto)}.`;
    }
    const rating = p.ratings[selected];
    use.textContent = rating === null ? `Use ${label}` : `Use ${label} · ${rating}`;
  }

  async function search(): Promise<void> {
    const username = input.value.trim();
    const mine = ++token;
    if (username === "") {
      setMessage("Enter a chess.com username.", true);
      return;
    }
    go.disabled = true;
    go.textContent = "Looking up…";
    setMessage("");
    const r = await lookupPlayer(username);
    if (mine !== token) return;
    go.disabled = false;
    go.textContent = "Look up";
    if (r.ok) {
      player = r.player;
      selected = pickDefault(r.player);
      input.value = r.player.username;
      setMessage("");
      deps.onLookedUp(r.player.username);
      renderRecent();
      renderCard();
    } else if (r.error === "notfound") {
      setMessage(`No chess.com player is called “${username}”. Check the spelling; the username has to match exactly.`, true);
      showEmpty("No player to show", "You can still type a name and rating by hand on the New game screen.");
    } else if (r.error === "invalid") {
      setMessage("A chess.com username is 3 to 25 letters, numbers, hyphens or underscores.", true);
      showEmpty("No player to show", EMPTY_TEXT);
    } else {
      setMessage("Could not reach chess.com. Check your connection and try again.", true);
      showEmpty("No connection", "You can still type a name and rating by hand on the New game screen.");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void search();
  });
  input.addEventListener("input", () => {
    input.classList.remove("invalid");
  });
  $("search-back").addEventListener("click", deps.onBack);
  use.addEventListener("click", () => {
    if (!player) return;
    const rating = player.ratings[selected];
    deps.onPick(side, {
      name: player.name ?? player.username,
      rating,
      source: rating === null ? null : { username: player.username, category: selected },
    });
  });

  return {
    open(s: Side, prefill = ""): void {
      side = s;
      token++;
      sideEl.textContent = `${sideLabel(s)} player`;
      input.value = prefill;
      go.disabled = false;
      go.textContent = "Look up";
      setMessage("");
      input.classList.remove("active", "invalid");
      showEmpty("Look up a player", EMPTY_TEXT);
      renderRecent();
      if (prefill === "") input.focus();
    },
  };
}
