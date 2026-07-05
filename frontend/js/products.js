/**
 * Everything about managing a single product: the add/edit/delete dialog,
 * and the full-page product detail view (balance + meta + transactions).
 */
import * as api from "./api.js";
import { el, productLabel, formatMoney, PRODUCT_TYPES, LIABILITY_TYPES, LINKED_PRODUCT_TYPES } from "./utils.js";
import { attachCurrencySelect } from "./currency-select.js";
import { renderTransactionsSection } from "./transactions.js";

const dialog = document.getElementById("product-dialog");
const form = document.getElementById("product-form");
const titleEl = document.getElementById("product-dialog-title");
const idInput = document.getElementById("product-id-input");
const bankIdInput = document.getElementById("product-bank-id-input");
const typeInput = document.getElementById("product-type-input");
const nicknameInput = document.getElementById("product-nickname-input");
const currencyGroup = document.getElementById("currency-field-group");
const currencyInput = document.getElementById("product-currency-input");
const balanceGroup = document.getElementById("balance-field-group");
const balanceInput = document.getElementById("product-balance-input");
const accountNumberGroup = document.getElementById("account-number-field-group");
const accountNumberInput = document.getElementById("product-account-number-input");
const expiryGroup = document.getElementById("expiry-field-group");
const expiryInput = document.getElementById("product-expiry-input");
const creditLineGroup = document.getElementById("credit-line-field-group");
const creditLineLabelText = document.getElementById("credit-line-label-text");
const creditLineInput = document.getElementById("product-credit-line-input");
const interestRateGroup = document.getElementById("interest-rate-field-group");
const interestRateInput = document.getElementById("product-interest-rate-input");
const linkedGroup = document.getElementById("linked-product-field-group");
const linkedLabelText = document.getElementById("linked-field-label-text");
const linkedHint = document.getElementById("linked-field-hint");
const linkedSelect = document.getElementById("product-linked-select");
const deleteBtn = document.getElementById("product-delete-btn");
const cancelBtn = document.getElementById("product-cancel-btn");

let callbacks = { onSaved: () => {}, onDeleted: () => {} };
let editingProduct = null; // null while adding
let availableLinkTargets = [];

export function initProductDialog(cb) {
  callbacks = cb;

  typeInput.innerHTML = "";
  for (const [value, meta] of Object.entries(PRODUCT_TYPES)) {
    typeInput.appendChild(el("option", { value }, meta.label));
  }

  attachCurrencySelect(currencyInput);

  typeInput.addEventListener("change", async () => {
    updateFieldVisibility();
    const meta = PRODUCT_TYPES[typeInput.value] ?? {};
    if (meta.needsLink) {
      await populateLinkedSelect(Number(bankIdInput.value), meta.linkType, null, editingProduct?.id ?? null);
    }
  });

  cancelBtn.addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveProduct();
  });

  deleteBtn.addEventListener("click", async () => {
    if (!editingProduct) return;
    if (!confirm(`Delete "${editingProduct.nickname}"? This cannot be undone.`)) return;
    try {
      await api.deleteProduct(editingProduct.id);
      dialog.close();
      callbacks.onDeleted(editingProduct.bank_id);
    } catch (err) {
      alert(err.message);
    }
  });
}

function updateFieldVisibility() {
  const meta = PRODUCT_TYPES[typeInput.value] ?? {};
  const showCurrency = meta.hasCurrencyInput !== false;
  currencyGroup.classList.toggle("hidden", !showCurrency);
  currencyInput.required = showCurrency; // a hidden-but-required field silently blocks submission
  balanceGroup.classList.toggle("hidden", !meta.hasBalance);
  accountNumberGroup.classList.toggle("hidden", !meta.hasAccountNumber);
  expiryGroup.classList.toggle("hidden", !meta.hasExpiry);
  creditLineGroup.classList.toggle("hidden", !meta.hasCreditLine);
  if (meta.hasCreditLine) creditLineLabelText.textContent = meta.creditLineLabel ?? "Credit line";
  interestRateGroup.classList.toggle("hidden", !meta.hasInterestRate);
  linkedGroup.classList.toggle("hidden", !meta.needsLink);
  if (meta.needsLink) {
    linkedLabelText.textContent = meta.linkLabel ?? "Linked product";
    linkedHint.textContent = meta.linkHint ?? "";
  }
}

