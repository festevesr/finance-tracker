/**
 * A small donut chart + legend for the spending-by-category breakdown.
 * The SVG slices are built from pure numbers/colors (safe as an HTML
 * string), but the legend is built with the `el()` DOM helper instead
 * of string interpolation, since category names are free text typed
 * by the user — never trust user text into innerHTML.
 */
import { el, formatMoney, positionTooltip } from "./utils.js";

const PALETTE = ["#4DA3FF", "#5BC8AF", "#9B8CFF", "#F2B84B", "#E2735A", "#6FD1E0", "#C77DFF", "#8FA8C8", "#7FE0A0", "#FF9F6B"];

const SIZE = 180;
const CENTER = SIZE / 2;
const OUTER_R = 78;
const INNER_R = 46;

function polarToCartesian(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + OUTER_R * Math.cos(rad), y: CENTER + OUTER_R * Math.sin(rad) };
}

function polarToCartesianInner(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + INNER_R * Math.cos(rad), y: CENTER + INNER_R * Math.sin(rad) };
}

function donutSlicePath(startAngle, endAngle) {
  // Avoid a degenerate arc when a single category is ~100% of the total.
  if (endAngle - startAngle >= 359.99) endAngle = startAngle + 359.99;
  const startOuter = polarToCartesian(startAngle);
  const endOuter = polarToCartesian(endAngle);
  const startInner = polarToCartesianInner(endAngle);
  const endInner = polarToCartesianInner(startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${startOuter.x.toFixed(2)} ${startOuter.y.toFixed(2)}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${endOuter.x.toFixed(2)} ${endOuter.y.toFixed(2)}`,
    `L ${startInner.x.toFixed(2)} ${startInner.y.toFixed(2)}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${endInner.x.toFixed(2)} ${endInner.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function renderCategoryChart(container, items, currency) {
  const wrap = el("div", { class: "category-chart-wrap" });
  container.appendChild(wrap);

  const filteredItems = (items || []).filter((i) => Math.abs(i.amount) > 0.001);
  if (filteredItems.length === 0) {
    wrap.appendChild(el("div", { class: "empty-state" }, "No transactions recorded in this range."));
    return;
  }

  const totalAbs = filteredItems.reduce((sum, i) => sum + Math.abs(i.amount), 0);

  let cumulativeAngle = -90; // start at the top
  const slices = filteredItems.map((item, i) => {
    const fraction = Math.abs(item.amount) / totalAbs;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + fraction * 360;
    cumulativeAngle = endAngle;
    // In net mode, negative amounts (net outflow categories) get a muted color.
    const baseColor = PALETTE[i % PALETTE.length];
    return { ...item, startAngle, endAngle, fraction, color: baseColor };
  });

  const tooltip = el("div", { class: "chart-tooltip hidden" });

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute("class", "category-chart-svg");
  const sliceElements = [];
  for (const s of slices) {
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", donutSlicePath(s.startAngle, s.endAngle));
    path.setAttribute("fill", s.color);
    path.setAttribute("class", "category-slice");
    path.addEventListener("mouseenter", () => {
      path.classList.add("is-hovered");
      tooltip.innerHTML = "";
      tooltip.appendChild(el("div", { class: "chart-tooltip-title" }, s.category));
      const signedAmt = (s.amount < 0 ? "-" : "+") + formatMoney(Math.abs(s.amount), currency);
      const pctLabel = `${(s.fraction * 100).toFixed(1)}%`;
      tooltip.appendChild(el("div", { class: "chart-tooltip-row" }, `${signedAmt} · ${pctLabel}`));
      tooltip.classList.remove("hidden");
    });
    path.addEventListener("mousemove", (e) => positionTooltip(tooltip, wrap, e.clientX, e.clientY));
    path.addEventListener("mouseleave", () => {
      path.classList.remove("is-hovered");
      tooltip.classList.add("hidden");
    });
    svg.appendChild(path);
    sliceElements.push(path);
  }

  const legend = el(
    "div",
    { class: "category-legend" },
    slices.map((s, i) => {
      const amountLabel = s.amount < 0
        ? "-" + formatMoney(Math.abs(s.amount), currency)
        : formatMoney(s.amount, currency);
      const amountClass = s.amount < 0 ? "category-legend-amount negative" : "category-legend-amount";
      return el(
        "div",
        {
          class: "category-legend-item",
          onmouseenter: () => sliceElements[i].classList.add("is-hovered"),
          onmouseleave: () => sliceElements[i].classList.remove("is-hovered"),
        },
        [
          el("span", { class: "category-legend-swatch", style: `background:${s.color}` }),
          el("span", { class: "category-legend-label" }, s.category),
          el("span", { class: amountClass }, amountLabel),
          el("span", { class: "category-legend-pct" }, `${(s.fraction * 100).toFixed(0)}%`),
        ]
      );
    })
  );

  const row = el("div", { class: "category-chart-row" }, [svg, legend]);
  wrap.appendChild(row);
  wrap.appendChild(tooltip);
}
