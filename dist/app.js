const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const LEGACY_PROFILE_KEY = "ledger-bridge-profile-v1";
const PROFILES_KEY = "ledger-bridge-profiles-v2";
const PROFILE_STORE_VERSION = 5;
const defaultProfile = {
  version: 1,
  name: "Default profile",
  baseCurrency: "EUR",
  inputDateFormat: "DMY",
  dateFormat: "DMY",
  decimalSeparator: ",",
  accountMappings: {},
  categoryMappings: {},
  transfers: {},
  payeeRules: [],
  catalogs: { accounts: [], categories: [], subcategories: [] },
};

const state = {
  sourceFile: null,
  targetFile: null,
  incomeReferenceFile: null,
  incomeReference: null,
  demoCatalog: null,
  rows: [],
  warnings: [],
  sourceKind: "",
  profileStore: loadProfileStore(),
  profile: null,
  overrides: {},
  manualRows: [],
  rates: {},
  converted: [],
  reviewFilter: "all",
  demoProfileBackup: null,
};
state.profile = mergeProfile(state.profileStore.profiles[state.profileStore.activeId]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function profileId() {
  return globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function loadProfileStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILES_KEY));
    if (saved?.activeId && saved.profiles?.[saved.activeId]) {
      const savedVersion = saved.version || 0;
      if (savedVersion < 3) {
        Object.values(saved.profiles).forEach((profile) => {
          profile.catalogs = { accounts: [], categories: [], subcategories: [] };
        });
      }
      if (savedVersion < 4) {
        const demoAccounts = ["Example checking account", "Example credit card"];
        const demoCategories = ["Example spending␟Meal out", "Example spending␟Food shop", "Example transfers␟Savings transfer", "Example spending␟Household bill", "Example spending␟Personal purchase"];
        Object.values(saved.profiles).forEach((profile) => {
          demoAccounts.forEach((key) => { if (profile.accountMappings) delete profile.accountMappings[key]; });
          demoCategories.forEach((key) => { if (profile.categoryMappings) delete profile.categoryMappings[key]; });
          if (profile.transfers) delete profile.transfers["Transfer : Example savings account"];
        });
      }
      if (savedVersion < 5) {
        Object.values(saved.profiles).forEach((profile) => {
          const accounts = new Set((profile.catalogs?.accounts || []).map((value) => String(value).trim().toLowerCase()));
          if (Array.isArray(profile.catalogs?.categories)) {
            profile.catalogs.categories = profile.catalogs.categories.filter((value) => {
              const normalized = String(value).trim().toLowerCase();
              return !accounts.has(normalized) && !/^(modifica saldo|balance adjustment|starting balance)$/.test(normalized);
            });
          }
        });
      }
      if (savedVersion < PROFILE_STORE_VERSION) {
        saved.version = PROFILE_STORE_VERSION;
        localStorage.setItem(PROFILES_KEY, JSON.stringify(saved));
      }
      return saved;
    }
  } catch {}
  let first = clone(defaultProfile);
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PROFILE_KEY));
    if (legacy) first = mergeProfile(legacy);
  } catch {}
  first.catalogs = { accounts: [], categories: [], subcategories: [] };
  const id = profileId();
  const store = { version: PROFILE_STORE_VERSION, activeId: id, profiles: { [id]: first } };
  localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
  return store;
}
function mergeProfile(profile = {}) {
  const catalogs = profile.catalogs && typeof profile.catalogs === "object" ? profile.catalogs : {};
  return {
    ...clone(defaultProfile),
    ...profile,
    accountMappings: profile.accountMappings && typeof profile.accountMappings === "object" && !Array.isArray(profile.accountMappings) ? { ...profile.accountMappings } : {},
    categoryMappings: profile.categoryMappings && typeof profile.categoryMappings === "object" && !Array.isArray(profile.categoryMappings) ? { ...profile.categoryMappings } : {},
    transfers: profile.transfers && typeof profile.transfers === "object" && !Array.isArray(profile.transfers) ? { ...profile.transfers } : {},
    payeeRules: Array.isArray(profile.payeeRules) ? profile.payeeRules : [],
    catalogs: {
      accounts: Array.isArray(catalogs.accounts) ? unique(catalogs.accounts.map(String)) : [],
      categories: Array.isArray(catalogs.categories) ? unique(catalogs.categories.map(String)) : [],
      subcategories: Array.isArray(catalogs.subcategories) ? unique(catalogs.subcategories.map(String)) : [],
    },
  };
}
function saveProfile() {
  if (!state.demoProfileBackup) {
    state.profileStore.profiles[state.profileStore.activeId] = clone(state.profile);
    localStorage.setItem(PROFILES_KEY, JSON.stringify(state.profileStore));
  }
  $("#save-state").textContent = state.demoProfileBackup ? "Example changes are temporary." : "Saved in this browser.";
  clearTimeout(saveProfile.timer);
  saveProfile.timer = setTimeout(() => $("#save-state").textContent = state.demoProfileBackup ? "Example changes are temporary." : "Changes save automatically in this browser.", 1600);
}

function openSettings() {
  syncProfileControls();
  syncSettingsCatalogs();
  $("#settings-dialog").showModal();
}
function syncSettingsCatalogs() {
  $("#settings-catalog-accounts").value = state.profile.catalogs.accounts.join("\n");
  $("#settings-catalog-categories").value = state.profile.catalogs.categories.join("\n");
  $("#settings-catalog-subcategories").value = state.profile.catalogs.subcategories.join("\n");
}
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("is-visible"), 2800);
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}
function unique(values) { return [...new Set(values.filter((value) => String(value ?? "").trim() !== ""))].sort((a, b) => String(a).localeCompare(String(b))); }
function categoryKey(row) { return `${row.categoryGroup || ""}\u241f${row.category || ""}`; }
function splitCategoryKey(key) { const [group, category] = key.split("\u241f"); return { group, category }; }
function setRunState(label, color = "#829ab1") { $("#run-state").innerHTML = `<span style="background:${color}"></span>${escapeHtml(label)}`; }

function parseDelimited(text) {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length ? "\t" : ",";
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const character = clean[index];
    if (character === '"') {
      if (quoted && clean[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(field); field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && clean[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else field += character;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  if (!rows.length) return { headers: [], records: [], delimiter };
  const headers = rows.shift().map((header) => header.trim());
  return {
    headers,
    delimiter,
    records: rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))),
  };
}

function getField(record, aliases) {
  const entries = Object.entries(record);
  for (const alias of aliases) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === alias.toLowerCase());
    if (found) return String(found[1] ?? "");
  }
  return "";
}
function parseAmount(value) {
  let text = String(value ?? "").replace(/\u00a0/g, " ").trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text.replace(/[^0-9,.-]/g, "");
  if (!/[0-9]/.test(text)) return NaN;
  const lastComma = text.lastIndexOf(",");
  const lastPoint = text.lastIndexOf(".");
  if (lastComma > lastPoint) text = text.replace(/\./g, "").replace(",", ".");
  else if (lastPoint > lastComma) text = text.replace(/,/g, "");
  else text = text.replace(",", ".");
  const number = Number(text.replace(/(?!^)-/g, ""));
  if (!Number.isFinite(number)) return NaN;
  return negative ? -Math.abs(number) : number;
}
function parseDate(value, order = state.profile?.inputDateFormat || "DMY") {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  const text = String(value ?? "").trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const strictDate = (year, month, day) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  };
  if (match) return strictDate(+match[1], +match[2], +match[3]);
  match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (!match) return null;
  let first = +match[1], second = +match[2];
  let day = order === "MDY" ? second : first, month = order === "MDY" ? first : second;
  if (first > 12) { day = first; month = second; }
  else if (second > 12) { month = first; day = second; }
  return strictDate(+match[3], month, day);
}
function isoDate(date) { return date ? date.toISOString().slice(0, 10) : ""; }
function formatDate(date) {
  if (!date) return "";
  const y = date.getUTCFullYear(), m = String(date.getUTCMonth() + 1).padStart(2, "0"), d = String(date.getUTCDate()).padStart(2, "0");
  if (state.profile.dateFormat === "MDY") return `${m}/${d}/${y}`;
  if (state.profile.dateFormat === "YMD") return `${y}-${m}-${d}`;
  return `${d}/${m}/${y}`;
}
function formatMoney(value, separator = state.profile.decimalSeparator) {
  const fixed = Number(value).toFixed(2);
  return separator === "," ? fixed.replace(".", ",") : fixed;
}
function sourceCurrencyHint(value) {
  const text = String(value || "").toUpperCase();
  const match = text.match(/\b(EUR|USD|GBP|SEK|NOK|DKK|CHF|JPY|CAD|AUD)\b/);
  if (match) return match[1];
  if (/[€]/.test(text)) return "EUR";
  if (/[$]/.test(text)) return "USD";
  return "";
}

