/**
 * Everything about transactions: the add/edit transaction dialog (also
 * reused for "duplicate" and "use template"), the transactions table,
 * and the row of quick-entry template chips on the product page.
 */
import * as api from "./api.js";
import { el, formatMoney, formatDate, localISODate, LINKED_PRODUCT_TYPES } from "./utils.js";
import { attachCurrencySelect } from "./currency-select.js";
import { COMMON_CATEGORIES } from "./categories.js";
import { openTransferDialog } from "./transfer-dialog.js";

const dialog = document.getElementById("transaction-dialog");
const form = document.getElementById("transaction-form");
const titleEl = document.getElementById("transaction-dialog-title");
const productIdInput = document.getElementById("transaction-product-id-input");
const dateInput = document.getElementById("transaction-date-input");
const nameInput = document.getElementById("transaction-name-input");
const descInput = document.getElementById("transaction-description-input");
const categoryInput = document.getElementById("transaction-category-input");
const categorySuggestions = document.getElementById("category-suggestions");
const directionInput = document.getElementById("transaction-direction-input");
const amountInput = document.getElementById("transaction-amount-input");
const currencyInput = document.getElementById("transaction-currency-input");
const rateGroup = document.getElementById("transaction-rate-field-group");
const rateInput = document.getElementById("transaction-rate-input");
const rateHint = document.getElementById("transaction-rate-hint");
const deleteBtn = document.getElementById("transaction-delete-btn");
const saveTemplateBtn = document.getElementById("transaction-save-template-btn");
const cancelBtn = document.getElementById("transaction-cancel-btn");

let callbacks = { onSaved: () => {}, onDeleted: () => {} };
let currentProductCurrency = "USD";
let editingTransaction = null; // null while adding/duplicating/using a template

export function initTransactionDialog(cb) {
  callbacks = cb;
  attachCurrencySelect(currencyInput);

  categorySuggestions.innerHTML = "";
  for (const category of COMMON_CATEGORIES) {
    categorySuggestions.appendChild(el("option", { value: category }));
  }

  cancelBtn.addEventListener("click", () => dialog.close());
  currencyInput.addEventListener("input", updateRateVisibility);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveTransaction();
  });

  deleteBtn.addEventListener("click", async () => {
    if (!editingTransaction) return;
    if (!confirm("Delete this transaction?")) return;
    try {
      const productId = editingTransaction.product_id;
      await api.deleteTransaction(editingTransaction.id);
      dialog.close();
      callbacks.onDeleted(productId);
    } catch (err) {
      alert(err.message);
    }
  });

  saveTemplateBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const amount = parseFloat(amountInput.value);
    if (!name || Number.isNaN(amount)) {
      alert("Fill in at least a name and amount before saving as a template.");
      return;
    }
    const currency = currencyInput.value.trim().toUpperCase();
    const payload = {
      name,
      description: descInput.value.trim() || null,
      category: categoryInput.value.trim() || null,
      direction: directionInput.value,
      amount,
      currency,
      exchange_rate: currency !== currentProductCurrency ? parseFloat(rateInput.value) || null : null,
    };
    try {
      await api.createTemplate(Number(productIdInput.value), payload);
      const original = saveTemplateBtn.textContent;
      saveTemplateBtn.textContent = "✓ Saved as template";
      saveTemplateBtn.disabled = true;
      setTimeout(() => {
        saveTemplateBtn.textContent = original;
        saveTemplateBtn.disabled = false;
      }, 1500);
    } catch (err) {
      alert(err.message);
    }
  });
}

function updateRateVisibility() {
  const txCurrency = currencyInput.value.trim().toUpperCase();
  const same = txCurrency === currentProductCurrency;
  rateGroup.classList.toggle("hidden", same);
  rateInput.required = !same;
  rateHint.textContent = same ? "" : `(1 ${txCurrency || "?"} = how many ${currentProductCurrency}?)`;
}

