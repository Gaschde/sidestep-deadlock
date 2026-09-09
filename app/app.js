import { formatSouls, manifestsAreCompatible, parseCsv } from "./lib.mjs";
import { buildOptimizerData, optimizeWeaponCarryFullBuild } from "./optimizer.mjs";
import { evaluateWardenCarryPerformance } from "./warden-search.mjs";

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
  economy: "../data/core/economy.json",
  slots: "../data/core/slots.json"
};

const state = {
  build: null,
  pickerMode: "hero",
  pickerSlot: null,
  selectedHeroId: "warden",
  data: null
};
let activeOptimizerWorker = null;

const heroArt = {
  warden: "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/1abd1b51-ad97-49a1-98b9-46fa901fde74/content-assets/warden-hero-portrait/warden_card.webp",
  vyper: "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/1abd1b51-ad97-49a1-98b9-46fa901fde74/content-assets/hero-vyper-lane-portrait/vyper_sm.webp",
  abrams: "https://vgbujcuwptvheqijyjbe.supabase.co/storage/v1/object/public/hmac-uploads/projects/1abd1b51-ad97-49a1-98b9-46fa901fde74/content-assets/hero-abrams-lane-portrait/abrams_sm.webp"
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
    fetch(paths.economy).then((response) => response.json()),
    fetch(paths.slots).then((response) => response.json())
  ]);
  const [coreManifest, heroManifest, items, itemMechanics, upgrades, heroes, abilities, abilityMechanics, interactions, progression, heroStats, economy, slots] = entries;
  return buildOptimizerData({
    coreManifest,
    heroManifest,
    items,
    itemMechanics,
    upgrades,
    heroes: heroes.filter((hero) => hero.publicly_playable === "true").sort((a, b) => a.display_name.localeCompare(b.display_name, "de")),
    abilities,
    abilityMechanics,
    interactions,
    progression,
    heroStats,
    economy,
    slots
  });
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatarMarkup(hero, size = "") {
  const art = heroArt[hero?.hero_id];
  const name = hero?.display_name || "Nicht gewählt";
  return `<span class="avatar ${size} ${art ? "has-art" : ""}" aria-hidden="true">${art ? `<img src="${art}" alt="" onerror="this.remove()">` : ""}<span>${hero ? initials(name) : "—"}</span></span>`;
}

function getHero(id) {
  return state.data.heroes.find((hero) => hero.hero_id === id);
}

function categoryClass(category) {
  return `category-${category.toLowerCase()}`;
}

function itemTile(item, compact = false) {
  return `<span class="item-tile ${categoryClass(item.category)} ${compact ? "compact" : ""}" aria-hidden="true"><span>${initials(item.name)}</span></span>`;
}