function normalizeYnab(parsed, filename) {
  const lowerHeaders = parsed.headers.map((header) => header.toLowerCase());
  const hasTransactions = lowerHeaders.includes("account") && lowerHeaders.includes("date") && (lowerHeaders.includes("outflow") || lowerHeaders.includes("inflow"));
  if (!hasTransactions) {
    if (lowerHeaders.includes("category group") && lowerHeaders.some((header) => /\b20\d{2}\b/.test(header))) throw new Error("This is a category summary. Choose the YNAB file whose name ends in “transactions”.");
    throw new Error("This file does not look like a YNAB transaction export.");
  }
  const rows = parsed.records.map((record, index) => {
    const rawOutflow = getField(record, ["Outflow"]);
    const rawInflow = getField(record, ["Inflow"]);
    return {
      id: index,
      account: getField(record, ["Account"]).trim(),
      flag: getField(record, ["Flag"]).trim(),
      dateText: getField(record, ["Date"]),
      date: parseDate(getField(record, ["Date"])),
      payee: getField(record, ["Payee"]).trim(),
      categoryGroup: getField(record, ["Category Group"]).trim(),
      category: getField(record, ["Category"]).trim(),
      memo: getField(record, ["Memo"]),
      outflow: parseAmount(rawOutflow),
      inflow: parseAmount(rawInflow),
      rawOutflow,
      rawInflow,
      cleared: getField(record, ["Cleared"]).trim() || "Unknown",
      currencyHint: sourceCurrencyHint(`${rawOutflow} ${rawInflow}`),
    };
  });
  if (!rows.length) throw new Error("The transaction export contains no rows.");
  const invalidDates = rows.filter((row) => !row.date).length;
  const warnings = [];
  const isSpendingBreakdown = /spending[- ]breakdown/i.test(filename) || rows.every((row) => !row.inflow);
  if (isSpendingBreakdown) warnings.push("This appears to be a Spending Breakdown export. It can omit income and some transfers.");
  if (invalidDates) warnings.push(`${invalidDates} transaction date${invalidDates === 1 ? "" : "s"} could not be read.`);
  return { rows, warnings, kind: isSpendingBreakdown ? "Spending Breakdown transactions" : "YNAB transactions" };
}

function normalizeIncomeExpense(parsed) {
  const categoryHeader = parsed.headers.find((header) => header.trim().toLowerCase() === "category");
  const monthHeaders = parsed.headers.filter((header) => /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+20\d{2}$/i.test(header.trim()));
  if (!categoryHeader || !monthHeaders.length) throw new Error("This does not look like a YNAB Reflect Income & Expense export.");
  const allIncomeIndex = parsed.records.findIndex((record) => getField(record, [categoryHeader]).trim().toLowerCase() === "all income sources");
  const totalIncomeIndex = parsed.records.findIndex((record) => getField(record, [categoryHeader]).trim().toLowerCase() === "total income");
  if (allIncomeIndex < 0 || totalIncomeIndex <= allIncomeIndex) throw new Error("The report does not contain an Income section.");
  const sources = parsed.records.slice(allIncomeIndex + 1, totalIncomeIndex).map((record) => ({
    name: getField(record, [categoryHeader]).trim(),
    months: Object.fromEntries(monthHeaders.map((header) => [header, parseAmount(getField(record, [header]))])),
  })).filter((source) => source.name);
  const totalRecord = parsed.records[totalIncomeIndex];
  const monthlyTotals = Object.fromEntries(monthHeaders.map((header) => [header, parseAmount(getField(totalRecord, [header]))]));
  return { sources, monthlyTotals, months: monthHeaders };
}

function normalizeMoneyManagerRows(rows) {
  if (!rows.length) return { accounts: [], categories: [], subcategories: [] };
  const headers = rows[0].map((value) => String(value ?? "").trim());
  const accountIndex = headers.findIndex((header) => /^(account|conto)$/i.test(header));
  const categoryIndex = headers.findIndex((header) => /^(category|categoria)$/i.test(header));
  const subcategoryIndex = headers.findIndex((header) => /^(subcategory|sotto-categoria)$/i.test(header));
  const typeIndex = headers.findIndex((header) => /^(income\s*\/\s*expenses?|guadagni\s*\/\s*spese|entrate\s*\/\s*uscite|type|tipo)$/i.test(header));
  if (accountIndex < 0 || categoryIndex < 0) throw new Error("The Money Manager export needs Account and Category columns.");
  const dataRows = rows.slice(1);
  const isTransfer = (row) => typeIndex >= 0 && /transfer|trasferimento/i.test(String(row[typeIndex] ?? ""));
  const isBalanceAdjustment = (row) => typeIndex >= 0 && /balance|saldo/i.test(String(row[typeIndex] ?? ""));
  const transactionRows = dataRows.filter((row) => !isTransfer(row));
  const transferAccounts = dataRows.filter(isTransfer).map((row) => String(row[categoryIndex] ?? "")).filter(Boolean);
  const accounts = unique([...dataRows.map((row) => String(row[accountIndex] ?? "")).filter(Boolean), ...transferAccounts]);
  const accountNames = new Set(accounts.map((value) => value.trim().toLowerCase()));
  const balanceCategories = new Set(dataRows.filter(isBalanceAdjustment).map((row) => String(row[categoryIndex] ?? "").trim().toLowerCase()).filter(Boolean));
  const isRealCategory = (value) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized && !accountNames.has(normalized) && !balanceCategories.has(normalized);
  };
  return {
    accounts,
    categories: unique(transactionRows.map((row) => String(row[categoryIndex] ?? "")).filter(isRealCategory)),
    subcategories: subcategoryIndex < 0 ? [] : unique(transactionRows.map((row) => String(row[subcategoryIndex] ?? "")).filter(Boolean)),
  };
}

async function parseMoneyManagerFile(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    if (!window.XLSX) throw new Error("The XLSX reader is unavailable. Try again online or use a CSV/TSV export.");
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return normalizeMoneyManagerRows(window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }));
  }
  const parsed = parseDelimited(await file.text());
  return normalizeMoneyManagerRows([parsed.headers, ...parsed.records.map((record) => parsed.headers.map((header) => record[header]))]);
}