function populateDialog(product, ownerCurrency, editingTx, values) {
  editingTransaction = editingTx;
  titleEl.textContent = editingTx ? "Edit transaction" : "Add transaction";
  deleteBtn.classList.toggle("hidden", !editingTx);
  currentProductCurrency = ownerCurrency;
  productIdInput.value = product.id;
  dateInput.value = values.date;
  nameInput.value = values.name;
  descInput.value = values.description ?? "";
  categoryInput.value = values.category ?? "";
  directionInput.value = values.direction;
  amountInput.value = values.amount;
  currencyInput.value = values.currency;
  rateInput.value = values.exchange_rate ?? "";
  updateRateVisibility();
  dialog.showModal();
}

export function openAddTransactionDialog(product, ownerCurrency) {
  populateDialog(product, ownerCurrency, null, {
    date: localISODate(),
    name: "",
    description: "",
    category: "",
    direction: "outflow",
    amount: "",
    currency: ownerCurrency,
    exchange_rate: "",
  });
}

export function openEditTransactionDialog(product, ownerCurrency, transaction) {
  populateDialog(product, ownerCurrency, transaction, { ...transaction });
}

// Shared by "Duplicate" (source = an existing transaction) and "use
// template" (source = a saved template) — both just pre-fill a brand
// new transaction dated today from some earlier set of values.
export function openQuickAddDialog(product, ownerCurrency, source) {
  populateDialog(product, ownerCurrency, null, {
    date: localISODate(),
    name: source.name,
    description: source.description ?? "",
    category: source.category ?? "",
    direction: source.direction,
    amount: source.amount,
    currency: source.currency,
    exchange_rate: source.exchange_rate ?? "",
  });
}

async function saveTransaction() {
  const productId = Number(productIdInput.value);
  const currency = currencyInput.value.trim().toUpperCase();
  const payload = {
    date: dateInput.value,
    name: nameInput.value.trim(),
    description: descInput.value.trim() || null,
    category: categoryInput.value.trim() || null,
    direction: directionInput.value,
    amount: parseFloat(amountInput.value),
    currency,
  };
  if (currency !== currentProductCurrency) {
    if (!rateInput.value) {
      alert(`Please enter the exchange rate from ${currency} to ${currentProductCurrency}.`);
      return;
    }
    payload.exchange_rate = parseFloat(rateInput.value);
  } else {
    payload.exchange_rate = null;
  }
  try {
    if (editingTransaction) {
      await api.updateTransaction(editingTransaction.id, payload);
    } else {
      await api.createTransaction(productId, payload);
    }
    dialog.close();
    callbacks.onSaved(productId);
  } catch (err) {
    alert(err.message);
  }
}

function renderTemplateChips(container, product, ownerCurrency, templates, navigate) {
  if (templates.length === 0) return;
  container.appendChild(
    el(
      "div",
      { class: "template-chips" },
      templates.map((t) =>
        el("div", { class: "template-chip" }, [
          el(
            "button",
            {
              type: "button",
              class: "template-chip-use",
              title: "Use this template (you'll get a chance to review before saving)",
              onclick: () => openQuickAddDialog(product, ownerCurrency, t),
            },
            `🔁 ${t.name} · ${formatMoney(t.amount, t.currency)}`
          ),
          el(
            "button",
            {
              type: "button",
              class: "template-chip-remove",
              title: "Remove template",
              onclick: async (e) => {
                e.stopPropagation();
                if (!confirm(`Remove the "${t.name}" template?`)) return;
                await api.deleteTemplate(t.id);
                navigate("product", { productId: product.id });
              },
            },
            "×"
          ),
        ])
      )
    )
  );
}

