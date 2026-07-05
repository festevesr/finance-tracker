/**
 * A small, self-contained SVG line chart for the net worth history.
 * No charting library — just enough math to plot points, draw axis
 * labels, and support mouse hover (a vertical guide line + tooltip
 * showing the exact date/value of the nearest point). If you want to
 * change how the chart looks (line color, area fill, number of date
 * labels), it's all in this one file.
 */
import { el, formatMoney, formatDate, positionTooltip } from "./utils.js";

const WIDTH = 760;
const HEIGHT = 220;
const PAD_LEFT = 70;
const PAD_RIGHT = 16;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const step = (max - min) / count;
  const ticks = [];
  for (let i = 0; i <= count; i++) ticks.push(min + step * i);
  return ticks;
}

export function renderNetWorthChart(container, points, currency) {
  const wrap = el("div", { class: "networth-chart-wrap" });
  container.appendChild(wrap);

  if (!points || points.length === 0) {
    wrap.appendChild(emptyState("No history yet — add some transactions and check back here."));
    return;
  }
  if (points.length === 1) {
    wrap.appendChild(
      emptyState(`Just getting started — only one data point so far (${formatMoney(points[0].net_worth, currency)} on ${formatDate(points[0].date)}). Add more transactions over time to see a trend.`)
    );
    return;
  }

  const values = points.map((p) => p.net_worth);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const innerWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const xAt = (i) => PAD_LEFT + (points.length === 1 ? 0 : (i / (points.length - 1)) * innerWidth);
  const yAt = (v) => PAD_TOP + innerHeight - ((v - min) / (max - min)) * innerHeight;

  const svg = svgEl("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "networth-chart-svg", preserveAspectRatio: "none" });

  const yTicks = niceTicks(min, max, 3);
  for (const v of yTicks) {
    svg.appendChild(svgEl("line", { x1: PAD_LEFT, y1: yAt(v).toFixed(1), x2: WIDTH - PAD_RIGHT, y2: yAt(v).toFixed(1), class: "chart-gridline" }));
    const label = svgEl("text", { x: PAD_LEFT - 8, y: yAt(v).toFixed(1), class: "chart-axis-label", "text-anchor": "end", "dominant-baseline": "middle" });
    label.textContent = formatCompact(v);
    svg.appendChild(label);
  }

  if (min < 0 && max > 0) {
    svg.appendChild(svgEl("line", { x1: PAD_LEFT, y1: yAt(0).toFixed(1), x2: WIDTH - PAD_RIGHT, y2: yAt(0).toFixed(1), class: "chart-zero-line" }));
  }

  const areaD =
    `M ${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)} ` +
    points.map((p, i) => `L ${xAt(i).toFixed(1)} ${yAt(p.net_worth).toFixed(1)}`).join(" ") +
    ` L ${xAt(points.length - 1).toFixed(1)} ${yAt(0).toFixed(1)} Z`;
  svg.appendChild(svgEl("path", { d: areaD, class: "chart-area" }));

  const lineD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.net_worth).toFixed(1)}`).join(" ");
  svg.appendChild(svgEl("path", { d: lineD, class: "chart-line" }));

  for (const i of pickXLabelIndices(points.length)) {
    const label = svgEl("text", { x: xAt(i).toFixed(1), y: HEIGHT - 8, class: "chart-axis-label", "text-anchor": "middle" });
    label.textContent = formatDate(points[i].date);
    svg.appendChild(label);
  }

  const dots = points.map((p, i) => {
    const dot = svgEl("circle", { cx: xAt(i).toFixed(1), cy: yAt(p.net_worth).toFixed(1), r: 2.5, class: "chart-dot" });
    svg.appendChild(dot);
    return dot;
  });

  // Vertical guide line, hidden until hover.
  const guideLine = svgEl("line", { x1: 0, y1: PAD_TOP, x2: 0, y2: HEIGHT - PAD_BOTTOM, class: "chart-guide-line hidden" });
  svg.appendChild(guideLine);

  // Transparent capture rect spanning the plot area — easier to
  // hover precisely than the thin line itself.
  const captureRect = svgEl("rect", { x: PAD_LEFT, y: PAD_TOP, width: innerWidth, height: innerHeight, class: "chart-capture-rect" });
  svg.appendChild(captureRect);

  const tooltip = el("div", { class: "chart-tooltip hidden" });
  wrap.appendChild(svg);
  wrap.appendChild(tooltip);

  let lastIndex = -1;

  function handleMove(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const userX = ((clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(xAt(i) - userX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    }

    if (nearest !== lastIndex) {
      if (lastIndex >= 0) dots[lastIndex].classList.remove("is-hovered");
      dots[nearest].classList.add("is-hovered");
      lastIndex = nearest;
    }

    guideLine.setAttribute("x1", xAt(nearest).toFixed(1));
    guideLine.setAttribute("x2", xAt(nearest).toFixed(1));
    guideLine.classList.remove("hidden");

    const point = points[nearest];
    tooltip.innerHTML = "";
    tooltip.appendChild(el("div", { class: "chart-tooltip-title" }, formatDate(point.date)));
    tooltip.appendChild(el("div", { class: "chart-tooltip-row" }, formatMoney(point.net_worth, currency)));
    if (point.incomplete) tooltip.appendChild(el("div", { class: "chart-tooltip-note" }, "Some rates missing"));
    tooltip.classList.remove("hidden");

    // Position relative to the actual rendered dot, in screen pixels.
    const pixelX = rect.left + (xAt(nearest) / WIDTH) * rect.width;
    const pixelY = rect.top + (yAt(point.net_worth) / HEIGHT) * rect.height;
    positionTooltip(tooltip, wrap, pixelX, pixelY);
  }

  svg.addEventListener("mousemove", (e) => handleMove(e.clientX, e.clientY));
  svg.addEventListener("mouseleave", () => {
    guideLine.classList.add("hidden");
    tooltip.classList.add("hidden");
    if (lastIndex >= 0) dots[lastIndex].classList.remove("is-hovered");
    lastIndex = -1;
  });

  const hasIncomplete = points.some((p) => p.incomplete);
  if (hasIncomplete) {
    wrap.appendChild(emptyState("Some points use balances that couldn't be fully converted (missing exchange rate) — treat the trend as approximate.", true));
  }
}

function pickXLabelIndices(count) {
  if (count <= 5) return Array.from({ length: count }, (_, i) => i);
  const indices = new Set([0, count - 1]);
  indices.add(Math.floor((count - 1) / 2));
  indices.add(Math.floor((count - 1) / 4));
  indices.add(Math.floor(((count - 1) * 3) / 4));
  return Array.from(indices).sort((a, b) => a - b);
}

function formatCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return (value / 1_000_000).toFixed(1) + "M";
  if (abs >= 1_000) return (value / 1_000).toFixed(1) + "k";
  return value.toFixed(0);
}

function emptyState(text, small = false) {
  const div = document.createElement("div");
  div.className = small ? "chart-note" : "empty-state";
  div.textContent = text;
  return div;
}