function replaceCatalog(catalog) {
  const next = {
    accounts: unique(catalog.accounts),
    categories: unique(catalog.categories),
    subcategories: unique(catalog.subcategories),
  };
  state.profile.catalogs = next;
  saveProfile();
  renderDatalists();
}
function activeCatalogs() { return state.demoCatalog || state.profile.catalogs; }
function catalogHas(kind, value) { return Boolean(value && activeCatalogs()[kind].includes(value)); }
function renderDatalists() {
  const catalogs = activeCatalogs();
  const write = (selector, values) => { $(selector).innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join(""); };
  write("#accounts-list", catalogs.accounts);
  write("#categories-list", catalogs.categories);
  write("#subcategories-list", catalogs.subcategories);
}
function catalogOptions(values, current, placeholder, addLabel) {
  return `<option value="">${escapeHtml(placeholder)}</option>${values.map((value) => `<option value="${escapeHtml(value)}" ${value === current ? "selected" : ""}>${escapeHtml(value)}</option>`).join("")}<option value="__add_new__">＋ ${escapeHtml(addLabel)}</option>`;
}
function requestCatalogValue(kind, mappingType, sourceKey) {
  const singular = kind === "accounts" ? "account" : "category";
  state.pendingCatalogAddition = { kind, mappingType, sourceKey };
  $("#add-target-title").textContent = `Add a Money Manager ${singular}`;
  $("#add-target-label").textContent = `${singular[0].toUpperCase()}${singular.slice(1)} name`;
  $("#add-target-name").value = "";
  $("#add-target-dialog").showModal();
  $("#add-target-name").focus();
}
function saveCatalogValue(event) {
  event.preventDefault();
  const pending = state.pendingCatalogAddition;
  const value = $("#add-target-name").value.trim();
  if (!pending || !value) { $("#add-target-name").focus(); return; }
  const catalogs = state.demoCatalog || state.profile.catalogs;
  catalogs[pending.kind] = unique([...catalogs[pending.kind], value]);
  if (pending.mappingType === "account") {
    state.profile.accountMappings[pending.sourceKey] ||= { target: "", currency: "" };
    state.profile.accountMappings[pending.sourceKey].target = value;
  } else {
    state.profile.categoryMappings[pending.sourceKey] ||= { action: "expense", target: "", subcategory: "" };
    state.profile.categoryMappings[pending.sourceKey].target = value;
  }
  state.pendingCatalogAddition = null;
  saveProfile(); renderDatalists(); renderMappings(); renderReview();
  $("#add-target-dialog").close();
  toast(`Added “${value}”`);
}
function accountSummary() {
  const counts = {};
  state.rows.filter((row) => !isAutoExcludedTransfer(row)).forEach((row) => counts[row.account] = (counts[row.account] || 0) + 1);
  return counts;
}
function categorySummary() {
  const counts = {};
  state.rows.filter((row) => !/^transfer\s*:/i.test(row.payee)).forEach((row) => counts[categoryKey(row)] = (counts[categoryKey(row)] || 0) + 1);
  return counts;
}
function defaultActionForCategory(key) {
  const rows = state.rows.filter((row) => categoryKey(row) === key);
  return rows.length && rows.every((row) => Number(row.inflow || 0) > 0 && !Number(row.outflow || 0)) ? "income" : "expense";
}

function renderMappings() {
  renderDatalists();
  const catalogs = activeCatalogs();
  const accounts = accountSummary();
  const accountHost = $("#account-mappings");
  if (!Object.keys(accounts).length) accountHost.innerHTML = '<div class="empty-state">Load a YNAB file to discover accounts.</div>';
  else accountHost.innerHTML = Object.entries(accounts).map(([source, count]) => {
    const mapping = state.profile.accountMappings[source] || { target: "", currency: "" };
    return `<div class="mapping-row" data-source-account="${escapeHtml(source)}">
      <div class="source-label"><strong>${escapeHtml(source)}</strong><span>${count} transaction${count === 1 ? "" : "s"}</span></div>
      <select data-field="target" aria-label="Target account for ${escapeHtml(source)}">${catalogOptions(catalogs.accounts, mapping.target, catalogs.accounts.length ? "Choose Money Manager account" : "No accounts loaded", "Add a new account…")}</select>
      <input data-field="currency" value="${escapeHtml(mapping.currency)}" maxlength="3" pattern="[A-Za-z]{3}" title="Use a three-letter currency code, such as EUR" placeholder="SEK" aria-label="Currency for ${escapeHtml(source)}" />
      <span class="status-dot ${catalogHas("accounts", mapping.target) && validCurrencyCode(mapping.currency) ? "ready" : "review"}" title="${catalogHas("accounts", mapping.target) && validCurrencyCode(mapping.currency) ? "Mapped" : "Incomplete"}"></span>
    </div>`;
  }).join("");
  const mappedAccounts = Object.keys(accounts).filter((source) => catalogHas("accounts", state.profile.accountMappings[source]?.target) && validCurrencyCode(state.profile.accountMappings[source]?.currency)).length;
  $("#account-counter").textContent = `${mappedAccounts}/${Object.keys(accounts).length} mapped`;

  const query = $("#category-search").value.trim().toLowerCase();
  const categoryCounts = categorySummary();
  const categories = Object.entries(categoryCounts).filter(([key]) => key.toLowerCase().includes(query));
  const categoryHost = $("#category-mappings");
  if (!categories.length) categoryHost.innerHTML = `<div class="empty-state">${Object.keys(categoryCounts).length ? "No categories match this filter." : state.rows.length ? "No spending or income categories need mapping for this file." : "Load a YNAB file to discover categories."}</div>`;
  else categoryHost.innerHTML = categories.map(([key, count]) => {
    const source = splitCategoryKey(key);
    const mapping = state.profile.categoryMappings[key] || { action: defaultActionForCategory(key), target: "", subcategory: "" };
    const targetDisabled = ["manual", "ignore", "transfer"].includes(mapping.action);
    return `<div class="mapping-row category-row" data-category-key="${escapeHtml(key)}">
      <div class="source-label"><strong>${escapeHtml(source.category || "Uncategorised")}</strong><span>${escapeHtml(source.group || "No group")} · ${count} row${count === 1 ? "" : "s"}</span></div>
      <select data-field="action" aria-label="Action for ${escapeHtml(source.category)}"><option value="expense" ${mapping.action === "expense" ? "selected" : ""}>Expense</option><option value="income" ${mapping.action === "income" ? "selected" : ""}>Income</option><option value="transfer" ${mapping.action === "transfer" ? "selected" : ""}>Transfer</option><option value="manual" ${mapping.action === "manual" ? "selected" : ""}>Manual review</option><option value="ignore" ${mapping.action === "ignore" ? "selected" : ""}>Ignore</option></select>
      <select data-field="target" aria-label="Target category for ${escapeHtml(source.category)}" ${targetDisabled ? "disabled" : ""}>${catalogOptions(catalogs.categories, mapping.target, catalogs.categories.length ? "Choose Money Manager category" : "No categories loaded", "Add a new category…")}</select>
      <input data-field="subcategory" list="subcategories-list" value="${escapeHtml(mapping.subcategory)}" placeholder="Subcategory (optional)" ${targetDisabled ? "disabled" : ""} />
    </div>`;
  }).join("");
  const allCategoryKeys = Object.keys(categorySummary());
  const mappedCategories = allCategoryKeys.filter((key) => {
    const mapping = state.profile.categoryMappings[key];
    return mapping && (["manual", "ignore", "transfer"].includes(mapping.action) || catalogHas("categories", mapping.target));
  }).length;
  $("#category-counter").textContent = `${mappedCategories}/${allCategoryKeys.length} mapped`;

  const transferPayees = unique(state.rows.filter((row) => /^transfer\s*:/i.test(row.payee) && !isAutoExcludedTransfer(row)).map((row) => row.payee));
  $("#transfer-section").hidden = transferPayees.length === 0;
  $("#transfer-mappings").innerHTML = transferPayees.map((payee) => {
    const sourceAccounts = unique(state.rows.filter((row) => row.payee === payee).map((row) => row.account));
    const rule = state.profile.transfers[payee] || { destination: "" };
    return `<div class="mapping-row transfer-row" data-transfer-payee="${escapeHtml(payee)}">
      <div class="source-label"><strong>${escapeHtml(payee)}</strong><span>Detected transfer</span></div>
      <div class="transfer-account"><span>From account</span><strong>${escapeHtml(sourceAccounts.join(", "))}</strong></div>
      <label class="transfer-destination"><span>To account</span><input data-field="destination" list="accounts-list" value="${escapeHtml(rule.destination)}" placeholder="Choose destination account" /></label>
    </div>`;
  }).join("");
  renderPayeeRules();
}

function renderPayeeRules() {
  const host = $("#payee-rules");
  if (!state.profile.payeeRules.length) { host.innerHTML = '<div class="empty-state">No payee-specific rules.</div>'; return; }
  host.innerHTML = state.profile.payeeRules.map((rule, index) => `<div class="mapping-row rule-row" data-rule-index="${index}">
    <select data-field="match"><option value="exact" ${rule.match === "exact" ? "selected" : ""}>Equals</option><option value="contains" ${rule.match === "contains" ? "selected" : ""}>Contains</option></select>
    <input data-field="value" value="${escapeHtml(rule.value)}" placeholder="Payee name" />
    <select data-field="action"><option value="expense" ${rule.action === "expense" ? "selected" : ""}>Expense</option><option value="income" ${rule.action === "income" ? "selected" : ""}>Income</option><option value="manual" ${rule.action === "manual" ? "selected" : ""}>Manual review</option><option value="ignore" ${rule.action === "ignore" ? "selected" : ""}>Ignore</option></select>
    <input data-field="target" list="categories-list" value="${escapeHtml(rule.target || "")}" placeholder="Target category" />
    <button class="remove-button" type="button" aria-label="Remove rule">×</button>
  </div>`).join("");
}