async function populateLinkedSelect(bankId, requiredType, selectedId, excludeProductId = null) {
  linkedSelect.innerHTML = "";
  const products = await api.getProducts(bankId);
  availableLinkTargets = products.filter((p) => p.type === requiredType && p.id !== excludeProductId);
  if (availableLinkTargets.length === 0) {
    linkedSelect.appendChild(el("option", { value: "" }, `No ${productLabel(requiredType).toLowerCase()} in this bank yet`));
    return;
  }
  for (const target of availableLinkTargets) {
    const opt = el("option", { value: target.id }, `${target.nickname} (${target.currency})`);
    if (String(target.id) === String(selectedId)) opt.selected = true;
    linkedSelect.appendChild(opt);
  }
}

export async function openAddProductDialog(bankId) {
  editingProduct = null;
  titleEl.textContent = "Add product";
  deleteBtn.classList.add("hidden");
  idInput.value = "";
  bankIdInput.value = bankId;
  typeInput.value = "savings_account";
  typeInput.disabled = false;
  nicknameInput.value = "";
  currencyInput.value = "";
  balanceInput.value = "0";
  accountNumberInput.value = "";
  expiryInput.value = "";
  creditLineInput.value = "";
  interestRateInput.value = "";
  const meta = PRODUCT_TYPES[typeInput.value] ?? {};
  if (meta.needsLink) await populateLinkedSelect(bankId, meta.linkType, null);
  updateFieldVisibility();
  dialog.showModal();
}

export async function openEditProductDialog(product) {
  editingProduct = product;
  titleEl.textContent = "Edit product";
  deleteBtn.classList.remove("hidden");
  idInput.value = product.id;
  bankIdInput.value = product.bank_id;
  typeInput.value = product.type;
  typeInput.disabled = true; // type can't change after creation, keeps the data model simple
  nicknameInput.value = product.nickname;
  currencyInput.value = product.currency;
  balanceInput.value = product.balance ?? 0;
  accountNumberInput.value = product.account_number ?? "";
  expiryInput.value = product.expiry_date ? product.expiry_date.slice(0, 7) : "";
  creditLineInput.value = product.credit_line ?? "";
  interestRateInput.value = product.interest_rate ?? "";
  const meta = PRODUCT_TYPES[product.type] ?? {};
  if (meta.needsLink) await populateLinkedSelect(product.bank_id, meta.linkType, product.linked_product_id, product.id);
  updateFieldVisibility();
  dialog.showModal();
}

async function saveProduct() {
  const type = typeInput.value;
  const meta = PRODUCT_TYPES[type] ?? {};

  const payload = {
    nickname: nicknameInput.value.trim(),
  };

  if (meta.hasCurrencyInput === false) {
    if (!linkedSelect.value) {
      alert(`Please select (or first create) a ${productLabel(meta.linkType).toLowerCase()} to link this to.`);
      return;
    }
    const linked = availableLinkTargets.find((a) => String(a.id) === linkedSelect.value);
    payload.currency = linked ? linked.currency : "USD";
  } else {
    payload.currency = currencyInput.value.trim().toUpperCase();
  }

  if (meta.hasBalance) payload.balance = parseFloat(balanceInput.value || "0");
  if (meta.hasAccountNumber) payload.account_number = accountNumberInput.value.trim() || null;
  if (meta.hasExpiry) payload.expiry_date = expiryInput.value ? `${expiryInput.value}-01` : null;
  if (meta.hasCreditLine) payload.credit_line = creditLineInput.value.trim() === "" ? null : parseFloat(creditLineInput.value);
  if (meta.hasInterestRate) payload.interest_rate = interestRateInput.value.trim() === "" ? null : parseFloat(interestRateInput.value);
  if (meta.needsLink) payload.linked_product_id = Number(linkedSelect.value);

  try {
    if (editingProduct) {
      const updated = await api.updateProduct(editingProduct.id, payload);
      dialog.close();
      callbacks.onSaved(updated.bank_id);
    } else {
      payload.bank_id = Number(bankIdInput.value);
      payload.type = type;
      const created = await api.createProduct(payload);
      dialog.close();
      callbacks.onSaved(created.bank_id);
    }
  } catch (err) {
    alert(err.message);
  }
}

