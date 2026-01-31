/* DrCalculator Web App (PWA-ready) - app.js
   - Modalità: ACQUISTA / VENDI / RICETTE
   - CRUD pozioni (acquisto/vendita) + CRUD ricette
   - Carrello + invio embed via Discord Webhook
   - Salvataggio su localStorage (JSON)
   - Immagini: solo nome/path testuale (non caricate)
*/

(() => {
  "use strict";

  // -----------------------------
  // Keys localStorage (separati come desktop)
  // -----------------------------
  const LS_KEYS = {
    POTIONS_BUY: "drcalc_potions_acquisto",
    POTIONS_SELL: "drcalc_potions_vendita",
    SETTINGS_BUY: "drcalc_settings_acquisto",
    SETTINGS_SELL: "drcalc_settings_vendita",
    RECIPES: "drcalc_ricette",
  };

  const DEFAULT_POTIONS = { currency: "€", potions: [] };
  const DEFAULT_SETTINGS = { webhook_url: "", last_actor: "" };
  const DEFAULT_RECIPES = { recipes: [] };

  // -----------------------------
  // Utils
  // -----------------------------
  const normalizeName = (s) => (s || "").trim().split(/\s+/).filter(Boolean).join(" ");

  const uid = () => {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch {}
    return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now();
  };

  const clone = (obj) => {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
  };

  const looksLikeDiscordWebhook = (url) => {
    const u = (url || "").trim();
    return u.startsWith("https://discord.com/api/webhooks/") || u.startsWith("https://discordapp.com/api/webhooks/");
  };

  const safeInt = (v, fallback = 0) => {
    const n = parseInt(String(v ?? "").trim(), 10);
    return Number.isFinite(n) ? n : fallback;
  };

  function resolveAsset(path) {
  const p = String(path || "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p; // lascia URL esterni
  // costruisce il path relativo alla cartella dell'app (ok per GH Pages)
  return new URL(p, document.baseURI).toString();
  };


  // -----------------------------
  // Storage
  // -----------------------------
  function loadJSON(key, fallbackObj) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        localStorage.setItem(key, JSON.stringify(fallbackObj));
        return clone(fallbackObj);
      }
      const parsed = JSON.parse(raw);
      if (typeof parsed !== "object" || !parsed) throw new Error("Invalid JSON");
      return parsed;
    } catch {
      localStorage.setItem(key, JSON.stringify(fallbackObj));
      return clone(fallbackObj);
    }
  }

  function saveJSON(key, obj) {
    localStorage.setItem(key, JSON.stringify(obj, null, 2));
  }

  function loadPotions(key) {
    const data = loadJSON(key, DEFAULT_POTIONS);
    data.currency = data.currency || "€";
    if (!Array.isArray(data.potions)) data.potions = [];

    data.potions = data.potions
      .filter((p) => p && typeof p === "object")
      .map((p) => ({
        id: String(p.id || uid()),
        name: normalizeName(String(p.name || "")),
        price: safeInt(p.price, 0),
        image: (p.image || "").toString().trim(),
      }))
      .filter((p) => p.name && p.price > 0);

    return data;
  }

  function loadSettings(key) {
    const s = loadJSON(key, DEFAULT_SETTINGS);
    s.webhook_url = (s.webhook_url || "").toString();
    s.last_actor = (s.last_actor || "").toString();
    return s;
  }

  function loadRecipes() {
    const data = loadJSON(LS_KEYS.RECIPES, DEFAULT_RECIPES);
    if (!Array.isArray(data.recipes)) data.recipes = [];
    data.recipes = data.recipes
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        id: String(r.id || uid()),
        name: normalizeName(String(r.name || "")),
        image: (r.image || "").toString().trim(),
        ingredients: (r.ingredients || "").toString(),
        procedure: (r.procedure || "").toString(),
      }))
      .filter((r) => r.name);

    return data;
  }

  // -----------------------------
  // App State
  // -----------------------------
  const state = {
    mode: "home", // home | buy | sell | recipes
    potionsKey: null,
    settingsKey: null,
    potionsData: clone(DEFAULT_POTIONS),
    settings: clone(DEFAULT_SETTINGS),
    recipesData: clone(DEFAULT_RECIPES),
    cart: {}, // { potionId: qty }
    recipeOpen: new Set(),
    multiSelect: false,
    drawerOpen: false,
  };

  // -----------------------------
  // DOM + Styles
  // -----------------------------
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("Manca <div id='app'></div> in index.html");
  }

  injectStyles();

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") node.className = v;
      else if (k === "style") node.setAttribute("style", v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === false || v === null || v === undefined) continue;
      else node.setAttribute(k, String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function toast(msg, type = "info") {
    const t = el("div", { class: `toast toast-${type}` }, msg);
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
      t.classList.remove("show");
      setTimeout(() => t.remove(), 250);
    }, 2200);
  }

  function confirmBox(message) {
    return window.confirm(message);
  }

  // -----------------------------
  // Quick cart bar (tendina gialla in alto)
  // -----------------------------
  function cartSummary() {
    if (!(state.mode === "buy" || state.mode === "sell")) return { count: 0, total: 0, currency: "€" };

    const potMap = new Map((state.potionsData.potions || []).map((p) => [p.id, p]));
    let total = 0;
    let count = 0;

    for (const [pid, qtyRaw] of Object.entries(state.cart || {})) {
      const qty = safeInt(qtyRaw, 0);
      const p = potMap.get(pid);
      if (!p || qty <= 0) continue;
      count += qty;
      total += safeInt(p.price, 0) * qty;
    }

    return { count, total, currency: state.potionsData.currency || "€" };
  }

  function renderQuickCartBar() {
    // visibile SOLO in buy/sell e SOLO se carrello non vuoto
    if (!(state.mode === "buy" || state.mode === "sell")) return null;

    const { count, total, currency } = cartSummary();
    if (count <= 0) return null;

    // IMPORTANT: non possiamo referenziare "btn" dentro il suo initializer (TDZ),
    // quindi creiamo il bottone e poi agganciamo l'handler.
    const btn = el("button", { class: "quickbar-btn", type: "button" }, "Invia embed");
    btn.addEventListener("click", () => sendToDiscord(btn));

    return el(
      "div",
      { class: "quickbar" },
      el("div", { class: "quickbar-total" }, `Totale carrello: ${total}${currency}`),
      btn
    );
  }

  // -----------------------------
  // Render
  // -----------------------------
  function render() {
    clear(root);

    const appShell = el("div", { class: "shell" }, renderTopBar(), renderBody());
    root.appendChild(appShell);

    const overlay = el("div", {
      class: `overlay ${state.drawerOpen ? "open" : ""}`,
      onclick: () => {
        state.drawerOpen = false;
        render();
      },
    });

    const drawer = renderDrawer();
    root.appendChild(overlay);
    root.appendChild(drawer);
  }

  function renderTopBar() {
    const title = el("div", { class: "brand" }, "DrCalculator");

    const leftBtn =
      state.mode === "home"
        ? el("div", { class: "top-left" })
        : el(
            "button",
            {
              class: "btn btn-ghost",
              onclick: () => goHome(),
              title: "Home",
              type: "button",
            },
            "Home"
          );

    const modeLabel =
      state.mode === "buy"
        ? "Modalità: ACQUISTA"
        : state.mode === "sell"
        ? "Modalità: VENDI"
        : state.mode === "recipes"
        ? "Modalità: RICETTE"
        : "";

    const rightControls = el("div", { class: "top-right" });

    if (state.mode === "buy" || state.mode === "sell") {
      rightControls.appendChild(el("button", { class: "btn btn-ghost", onclick: () => reloadMode(false), type: "button" }, "Ricarica"));
      rightControls.appendChild(el("button", { class: "btn btn-gold", onclick: () => openManagePotions(), type: "button" }, "Gestisci pozioni"));
      rightControls.appendChild(
        el("button", { class: "btn btn-ghost btn-square", onclick: () => toggleDrawer(true), title: "Carrello", type: "button" }, "☰")
      );
    } else if (state.mode === "recipes") {
      rightControls.appendChild(
        el(
          "label",
          { class: "toggle" },
          el("input", {
            type: "checkbox",
            checked: state.multiSelect ? "checked" : null,
            onchange: (e) => {
              state.multiSelect = !!e.target.checked;
              if (!state.multiSelect) state.recipeOpen.clear();
              render();
            },
          }),
          el("span", {}, "Selezione multipla")
        )
      );
      rightControls.appendChild(el("button", { class: "btn btn-gold", onclick: () => openManageRecipes(), type: "button" }, "Gestisci ricette"));
    }

    const top = el(
      "div",
      { class: "topbar" },
      el("div", { class: "top-left" }, leftBtn),
      el("div", { class: "top-center" }, title, modeLabel ? el("div", { class: "mode" }, modeLabel) : null),
      rightControls
    );

    const quick = renderQuickCartBar();

    return el("div", { class: "topwrap" }, top, quick ? quick : null);
  }

  function renderBody() {
    if (state.mode === "home") return renderHome();
    if (state.mode === "recipes") return renderRecipes();
    if (state.mode === "buy" || state.mode === "sell") return renderPotions();
    return el("div", { class: "page" }, "Modalità sconosciuta");
  }

  function renderHome() {
    return el(
      "div",
      { class: "home" },
      el(
        "div",
        { class: "home-card" },
        el("div", { class: "home-title" }, "Scegli cosa vuoi fare:"),
        el(
          "div",
          { class: "home-actions" },
          el("button", { class: "btn btn-gold btn-big", onclick: () => startMode("buy"), type: "button" }, "ACQUISTA"),
          el("button", { class: "btn btn-ghost btn-big", onclick: () => startMode("recipes"), type: "button" }, "RICETTE"),
          el("button", { class: "btn btn-ghost btn-big", onclick: () => startMode("sell"), type: "button" }, "VENDI")
        )
      )
    );
  }

  function renderPotions() {
    const data = state.potionsData;
    const currency = data.currency || "€";
    const potions = [...(data.potions || [])].sort((a, b) => a.name.localeCompare(b.name, "it"));

    const page = el("div", { class: "page" });

    if (!potions.length) {
      page.appendChild(el("div", { class: "empty" }, "Nessuna pozione salvata. Premi “Gestisci pozioni” per aggiungerne."));
      return page;
    }

    const grid = el("div", { class: "grid" });

    for (const p of potions) {
      const qty = state.cart[p.id] || 0;

      const qtyBadge = el("div", { class: "badge" }, qty > 0 ? `x${qty}` : "");
      const imgNode = p.image
        ? el("img", {
            class: "card-img",
            src: resolveAsset(p.image),
            alt: p.name,
            loading: "lazy",
            onerror: (e) => {
              e.target.style.display = "none";
            },
          })
        : null;


      const stepper = renderQtyEditor(p.id);

      const card = el(
        "div",
        {
          class: "card",
          onclick: (e) => {
            if (e.target.closest(".qty-editor")) return;
            stepper.classList.toggle("open");
          },
        },
        el("div", { class: "card-title" }, p.name),
        el("div", { class: "card-price" }, `${p.price}${currency}`),
        el("div", { class: "card-price" }, `${p.price}${currency}`),
        imgLine,
        qtyBadge,
        stepper
      );

      grid.appendChild(card);
    }

    page.appendChild(grid);
    return page;
  }

  function renderQtyEditor(potionId) {
    const wrap = el("div", { class: "qty-editor" });
    const input = el("input", {
      class: "qty-input",
      inputmode: "numeric",
      value: String(state.cart[potionId] || 1),
      oninput: (e) => {
        const v = e.target.value.replace(/[^\d]/g, "");
        e.target.value = v;
      },
    });

    const minusBtn = el(
      "button",
      {
        class: "btn btn-ghost",
        type: "button",
        onclick: () => {
          const n = Math.max(0, safeInt(input.value, 0) - 1);
          input.value = String(n);
        },
      },
      "−"
    );

    const plusBtn = el(
      "button",
      {
        class: "btn btn-ghost",
        type: "button",
        onclick: () => {
          const n = Math.min(9999, safeInt(input.value, 0) + 1);
          input.value = String(n);
        },
      },
      "+"
    );

    const cancelBtn = el("button", { class: "btn btn-ghost", type: "button", onclick: () => wrap.classList.remove("open") }, "✕");
    const okBtn = el(
      "button",
      {
        class: "btn btn-gold",
        type: "button",
        onclick: () => {
          const n = safeInt(input.value, 0);
          if (n <= 0) delete state.cart[potionId];
          else state.cart[potionId] = n;
          wrap.classList.remove("open");
          refreshDrawerTotals();
          render(); // aggiorna badge + quickbar
        },
      },
      "✓"
    );

    wrap.appendChild(el("div", { class: "qty-row" }, minusBtn, input, plusBtn));
    wrap.appendChild(el("div", { class: "qty-actions" }, cancelBtn, okBtn));
    return wrap;
  }

  function renderRecipes() {
    const recipes = [...(state.recipesData.recipes || [])].sort((a, b) => a.name.localeCompare(b.name, "it"));
    const page = el("div", { class: "page" });

    if (!recipes.length) {
      page.appendChild(el("div", { class: "empty" }, "Nessuna ricetta salvata. Premi “Gestisci ricette” per aggiungerne."));
      return page;
    }

    const grid = el("div", { class: "grid" });

    for (const r of recipes) {
      const open = state.recipeOpen.has(r.id);
      const imgLine = el("div", { class: "imgline" }, r.image ? `Immagine: ${r.image}` : "Immagine: —");

      const details = open
        ? el(
            "div",
            { class: "recipe-details" },
            el("div", { class: "section-title" }, "Ingredienti"),
            el("div", { class: "section-text" }, (r.ingredients || "").trim() || "—"),
            el("div", { class: "section-title" }, "Procedimento"),
            el("div", { class: "section-text" }, (r.procedure || "").trim() || "—")
          )
        : null;

      const card = el(
        "div",
        {
          class: "card",
          onclick: () => {
            if (open) state.recipeOpen.delete(r.id);
            else {
              if (!state.multiSelect) state.recipeOpen.clear();
              state.recipeOpen.add(r.id);
            }
            render();
          },
        },
        el("div", { class: "card-title" }, r.name),
        imgLine,
        details
      );

      grid.appendChild(card);
    }

    page.appendChild(grid);
    return page;
  }

  // -----------------------------
  // Drawer (Carrello + impostazioni + invio Discord)
  // -----------------------------
  function renderDrawer() {
    const drawer = el("div", { class: `drawer ${state.drawerOpen ? "open" : ""}` });

    const header = el(
      "div",
      { class: "drawer-header" },
      el("div", { class: "drawer-title" }, "Carrello"),
      el("button", { class: "btn btn-ghost btn-square", type: "button", onclick: () => toggleDrawer(false) }, "×")
    );

    const actorInput = el("input", {
      class: "input",
      placeholder: "Chi ha fatto l'operazione (nome/nota)",
      value: state.settings.last_actor || "",
      oninput: (e) => (state.settings.last_actor = e.target.value),
    });

    const webhookInput = el("input", {
      class: "input",
      placeholder: "Webhook Discord (https://discord.com/api/webhooks/...)",
      value: state.settings.webhook_url || "",
      oninput: (e) => (state.settings.webhook_url = e.target.value),
    });

    const saveBtn = el("button", { class: "btn btn-ghost", type: "button", onclick: () => saveSettingsNow() }, "Salva");

    const list = el("div", { class: "cart-list" });
    const totalLine = el("div", { class: "total" }, "Totale: 0€");

    const sendBtn = el("button", { class: "btn btn-gold", type: "button", onclick: () => sendToDiscord(sendBtn) }, "Invia su Discord (Embed)");
    const clearBtn = el("button", { class: "btn btn-ghost", type: "button", onclick: () => clearCart() }, "Svuota carrello");

    drawer.appendChild(header);
    drawer.appendChild(el("div", { class: "drawer-block" }, el("div", { class: "label" }, "Operatore"), actorInput));
    drawer.appendChild(el("div", { class: "drawer-block" }, el("div", { class: "label" }, "Webhook Discord (Canale)"), webhookInput, saveBtn));
    drawer.appendChild(el("div", { class: "drawer-block" }, el("div", { class: "label" }, "Riepilogo"), list, totalLine));
    drawer.appendChild(el("div", { class: "drawer-block" }, sendBtn, clearBtn));

    fillCartList(list, totalLine);
    return drawer;
  }

  function fillCartList(container, totalLine) {
    clear(container);

    if (!(state.mode === "buy" || state.mode === "sell")) {
      totalLine.textContent = "Totale: 0€";
      container.appendChild(el("div", { class: "muted" }, "Carrello disponibile solo in Acquista/Vendi."));
      return;
    }

    const potMap = new Map((state.potionsData.potions || []).map((p) => [p.id, p]));
    const items = Object.entries(state.cart)
      .map(([pid, qty]) => ({ pid, qty: safeInt(qty, 0) }))
      .filter((x) => x.qty > 0 && potMap.has(x.pid))
      .map((x) => ({ ...x, potion: potMap.get(x.pid) }))
      .sort((a, b) => a.potion.name.localeCompare(b.potion.name, "it"));

    const currency = state.potionsData.currency || "€";
    let total = 0;

    if (!items.length) {
      container.appendChild(el("div", { class: "muted" }, "Carrello vuoto."));
      totalLine.textContent = `Totale: 0${currency}`;
      return;
    }

    for (const it of items) {
      const subtotal = it.potion.price * it.qty;
      total += subtotal;
      container.appendChild(
        el(
          "div",
          { class: "cart-row" },
          el("div", { class: "cart-name" }, it.potion.name),
          el("div", { class: "cart-qty" }, `x${it.qty}`),
          el("div", { class: "cart-sub" }, `${subtotal}${currency}`)
        )
      );
    }

    totalLine.textContent = `Totale: ${total}${currency}`;
  }

  function refreshDrawerTotals() {
    if (!(state.mode === "buy" || state.mode === "sell")) return;
    const existing = new Set((state.potionsData.potions || []).map((p) => p.id));
    for (const pid of Object.keys(state.cart)) {
      if (!existing.has(pid)) delete state.cart[pid];
    }
  }

  function toggleDrawer(open) {
    if (!(state.mode === "buy" || state.mode === "sell")) return;
    state.drawerOpen = !!open;
    render();
  }

  // -----------------------------
  // Navigation / Mode load
  // -----------------------------
  function goHome() {
    state.mode = "home";
    state.drawerOpen = false;
    state.cart = {};
    state.recipeOpen.clear();
    state.multiSelect = false;
    render();
  }

  function startMode(mode) {
    if (mode === "buy") {
      state.mode = "buy";
      state.potionsKey = LS_KEYS.POTIONS_BUY;
      state.settingsKey = LS_KEYS.SETTINGS_BUY;
      reloadMode(true);
    } else if (mode === "sell") {
      state.mode = "sell";
      state.potionsKey = LS_KEYS.POTIONS_SELL;
      state.settingsKey = LS_KEYS.SETTINGS_SELL;
      reloadMode(true);
    } else if (mode === "recipes") {
      state.mode = "recipes";
      state.drawerOpen = false;
      state.cart = {};
      state.recipesData = loadRecipes();
      state.recipeOpen.clear();
      render();
    }
  }

  function reloadMode(resetCart) {
    state.drawerOpen = false;
    state.recipeOpen.clear();
    state.potionsData = loadPotions(state.potionsKey);
    state.settings = loadSettings(state.settingsKey);

    if (resetCart) state.cart = {};
    refreshDrawerTotals();
    render();
  }

  function saveSettingsNow() {
    if (!state.settingsKey) return;

    const url = (state.settings.webhook_url || "").trim();
    if (url && !looksLikeDiscordWebhook(url)) {
      toast("Webhook non valido (deve essere discord.com/api/webhooks/...)", "error");
      return;
    }
    state.settings.last_actor = normalizeName(state.settings.last_actor || "");
    saveJSON(state.settingsKey, state.settings);
    toast("Impostazioni salvate ✅", "ok");
  }

  function clearCart() {
    if (!(state.mode === "buy" || state.mode === "sell")) return;
    state.cart = {};
    state.drawerOpen = false;
    render();
  }

  // -----------------------------
  // Discord webhook sending
  // -----------------------------
  async function sendToDiscord(btn) {
    if (!(state.mode === "buy" || state.mode === "sell")) return;

    const url = (state.settings.webhook_url || "").trim();
    if (!url) return toast("Webhook mancante. Incollalo e premi Salva.", "error");
    if (!looksLikeDiscordWebhook(url)) return toast("Webhook non valido.", "error");

    saveSettingsNow();

    const payloads = buildEmbedPayloads();
    if (!payloads.length) return toast("Niente da inviare.", "error");

    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Invio...";

    try {
      for (const payload of payloads) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok && res.status !== 204) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
        }
      }

      toast("Riepilogo inviato su Discord ✅", "ok");
      state.cart = {};
      state.drawerOpen = false;
      render();
    } catch (e) {
      toast("Errore invio: " + (e?.message || String(e)), "error");
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function buildEmbedPayloads() {
    const potMap = new Map((state.potionsData.potions || []).map((p) => [p.id, p]));
    const items = Object.entries(state.cart)
      .map(([pid, qty]) => ({ pid, qty: safeInt(qty, 0) }))
      .filter((x) => x.qty > 0 && potMap.has(x.pid))
      .map((x) => ({ ...x, potion: potMap.get(x.pid) }))
      .sort((a, b) => a.potion.name.localeCompare(b.potion.name, "it"));

    const currency = state.potionsData.currency || "€";
    const modeLabel = state.mode === "buy" ? "ACQUISTO" : "VENDITA";
    const actor = normalizeName(state.settings.last_actor || "");

    if (!items.length) {
      let desc = `**Tipo:** ${modeLabel}\n`;
      if (actor) desc += `**Operatore:** ${actor}\n`;
      desc += `\nCarrello vuoto.`;

      return [
        {
          content: "",
          embeds: [
            {
              title: `🧾 Riepilogo ${modeLabel}`,
              description: desc,
              color: 0xD4AF37,
            },
          ],
        },
      ];
    }

    const fields = [];
    let total = 0;

    for (const it of items) {
      const unit = safeInt(it.potion.price, 0);
      const subtotal = unit * it.qty;
      total += subtotal;

      fields.push({
        name: it.potion.name,
        value: `Prezzo singolo: **${unit}${currency}**\nQuantità: **${it.qty}**\nTotale: **${subtotal}${currency}**`,
        inline: false,
      });
    }

    // chunk max 20 fields
    const chunks = [];
    for (let i = 0; i < fields.length; i += 20) chunks.push(fields.slice(i, i + 20));

    let baseDesc = `**Tipo:** ${modeLabel}\n`;
    if (actor) baseDesc += `**Operatore:** ${actor}\n`;
    baseDesc += `\nRiepilogo generato dal Calcolatore Pozioni.`;

    const out = [];
    for (let i = 0; i < chunks.length; i++) {
      const embed = {
        title: `🧾 Riepilogo ${modeLabel}` + (chunks.length > 1 ? ` (Parte ${i + 1}/${chunks.length})` : ""),
        description: baseDesc,
        color: 0xD4AF37,
        fields: chunks[i],
      };

      if (i === chunks.length - 1) {
        embed.fields.push({
          name: "💰 Totale complessivo",
          value: `**${total}${currency}**`,
          inline: false,
        });
      }

      out.push({ content: "", embeds: [embed] });
    }

    return out;
  }

  // -----------------------------
  // Manage screens (modals)
  // -----------------------------
  function openManagePotions() {
    const data = clone(state.potionsData);
    const currency = data.currency || "€";
    const potions = [...(data.potions || [])].sort((a, b) => a.name.localeCompare(b.name, "it"));

    const modal = createModal(
      `Gestione Pozioni (${state.mode === "buy" ? "ACQUISTA" : "VENDI"})`,
      renderPotionsManager(potions, currency, (updatedPotions, updatedCurrency) => {
        state.potionsData.currency = (updatedCurrency || "€").trim() || "€";
        state.potionsData.potions = updatedPotions;

        saveJSON(state.potionsKey, state.potionsData);

        refreshDrawerTotals();
        toast("Pozioni salvate ✅", "ok");
        closeModal(modal);
        render();
      })
    );

    document.body.appendChild(modal);
  }

  function renderPotionsManager(potions, currency, onSaveAll) {
    let selectedId = null;

    const list = el("div", { class: "mgr-list" });
    const form = el("div", { class: "mgr-form" });

    const currencyInput = el("input", { class: "input", value: currency, maxlength: "3" });

    const nameInput = el("input", { class: "input", placeholder: "Nome" });
    const priceInput = el("input", { class: "input", placeholder: "Prezzo (intero)", inputmode: "numeric" });
    const imageInput = el("input", { class: "input", placeholder: "Immagine (solo nome/path)" });

    function redrawList() {
      clear(list);
      const header = el("div", { class: "mgr-row mgr-head" }, el("div", {}, "Nome"), el("div", {}, "Prezzo"), el("div", {}, "Immagine"));
      list.appendChild(header);

      for (const p of potions.sort((a, b) => a.name.localeCompare(b.name, "it"))) {
        const row = el(
          "button",
          {
            class: `mgr-row ${selectedId === p.id ? "active" : ""}`,
            type: "button",
            onclick: () => {
              selectedId = p.id;
              nameInput.value = p.name;
              priceInput.value = String(p.price);
              imageInput.value = p.image || "";
              redrawList();
            },
          },
          el("div", { class: "mgr-col" }, p.name),
          el("div", { class: "mgr-col mgr-right" }, String(p.price)),
          el("div", { class: "mgr-col mgr-muted" }, p.image || "—")
        );
        list.appendChild(row);
      }
    }

    function clearForm() {
      selectedId = null;
      nameInput.value = "";
      priceInput.value = "";
      imageInput.value = "";
      redrawList();
    }

    function saveOne() {
      const name = normalizeName(nameInput.value);
      const price = safeInt(priceInput.value, -1);
      const image = (imageInput.value || "").trim();

      if (!name) return toast("Nome non valido.", "error");
      if (!(price > 0)) return toast("Prezzo non valido (deve essere > 0).", "error");

      if (selectedId) {
        const idx = potions.findIndex((x) => x.id === selectedId);
        if (idx >= 0) potions[idx] = { ...potions[idx], name, price, image };
      } else {
        potions.push({ id: uid(), name, price, image });
      }
      toast("Salvato.", "ok");
      redrawList();
    }

    function deleteOne() {
      if (!selectedId) return toast("Seleziona una pozione.", "error");
      const p = potions.find((x) => x.id === selectedId);
      if (!p) return;
      if (!confirmBox(`Eliminare '${p.name}'?`)) return;
      const idx = potions.findIndex((x) => x.id === selectedId);
      if (idx >= 0) potions.splice(idx, 1);
      clearForm();
    }

    const buttons = el(
      "div",
      { class: "mgr-buttons" },
      el("button", { class: "btn btn-ghost", type: "button", onclick: () => clearForm() }, "Nuova"),
      el("button", { class: "btn btn-gold", type: "button", onclick: () => saveOne() }, "Salva"),
      el("button", { class: "btn btn-ghost", type: "button", onclick: () => deleteOne() }, "Elimina"),
      el("div", { class: "spacer" }),
      el(
        "button",
        {
          class: "btn btn-gold",
          type: "button",
          onclick: () => {
            const cur = (currencyInput.value || "€").trim() || "€";
            const cleaned = potions
              .map((p) => ({
                id: String(p.id || uid()),
                name: normalizeName(p.name),
                price: safeInt(p.price, 0),
                image: (p.image || "").toString().trim(),
              }))
              .filter((p) => p.name && p.price > 0);

            onSaveAll(cleaned, cur);
          },
        },
        "Salva tutto"
      )
    );

    form.appendChild(el("div", { class: "label" }, "Valuta"));
    form.appendChild(currencyInput);
    form.appendChild(el("div", { class: "label" }, "Nome"));
    form.appendChild(nameInput);
    form.appendChild(el("div", { class: "label" }, "Prezzo"));
    form.appendChild(priceInput);
    form.appendChild(el("div", { class: "label" }, "Immagine (testo)"));
    form.appendChild(imageInput);
    form.appendChild(buttons);

    redrawList();

    return el("div", { class: "mgr" }, list, form);
  }

  function openManageRecipes() {
    const data = clone(state.recipesData);
    const recipes = [...(data.recipes || [])].sort((a, b) => a.name.localeCompare(b.name, "it"));

    const modal = createModal(
      "Gestione Ricette",
      renderRecipesManager(recipes, (updatedRecipes) => {
        state.recipesData.recipes = updatedRecipes;
        saveJSON(LS_KEYS.RECIPES, state.recipesData);
        toast("Ricette salvate ✅", "ok");
        closeModal(modal);
        render();
      })
    );

    document.body.appendChild(modal);
  }

  function renderRecipesManager(recipes, onSaveAll) {
    let selectedId = null;

    const list = el("div", { class: "mgr-list" });
    const form = el("div", { class: "mgr-form" });

    const nameInput = el("input", { class: "input", placeholder: "Nome ricetta" });
    const imageInput = el("input", { class: "input", placeholder: "Immagine (solo nome/path)" });
    const ingredientsInput = el("textarea", { class: "input", placeholder: "Ingredienti" });
    const procedureInput = el("textarea", { class: "input", placeholder: "Procedimento" });

    function redrawList() {
      clear(list);
      const header = el("div", { class: "mgr-row mgr-head" }, el("div", {}, "Nome"), el("div", {}, "Immagine"), el("div", {}, "ID"));
      list.appendChild(header);

      for (const r of recipes.sort((a, b) => a.name.localeCompare(b.name, "it"))) {
        const row = el(
          "button",
          {
            class: `mgr-row ${selectedId === r.id ? "active" : ""}`,
            type: "button",
            onclick: () => {
              selectedId = r.id;
              nameInput.value = r.name || "";
              imageInput.value = r.image || "";
              ingredientsInput.value = r.ingredients || "";
              procedureInput.value = r.procedure || "";
              redrawList();
            },
          },
          el("div", { class: "mgr-col" }, r.name),
          el("div", { class: "mgr-col mgr-muted" }, r.image || "—"),
          el("div", { class: "mgr-col mgr-muted" }, r.id.slice(0, 8) + "…")
        );
        list.appendChild(row);
      }
    }

    function clearForm() {
      selectedId = null;
      nameInput.value = "";
      imageInput.value = "";
      ingredientsInput.value = "";
      procedureInput.value = "";
      redrawList();
    }

    function saveOne() {
      const name = normalizeName(nameInput.value);
      if (!name) return toast("Nome non valido.", "error");

      const image = (imageInput.value || "").trim();
      const ingredients = (ingredientsInput.value || "").trim();
      const procedure = (procedureInput.value || "").trim();

      if (selectedId) {
        const idx = recipes.findIndex((x) => x.id === selectedId);
        if (idx >= 0) recipes[idx] = { ...recipes[idx], name, image, ingredients, procedure };
      } else {
        recipes.push({ id: uid(), name, image, ingredients, procedure });
      }

      toast("Salvato.", "ok");
      redrawList();
    }

    function deleteOne() {
      if (!selectedId) return toast("Seleziona una ricetta.", "error");
      const r = recipes.find((x) => x.id === selectedId);
      if (!r) return;
      if (!confirmBox(`Eliminare '${r.name}'?`)) return;
      const idx = recipes.findIndex((x) => x.id === selectedId);
      if (idx >= 0) recipes.splice(idx, 1);
      clearForm();
    }

    const buttons = el(
      "div",
      { class: "mgr-buttons" },
      el("button", { class: "btn btn-ghost", type: "button", onclick: () => clearForm() }, "Nuova"),
      el("button", { class: "btn btn-gold", type: "button", onclick: () => saveOne() }, "Salva"),
      el("button", { class: "btn btn-ghost", type: "button", onclick: () => deleteOne() }, "Elimina"),
      el("div", { class: "spacer" }),
      el(
        "button",
        {
          class: "btn btn-gold",
          type: "button",
          onclick: () => {
            const cleaned = recipes
              .map((r) => ({
                id: String(r.id || uid()),
                name: normalizeName(r.name),
                image: (r.image || "").toString().trim(),
                ingredients: (r.ingredients || "").toString(),
                procedure: (r.procedure || "").toString(),
              }))
              .filter((r) => r.name);
            onSaveAll(cleaned);
          },
        },
        "Salva tutto"
      )
    );

    form.appendChild(el("div", { class: "label" }, "Nome"));
    form.appendChild(nameInput);
    form.appendChild(el("div", { class: "label" }, "Immagine (testo)"));
    form.appendChild(imageInput);
    form.appendChild(el("div", { class: "label" }, "Ingredienti"));
    form.appendChild(ingredientsInput);
    form.appendChild(el("div", { class: "label" }, "Procedimento"));
    form.appendChild(procedureInput);
    form.appendChild(buttons);

    redrawList();
    return el("div", { class: "mgr" }, list, form);
  }

    // -----------------------------
  // Modal helpers + Styles injection
  // -----------------------------
  function createModal(title, contentNode) {
    const modal = el("div", { class: "modal-backdrop" });

    const box = el("div", { class: "modal" });
    const header = el(
      "div",
      { class: "modal-header" },
      el("div", { class: "modal-title" }, title),
      el("button", { class: "btn btn-ghost btn-square", onclick: () => closeModal(modal) }, "×")
    );

    box.appendChild(header);
    box.appendChild(el("div", { class: "modal-body" }, contentNode));
    modal.appendChild(box);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });

    return modal;
  }

  function closeModal(modal) {
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function injectStyles() {
    const css = `
      :root{
        --bg:#0b0b0b; --card:#111; --muted:#bdbdbd; --gold:#d4af37; --line:#2a2a2a;
        --btn:#151515; --btn2:#1f1f1f;
      }
      *{ box-sizing:border-box; }
      body{ margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:var(--bg); color:#fff; }
      .shell{ min-height:100vh; display:flex; flex-direction:column; }

      /* TOP + QUICKBAR WRAP */
      .topwrap{ position:sticky; top:0; z-index:6; }

      .topbar{
        position:sticky; top:0; z-index:5;
        display:flex; gap:10px; align-items:center;
        padding:12px 14px;
        background:rgba(11,11,11,.92);
        border-bottom:1px solid var(--line);
        backdrop-filter: blur(8px);
      }

      /* QUICK CART BAR (solo se carrello non vuoto) */
      .quickbar{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
        padding:8px 12px;
        background:var(--gold);
        color:var(--bg);
        border-bottom:1px solid rgba(0,0,0,.25);
      }
      .quickbar-total{
        font-weight:1000;
        font-size:13px;
        letter-spacing:.2px;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .quickbar-btn{
        border:0;
        border-radius:10px;
        padding:8px 12px;
        font-weight:1000;
        font-size:13px;
        cursor:pointer;
        background:rgba(0,0,0,.14);
        color:var(--bg);
      }
      .quickbar-btn:hover{ background:rgba(0,0,0,.22); }
      .quickbar-btn:disabled{ opacity:.65; cursor:not-allowed; }

      .top-left, .top-right{ display:flex; gap:10px; align-items:center; }
      .top-center{ flex:1; display:flex; flex-direction:column; align-items:center; gap:2px; }
      .brand{ font-weight:800; color:var(--gold); font-size:18px; letter-spacing:.3px; }
      .mode{ font-size:12px; color:var(--muted); font-weight:700; }

      .page{ padding:14px; }
      .home{ flex:1; display:flex; align-items:center; justify-content:center; padding:18px; }
      .home-card{ width:min(560px, 100%); background:var(--card); border:2px solid var(--gold); border-radius:16px; padding:18px; }
      .home-title{ color:var(--muted); font-weight:700; margin-bottom:14px; text-align:center; }
      .home-actions{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
      @media (max-width:560px){ .home-actions{ grid-template-columns:1fr; } }

      .grid{ display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:12px; }
      .card{ background:var(--card); border:2px solid var(--gold); border-radius:16px; padding:14px; cursor:pointer; }
      .card-title{ font-weight:800; font-size:15px; text-align:center; }
      .card-price{ margin-top:6px; text-align:center; font-weight:900; color:var(--gold); }
      .card-img{
        width: 100%;
        height: 120px;
        object-fit: cover;
        border-radius: 12px;
        margin-top: 10px;
        border: 1px solid var(--line);
        background:#0e0e0e;
      }

      .imgline{ margin-top:8px; font-size:12px; color:var(--muted); text-align:center; }
      .badge{ margin-top:10px; text-align:center; font-weight:900; color:var(--gold); min-height:18px; }

      .qty-editor{ margin-top:10px; display:none; border-top:1px solid var(--line); padding-top:10px; }
      .qty-editor.open{ display:block; }
      .qty-row{ display:flex; gap:10px; align-items:center; justify-content:center; }
      .qty-input{ width:90px; text-align:center; font-size:18px; font-weight:900; background:#0f0f0f; color:#fff; border:1px solid var(--line); border-radius:12px; padding:10px; }
      .qty-actions{ display:flex; gap:10px; margin-top:10px; }

      .recipe-details{ margin-top:12px; border-top:1px solid var(--line); padding-top:10px; }
      .section-title{ color:var(--gold); font-weight:900; font-size:13px; margin-top:8px;}
      .section-text{ color:#eaeaea; font-size:13px; white-space:pre-wrap; }

      .btn{ border:0; border-radius:12px; padding:10px 12px; font-weight:800; cursor:pointer; background:var(--btn); color:var(--gold); }
      .btn:hover{ background:var(--btn2); }
      .btn-ghost{ background:var(--btn); color:var(--gold); }
      .btn-gold{ background:var(--gold); color:var(--bg); }
      .btn-gold:hover{ filter:brightness(1.05); }
      .btn-big{ padding:16px 14px; font-size:16px; }
      .btn-square{ width:42px; height:42px; display:inline-flex; align-items:center; justify-content:center; padding:0; border-radius:12px; }

      .empty{ color:var(--muted); font-weight:700; padding:18px; text-align:center; background:var(--card); border:1px solid var(--line); border-radius:14px; }
      .muted{ color:var(--muted); }

      .overlay{ position:fixed; inset:0; background:rgba(0,0,0,.55); opacity:0; pointer-events:none; transition:opacity .18s ease; z-index:9; }
      .overlay.open{ opacity:1; pointer-events:auto; }

      .drawer{
        position:fixed; top:0; right:-420px;
        width:min(420px, 92vw); height:100vh;
        background:#0a0a0a; border-left:2px solid var(--gold);
        z-index:10; transition:right .18s ease;
        padding:14px; overflow:auto;
      }
      .drawer.open{ right:0; }
      .drawer-header{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .drawer-title{ color:var(--gold); font-weight:900; font-size:18px; }
      .drawer-block{ margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
      .label{ color:var(--muted); font-weight:800; font-size:12px; margin-bottom:8px; }
      .input{ width:100%; border-radius:12px; border:1px solid var(--line); background:#0e0e0e; color:#fff; padding:10px 12px; font-weight:700; outline:none; }

      .cart-list{ margin-top:10px; display:flex; flex-direction:column; gap:8px; }
      .cart-row{ display:grid; grid-template-columns: 1fr auto auto; gap:10px; background:#0e0e0e; border:1px solid var(--line); border-radius:12px; padding:10px; }
      .cart-name{ font-weight:800; }
      .cart-qty{ color:var(--muted); font-weight:800; }
      .cart-sub{ color:var(--gold); font-weight:900; text-align:right; }
      .total{ margin-top:10px; font-size:18px; font-weight:900; color:var(--gold); }

      .toggle{ display:flex; align-items:center; gap:8px; font-weight:800; color:var(--gold); background:var(--btn); padding:10px 12px; border-radius:12px; }
      .toggle input{ accent-color: var(--gold); }

      .toast{
        position:fixed; left:50%; bottom:18px;
        transform:translateX(-50%) translateY(10px);
        opacity:0; transition: all .2s ease; z-index:999;
        padding:10px 12px; border-radius:12px; font-weight:900;
        background:#111; border:1px solid var(--line); color:#fff;
      }
      .toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
      .toast-ok{ border-color: rgba(212,175,55,.6); }
      .toast-error{ border-color: rgba(255,179,179,.6); }

      .modal-backdrop{ position:fixed; inset:0; background:rgba(0,0,0,.65); z-index:50; display:flex; align-items:center; justify-content:center; padding:16px; }
      .modal{ width:min(980px, 100%); max-height:90vh; overflow:auto; background:var(--bg); border:2px solid var(--gold); border-radius:16px; }
      .modal-header{
        position:sticky; top:0;
        background:rgba(11,11,11,.92); backdrop-filter: blur(8px);
        border-bottom:1px solid var(--line);
        padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:10px;
      }
      .modal-title{ font-weight:900; color:var(--gold); }
      .modal-body{ padding:14px; }

      .mgr{ display:grid; grid-template-columns: 1.3fr .9fr; gap:12px; }
      @media (max-width:860px){ .mgr{ grid-template-columns:1fr; } }
      .mgr-list{ border:1px solid var(--line); border-radius:14px; overflow:hidden; }
      .mgr-form{ border:1px solid var(--line); border-radius:14px; padding:12px; background:var(--card); }
      .mgr-row{ width:100%; display:grid; grid-template-columns: 1fr 90px 1fr; gap:10px; padding:10px; border:0; background:#0e0e0e; color:#fff; text-align:left; }
      .mgr-row + .mgr-row{ border-top:1px solid var(--line); }
      .mgr-head{ background:#0b0b0b; color:var(--muted); font-weight:900; }
      .mgr-row.active{ outline:2px solid rgba(212,175,55,.6); outline-offset:-2px; }
      .mgr-col{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .mgr-right{ text-align:right; font-weight:900; color:var(--gold); }
      .mgr-muted{ color:var(--muted); }
      .mgr-buttons{ display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
      .spacer{ flex:1; }
      textarea.input{ min-height:110px; resize:vertical; font-family:inherit; }
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // -----------------------------
  // Auto-import da /data (solo se LS vuoto)
  // -----------------------------
  async function tryAutoImportFromDataFolder() {
    // Se ci sono già dati, NON sovrascrivere
    const buyRaw = localStorage.getItem(LS_KEYS.POTIONS_BUY);
    const sellRaw = localStorage.getItem(LS_KEYS.POTIONS_SELL);
    const recRaw = localStorage.getItem(LS_KEYS.RECIPES);

    const hasSomething =
      (buyRaw && JSON.parse(buyRaw || "{}")?.potions?.length) ||
      (sellRaw && JSON.parse(sellRaw || "{}")?.potions?.length) ||
      (recRaw && JSON.parse(recRaw || "{}")?.recipes?.length);

    if (hasSomething) return false;

    const files = [
      { url: "data/potions_acquisto.json", key: LS_KEYS.POTIONS_BUY, type: "potions" },
      { url: "data/potions_vendita.json", key: LS_KEYS.POTIONS_SELL, type: "potions" },
      { url: "data/ricette.json", key: LS_KEYS.RECIPES, type: "recipes" },
      { url: "data/settings_acquisto.json", key: LS_KEYS.SETTINGS_BUY, type: "settings" },
      { url: "data/settings_vendita.json", key: LS_KEYS.SETTINGS_SELL, type: "settings" },
    ];

    let importedAny = false;

    for (const f of files) {
      try {
        const res = await fetch(f.url, { cache: "no-store" });
        if (!res.ok) continue;
        const json = await res.json();

        if (f.type === "potions") {
          if (!json || typeof json !== "object") continue;
          const currency = (json.currency || "€").toString();
          const potions = Array.isArray(json.potions) ? json.potions : [];
          const cleaned = {
            currency,
            potions: potions
              .filter((p) => p && typeof p === "object")
              .map((p) => ({
                id: String(p.id || uid()),
                name: normalizeName(String(p.name || "")),
                price: safeInt(p.price, 0),
                image: (p.image || "").toString().trim(),
              }))
              .filter((p) => p.name && p.price > 0),
          };
          saveJSON(f.key, cleaned);
          importedAny = true;
        }

        if (f.type === "recipes") {
          if (!json || typeof json !== "object") continue;
          const recipes = Array.isArray(json.recipes) ? json.recipes : [];
          const cleaned = {
            recipes: recipes
              .filter((r) => r && typeof r === "object")
              .map((r) => ({
                id: String(r.id || uid()),
                name: normalizeName(String(r.name || "")),
                image: (r.image || "").toString().trim(),
                ingredients: (r.ingredients || "").toString(),
                procedure: (r.procedure || "").toString(),
              }))
              .filter((r) => r.name),
          };
          saveJSON(f.key, cleaned);
          importedAny = true;
        }

        if (f.type === "settings") {
          if (!json || typeof json !== "object") continue;
          const cleaned = {
            webhook_url: (json.webhook_url || "").toString(),
            last_actor: (json.last_actor || "").toString(),
          };
          saveJSON(f.key, cleaned);
          importedAny = true;
        }
      } catch {
        // skip
      }
    }

    return importedAny;
  }

  // Boot
  (async () => {
    const imported = await tryAutoImportFromDataFolder();
    if (imported) toast("Dati importati da /data ✅", "ok");
    render();
  })();
})(); 