function matchingPayeeRule(row) {
  const exact = state.profile.payeeRules.filter((rule) => rule.value && rule.match === "exact" && row.payee.toLowerCase() === rule.value.toLowerCase());
  if (exact.length > 1) return { conflict: true };
  if (exact.length === 1) return exact[0];
  const contains = state.profile.payeeRules.filter((rule) => rule.value && rule.match === "contains" && row.payee.toLowerCase().includes(rule.value.toLowerCase()));
  if (contains.length > 1) return { conflict: true };
  return contains[0] || null;
}
function closestRate(currency, date) {
  const rates = state.rates[currency] || {};
  const target = isoDate(date);
  const dateKeys = Object.keys(rates).filter((key) => key <= target).sort().reverse();
  return dateKeys.length ? { value: rates[dateKeys[0]], date: dateKeys[0] } : null;
}
function resolvedRowDate(row) {
  const override = state.overrides[row.id] || {};
  return Object.prototype.hasOwnProperty.call(override, "date") ? parseDate(override.date, "YMD") : row.date;
}
function validCurrencyCode(value) { return /^[A-Z]{3}$/.test(String(value || "").trim().toUpperCase()); }
function transferAccountName(payee) {
  const match = String(payee || "").match(/^transfer\s*:\s*(.+)$/i);
  return match ? match[1].trim() : "";
}
function matchingTransferOut(row) {
  const destination = transferAccountName(row.payee).toLowerCase();
  const source = String(row.account || "").trim().toLowerCase();
  const amount = Number(row.inflow || 0);
  const date = isoDate(row.date);
  if (!destination || !source || !amount || !date) return null;
  return [...state.rows, ...state.manualRows].find((candidate) => candidate !== row
    && isoDate(candidate.date) === date
    && String(candidate.account || "").trim().toLowerCase() === destination
    && transferAccountName(candidate.payee).toLowerCase() === source
    && Math.abs(Number(candidate.outflow || 0) - amount) < 0.005
    && !Number(candidate.inflow || 0));
}
function isAutoExcludedTransfer(row) {
  return /^transfer\s*:/i.test(row.payee)
    && Number(row.inflow || 0) > 0
    && !Number(row.outflow || 0)
    && Boolean(matchingTransferOut(row));
}
function convertRow(row) {
  const override = state.overrides[row.id] || {};
  const issues = [], warnings = [];
  const date = resolvedRowDate(row);
  const accountMap = state.profile.accountMappings[row.account] || {};
  let targetAccount = override.targetAccount ?? (catalogHas("accounts", accountMap.target) ? accountMap.target : "");
  let currency = String(override.currency ?? accountMap.currency ?? row.currencyHint ?? "").trim().toUpperCase();
  const categoryMap = state.profile.categoryMappings[categoryKey(row)] || null;
  const payeeRule = matchingPayeeRule(row);
  const isAccountCredit = Number(row.inflow || 0) > 0 && !Number(row.outflow || 0);
  let action = isAccountCredit ? "income" : categoryMap?.action || "expense";
  let targetCategory = catalogHas("categories", categoryMap?.target) ? categoryMap.target : "";
  let subcategory = categoryMap?.subcategory || "";
  if (payeeRule?.conflict) issues.push("Conflicting payee rules");
  else if (payeeRule) {
    action = payeeRule.action;
    const targetKind = action === "transfer" ? "accounts" : "categories";
    if (catalogHas(targetKind, payeeRule.target)) targetCategory = payeeRule.target;
  }
  const isDetectedTransfer = /^transfer\s*:/i.test(row.payee);
  if (isDetectedTransfer) action = "transfer";
  if (override.type) action = ({ Expenses: "expense", Income: "income", "Transfer-Out": "transfer", Ignore: "ignore" })[override.type] || action;
  if (isDetectedTransfer && !override.type && Number(row.inflow || 0) > 0 && !Number(row.outflow || 0)) {
    if (isAutoExcludedTransfer(row)) action = "ignore";
    else { action = "manual"; issues.push("Incoming transfer without matching outflow"); }
  }
  if (/^(starting balance|reconciliation balance adjustment)$/i.test(row.payee.trim())) { action = "manual"; issues.push("Starting balance or reconciliation adjustment"); }
  if (!targetAccount) issues.push("Account mapping missing");
  if (!currency) issues.push("Source currency missing");
  else if (!validCurrencyCode(currency)) issues.push("Source currency invalid");
  if (!validCurrencyCode(state.profile.baseCurrency)) issues.push("Base currency invalid");
  if (!date) issues.push("Invalid date");
  const outflow = Number(row.outflow || 0), inflow = Number(row.inflow || 0);
  if ((!outflow && !inflow) || (outflow && inflow)) issues.push("Amount needs review");
  const amount = Math.abs(outflow || inflow);
  let type = outflow ? "Expenses" : "Income";
  if (action === "income") type = "Income";
  if (action === "expense") type = "Expenses";
  if (action === "ignore") type = "Ignore";
  if ((action === "manual" || !action) && !issues.some((issue) => ["Incoming transfer without matching outflow", "Starting balance or reconciliation adjustment"].includes(issue))) issues.push("Manual classification required");
  if (inflow && action === "expense") warnings.push("Possible refund");
  if (action === "transfer") {
    type = "Transfer-Out";
    const savedDestination = state.profile.transfers[row.payee]?.destination;
    targetCategory = (override.targetCategory ?? (catalogHas("accounts", savedDestination) ? savedDestination : "")) || targetCategory;
    if (!targetCategory) issues.push("Transfer destination missing");
  } else {
    targetCategory = override.targetCategory ?? targetCategory;
    if (!["ignore", "manual"].includes(action) && !targetCategory) issues.push("Category mapping missing");
  }
  subcategory = override.subcategory ?? subcategory;
  targetAccount = override.targetAccount ?? targetAccount;
  currency = String(override.currency ?? currency).trim().toUpperCase();
  type = override.type || type;
  if (targetAccount && !catalogHas("accounts", targetAccount)) issues.push("Account not in Money Manager list");
  if (targetCategory && action === "transfer" && !catalogHas("accounts", targetCategory)) issues.push("Destination account not in Money Manager list");
  if (targetCategory && !["transfer", "ignore", "manual"].includes(action) && !catalogHas("categories", targetCategory)) issues.push("Category not in Money Manager list");
  let baseAmount = override.baseAmount !== undefined && override.baseAmount !== "" ? parseAmount(override.baseAmount) : null;
  if (baseAmount !== null && (!Number.isFinite(baseAmount) || baseAmount <= 0)) { issues.push("Base amount invalid"); baseAmount = null; }
  let rateInfo = null;
  const baseCurrency = state.profile.baseCurrency.trim().toUpperCase();
  if (validCurrencyCode(currency) && validCurrencyCode(baseCurrency) && currency === baseCurrency) { baseAmount = baseAmount ?? amount; rateInfo = { value: 1, date: isoDate(date), source: "Same currency" }; }
  else if (validCurrencyCode(currency) && validCurrencyCode(baseCurrency)) {
    const rate = closestRate(currency, date);
    if (baseAmount === null && rate) { baseAmount = amount * rate.value; rateInfo = { ...rate, source: "ECB via Frankfurter" }; }
    else if (baseAmount !== null) rateInfo = { value: amount ? baseAmount / amount : 0, date: isoDate(date), source: "Manual" };
    else issues.push("Exchange rate needed");
  }
  if (type === "Ignore") issues.length = 0;
  const status = issues.length ? "review" : warnings.length ? "warning" : "ready";
  return {
    ...row, date, targetAccount, targetCategory, subcategory, type, currency, amount, baseAmount,
    note: override.note ?? row.payee,
    description: override.description ?? row.memo,
    issues: unique(issues), warnings: unique(warnings), status, rateInfo,
  };
}

