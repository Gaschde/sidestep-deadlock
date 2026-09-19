import { formatSouls, manifestsAreCompatible, parseCsv } from "./lib.mjs";
import { buildOptimizerData } from "./optimizer.mjs";
import { evaluateCarryPerformance } from "./warden-search.mjs";
import { FAST_SEARCH_BUDGET, PRODUCT_SEARCH_TIME_MS } from "./search-config.mjs";

const paths = {
  coreManifest: "../data/core/manifest.json",
  heroManifest: "../data/heroes/manifest.json",
  items: "../data/core/items.csv",
  itemMechanics: "../data/core/item_mechanics.csv",
  upgrades: "../data/core/item_upgrades.csv",
  heroes: "../data/heroes/heroes.csv",
  abilities: "../data/heroes/abilities.csv",
  abilityMechanics: "../data/heroes/ability_mechanics.csv",
  interactions: "../data/interactions/hero_interactions.csv",
  progression: "../data/heroes/progression.json",
  heroStats: "../data/heroes/hero_stats.csv",
  heroResources: "../data/heroes/hero_resources.csv",
  economy: "../data/core/economy.json",
  slots: "../data/core/slots.json"
};

const state = {
  build: null,
  paretoBuilds: [],
  selectedParetoIndex: 0,
  pickerMode: "hero",
  pickerSlot: null,
  selectedHeroId: "warden",
  data: null
};
let activeOptimizerWorker = null;

