/**
 * The ticker bar: a Wall-Street-style strip of currency cross rates.
 * Scrolls only when content is wider than the container — on a wide
 * screen where all pairs fit, everything stays perfectly still. The
 * scroll kicks in only when there are so many pairs that they overflow.
 * Pauses on hover regardless.
 */
import * as api from "./api.js";
import { el } from "./utils.js";

const ARROW = { up: "▲", down: "▼", flat: "▬" };

function renderItem(item) {
  const dirClass = item.direction === "up" ? "ticker-up" : item.direction === "down" ? "ticker-down" : "ticker-flat";
  const changeText = item.change_pct === null
    ? ""
    : `${item.change_pct > 0 ? "+" : ""}${item.change_pct.toFixed(2)}%`;
  return el("span", { class: "ticker-item" }, [
    el("span", { class: "ticker-pair" }, `${item.base}/${item.quote}`),
    el("span", { class: "ticker-rate" }, item.rate.toFixed(4)),
    el("span", { class: `ticker-change ${dirClass}` }, `${ARROW[item.direction]}${changeText ? ` ${changeText}` : ""}`),
  ]);
}

export async function renderTicker(container) {
  container.innerHTML = "";
  let data;
  try {
    data = await api.getTicker();
  } catch (_) {
    return; // decorative — fail silently
  }

  if (!data.items || data.items.length === 0) {
    container.classList.add("hidden");
    return;
  }
  container.classList.remove("hidden");

  // Render one copy of the items first so we can measure their natural
  // width. Only duplicate if they overflow — if they all fit, there's
  // no need to scroll at all.
  const singleRow = el("div", { class: "ticker-track" }, data.items.map(renderItem));
  container.appendChild(singleRow);

  // Wait one frame so the browser has laid out the elements.
  requestAnimationFrame(() => {
    const contentWidth = singleRow.scrollWidth;
    const containerWidth = container.clientWidth;

    if (contentWidth <= containerWidth) {
      // Everything fits — centre the items and stay still.
      singleRow.classList.add("ticker-static");
      return;
    }

    // Content overflows — duplicate and start the marquee.
    const duplicate = el("div", { class: "ticker-track" }, data.items.map(renderItem));
    container.appendChild(duplicate);
    singleRow.classList.add("ticker-scrolling");
    duplicate.classList.add("ticker-scrolling");

    // Set the scroll duration proportionally to content width so speed
    // is always comfortable regardless of how many pairs there are.
    const duration = Math.max(15, contentWidth / 60); // ~60px/s
    singleRow.style.animationDuration = `${duration}s`;
    duplicate.style.animationDuration = `${duration}s`;
    duplicate.style.animationDelay = `-${duration / 2}s`; // seamless handoff
  });
}