function selectedStatuses() { return new Set($$(".status-filters input:checked").map((input) => input.value)); }
function filteredSourceRows() {
  const from = $("#date-from").value, to = $("#date-to").value, statuses = selectedStatuses();
  return [...state.rows, ...state.manualRows].filter((row) => {
    const resolvedDate = resolvedRowDate(row);
    const date = isoDate(resolvedDate);
    const inDateRange = !resolvedDate || ((!from || date >= from) && (!to || date <= to));
    return inDateRange && (statuses.has(row.cleared) || row.cleared === "Unknown");
  });
}
function currenciesNeedingRates() {
  const baseCurrency = state.profile.baseCurrency.trim().toUpperCase();
  if (!validCurrencyCode(baseCurrency)) return [];
  return unique(state.converted.filter((row) => row.type !== "Ignore").map((row) => row.currency)
    .filter((currency) => validCurrencyCode(currency) && currency !== baseCurrency));
}
function renderReview() {
  state.converted = filteredSourceRows().map(convertRow);
  const invalidDateRange = Boolean($("#date-from").value && $("#date-to").value && $("#date-from").value > $("#date-to").value);
  $("#date-range-error").hidden = !invalidDateRange;
  $("#continue-config").disabled = !state.rows.length || invalidDateRange;
  $("#date-from").setCustomValidity(invalidDateRange ? "The start date must be on or before the end date." : "");
  $("#date-to").setCustomValidity(invalidDateRange ? "The end date must be on or after the start date." : "");
  $("#fetch-rates").hidden = currenciesNeedingRates().length === 0;
  $("#add-manual-transfer").hidden = !state.rows.length || !/Spending Breakdown/i.test(state.sourceKind);
  const counts = { ready: 0, warning: 0, review: 0 };
  state.converted.filter((row) => row.type !== "Ignore").forEach((row) => counts[row.status] += 1);
  $("#ready-count").textContent = counts.ready + counts.warning;
  $("#review-count").textContent = counts.review;
  const includedRows = state.converted.filter((row) => row.type !== "Ignore");
  const currencies = unique(includedRows.map((row) => row.currency));
  if (includedRows.some((row) => !validCurrencyCode(row.currency))) {
    $("#included-total").textContent = "—";
    $("#included-currency").textContent = "Currency code needs correction";
  } else if (currencies.length === 1) {
    $("#included-total").textContent = formatMoney(includedRows.reduce((sum, row) => sum + row.amount, 0));
    $("#included-currency").textContent = `${currencies[0]} source total`;
  } else {
    $("#included-total").textContent = "—";
    $("#included-currency").textContent = currencies.length ? `Mixed currencies · ${currencies.join(", ")}` : "Currency not set";
  }
  const notice = $("#review-notice");
  const messages = [...state.warnings];
  if (state.incomeReference && !state.rows.some((row) => Number(row.inflow || 0) > 0)) messages.push("The Income & Expense report contains monthly income totals, but this transaction file has no account credits. The report can verify totals, but cannot supply transaction dates or receiving accounts.");
  if (state.converted.some((row) => row.issues.includes("Exchange rate needed"))) messages.push(`Some foreign-currency transactions need an exchange rate. Select “Get exchange rates”, or open a transaction and enter its ${state.profile.baseCurrency} amount.`);
  notice.hidden = messages.length === 0;
  notice.textContent = unique(messages).join(" ");
  const visible = state.converted.filter((row) => state.reviewFilter === "all" || (state.reviewFilter === "ready" ? row.status !== "review" : row.status === "review"));
  const host = $("#review-rows");
  if (!visible.length) host.innerHTML = `<tr><td colspan="6" class="empty-state">${state.rows.length ? "No transactions match this view." : "Load and configure a YNAB file to review transactions."}</td></tr>`;
  else host.innerHTML = visible.map((row) => {
    const needsRate = row.issues.includes("Exchange rate needed");
    const needsClassification = row.issues.some((issue) => ["Manual classification required", "Incoming transfer without matching outflow", "Starting balance or reconciliation adjustment"].includes(issue));
    const statusLabel = row.type === "Ignore" ? "Excluded" : row.status === "review" ? "Needs your input" : "Ready";
    const detail = row.type === "Ignore" ? "Not included in the export" : needsRate ? `Get exchange rates or enter the ${state.profile.baseCurrency} amount` : row.status === "review" ? row.issues.map(readableIssue).join(" · ") : row.status === "warning" ? `Optional note: ${row.warnings.join(" · ")}` : row.rateInfo?.source || "Mapped";
    const result = row.type === "Ignore" ? "Excluded" : needsClassification ? "Not classified" : `${row.targetAccount || "No account"} → ${row.targetCategory || "No category"}`;
    const resultType = needsClassification ? "Manual decision" : row.type;
    return `<tr><td>${escapeHtml(formatDate(row.date))}</td><td><span class="primary">${escapeHtml(row.payee || "No payee")}</span><span class="secondary">${escapeHtml(row.account)} · ${escapeHtml(row.category || "Uncategorised")}</span></td><td><span class="primary">${escapeHtml(formatMoney(row.amount))} ${escapeHtml(row.currency || "")}</span>${row.baseAmount !== null ? `<span class="secondary">${escapeHtml(formatMoney(row.baseAmount))} ${escapeHtml(state.profile.baseCurrency)}</span>` : ""}</td><td><span class="primary">${escapeHtml(result)}</span><span class="secondary">${escapeHtml(resultType)}${row.subcategory ? ` · ${escapeHtml(row.subcategory)}` : ""}</span></td><td><span class="status-pill ${row.status}">${statusLabel}</span><span class="secondary">${escapeHtml(detail)}</span></td><td><button class="edit-row" type="button" data-edit-row="${row.id}">Edit</button></td></tr>`;
  }).join("");
  renderExportState(counts);
}

function readableIssue(issue) {
  return ({
    "Account mapping missing": "Choose a Money Manager account",
    "Source currency missing": "Choose the source currency",
    "Source currency invalid": "Use a three-letter source currency code, such as EUR",
    "Base currency invalid": "Use a three-letter base currency code, such as EUR",
    "Base amount invalid": "Enter a valid base-currency amount",
    "Invalid date": "Fix the transaction date",
    "Amount needs review": "Check the transaction amount",
    "Manual classification required": "Choose how to classify this transaction",
    "Transfer destination missing": "Choose the destination account",
    "Category mapping missing": "Choose a Money Manager category",
    "Account not in Money Manager list": "Choose an account from the Money Manager list",
    "Destination account not in Money Manager list": "Choose a destination from the Money Manager account list",
    "Category not in Money Manager list": "Choose a category from the Money Manager list",
    "Conflicting payee rules": "Remove an overlapping payee rule",
    "Starting balance or reconciliation adjustment": "Choose how to handle this balance adjustment",
    "Incoming transfer without matching outflow": "Find the outgoing side or choose how to handle this incoming transfer",
  })[issue] || issue;
}

function renderExportState(counts) {
  const readyRows = state.converted.filter((row) => row.status !== "review" && row.type !== "Ignore");
  const canExport = readyRows.length > 0 && counts.review === 0;
  $("#download-tsv").disabled = !canExport;
  $("#download-test").disabled = readyRows.length === 0;
  $("#continue-export").disabled = !canExport;
  const label = canExport ? `${readyRows.length} transaction${readyRows.length === 1 ? "" : "s"} ready` : counts.review ? `Resolve ${counts.review} transaction${counts.review === 1 ? "" : "s"}` : "No transactions ready";
  $("#export-readiness").textContent = label;
  $("#export-readiness").classList.toggle("is-ready", canExport);
}