// Public hero icons from the open, game-extracted asset catalogue. They are
// visual UI assets only; canonical game values still come from data/heroes.
const heroAssetIds = Object.freeze({
  celeste: "unicorn",
  graves: "necro",
  mina: "vampirebat",
  the_doorman: "doorman"
});
const heroAssetUrls = Object.freeze({
  vyper: "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/1abd1b51-ad97-49a1-98b9-46fa901fde74/content-assets/hero-vyper-lane-portrait/vyper_sm.webp"
});
const heroArt = (heroId) => {
  if (heroAssetUrls[heroId]) return heroAssetUrls[heroId];
  const assetId = heroAssetIds[heroId] || heroId;
  return `https://media.githubusercontent.com/media/0xThiagoAmaral/deadlock-open-assets/main/images/deadlock/heroes_circle/${assetId}.png`;
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

async function loadText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

async function loadData() {
  const entries = await Promise.all([
    fetch(paths.coreManifest).then((response) => response.json()),
    fetch(paths.heroManifest).then((response) => response.json()),
    loadText(paths.items).then(parseCsv),
    loadText(paths.itemMechanics).then(parseCsv),
    loadText(paths.upgrades).then(parseCsv),
    loadText(paths.heroes).then(parseCsv),
    loadText(paths.abilities).then(parseCsv),
    loadText(paths.abilityMechanics).then(parseCsv),
    loadText(paths.interactions).then(parseCsv),
    fetch(paths.progression).then((response) => response.json()),
    loadText(paths.heroStats).then(parseCsv),
    loadText(paths.heroResources).then(parseCsv),
    fetch(paths.economy).then((response) => response.json()),
    fetch(paths.slots).then((response) => response.json())
  ]);
  const [coreManifest, heroManifest, items, itemMechanics, upgrades, heroes, abilities, abilityMechanics, interactions, progression, heroStats, heroResources, economy, slots] = entries;
  return buildOptimizerData({
    coreManifest,
    heroManifest,
    items,
    itemMechanics,
    upgrades,
    heroes: heroes.sort((a, b) => a.display_name.localeCompare(b.display_name, "de")),
    abilities,
    abilityMechanics,
    interactions,
    progression,
    heroStats, heroResources,
    economy,
    slots
  });
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatarMarkup(hero, size = "") {
  const art = hero ? heroArt(hero.hero_id) : null;
  const name = hero?.display_name || "Nicht gewählt";
  return `<span class="avatar ${size} ${art ? "has-art" : ""}" aria-hidden="true">${art ? `<img src="${art}" alt="" onerror="this.remove()">` : ""}<span>${hero ? initials(name) : "—"}</span></span>`;
}

function getHero(id) {
  return state.data.heroes.find((hero) => hero.hero_id === id);
}

function isPublicHero(hero) {
  return hero.publicly_playable === "true";
}

function categoryClass(category) {
  return `category-${category.toLowerCase()}`;
}

function itemTile(item, compact = false) {
  return `<span class="item-tile ${categoryClass(item.category)} ${compact ? "compact" : ""}" aria-hidden="true"><span>${initials(item.name)}</span></span>`;
}

function renderDatasetStatus() {
  const { coreManifest, heroManifest, items, upgrades, heroes, abilities, interactions } = state.data;
  const publicHeroes = heroes.filter(isPublicHero);
  const compatible = manifestsAreCompatible(coreManifest, heroManifest);
  const badge = $("#patch-badge");
  badge.textContent = compatible ? coreManifest.patch : "Patch-Konflikt";
  badge.className = `badge ${compatible ? "badge-good" : "badge-warning"}`;
  $("#dataset-status").innerHTML = `<span class="status-dot"></span>${publicHeroes.length} aktive Helden · ${items.length} Items · ${interactions.length} Interaktionen`;
  $("#source-patch").textContent = `${coreManifest.data_as_of} · ${coreManifest.mode}`;
  $("#source-stats").innerHTML = [
    [items.length, "Shop-Items", "data/core/items.csv"],
    [upgrades.length, "Upgrade-Kanten", "data/core/item_upgrades.csv"],
    [`${publicHeroes.length}/${heroes.length}`, "aktive / kanonische Helden", "data/heroes/heroes.csv"],
    [abilities.length, "Fähigkeiten", "data/heroes/abilities.csv"],
    [interactions.length, "Interaktionen", "data/interactions/hero_interactions.csv"]
  ].map(([value, label, source]) => `<article><strong>${value}</strong><span>${label}</span><small>${source}</small></article>`).join("");
}

function renderSelections() {
  const hero = getHero(state.selectedHeroId);
  $("#hero-name").textContent = hero.display_name;
  $("#hero-avatar").outerHTML = avatarMarkup(hero, "avatar-large").replace('class="avatar', 'id="hero-avatar" class="avatar');
  $("#result-hero").textContent = hero.display_name;
  $("#results").dataset.focus = $("#damage-focus").value;
}

function renderAbilities() {
  const hero = getHero(state.selectedHeroId);
  const abilities = state.data.abilities
    .filter((ability) => ability.hero_id === state.selectedHeroId)
    .sort((a, b) => String(a.ability_slot).localeCompare(String(b.ability_slot), undefined, { numeric: true }));
  const thresholds = state.data.progression.ability_unlocks.soul_thresholds;
  const costs = state.data.progression.ability_points.upgrade_costs;
  // Die Spalten sind die Reihenfolge der Skill-Schritte, nicht Soul-Budgets.
  // So entspricht die Darstellung dem Ingame-Build-Strahl und bleibt klar als Demo markiert.
  const timelinePositions = [[1, 2, 9, 13], [5, 6, 11, 15], [3, 4, 10, 14], [7, 8, 12, 16]];
  $("#ability-title").textContent = `${hero.display_name} Skill-Übersicht`;
  $("#ability-meta").textContent = abilities.length === 4 ? "Mechanisch gültiger Demo-Strahl" : `${abilities.length} Fähigkeiten · verifiziert`;
  if (abilities.length !== 4) {
    $("#ability-board").innerHTML = `<div class="empty-state">Für diesen Helden sind keine vier Fähigkeiten im geladenen Datensatz enthalten.</div>`;
    return;
  }
  $("#ability-board").innerHTML = `
    <div class="ability-timeline" aria-label="Skill-Strahl von links nach rechts">
      <div class="skill-timeline-header"><span>Reihenfolge</span>${Array.from({ length: 16 }, (_, index) => `<span>${String(index + 1).padStart(2, "0")}</span>`).join("")}</div>
      ${abilities.map((ability, index) => {
        const positions = timelinePositions[index];
        const unlockThreshold = formatSouls(thresholds[Math.min(index, thresholds.length - 1)]);
        return `<article class="skill-timeline-row">
          <div class="ability-identity timeline-identity"><span class="ability-key">${ability.ability_slot || "I"}</span><span class="ability-orb">${initials(ability.name)}</span><div><strong>${ability.name}</strong><small>${ability.ability_type}${ability.base_cooldown ? ` · ${ability.base_cooldown}s Basis-CD` : ""}</small></div></div>
          <div class="skill-event unlock-event" style="grid-column:${positions[0] + 1}" aria-label="Freischalten ab ${unlockThreshold}"><span class="unlock-diamond" title="Freischalten ab ${unlockThreshold}"></span></div>
          ${costs.map((cost, costIndex) => `<div class="skill-event ap-event" style="grid-column:${positions[costIndex + 1] + 1}" aria-label="${cost} Ability Points für Stufe ${costIndex + 1}"><span>${cost}<small>AP</small></span></div>`).join("")}
        </article>`;
      }).join("")}
    </div>`;
}

function renderBuildCard(event) {
  const itemName = event.item?.name || event.item_id || event.from || "Unbekanntes Item";
  const tile = event.item
    ? itemTile(event.item)
    : `<span class="item-tile" aria-hidden="true"><span>?</span></span>`;
  const actionLabel = {
    purchase: "Kauf",
    upgrade: "Upgrade",
    replacement: "Replacement",
    sell: "Sell"
  }[event.purchase_type] || event.purchase_type;
  const detail = event.purchase_type === "replacement"
    ? `ersetzt ${event.upgradeFrom?.name || event.from || "unbekannt"}`
    : event.purchase_type === "upgrade"
    ? `von ${event.upgradeFrom?.name || event.from || "unbekannt"}`
    : event.purchase_type === "sell"
    ? itemName
    : `${event.item?.category || "Item"} · T${event.item?.tier || "?"}`;
  const money = event.purchase_type === "sell"
    ? `Erlös ${formatSouls(event.saleProceeds || 0)}`
    : Number.isFinite(event.cashCost)
    ? `Kosten ${formatSouls(event.cashCost)}`
    : "Kosten nicht separat ausgewiesen";
  return `<article class="build-card">
    <span class="build-order">${String(event.step).padStart(2, "0")}</span>
    ${tile}
    <strong>${itemName}</strong>
    <small>${actionLabel} · ${detail}</small>
    <small>bei ${formatSouls(event.earnedSouls || 0)} earned Souls</small>
    <small>${money}</small>
  </article>`;
}

function clearBuildState() {
  state.build = null;
  state.paretoBuilds = [];
  state.selectedParetoIndex = 0;
}

function profileIsExperimental(evaluation) {
  const abilities = evaluation?.scenarios?.common?.spirit_mechanics?.abilities || [];
  return abilities.length !== 4 || abilities.some((ability) => Boolean(ability.excluded));
}

function formatObjective(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "—";
}

function renderPhase() {
  const panel = $("#phase-panel");
  if (!state.build) {
    panel.innerHTML = `<div class="empty-state"><span>✦</span><h2>Bereit für die Build-Prüfung</h2><p>Held, Carry und Weapon/Spirit/Hybrid wählen. Ein Klick startet den aktuellen experimentellen Multiobjective-Optimizer bis 40.000 Souls.</p></div>`;
    return;
  }

  const variant = state.build;
  const telemetry = variant.search.telemetry;
  const focusLabel = { weapon: "Weapon", spirit: "Spirit", hybrid: "Hybrid" }[$("#damage-focus").value] || $("#damage-focus").value;
  const naturalReach = telemetry.terminalCompletion?.naturalSearchMaxReachedSouls ?? 0;
  const searchStates = telemetry.searchGeneratedStates ?? telemetry.generatedStates ?? 0;
  const terminalCandidates = telemetry.terminalCandidates ?? 0;
  const paretoSize = state.paretoBuilds.length;
  const experimentalHero = profileIsExperimental(variant.winner.evaluation);
  const saveHint = variant.saveSteps > 0
    ? `<p class="section-note"><strong>Save-to-40k:</strong> ${variant.saveSteps.toLocaleString("de-CH")} interne Save-Schritte wurden für die legale Completion verwendet. Sie sind keine Shop-Transaktionen und werden deshalb nicht einzeln dargestellt.</p>`
    : "";
  const heroNote = experimentalHero
    ? `<p class="section-note"><strong>Experimentelles Heldenprofil:</strong> Mindestens eine Ability/Interaction ist im aktuellen Modell nicht vollständig auswertbar. Der Build wird trotzdem mit den belegten Daten berechnet.</p>`
    : "";

  const statusRows = [
    ["Hero", getHero(state.selectedHeroId).display_name],
    ["Rolle", "Carry"],
    ["Focus", focusLabel],
    ["Horizon", formatSouls(FAST_SEARCH_BUDGET)],
    ["Wallclock-Budget", `${Math.round(PRODUCT_SEARCH_TIME_MS / 1000)} s`],
    ["Path-AUC", formatObjective(variant.pathScore)],
    ["Endbuild", formatObjective(variant.endScore)],
    ["Natural Reach", `${formatSouls(naturalReach)} / ${formatSouls(FAST_SEARCH_BUDGET)}`],
    ["Search States", searchStates.toLocaleString("de-CH")],
    ["Evaluations", (telemetry.evaluations ?? 0).toLocaleString("de-CH")],
    ["Terminal / Pareto", `${terminalCandidates} / ${paretoSize}`],
    ["legal replay verified", variant.validation?.valid === true ? "ja" : "nein"],
    ["Status", "experimenteller Multiobjective-Optimizer"]
  ];

  const variantControls = paretoSize > 1
    ? `<div class="pareto-switcher" aria-label="Pareto-Builds">${state.paretoBuilds.map((candidate, index) =>
        `<button type="button" data-pareto-index="${index}" aria-current="${index === state.selectedParetoIndex ? "true" : "false"}">Build ${index + 1}<small>Path ${formatObjective(candidate.pathScore)} · End ${formatObjective(candidate.endScore)}</small></button>`
      ).join("")}</div>`
    : `<p class="section-note"><strong>Pareto-Front:</strong> 1 terminale Variante.</p>`;

  panel.innerHTML = `
    <div class="section-heading">
      <div><p class="eyebrow">Multiobjective Preview · keine Scalarisierung</p><h2>${getHero(state.selectedHeroId).display_name} · Build ${state.selectedParetoIndex + 1} / ${paretoSize}</h2></div>
      <span class="meta-chip">${variant.inventory.length} / ${state.data.slots.item_limit} finale Slots</span>
    </div>
    ${variantControls}
    <div class="optimizer-status-grid">${statusRows.map(([label, value]) => `<article><small>${label}</small><strong>${value}</strong></article>`).join("")}</div>
    <section class="final-inventory" aria-label="Finales Inventar"><h3>Finales Inventar</h3><p>${variant.inventory.map((item) => item?.name || "Unbekannt").join(" · ") || "leer"}</p></section>
    <section class="chronological-build" aria-label="Chronologischer Kaufpfad">
      <div class="build-phase-heading"><h3>Kompletter chronologischer Kaufpfad</h3><span>${variant.events.length} Shop-Transaktionen</span></div>
      <div class="build-card-row">${variant.events.map(renderBuildCard).join("") || `<p class="empty-phase">Keine Shop-Transaktion vor dem 40k-Horizont.</p>`}</div>
    </section>
    ${saveHint}
    ${heroNote}
    <p class="section-note">Path-AUC und Endbuild bleiben getrennte Ziele. Die Reihenfolge der angezeigten Pareto-Varianten ist nur Darstellungsreihenfolge und keine Siegerauswahl.</p>`;

  $$("[data-pareto-index]", panel).forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.paretoIndex);
    if (!Number.isSafeInteger(index) || !state.paretoBuilds[index]) return;
    state.selectedParetoIndex = index;
    state.build = state.paretoBuilds[index];
    renderPhase();
  }));
}