function buildMetaItems(product, linkedProduct, childCards) {
  const items = [];
  if (product.account_number) {
    items.push(el("div", {}, [document.createTextNode("Account number"), el("strong", {}, product.account_number)]));
  }
  if (product.expiry_date) {
    const [y, m] = product.expiry_date.split("-");
    items.push(el("div", {}, [document.createTextNode("Expires"), el("strong", {}, `${m}/${y}`)]));
  }
  if (product.interest_rate != null) {
    items.push(el("div", {}, [document.createTextNode("Interest rate"), el("strong", {}, `${product.interest_rate}% / year`)]));
  }
  if (product.type === "credit_card" && product.credit_line != null) {
    items.push(el("div", {}, [document.createTextNode("Credit line"), el("strong", {}, formatMoney(product.credit_line, product.currency))]));
  }
  if (product.type === "additional_credit_card" && product.credit_line != null) {
    items.push(el("div", {}, [document.createTextNode("Assigned credit limit"), el("strong", {}, formatMoney(product.credit_line, product.currency))]));
  }
  if (product.type === "additional_credit_card" && product.shared_balance != null) {
    items.push(
      el("div", {}, [
        document.createTextNode("Total owed (this card + primary, combined)"),
        el("strong", {}, formatMoney(product.shared_balance, product.currency)),
      ])
    );
  }
  if (linkedProduct) {
    const label = product.type === "additional_credit_card" ? "Primary card" : "Linked account";
    items.push(
      el("div", {}, [
        document.createTextNode(label),
        el("strong", {}, `${linkedProduct.nickname} (${linkedProduct.currency})`),
      ])
    );
  }
  if (childCards && childCards.length > 0) {
    items.push(
      el("div", {}, [
        document.createTextNode("Additional cards"),
        el("strong", {}, childCards.map((c) => c.nickname).join(", ")),
      ])
    );
  }
  return items;
}

export async function renderProductView(container, productId, navigate) {
  const product = await api.getProduct(productId);
  const banks = await api.getBanks();
  const bank = banks.find((b) => b.id === product.bank_id);

  let linkedProduct = null;
  if (LINKED_PRODUCT_TYPES.has(product.type) && product.linked_product_id) {
    linkedProduct = await api.getProduct(product.linked_product_id);
  }

  let childCards = [];
  if (product.type === "credit_card") {
    childCards = await api.getProducts(undefined, product.id);
  }

  const header = el("div", { class: "page-header" }, [
    el("div", {}, [
      el(
        "div",
        { class: "breadcrumb" },
        el("button", { type: "button", onclick: () => navigate("bank", { bankId: product.bank_id }) }, bank ? bank.name : "Bank")
      ),
      el("h2", { class: "page-title" }, product.nickname),
    ]),
    el("div", { class: "page-header-actions" }, [
      ...(product.type === "credit_card" && childCards.length > 0 ? [
        el("button", {
          class: "btn btn-ghost",
          type: "button",
          title: "After paying this card from savings, use this to reset the additional cards' own balances to zero for the new billing cycle.",
          onclick: async () => {
            if (!confirm("Settle billing cycle?\n\nThis will zero out each additional card's own balance display, marking the cycle as closed.\n\nMake sure you've already recorded the actual payment from your savings account first.")) return;
            try {
              const result = await api.settleCreditCardCycle(product.id);
              if (result.total_settled > 0) {
                alert(`Billing cycle settled. Reset ${result.settled_transactions.length} additional card(s), total ${result.total_settled} ${result.currency}.`);
              } else {
                alert("Nothing to settle — all additional cards already show zero.");
              }
              navigate("product", { productId: product.id });
            } catch (err) {
              alert(err.message);
            }
          },
        }, "Settle billing cycle"),
      ] : []),
      el("button", { class: "btn btn-ghost", type: "button", onclick: () => openEditProductDialog(product) }, "Edit"),
    ]),
  ]);
  container.appendChild(header);

  const isLiability = LIABILITY_TYPES.has(product.type) || product.type === "additional_credit_card";
  const balanceLabel =
    product.type === "additional_credit_card"
      ? "Charged on this card only. Payments only reduce this number if recorded against this card too — see \"Total owed\" below for the real combined balance."
      : null;

  const detailChildren = [
    el("span", { class: "tag" }, productLabel(product.type)),
  ];
  if (balanceLabel) detailChildren.push(el("div", { class: "field-hint" }, balanceLabel));
  detailChildren.push(
    el(
      "div",
      { class: "detail-balance", style: `color: var(${isLiability ? "--liability" : "--accent"})` },
      formatMoney(product.display_balance, product.currency)
    )
  );
  detailChildren.push(el("div", { class: "detail-meta" }, buildMetaItems(product, linkedProduct, childCards)));

  container.appendChild(el("div", { class: "detail-card" }, detailChildren));

  await renderTransactionsSection(container, product, navigate);
}