async function fetchRates() {
  const button = $("#fetch-rates");
  const foreignCurrencies = currenciesNeedingRates();
  if (!foreignCurrencies.length) { toast("No foreign currencies need rates"); return; }
  const dates = filteredSourceRows().map(resolvedRowDate).filter(Boolean).sort((a, b) => a - b);
  if (!dates.length) return;
  const fromDate = new Date(dates[0]); fromDate.setUTCDate(fromDate.getUTCDate() - 7);
  const from = isoDate(fromDate), to = isoDate(dates.at(-1));
  button.disabled = true; button.textContent = "Fetching rates…";
  let loaded = 0;
  try {
    for (const currency of foreignCurrencies) {
      let rateMap = {};
      try {
        const url = `https://api.frankfurter.dev/v2/rates?from=${from}&to=${to}&base=${encodeURIComponent(currency)}&quotes=${encodeURIComponent(state.profile.baseCurrency)}&providers=ecb`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Rate service returned ${response.status}`);
        const data = await response.json();
        const entries = Array.isArray(data) ? data : data.data || data.rates || [];
        if (Array.isArray(entries)) entries.forEach((item) => { if (item.date && Number.isFinite(Number(item.rate))) rateMap[item.date] = Number(item.rate); });
        else Object.entries(entries).forEach(([date, values]) => { const value = typeof values === "number" ? values : values?.[state.profile.baseCurrency]; if (Number.isFinite(Number(value))) rateMap[date] = Number(value); });
      } catch {
        const fallback = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=${encodeURIComponent(currency)}&symbols=${encodeURIComponent(state.profile.baseCurrency)}`);
        if (!fallback.ok) throw new Error(`No rates found for ${currency}`);
        const data = await fallback.json();
        Object.entries(data.rates || {}).forEach(([date, values]) => { const value = values?.[state.profile.baseCurrency]; if (Number.isFinite(Number(value))) rateMap[date] = Number(value); });
      }
      if (!Object.keys(rateMap).length) throw new Error(`No rates found for ${currency}`);
      state.rates[currency] = rateMap; loaded += 1;
    }
    toast(`Historical rates loaded for ${loaded} currenc${loaded === 1 ? "y" : "ies"}`);
  } catch (error) { toast(`${error.message}. You can enter the converted amount manually.`); }
  finally { button.disabled = false; button.textContent = "Get exchange rates"; renderReview(); }
}

function openRowEditor(id) {
  const source = [...state.rows, ...state.manualRows].find((item) => String(item.id) === String(id));
  const row = state.converted.find((item) => String(item.id) === String(id)) || convertRow(source);
  $("#row-index").value = row.id;
  $("#row-dialog-title").textContent = row.payee || "Transaction without payee";
  $("#row-source-summary").textContent = `${formatDate(row.date)} · ${row.account} · ${formatMoney(row.amount)} ${row.currency || ""}`;
  $("#row-date").value = isoDate(row.date);
  $("#row-account").value = row.targetAccount || "";
  $("#row-category").value = row.targetCategory || "";
  $("#row-subcategory").value = row.subcategory || "";
  $("#row-type").value = row.type || "Expenses";
  $("#row-currency").value = row.currency || "";
  $("#row-base-amount-label").textContent = `Amount in ${state.profile.baseCurrency}`;
  $("#row-base-amount").value = row.baseAmount === null ? "" : Number(row.baseAmount).toFixed(2);
  $("#row-note").value = row.note || "";
  $("#row-description").value = row.description || "";
  $("#row-dialog").showModal();
}

function openManualTransfer() {
  $("#manual-transfer-form").reset();
  $("#manual-transfer-date").value = $("#date-to").value || isoDate(new Date());
  $("#manual-transfer-currency").value = state.profile.baseCurrency.toUpperCase();
  $("#manual-transfer-base-label").textContent = `Amount in ${state.profile.baseCurrency} (optional)`;
  $("#manual-transfer-dialog").showModal();
}

function addManualTransfer(event) {
  event.preventDefault();
  const dateText = $("#manual-transfer-date").value;
  const fromAccount = $("#manual-transfer-from").value.trim();
  const toAccount = $("#manual-transfer-to").value.trim();
  const currency = $("#manual-transfer-currency").value.trim().toUpperCase();
  const amount = parseAmount($("#manual-transfer-amount").value);
  const baseAmount = $("#manual-transfer-base").value.trim();
  const date = parseDate(dateText, "YMD");
  if (!date || !fromAccount || !toAccount || !validCurrencyCode(currency) || !Number.isFinite(amount) || amount <= 0) {
    toast("Enter the date, both accounts, a three-letter currency code, and a positive amount");
    return;
  }
  if (baseAmount && (!Number.isFinite(parseAmount(baseAmount)) || parseAmount(baseAmount) <= 0)) { toast("Enter a positive base-currency amount or leave it empty"); return; }
  if (fromAccount === toAccount) { toast("Choose two different accounts"); return; }
  const id = `manual-${Date.now()}`;
  state.manualRows.push({
    id,
    account: fromAccount,
    flag: "",
    dateText,
    date,
    payee: `Transfer : ${toAccount}`,
    categoryGroup: "",
    category: "",
    memo: $("#manual-transfer-note").value.trim(),
    outflow: amount,
    inflow: 0,
    rawOutflow: String(amount),
    rawInflow: "0",
    cleared: "Reconciled",
    currencyHint: currency,
    manual: true,
  });
  state.overrides[id] = {
    targetAccount: fromAccount,
    targetCategory: toAccount,
    type: "Transfer-Out",
    currency,
    baseAmount,
    note: $("#manual-transfer-note").value.trim() || `Transfer to ${toAccount}`,
    description: "Added manually because it was absent from the YNAB Spending Breakdown export",
  };
  if (!$("#date-from").value || dateText < $("#date-from").value) $("#date-from").value = dateText;
  if (!$("#date-to").value || dateText > $("#date-to").value) $("#date-to").value = dateText;
  $("#manual-transfer-dialog").close();
  renderReview();
  toast("Missing transfer added to this export");
}
function readRowEditor() {
  return {
    date: $("#row-date").value,
    targetAccount: $("#row-account").value,
    targetCategory: $("#row-category").value,
    subcategory: $("#row-subcategory").value,
    type: $("#row-type").value,
    currency: $("#row-currency").value.toUpperCase(),
    baseAmount: $("#row-base-amount").value,
    note: $("#row-note").value,
    description: $("#row-description").value,
  };
}

function tsvRows(limit) {
  const rows = state.converted.filter((row) => row.status !== "review" && row.type !== "Ignore").slice(0, limit || Infinity);
  const headers = ["Date", "Account", "Category", "Subcategory", "Note", "Amount", "Income/Expense", "Description", "AmountSub", "Currency"];
  const quote = (value) => { const text = String(value ?? ""); return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const body = rows.map((row) => [formatDate(row.date), row.targetAccount, row.targetCategory, row.subcategory, row.note, formatMoney(row.baseAmount), row.type, row.description, formatMoney(row.amount), row.currency].map(quote).join("\t"));
  return "\uFEFF" + [headers.join("\t"), ...body].join("\r\n");
}
function download(content, filename, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function runReport() {
  return {
    generatedAt: new Date().toISOString(),
    sourceFile: state.sourceFile?.name || "Example data",
    targetReference: state.targetFile?.name || null,
    incomeReference: state.incomeReferenceFile ? {
      file: state.incomeReferenceFile.name,
      sources: state.incomeReference.sources.map((source) => source.name),
      monthlyTotals: state.incomeReference.monthlyTotals,
      note: "Summary reference only; it does not provide transaction dates or receiving accounts.",
    } : null,
    dateRange: { from: $("#date-from").value || null, to: $("#date-to").value || null },
    counts: {
      included: state.converted.filter((row) => row.status !== "review" && row.type !== "Ignore").length,
      manuallyAdded: state.converted.filter((row) => row.manual).length,
      ignored: state.converted.filter((row) => row.type === "Ignore").length,
      unresolved: state.converted.filter((row) => row.status === "review").length,
      warnings: state.converted.filter((row) => row.status === "warning").length,
    },
    currencies: Object.fromEntries(unique(state.converted.map((row) => row.currency)).filter(Boolean).map((currency) => [currency, state.converted.filter((row) => row.currency === currency).reduce((sum, row) => sum + row.amount, 0)])),
    rateSources: unique(state.converted.map((row) => row.rateInfo?.source).filter(Boolean)),
    unresolved: state.converted.filter((row) => row.status === "review").map((row) => ({ date: isoDate(row.date), account: row.account, payee: row.payee, amount: row.amount, issues: row.issues })),
  };
}

function setDateRangeFromRows() {
  const dates = state.rows.map((row) => row.date).filter(Boolean).sort((a, b) => a - b);
  if (dates.length) { $("#date-from").value = isoDate(dates[0]); $("#date-to").value = isoDate(dates.at(-1)); }
  else { $("#date-from").value = ""; $("#date-to").value = ""; }
}
function showDetectedFile(kind, name, detail) {
  const host = $("#detected-files"); host.hidden = false;
  const old = host.querySelector(`[data-file-kind="${kind}"]`); if (old) old.remove();
  const row = document.createElement("div"); row.className = "file-row"; row.dataset.fileKind = kind;
  row.innerHTML = '<span class="status-icon">✓</span><strong></strong><small></small>';
  $("strong", row).textContent = name; $("small", row).textContent = detail; host.append(row);
}
async function loadYnabFile(file) {
  try {
    const parsed = parseDelimited(await file.text());
    const result = normalizeYnab(parsed, file.name);
    if (state.demoProfileBackup) { state.profile = mergeProfile(state.demoProfileBackup); state.demoProfileBackup = null; syncProfileControls(); }
    state.sourceFile = file; state.rows = result.rows; state.warnings = result.warnings; state.sourceKind = result.kind; state.overrides = {}; state.manualRows = []; state.rates = {}; state.demoCatalog = null;
    showDetectedFile("ynab", file.name, `${state.rows.length} rows · ${result.kind}`);
    setDateRangeFromRows();
    $("#continue-config").disabled = false;
    setRunState(`${state.rows.length} source rows`, "#38bfa0");
    renderMappings(); renderReview(); toast("YNAB transactions loaded");
  } catch (error) { toast(error.message); setRunState("Source file needs attention", "#c84b4b"); }
}
async function loadMoneyManagerFile(file) {
  try {
    const catalog = await parseMoneyManagerFile(file);
    state.targetFile = file; state.demoCatalog = null; replaceCatalog(catalog);
    showDetectedFile("mm", file.name, `${catalog.accounts.length} accounts · ${catalog.categories.length} categories`);
    renderMappings(); renderReview(); toast("Money Manager lists replaced from this export");
  } catch (error) { toast(error.message); }
}
async function loadIncomeReferenceFile(file) {
  try {
    const reference = normalizeIncomeExpense(parseDelimited(await file.text()));
    state.incomeReferenceFile = file;
    state.incomeReference = reference;
    showDetectedFile("income", file.name, `${reference.sources.length} income sources · monthly totals only`);
    renderReview();
    toast("Income reference loaded");
  } catch (error) { toast(error.message); }
}
function bindDropzone(zoneSelector, inputSelector, onFile) {
  const zone = $(zoneSelector), input = $(inputSelector);
  input.addEventListener("change", () => input.files[0] && onFile(input.files[0]));
  ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove("is-dragging"); }));
  zone.addEventListener("drop", (event) => event.dataTransfer.files[0] && onFile(event.dataTransfer.files[0]));
}