function setFastControls(running) {
  $("#fast-build-button").textContent = running ? "Suche läuft · 40k" : "Build erstellen · 40k";
  for (const id of ["fast-build-button", "hero-trigger", "role", "damage-focus"]) $("#" + id).disabled = running;
}

function mapParetoVariant(entry, result, damageFocus) {
  const itemMap = state.data.itemsById;
  const allEvents = entry.state.events || [];
  const snapshots = entry.state.snapshots || [];
  const events = allEvents
    .map((event, index) => ({ event, snapshot: snapshots[index + 1] }))
    .filter(({ event }) => event.type !== "save")
    .map(({ event, snapshot }, index) => ({
      step: index + 1,
      item: itemMap.get(event.type === "sell" ? event.from : event.item),
      item_id: event.item,
      from: event.from,
      upgradeFrom: event.from ? itemMap.get(event.from) : null,
      purchase_type: event.type,
      earnedSouls: snapshot?.earnedSouls ?? event.earnedSouls ?? 0,
      cashCost: event.payment,
      saleProceeds: event.saleProceeds || 0
    }));
  const inventory = entry.state.inventory.map((id) => itemMap.get(id)).filter(Boolean);
  const evaluation = evaluateCarryPerformance(entry.state, {
    heroId: state.selectedHeroId,
    damageFocus,
    budget: FAST_SEARCH_BUDGET
  }, state.data);
  return {
    events,
    inventory,
    spent: entry.state.earnedSouls - entry.state.cash,
    saveSteps: allEvents.filter((event) => event.type === "save").length,
    pathScore: entry.pathScore,
    endScore: entry.endScore,
    validation: entry.validation,
    sources: entry.sources,
    winner: { evaluation },
    search: {
      telemetry: result.telemetry,
      frontSize: result.front.length,
      scalarizationUsed: result.telemetry.scalarizationUsed
    }
  };
}

