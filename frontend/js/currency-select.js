/**
 * Turns a plain text input into a searchable currency picker: typing
 * filters CURRENCIES by code or name, and clicking (or pressing Enter
 * on) a highlighted result sets the input's value to the currency CODE.
 *
 * Usage: attachCurrencySelect(someInputElement) — call once per input,
 * right after the dialog's DOM elements are looked up.
 */
import { CURRENCIES } from "./currencies.js";

const MAX_RESULTS = 20;

export function attachCurrencySelect(inputEl) {
  inputEl.setAttribute("autocomplete", "off");

  const wrapper = inputEl.parentElement;
  wrapper.classList.add("currency-select-wrap");

  const list = document.createElement("ul");
  list.className = "currency-select-list hidden";
  wrapper.appendChild(list);

  // Without this, clicking/dragging the dropdown's own scrollbar still
  // counts as a mousedown outside any <li>, which blurs the input and
  // closes the list mid-scroll. Stopping the default here keeps focus
  // on the input no matter where inside the list you click.
  list.addEventListener("mousedown", (e) => e.preventDefault());

  let highlightedIndex = -1;
  let currentMatches = [];

  function matchesFor(query) {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES.slice(0, MAX_RESULTS);
    const startsWith = CURRENCIES.filter((c) => c.code.toLowerCase().startsWith(q));
    const contains = CURRENCIES.filter(
      (c) => !c.code.toLowerCase().startsWith(q) && (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    );
    return [...startsWith, ...contains].slice(0, MAX_RESULTS);
  }

  function renderList() {
    currentMatches = matchesFor(inputEl.value);
    list.innerHTML = "";
    highlightedIndex = -1;

    if (currentMatches.length === 0) {
      const li = document.createElement("li");
      li.className = "no-matches";
      li.textContent = "No matching currency — you can still type a custom code";
      list.appendChild(li);
      list.classList.remove("hidden");
      return;
    }

    currentMatches.forEach((c, i) => {
      const li = document.createElement("li");
      li.textContent = `${c.code} — ${c.name}`;
      li.dataset.index = String(i);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep focus, avoid blur firing before click
        selectCurrency(c);
      });
      list.appendChild(li);
    });
    list.classList.remove("hidden");
  }

  function selectCurrency(currency) {
    inputEl.value = currency.code;
    list.classList.add("hidden");
    inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setHighlight(index) {
    const items = list.querySelectorAll("li:not(.no-matches)");
    items.forEach((item) => item.classList.remove("is-highlighted"));
    if (index >= 0 && index < items.length) {
      items[index].classList.add("is-highlighted");
      items[index].scrollIntoView({ block: "nearest" });
    }
    highlightedIndex = index;
  }

  inputEl.addEventListener("focus", renderList);
  inputEl.addEventListener("input", renderList);

  inputEl.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(highlightedIndex + 1, currentMatches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(highlightedIndex - 1, 0));
    } else if (e.key === "Enter" && highlightedIndex >= 0 && currentMatches[highlightedIndex]) {
      e.preventDefault();
      selectCurrency(currentMatches[highlightedIndex]);
    } else if (e.key === "Escape") {
      list.classList.add("hidden");
    }
  });

  inputEl.addEventListener("blur", () => {
    // Delay so a click on a list item (mousedown) registers first.
    setTimeout(() => list.classList.add("hidden"), 100);
  });
}