function loadDemo() {
  const demo = `Account\tFlag\tDate\tPayee\tCategory Group/Category\tCategory Group\tCategory\tMemo\tOutflow\tInflow\tCleared\nExample checking account\t\t10/09/2026\tLocal Café\tExample spending/Meal out\tExample spending\tMeal out\tLunch\t18,00 EUR\t0,00 EUR\tReconciled\nExample credit card\t\t11/09/2026\tNeighbourhood Shop\tExample spending/Food shop\tExample spending\tFood shop\t\t42,50 EUR\t0,00 EUR\tCleared\nExample checking account\t\t12/09/2026\tTransfer : Example savings account\tExample transfers/Savings transfer\tExample transfers\tSavings transfer\t\t100,00 EUR\t0,00 EUR\tCleared\nExample credit card\t\t13/09/2026\tShop refund\tExample spending/Food shop\tExample spending\tFood shop\tRefund\t0,00 EUR\t12,00 EUR\tUncleared\nExample checking account\t\t14/09/2026\tUtility Provider\tExample spending/Household bill\tExample spending\tHousehold bill\tSeptember\t65,00 EUR\t0,00 EUR\tReconciled\nExample credit card\t\t15/09/2026\tOnline Store\tExample spending/Personal purchase\tExample spending\tPersonal purchase\t\t24,00 EUR\t0,00 EUR\tCleared`;
  const result = normalizeYnab(parseDelimited(demo), "example-transactions.tsv");
  const liveProfile = mergeProfile(state.demoProfileBackup || state.profile);
  if (!state.demoProfileBackup) state.demoProfileBackup = clone(state.profile);
  state.profile = mergeProfile({ ...liveProfile, accountMappings: {}, categoryMappings: {}, transfers: {}, payeeRules: [] });
  state.sourceFile = null; state.rows = result.rows; state.warnings = []; state.sourceKind = "Example transactions"; state.overrides = {}; state.manualRows = []; state.rates = {};
  state.demoCatalog = { accounts: ["Checking account", "Credit card", "Savings account"], categories: ["Food", "Household", "Personal", "Transfers"], subcategories: [] };
  showDetectedFile("ynab", "example-transactions.tsv", `${state.rows.length} rows · example data`);
  renderDatalists();
  setDateRangeFromRows(); $("#continue-config").disabled = false; setRunState("Example loaded", "#38bfa0"); renderMappings(); renderReview(); toast("Example data loaded");
}