function startFastBuild() {
  if (activeOptimizerWorker) return;
  if ($("#role").value !== "carry") {
    $("#search-progress").textContent = "Dieser Build-Lauf unterstützt derzeit nur Carry.";
    return;
  }

  const damageFocus = $("#damage-focus").value;
  clearBuildState();
  setFastControls(true);
  $("#search-progress").textContent = `Multiobjective (Path-AUC, Endbuild) läuft · ${Math.round(PRODUCT_SEARCH_TIME_MS / 1000)} s Wallclock-Budget · hero-/focus-passende Referenz wird vorbereitet.`;
  const worker = activeOptimizerWorker = new Worker("./optimizer-worker.mjs", { type: "module" });
  const finish = (text) => {
    worker.terminate();
    activeOptimizerWorker = null;
    setFastControls(false);
    $("#search-progress").textContent = text;
  };

  worker.onmessage = ({ data: message }) => {
    if (message.type === "started") {
      $("#search-progress").textContent = `Multiobjective gestartet · ${message.itemCount} Items · ${formatSouls(message.budget)} Horizon · ${Math.round(message.timeBudgetMs / 1000)} s Wallclock.`;
    } else if (message.type === "progress") {
      if (message.phase === "sampled-reference") {
        $("#search-progress").textContent = `Hero-/Focus-Referenz vorbereitet · ${(message.runtimeMs / 1000).toFixed(2)} s · ${message.evaluations.toLocaleString("de-CH")} Inventare bewertet.`;
      } else if (message.phase === "multiobjective") {
        $("#search-progress").textContent = `Multiobjective Width ${message.width} · Natural Reach ${formatSouls(message.maxReachedSouls)} · ${message.generatedStates.toLocaleString("de-CH")} Zustände · ${message.evaluations.toLocaleString("de-CH")} Evaluations · ${message.terminalCandidates} Terminalkandidaten.`;
      }
    } else if (message.type === "search-complete") {
      const result = message.result;
      if (!Array.isArray(result.front) || result.front.length === 0) {
        finish("Suche beendet, aber ohne terminale Pareto-Variante.");
        return;
      }
      state.paretoBuilds = result.front.map((entry) => mapParetoVariant(entry, result, damageFocus));
      state.selectedParetoIndex = 0;
      state.build = state.paretoBuilds[0];
      $("#results").dataset.focus = damageFocus;
      $("#result-summary").textContent = `${state.paretoBuilds.length} terminale Pareto-Variante${state.paretoBuilds.length === 1 ? "" : "n"} · Path-AUC und Endbuild getrennt · legal replay ${state.paretoBuilds.every((entry) => entry.validation?.valid === true) ? "verifiziert" : "nicht vollständig verifiziert"}`;
      renderPhase();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      finish(`Abgeschlossen · Multiobjective · ${(result.telemetry.runtimeMs / 1000).toFixed(1)} s · ${result.telemetry.evaluations.toLocaleString("de-CH")} Evaluations · Pareto-Front ${result.front.length}.`);
    } else if (message.type === "error") {
      finish(`Suche fehlgeschlagen: ${message.message}`);
    }
  };
  worker.onerror = (error) => finish(`Worker-Fehler: ${error.message || "unbekannter Fehler"}`);
  worker.postMessage({
    data: state.data,
    itemIds: state.data.items.map((item) => item.item_id),
    budget: FAST_SEARCH_BUDGET,
    heroId: state.selectedHeroId,
    damageFocus
  });
}