export async function renderTransactionsSection(container, product, navigate) {
  // For a debit card or additional credit card, transactions are
  // recorded against the card but converted into the linked product's
  // currency on the backend.
  const ownerCurrency =
    LINKED_PRODUCT_TYPES.has(product.type) && product.linked_product_id
      ? (await api.getProduct(product.linked_product_id)).currency
      : product.currency;

  const section = el("div", {});
  section.appendChild(
    el("div", { class: "section-heading" }, [
      el("h3", {}, "Transactions"),
      el("div", { class: "section-heading-actions" }, [
        el(
          "button",
          { class: "btn btn-ghost btn-small", type: "button", onclick: () => openTransferDialog(product.id) },
          "⇄ Transfer"
        ),
        el(
          "button",
          { class: "btn btn-primary btn-small", type: "button", onclick: () => openAddTransactionDialog(product, ownerCurrency) },
          "+ Add transaction"
        ),
      ]),
    ])
  );

  const templates = await api.getTemplates(product.id);
  renderTemplateChips(section, product, ownerCurrency, templates, navigate);

  const transactions = await api.getTransactions(product.id);
  if (transactions.length === 0) {
    section.appendChild(el("div", { class: "empty-state" }, "No transactions yet. Add your first one above."));
    container.appendChild(section);
    return;
  }

  const table = el("table", { class: "ledger-table" });
  table.appendChild(
    el(
      "thead",
      {},
      el("tr", {}, [
        el("th", {}, "Date"),
        el("th", {}, "Name"),
        el("th", {}, "Category"),
        el("th", { class: "num" }, "Amount"),
        el("th", {}, ""),
      ])
    )
  );
  const tbody = el("tbody");
  for (const tx of transactions) {
    const sign = tx.direction === "inflow" ? "+" : "-";
    const amountClass = tx.direction === "inflow" ? "positive" : "negative";
    // Always show the amount in the product's own currency (converted_amount).
    // When the transaction was in a different currency, show the exchange
    // rate as a small note so you can always see the original figure too.
    const primaryAmount = `${sign}${formatMoney(tx.converted_amount, ownerCurrency)}`;
    const rateNote = (tx.currency !== ownerCurrency && tx.exchange_rate != null)
      ? el("div", { class: "field-hint" }, `${tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${tx.currency} @ ${tx.exchange_rate}`)
      : null;

    const categoryCell = tx.is_transfer
      ? el("span", { class: "tag tag-transfer", title: "Money moved between two of your own products — not counted as spending or income" }, "⇄ Transfer")
      : tx.is_settlement
        ? el("span", { class: "tag tag-settlement", title: "Billing cycle closed — additional card display reset to zero" }, "✓ Cycle settled")
        : tx.category
          ? el("span", { class: "tag" }, tx.category)
          : "—";

    const rowActions = [];
    if (!tx.is_transfer && !tx.is_settlement) {
      rowActions.push(
        el(
          "button",
          {
            class: "btn btn-ghost btn-small",
            type: "button",
            title: "Duplicate as a new transaction dated today",
            onclick: (e) => {
              e.stopPropagation();
              openQuickAddDialog(product, ownerCurrency, tx);
            },
          },
          "Duplicate"
        )
      );
    }
    rowActions.push(
      el(
        "button",
        {
          class: "btn btn-ghost btn-small",
          type: "button",
          onclick: async (e) => {
            e.stopPropagation();
            const confirmMsg = tx.is_transfer
              ? "Delete this transfer? Both sides (the outflow and the matching inflow) will be removed."
              : tx.is_settlement
                ? "Delete this settlement marker? The additional card's display balance will go back to its pre-settlement value."
                : "Delete this transaction?";
            if (!confirm(confirmMsg)) return;
            await api.deleteTransaction(tx.id);
            navigate("product", { productId: product.id });
          },
        },
        "Delete"
      )
    );

    const isSpecialRow = tx.is_transfer || tx.is_settlement;
    const rowAttrs = { class: isSpecialRow ? "is-transfer-row" : "" };
    if (!isSpecialRow) rowAttrs.onclick = () => openEditTransactionDialog(product, ownerCurrency, tx);

    tbody.appendChild(
      el("tr", rowAttrs, [
        el("td", {}, formatDate(tx.date)),
        el("td", {}, [tx.name, tx.description ? el("div", { class: "field-hint" }, tx.description) : null]),
        el("td", {}, categoryCell),
        el("td", { class: `amount ${amountClass}` }, [primaryAmount, rateNote].filter(Boolean)),
        el("td", {}, el("div", { class: "row-actions" }, rowActions)),
      ])
    );
  }
  table.appendChild(tbody);
  section.appendChild(table);
  container.appendChild(section);
}
