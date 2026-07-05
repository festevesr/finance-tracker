/**
 * Everything about banks: the sidebar list (with an expandable product
 * tree under each bank), the add/edit/delete dialog, and the bank detail
 * page (grid of that bank's products).
 */
import * as api from "./api.js";
import { el, productLabel, formatMoney, formatSignedAmount, LIABILITY_TYPES } from "./utils.js";
import { openAddProductDialog } from "./products.js";

const dialog = document.getElementById("bank-dialog");
const form = document.getElementById("bank-form");
const titleEl = document.getElementById("bank-dialog-title");
const idInput = document.getElementById("bank-id-input");
const nameInput = document.getElementById("bank-name-input");
const deleteBtn = document.getElementById("bank-delete-btn");
const cancelBtn = document.getElementById("bank-cancel-btn");

const bankListEl = document.getElementById("bank-list");

let callbacks = { onSaved: () => {}, onDeleted: () => {} };
let editingBank = null;

function isLiabilityLike(type) {
  return LIABILITY_TYPES.has(type) || type === "additional_credit_card";
}

let selectedBankCurrency = "USD";

export function initBankDialog(cb) {
  callbacks = cb;
  cancelBtn.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      if (editingBank) {
        await api.updateBank(editingBank.id, name);
      } else {
        await api.createBank(name);
      }
      dialog.close();
      callbacks.onSaved();
    } catch (err) {
      alert(err.message);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (!editingBank) return;
    if (!confirm(`Delete "${editingBank.name}" and all its products and transactions? This cannot be undone.`)) return;
    try {
      await api.deleteBank(editingBank.id);
      dialog.close();
      callbacks.onDeleted();
    } catch (err) {
      alert(err.message);
    }
  });
}

export function openAddBankDialog() {
  editingBank = null;
  titleEl.textContent = "Add bank";
  deleteBtn.classList.add("hidden");
  idInput.value = "";
  nameInput.value = "";
  dialog.showModal();
}

export function openEditBankDialog(bank) {
  editingBank = bank;
  titleEl.textContent = "Edit bank";
  deleteBtn.classList.remove("hidden");
  idInput.value = bank.id;
  nameInput.value = bank.name;
  dialog.showModal();
}

async function toggleBankTree(toggleBtn, productsEl, bankId, navigate) {
  const isExpanded = !productsEl.classList.contains("hidden");
  if (isExpanded) {
    productsEl.classList.add("hidden");
    toggleBtn.textContent = "+";
    return;
  }

  toggleBtn.textContent = "−";
  productsEl.innerHTML = "";
  productsEl.classList.remove("hidden");

  const products = await api.getProducts(bankId);
  if (products.length === 0) {
    productsEl.appendChild(el("li", { class: "bank-products-empty" }, "No products yet"));
    return;
  }
  for (const p of products) {
    productsEl.appendChild(
      el(
        "li",
        {
          class: `bank-product-item ${isLiabilityLike(p.type) ? "liability" : ""}`,
          onclick: (e) => {
            e.stopPropagation();
            navigate("product", { productId: p.id });
          },
        },
        [el("span", { class: "product-type-dot" }), document.createTextNode(p.nickname)]
      )
    );
  }
}

export async function refreshSidebar(navigate) {
  const banks = await api.getBanks();
  bankListEl.innerHTML = "";
  for (const bank of banks) {
    const productsEl = el("ul", { class: "bank-products hidden" });
    const toggleBtn = el(
      "button",
      {
        class: "tree-toggle",
        type: "button",
        title: "Show products",
        onclick: (e) => {
          e.stopPropagation();
          toggleBankTree(toggleBtn, productsEl, bank.id, navigate);
        },
      },
      "+"
    );

    const row = el(
      "div",
      { class: "bank-list-item", "data-bank-id": bank.id, onclick: () => navigate("bank", { bankId: bank.id }) },
      [
        toggleBtn,
        el("span", { class: "bank-name" }, bank.name),
        el(
          "button",
          {
            class: "edit-bank-btn",
            type: "button",
            onclick: (e) => {
              e.stopPropagation();
              openEditBankDialog(bank);
            },
          },
          "edit"
        ),
      ]
    );

    bankListEl.appendChild(el("li", { class: "bank-tree-item" }, [row, productsEl]));
  }
}

export async function renderBankView(container, bankId, navigate) {
  const banks = await api.getBanks();
  const bank = banks.find((b) => b.id === bankId);
  if (!bank) {
    container.appendChild(el("div", { class: "empty-state" }, "Select a bank from the sidebar, or add one to get started."));
    return;
  }

  container.appendChild(
    el("div", { class: "page-header" }, [
      el("h2", { class: "page-title" }, bank.name),
      el("div", {}, [
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => openEditBankDialog(bank) }, "Edit bank"),
        " ",
        el("button", { class: "btn btn-primary", type: "button", onclick: () => openAddProductDialog(bank.id) }, "+ Add product"),
      ]),
    ])
  );

  const products = await api.getProducts(bank.id);
  if (products.length === 0) {
    container.appendChild(
      el("div", { class: "empty-state" }, "No products yet. Add a savings account, card, loan, or investment above.")
    );
    return;
  }

  const totals = await api.getBankTotals(bank.id, selectedBankCurrency);
  selectedBankCurrency = totals.currency; // in case the previous pick is no longer valid

  const currencySelect = el(
    "select",
    {
      class: "currency-picker",
      onchange: async (e) => {
        selectedBankCurrency = e.target.value;
        container.innerHTML = "";
        await renderBankView(container, bankId, navigate);
      },
    },
    totals.available_currencies.map((c) => {
      const opt = el("option", { value: c }, c);
      if (c === selectedBankCurrency) opt.selected = true;
      return opt;
    })
  );

  container.appendChild(
    el("div", { class: "bank-totals-row" }, [
      el("span", { class: "bank-totals-label" }, "Total balance:"),
      el("span", { class: `bank-totals-amount ${totals.net_worth < 0 ? "negative" : ""}` }, formatSignedAmount(totals.net_worth, totals.currency)),
      el("label", { class: "currency-picker-label" }, ["Show in: ", currencySelect]),
    ])
  );

  if (totals.missing_rates.length > 0) {
    container.appendChild(
      el(
        "div",
        { class: "missing-rates-note" },
        `Couldn't fetch a rate for: ${totals.missing_rates.join(", ")} — those balances are excluded from the total above.`
      )
    );
  }

  const grid = el("div", { class: "product-grid" });
  for (const p of products) {
    grid.appendChild(
      el(
        "div",
        { class: `product-card ${isLiabilityLike(p.type) ? "liability" : ""}`, onclick: () => navigate("product", { productId: p.id }) },
        [
          el("div", { class: "nickname" }, p.nickname),
          el("div", { class: "type-tag" }, productLabel(p.type)),
          el("div", { class: "balance" }, formatMoney(p.display_balance, p.currency)),
        ]
      )
    );
  }
  container.appendChild(grid);
}