function wireEvents() {
  $("#open-settings").addEventListener("click", () => openSettings());
  $("#open-settings-sidebar").addEventListener("click", () => openSettings());
  bindDropzone("#ynab-dropzone", "#ynab-file", loadYnabFile);
  bindDropzone("#income-dropzone", "#income-reference-file", loadIncomeReferenceFile);
  bindDropzone("#mm-dropzone", "#mm-file", loadMoneyManagerFile);
  $("#load-demo").addEventListener("click", loadDemo);
  $("#continue-config").addEventListener("click", () => showStep("#configure", 1));
  $("#continue-review").addEventListener("click", () => { renderReview(); showStep("#review", 2); });
  $("#continue-export").addEventListener("click", () => showStep("#export", 3));
  ["#date-from", "#date-to"].forEach((selector) => $(selector).addEventListener("change", renderReview));
  $$(".status-filters input").forEach((input) => input.addEventListener("change", renderReview));
  $$("[data-review-filter]").forEach((button) => button.addEventListener("click", () => { state.reviewFilter = button.dataset.reviewFilter; $$("[data-review-filter]").forEach((item) => item.classList.toggle("is-active", item === button)); renderReview(); }));
  $("#category-search").addEventListener("input", renderMappings);
  $("#bulk-category-action").addEventListener("change", (event) => {
    if (!event.target.value) return;
    $$("#category-mappings [data-category-key]").forEach((row) => {
      const key = row.dataset.categoryKey;
      state.profile.categoryMappings[key] = { ...(state.profile.categoryMappings[key] || {}), action: event.target.value };
    });
    event.target.value = ""; saveProfile(); renderMappings(); renderReview();
  });
  const updateAccountMapping = (event) => {
    const row = event.target.closest("[data-source-account]"); if (!row) return;
    if (event.type === "input" && event.target.tagName === "SELECT") return;
    state.profile.accountMappings[row.dataset.sourceAccount] ||= { target: "", currency: "" };
    let value = event.target.value;
    if (event.target.dataset.field === "target" && value === "__add_new__") {
      requestCatalogValue("accounts", "account", row.dataset.sourceAccount);
      renderMappings();
      return;
    }
    state.profile.accountMappings[row.dataset.sourceAccount][event.target.dataset.field] = event.target.dataset.field === "currency" ? value.toUpperCase() : value;
    saveProfile(); updateMappingCounters(); renderReview();
  };
  $("#account-mappings").addEventListener("input", updateAccountMapping);
  $("#account-mappings").addEventListener("change", updateAccountMapping);
  $("#category-mappings").addEventListener("change", updateCategoryMapping);
  $("#category-mappings").addEventListener("input", updateCategoryMapping);
  $("#transfer-mappings").addEventListener("input", (event) => {
    const row = event.target.closest("[data-transfer-payee]"); if (!row) return;
    state.profile.transfers[row.dataset.transferPayee] = { destination: event.target.value };
    saveProfile(); renderReview();
  });
  $("#payee-rules").addEventListener("input", updatePayeeRule);
  $("#payee-rules").addEventListener("change", updatePayeeRule);
  $("#payee-rules").addEventListener("click", (event) => {
    const row = event.target.closest("[data-rule-index]"); if (!row || !event.target.matches(".remove-button")) return;
    state.profile.payeeRules.splice(Number(row.dataset.ruleIndex), 1); saveProfile(); renderPayeeRules(); renderReview();
  });
  $("#add-payee-rule").addEventListener("click", () => { state.profile.payeeRules.push({ match: "exact", value: "", action: "manual", target: "" }); saveProfile(); renderPayeeRules(); $("#payee-rules input")?.focus(); });
  $("#base-currency").addEventListener("input", (event) => { state.profile.baseCurrency = event.target.value.toUpperCase(); saveProfile(); renderReview(); });
  $("#input-date-format").addEventListener("change", (event) => {
    state.profile.inputDateFormat = event.target.value;
    state.rows.forEach((row) => { row.date = parseDate(row.dateText, state.profile.inputDateFormat); });
    saveProfile(); setDateRangeFromRows(); renderReview();
  });
  $("#date-format").addEventListener("change", (event) => { state.profile.dateFormat = event.target.value; saveProfile(); renderReview(); });
  $("#decimal-separator").addEventListener("change", (event) => { state.profile.decimalSeparator = event.target.value; saveProfile(); renderReview(); });
  $("#save-settings-catalog").addEventListener("click", saveSettingsCatalog);
  $("#add-target-form").addEventListener("submit", saveCatalogValue);
  $("#export-profile").addEventListener("click", () => {
    const configuration = clone(state.profile);
    delete configuration.name;
    download(JSON.stringify(configuration, null, 2), "money-manager-ynab-configuration.json", "application/json");
  });
  $("#import-profile").addEventListener("change", importProfile);
  $("#fetch-rates").addEventListener("click", fetchRates);
  $("#add-manual-transfer").addEventListener("click", openManualTransfer);
  $("#save-manual-transfer").addEventListener("click", addManualTransfer);
  $("#review-rows").addEventListener("click", (event) => { const button = event.target.closest("[data-edit-row]"); if (button) openRowEditor(button.dataset.editRow); });
  $("#save-row").addEventListener("click", () => { state.overrides[$("#row-index").value] = readRowEditor(); renderReview(); toast("Transaction updated"); });
  $("#save-as-category").addEventListener("click", () => {
    const id = $("#row-index").value, source = [...state.rows, ...state.manualRows].find((row) => String(row.id) === id), values = readRowEditor();
    if (!source) return;
    if (source.manual) { toast("This manually added transfer only applies to this export"); return; }
    state.profile.categoryMappings[categoryKey(source)] = { action: ({ Income: "income", "Transfer-Out": "transfer", Ignore: "ignore" })[values.type] || "expense", target: values.targetCategory, subcategory: values.subcategory };
    if (values.targetAccount && source.account) state.profile.accountMappings[source.account] = { target: values.targetAccount, currency: values.currency };
    saveProfile(); renderMappings(); renderReview(); toast("Mapping saved for matching transactions");
  });
  $("#download-tsv").addEventListener("click", () => download(tsvRows(), "import.tsv", "text/tab-separated-values;charset=utf-8"));
  $("#download-test").addEventListener("click", () => download(tsvRows(5), "import-test.tsv", "text/tab-separated-values;charset=utf-8"));
  $$(".step").forEach((step, index) => step.addEventListener("click", () => activateStep(index)));
}
function updateCategoryMapping(event) {
  const row = event.target.closest("[data-category-key]"); if (!row || !event.target.dataset.field) return;
  if (event.type === "input" && event.target.tagName === "SELECT") return;
  state.profile.categoryMappings[row.dataset.categoryKey] ||= { action: "expense", target: "", subcategory: "" };
  let value = event.target.value;
  if (event.target.dataset.field === "target" && value === "__add_new__") {
    requestCatalogValue("categories", "category", row.dataset.categoryKey);
    renderMappings();
    return;
  }
  state.profile.categoryMappings[row.dataset.categoryKey][event.target.dataset.field] = value;
  saveProfile(); updateMappingCounters();
  if (event.target.dataset.field === "action") renderMappings();
  renderReview();
}
function updatePayeeRule(event) {
  const row = event.target.closest("[data-rule-index]"); if (!row || !event.target.dataset.field) return;
  state.profile.payeeRules[Number(row.dataset.ruleIndex)][event.target.dataset.field] = event.target.value;
  saveProfile(); renderReview();
}
function readCatalogInputs(accountSelector, categorySelector, subcategorySelector) {
  const lines = (selector) => unique($(selector).value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  const accounts = lines(accountSelector);
  const accountNames = new Set(accounts.map((value) => value.toLowerCase()));
  const categories = lines(categorySelector).filter((value) => {
    const normalized = value.toLowerCase();
    return !accountNames.has(normalized) && !/^(modifica saldo|balance adjustment|starting balance)$/.test(normalized);
  });
  return { accounts, categories, subcategories: lines(subcategorySelector) };
}
function saveSettingsCatalog(event) {
  event.preventDefault();
  state.profile.catalogs = readCatalogInputs("#settings-catalog-accounts", "#settings-catalog-categories", "#settings-catalog-subcategories");
  saveProfile(); syncSettingsCatalogs(); renderDatalists(); renderMappings(); renderReview();
  toast("Money Manager names saved");
}
async function importProfile(event) {
  const file = event.target.files[0]; if (!file) return;
  try {
    const imported = mergeProfile(JSON.parse(await file.text()));
    state.demoProfileBackup = null; state.demoCatalog = null;
    state.profile = imported;
    saveProfile(); syncProfileControls(); syncSettingsCatalogs(); renderDatalists(); renderMappings(); renderReview(); toast("Configuration restored");
  }
  catch { toast("This configuration file could not be read"); }
  event.target.value = "";
}
function showStep(selector, index) { location.hash = selector; $(selector).scrollIntoView({ behavior: "smooth" }); activateStep(index); }
function activateStep(index) { $$(".step").forEach((step, stepIndex) => step.classList.toggle("is-active", stepIndex === index)); }
function activateStepFromHash() { const index = ["#upload", "#configure", "#review", "#export"].indexOf(location.hash); activateStep(index < 0 ? 0 : index); }
function syncProfileControls() {
  $("#input-date-format").value = state.profile.inputDateFormat; $("#base-currency").value = state.profile.baseCurrency; $("#date-format").value = state.profile.dateFormat; $("#decimal-separator").value = state.profile.decimalSeparator;
}
function updateMappingCounters() {
  const accounts = Object.keys(accountSummary());
  const mappedAccounts = accounts.filter((source) => catalogHas("accounts", state.profile.accountMappings[source]?.target) && validCurrencyCode(state.profile.accountMappings[source]?.currency)).length;
  $("#account-counter").textContent = `${mappedAccounts}/${accounts.length} mapped`;
  const categories = Object.keys(categorySummary());
  const mappedCategories = categories.filter((key) => {
    const mapping = state.profile.categoryMappings[key];
    return mapping && (["manual", "ignore", "transfer"].includes(mapping.action) || catalogHas("categories", mapping.target));
  }).length;
  $("#category-counter").textContent = `${mappedCategories}/${categories.length} mapped`;
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const register = (tool) => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {} };
  register({
    name: "get_conversion_summary", title: "Read conversion summary", description: "Return counts of ready, warning, unresolved, and ignored transactions in the current date range.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() { const rows = filteredSourceRows().map(convertRow); return { ready: rows.filter((row) => row.status === "ready").length, warnings: rows.filter((row) => row.status === "warning").length, unresolved: rows.filter((row) => row.status === "review").length, ignored: rows.filter((row) => row.type === "Ignore").length }; },
  });
  register({
    name: "set_conversion_date_range", title: "Set conversion date range", description: "Set the visible start and end dates used to filter the current YNAB transactions.",
    inputSchema: { type: "object", properties: { from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } }, required: ["from", "to"], additionalProperties: false }, annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) { if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(input?.to || "") || input.from > input.to) throw new Error("Enter a valid date range with from before to."); $("#date-from").value = input.from; $("#date-to").value = input.to; renderReview(); return { from: input.from, to: input.to, rows: state.converted.length }; },
  });
}

syncProfileControls();
renderDatalists();
wireEvents();
renderMappings();
renderReview();
activateStepFromHash();
window.addEventListener("hashchange", activateStepFromHash);
registerWebMcp();

window.__ledgerBridge = { parseDelimited, parseAmount, parseDate, normalizeYnab, convertRow, state };