function renderPicker(filter = "") {
  const list = $("#picker-list");
  const normalized = filter.trim().toLocaleLowerCase("de");
  const candidates = state.data.heroes.filter((hero) => isPublicHero(hero) && hero.display_name.toLocaleLowerCase("de").includes(normalized));
  list.innerHTML = candidates.map((hero) => `<button type="button" data-hero-id="${hero.hero_id}">${avatarMarkup(hero)}<span><strong>${hero.display_name}</strong><small>öffentlich spielbar</small></span>${hero.hero_id === state.selectedHeroId ? `<em>Aktiver Held</em>` : ""}</button>`).join("") || `<div class="empty-state compact"><p>Kein aktiver Held gefunden.</p></div>`;
  $$('[data-hero-id]', list).forEach((button) => button.addEventListener("click", () => chooseHero(button.dataset.heroId)));
}

function openPicker(mode, slot = null) {
  state.pickerMode = mode;
  state.pickerSlot = slot;
  $("#picker-eyebrow").textContent = "Build-Grundlage";
  $("#picker-title").textContent = "Held wählen";
  $("#picker-search").value = "";
  renderPicker();
  $("#picker-dialog").showModal();
  $("#picker-search").focus();
}

function chooseHero(heroId) {
  state.selectedHeroId = heroId;
  clearBuildState();
  $("#result-summary").textContent = "Auswahl geändert · Build erneut prüfen";
  $("#picker-dialog").close();
  renderSelections();
  renderAbilities();
  renderPhase();
}

function bindEvents() {
  $("#hero-trigger").addEventListener("click", () => openPicker("hero"));

  $("#picker-search").addEventListener("input", (event) => renderPicker(event.target.value));
  $("#role").addEventListener("change", () => {
    clearBuildState();
    $("#results").dataset.focus = $("#damage-focus").value;
    $("#result-summary").textContent = "Auswahl geändert · Build erneut prüfen";
    renderPhase();
  });
  $("#damage-focus").addEventListener("change", () => $("#role").dispatchEvent(new Event("change")));
  $("#fast-build-button").addEventListener("click", startFastBuild);
}

async function init() {
  try {
    state.data = await loadData();
    renderDatasetStatus();
    renderSelections();
    renderAbilities();
    renderPhase();
    bindEvents();
  } catch (error) {
    const notice = $("#data-error");
    notice.hidden = false;
    notice.textContent = `Die lokalen Daten konnten nicht geladen werden: ${error.message}. Bitte die App über den lokalen Server öffnen.`;
    $("#fast-build-button").disabled = true;
    console.error(error);
  }
}

init();