function renderDatasetStatus() {
  const { coreManifest, heroManifest, items, upgrades, heroes, abilities, interactions } = state.data;
  const compatible = manifestsAreCompatible(coreManifest, heroManifest);
  const badge = $("#patch-badge");
  badge.textContent = compatible ? coreManifest.patch : "Patch-Konflikt";
  badge.className = `badge ${compatible ? "badge-good" : "badge-warning"}`;
  $("#dataset-status").innerHTML = `<span class="status-dot"></span>${heroes.length} Helden · ${items.length} Items · ${interactions.length} Interaktionen`;
  $("#source-patch").textContent = `${coreManifest.data_as_of} · ${coreManifest.mode}`;
  $("#source-stats").innerHTML = [
    [items.length, "Shop-Items", "data/core/items.csv"],
    [upgrades.length, "Upgrade-Kanten", "data/core/item_upgrades.csv"],
    [heroes.length, "spielbare Helden", "data/heroes/heroes.csv"],
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
  if (event.purchase_type === "save") {
    return `<article class="build-card"><span class="build-order">${String(event.step).padStart(2, "0")}</span><strong>Sparen</strong><small>Bis ${formatSouls(event.earnedSouls)} verdiente Souls</small></article>`;
  }
  const upgrade = event.upgradeFrom;
  return `<article class="build-card">
    <span class="build-order">${String(event.step).padStart(2, "0")}</span>
    ${itemTile(event.item)}
    <strong>${event.item.name}</strong>
    <small>${event.purchase_type === "sell" ? "Verkaufen" : event.purchase_type === "replacement" ? `Ersetzt ${upgrade.name}` : upgrade ? `↑ ${upgrade.name}` : `${event.item.category} · T${event.item.tier}`}</small>
    ${event.earnedSouls === undefined ? "" : `<small>Bei ${event.earnedSouls.toLocaleString("de-CH")} verdienten Souls</small>`}
  </article>`;
}

function buildPhaseGroups(events) {
  // Diese Abschnitte erklären die Kaufreihenfolge visuell; sie steuern keine
  // Optimizer-Regel und behaupten keine festen Spielzeit-Meilensteine.
  const earlyEnd = Math.max(1, Math.ceil(events.length * 0.375));
  const midEnd = Math.max(earlyEnd, Math.ceil(events.length * 0.6875));
  return {
    early: events.slice(0, earlyEnd),
    mid: events.slice(earlyEnd, midEnd),
    late: events.slice(midEnd)
  };
}

function renderPhase() {
  const panel = $("#phase-panel");
  if (!state.build) {
    panel.innerHTML = `<div class="empty-state"><span>✦</span><h2>Bereit für die Build-Prüfung</h2><p>Wähle Held, Rolle und Schadensfokus. Der aktuelle Slice unterstützt Carry mit Weapon-Fokus und prüft dafür legale Kaufpfade sowie verifizierte, dauerhaft verfügbare Weapon-Effekte.</p></div>`;
    return;
  }

  const labels = { early: "Early", mid: "Mid", late: "Late" };
  const groups = buildPhaseGroups(state.build.events);
  const isNewSearch = Boolean(state.build.search?.byMetric);
  const combat = state.build.winner.evaluation.scenarios.common;
  const combatInputs = state.build.winner.evaluation.scenarios.inputs;
  const scenarioSummary = `<p><strong>Baseline (offene Modellannahmen):</strong> ${combat.sustained_weapon_dps.toFixed(1)} Sustained Weapon DPS · ${combat.effective_health_bullet?.toFixed(0) || "?"} Bullet-EHP · ${combat.effective_health_spirit?.toFixed(0) || "?"} Spirit-EHP. ${combat.item_kit_synergies.length} belegte Item×Kit-/Range-Bezüge dokumentiert; bedingte Effekte sind nicht als Dauerbonus eingerechnet.</p>`;
  const combatStateSummary = `<p><strong>Vergleichszustand:</strong> ${combatInputs.hero_level.value === null ? "Heldenlevel unbekannt – es gelten nur die kanonischen Basiswerte." : `Heldenlevel ${combatInputs.hero_level.value} ist angegeben, aber ohne verifizierte Level→Boon-Zuordnung nicht in Werte übersetzt.`} ${combatInputs.ability_levels.value === null ? "Skillzustand unbekannt – Fähigkeiten liefern keine stillschweigenden Kampfboni." : "Skillzustand ist angegeben, aber noch nicht in der gemeinsamen Item-/Skill-Suche berechnet."}</p>`;
  const foundations = state.build.winner.evaluation.foundations;
  const foundationSummary = state.build.search?.approximate
    ? `<p><strong>Approximative Auswahl:</strong> 70 % Endstärke · 15 % schlimmster · 15 % durchschnittlicher Rückstand. Stichprobenreferenz, keine Optimalitätsgarantie. Alle sieben Kennzahlen gleich gewichtet; Endwerte x/(x+Referenz). Vier Upgrade-Kanten sowie aktive Effekte/Combos sind nicht vollständig modelliert.</p>`
    : isNewSearch
    ? `<p><strong>Neue Suchauswertung:</strong> ${state.build.search.metrics.length} getrennte Szenario-/Leistungsziele; die vollständige Itemmenge wurde im Worker untersucht. Der ausgewählte Pfad ist nur ein repräsentativer Pareto-Pfad, kein Gesamtsieger.</p>`
    : `<p><strong>Robuste Frühbasis:</strong> ${foundations.checkpoints.map((entry) => `${entry.budget.toLocaleString("de-CH")} Souls: ${entry.fulfilled ? "erfüllt" : "nicht erfüllt"}`).join(" · ")}. Schutz zählt nur als Vitality-Schutzitem oder dauerhafte Bullet-/Spirit-Resistenz; Heldenfähigkeiten ersetzen ohne Skill-Reihenfolge kein gekauftes Sustain-Item.</p>`;
  const title = isNewSearch ? "Warden-Suchlauf im ausgewiesenen Modell" : "Warden Weapon Carry";
  const eyebrow = state.build.search?.approximate ? "Bester geprüfter Build · approximative Suche" : isNewSearch ? "Gemeinsame Pareto-Suche · repräsentativer Pfad" : "Bisheriger Optimizer · bester geprüfter Pfad";
  panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">${eyebrow}</p><h2>${title}</h2></div><span class="meta-chip">${state.build.inventory.length} / ${isNewSearch ? state.data.slots.starting_slots.universal : state.data.slots.item_limit} finale Slots</span></div><section aria-label="Finales Inventar"><h3>Finales Inventar</h3><p>${state.build.inventory.map((item) => item.name).join(" · ")}</p></section><div class="build-board">${Object.entries(labels).map(([phase, label]) => `<section class="build-phase build-phase-${phase}"><div class="build-phase-heading"><h3>${label}</h3><span>${groups[phase].length} Schritte</span></div><div class="build-card-row">${groups[phase].map(renderBuildCard).join("") || `<p class="empty-phase">Keine Käufe in dieser Phase.</p>`}</div></section>`).join("")}</div><div class="build-board-footer">${scenarioSummary}${combatStateSummary}${foundationSummary}<p>${state.build.scope || state.build.search.scope}</p></div>`;
}

async function createBuild() {
  const role = $("#role").value;
  const damageFocus = $("#damage-focus").value;
  if (role !== "carry" || damageFocus !== "weapon") {
    state.build = null;
    $("#result-summary").textContent = "Diese Kombination ist als Eingabe vorbereitet; der bestehende Optimizer-Slice unterstützt derzeit nur Carry · Weapon.";
    renderPhase();
    return;
  }
  state.build = optimizeWeaponCarryFullBuild({ heroId: state.selectedHeroId, objective: "weapon_magazine_dps", maxTransactions: 28 }, state.data);
  state.build = { ...state.build, events: state.build.winner.state.events, inventory: state.build.winner.state.inventory, spent: state.build.winner.state.spent };
  $("#results").dataset.focus = damageFocus;
  $("#result-summary").textContent = `${state.build.events.length} geprüfte Schritte · ${formatSouls(state.build.spent)} · bester geprüfter 12-Slot-Weapon-Carry-Build`;
  renderPhase();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cancelNewBuild() {
  if (!activeOptimizerWorker) return;
  activeOptimizerWorker.terminate();
  activeOptimizerWorker = null;
  $("#search-progress").textContent = "Neuer Suchlauf abgebrochen.";
  $("#new-build-button").textContent = "⟳ Neuen vollständigen Suchlauf starten";
  $("#new-build-button").disabled = false;
  $("#new-build-40k-button").disabled = false;
  $("#build-button").disabled = false;
  setFastControls(false);
}

function setFastControls(running) {
  $("#fast-build-button").textContent = running ? "Abbrechen · Build behalten" : "Build erstellen · 40k";
  for (const id of ["build-button", "new-build-button", "new-build-40k-button", "hero-trigger", "role", "damage-focus"]) $("#" + id).disabled = running;
}

function startFastBuild() {
  if (activeOptimizerWorker) { cancelNewBuild(); return; }
  if (state.selectedHeroId !== "warden" || $("#role").value !== "carry" || $("#damage-focus").value !== "weapon") {
    $("#search-progress").textContent = "Dieser Build-Lauf unterstützt Warden · Carry · Weapon.";
    return;
  }
  const started = performance.now();
  let firstResultMs = null;
  setFastControls(true);
  $("#search-progress").textContent = "Suche läuft · alle Items zugelassen · 25 s Rechenbudget · Stichprobenreferenz wird vorbereitet.";
  const worker = activeOptimizerWorker = new Worker("./optimizer-worker.mjs", { type: "module" });
  const finish = (text) => {
    worker.terminate(); activeOptimizerWorker = null; setFastControls(false);
    $("#search-progress").textContent = text;
  };
  worker.onmessage = ({ data: message }) => {
    if (message.type === "incumbent") {
      const result = message.result;
      firstResultMs ??= performance.now() - started;
      const itemMap = state.data.itemsById;
      const events = result.state.events.map((event, i) => ({ ...event, earnedSouls: result.state.snapshots[i + 1].earnedSouls }))
        .filter((event) => event.type !== "save").map((event, i) => ({ step: i + 1, item: itemMap.get(event.type === "sell" ? event.from : event.item),
          upgradeFrom: itemMap.get(event.from), purchase_type: event.type, earnedSouls: event.earnedSouls }));
      const inventory = result.state.inventory.map((id) => itemMap.get(id));
      const evaluation = evaluateWardenCarryPerformance(result.state, { heroId: "warden", budget: 40000 }, state.data);
      state.build = { events, inventory, spent: result.state.earnedSouls, winner: { evaluation },
        search: { ...result, byMetric: {}, metrics: Object.keys(result.state.snapshots[0].metrics),
          scope: "Legaler Kaufpfad von 0 bis 40.000 verdienten Souls. Sparabschnitte sind über die Soul-Angaben der Transaktionen erkennbar. Approximative Suche auf dem ausgewiesenen Zahlungsraster; keine garantierte Güte zum globalen Optimum." } };
      $("#result-summary").textContent = `${events.length} legale Transaktionen · ${inventory.length}/9 Slots · ${result.state.cash} Souls übrig · erstes Ergebnis nach ${(firstResultMs / 1000).toFixed(2)} s`;
      $("#search-progress").textContent = `Build verfügbar; Verbesserung läuft · Auswahlwert ${result.quality.score.toFixed(5)} (kein Optimalitätsprozentsatz).`;
      renderPhase();
    } else if (message.type === "anytime-complete") {
      finish(`Rechenbudget beendet nach ${((performance.now() - started) / 1000).toFixed(1)} s · bester geprüfter Build bleibt sichtbar.`);
    } else if (message.type === "error") finish(`Suche fehlgeschlagen: ${message.message}`);
  };
  worker.onerror = (error) => finish(`Suche fehlgeschlagen: ${error.message}`);
  worker.postMessage({ mode: "anytime", data: state.data, itemIds: state.data.items.map((item) => item.item_id), budget: 40000 });
}

function startNewBuild(budget = 60000) {
  const role = $("#role").value;
  const damageFocus = $("#damage-focus").value;
  if (state.selectedHeroId !== "warden" || role !== "carry" || damageFocus !== "weapon") {
    $("#search-progress").textContent = "Der neue Suchkern unterstützt derzeit Warden · Carry · Weapon.";
    return;
  }
  if (activeOptimizerWorker) {
    cancelNewBuild();
    return;
  }
  const itemIds = state.data.items.map((item) => item.item_id);
  activeOptimizerWorker = new Worker("./optimizer-worker.mjs", { type: "module" });
  $("#new-build-button").textContent = "Abbrechen";
  $("#new-build-button").disabled = false;
  $("#new-build-40k-button").disabled = true;
  $("#build-button").disabled = true;
  $("#search-progress").textContent = `Neue Suche gestartet: ${itemIds.length} Items, Horizont ${formatSouls(budget)} Souls.`;
  activeOptimizerWorker.onmessage = (event) => {
    const message = event.data;
    if (message.type === "started") {
      $("#search-progress").textContent = `Neue Suche läuft vollständig über ${message.itemCount} Items bis ${formatSouls(message.budget)} Souls …`;
    } else if (message.type === "progress") {
      if (message.phase === "reference-cache") {
        const labels = { hit: "Gespeicherte Referenz wiederverwendet.", miss: "Referenz wird neu berechnet.", stored: "Vollständige Referenz lokal gespeichert.", unavailable: "Referenzspeicher nicht verfügbar.", "write-failed": "Referenz berechnet; lokale Speicherung nicht möglich." };
        $("#search-progress").textContent = labels[message.status];
      } else if (message.phase === "direct-reference") {
        $("#search-progress").textContent = `Referenz: ${message.telemetry.evaluatedInventories.toLocaleString("de-CH")} legale Inventare geprüft · ${(message.telemetry.runtimeMs / 1000).toFixed(1)} s · Abbruch möglich.`;
      } else if (message.phase === "model-scope") {
        $("#search-progress").textContent = `Diagnose auf ${message.resourceStep}-Souls-Raster · ${message.unsupportedUpgrades.length} nicht unterstützte Upgrade-Kanten · keine vollständige Spieloptimalität zugesichert.`;
      } else if (message.phase === "reference-search" || message.phase === "trajectory-search") {
        const t = message.telemetry;
        const phase = message.phase === "reference-search" ? "Referenzberechnung" : "Gemeinsame Pfadsuche";
        $("#search-progress").textContent = `${phase}: ${(t.runtimeMs / 1000).toFixed(1)} s · ${t.expandedStates.toLocaleString("de-CH")} Zustände geprüft · ${t.generatedStates.toLocaleString("de-CH")} Kandidaten erzeugt · ${t.queuedLabels.toLocaleString("de-CH")} in Warteschlange · Abbruch möglich. Modellgrenzen gelten.`;
      } else {
        $("#search-progress").textContent = `${message.paretoCount ?? "…"} Ergebnisvektoren · ${Math.round(message.telemetry?.runtimeMs || 0)} ms · Abbruch möglich.`;
      }
    } else if (message.type === "complete") {
      const result = message.result;
      const selected = result.byMetric.sustainedWeaponDps.pareto[0];
      if (!selected) throw new Error("Die neue Suche lieferte keinen legalen Referenzpfad.");
      const itemMap = state.data.itemsById;
      const inventory = selected.state.inventory.map((id) => itemMap.get(id)).filter(Boolean);
      const events = selected.state.events.map((event, index) => ({ step: index + 1, item: itemMap.get(event.type === "sell" ? event.from : event.item), upgradeFrom: event.from ? itemMap.get(event.from) : null, purchase_type: event.type, cash_cost: event.payment, item_id: event.item, earnedSouls: selected.state.snapshots[index + 1].earnedSouls }));
      const request = { heroId: state.selectedHeroId, objective: "weapon_magazine_dps", budget };
      const evaluation = evaluateWardenCarryPerformance({ inventory: selected.state.inventory }, request, state.data);
      state.build = { status: "PASS_WITH_WARNINGS", search: result, winner: { state: { inventory, events }, evaluation }, events, inventory, spent: selected.state.earnedSouls };
      $("#result-summary").textContent = `${events.length} geprüfte Schritte · neuer vollständiger Suchlauf · ${formatSouls(selected.state.earnedSouls)} Souls`;
      $("#search-progress").textContent = `Abgeschlossen: gemeinsame Pareto-Suche über ${result.metrics.length} Leistungsmaße · ${result.pareto.length} Ergebnisvektoren · Raster ${result.resource.step} Souls · ${result.unsupportedUpgrades.length} nicht unterstützte Upgrade-Kanten. Keine vollständige Spieloptimalität zugesichert.`;
      $("#results").dataset.focus = damageFocus;
      renderPhase();
      $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
      activeOptimizerWorker.terminate();
      activeOptimizerWorker = null;
      $("#new-build-button").textContent = "⟳ Neuen vollständigen Suchlauf starten";
      $("#new-build-40k-button").disabled = false;
      $("#build-button").disabled = false;
    } else if (message.type === "error") {
      $("#search-progress").textContent = `Neue Suche fehlgeschlagen: ${message.message}`;
      activeOptimizerWorker.terminate();
      activeOptimizerWorker = null;
      $("#new-build-button").textContent = "⟳ Neuen vollständigen Suchlauf starten";
      $("#new-build-40k-button").disabled = false;
      $("#build-button").disabled = false;
    }
  };
  activeOptimizerWorker.onerror = (error) => {
    $("#search-progress").textContent = `Worker-Fehler: ${error.message || "unbekannter Fehler"}`;
    activeOptimizerWorker?.terminate();
    activeOptimizerWorker = null;
    $("#new-build-button").textContent = "⟳ Neuen vollständigen Suchlauf starten";
    $("#new-build-40k-button").disabled = false;
    $("#build-button").disabled = false;
  };
  activeOptimizerWorker.postMessage({ data: state.data, itemIds, budget });
}

function renderPicker(filter = "") {
  const list = $("#picker-list");
  const normalized = filter.trim().toLocaleLowerCase("de");
  const candidates = state.data.heroes.filter((hero) => hero.display_name.toLocaleLowerCase("de").includes(normalized));
  list.innerHTML = candidates.map((hero) => `<button type="button" data-hero-id="${hero.hero_id}">${avatarMarkup(hero)}<span><strong>${hero.display_name}</strong><small>${hero.availability.replaceAll("_", " ")}</small></span>${hero.hero_id === state.selectedHeroId ? `<em>Aktiver Held</em>` : ""}</button>`).join("") || `<div class="empty-state compact"><p>Kein passender Held gefunden.</p></div>`;
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
  state.build = null;
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
    state.build = null;
    $("#results").dataset.focus = $("#damage-focus").value;
    $("#result-summary").textContent = "Auswahl geändert · Build erneut prüfen";
    renderPhase();
  });
  $("#damage-focus").addEventListener("change", () => $("#role").dispatchEvent(new Event("change")));
  $("#build-button").addEventListener("click", createBuild);
  $("#fast-build-button").addEventListener("click", startFastBuild);
  $("#new-build-button").addEventListener("click", () => startNewBuild(60000));
  $("#new-build-40k-button").addEventListener("click", () => startNewBuild(40000));
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
    $("#build-button").disabled = true;
    console.error(error);
  }
}

init();
