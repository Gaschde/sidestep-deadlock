import { formatSouls, manifestsAreCompatible, parseCsv } from "./lib.mjs";
import { buildOptimizerData, optimizeWeaponCarryFullBuild } from "./optimizer.mjs";

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
  opponents: ["vyper", "abrams"],
  data: null
};

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
  $("#results").dataset.focus = $("#playstyle").value;

  $$(".opponent-trigger").forEach((button, index) => {
    const selected = getHero(state.opponents[index]);
    button.innerHTML = `${avatarMarkup(selected)}<span class="selection-copy"><small>Gegner ${index + 1}</small><strong>${selected?.display_name || "Nicht gewählt"}</strong></span><span>⌄</span>`;
  });
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

function renderInteractions() {
  const opponentIds = state.opponents.filter(Boolean);
  const relevant = state.data.interactions.filter((interaction) =>
    interaction.hero_id === state.selectedHeroId || opponentIds.includes(interaction.hero_id) || opponentIds.includes(interaction.other_entity_id)
  );
  if (!opponentIds.length) {
    return `<aside class="counter-card"><p class="eyebrow">Lane-Kontext</p><h3>Gegner auswählen</h3><p>Danach werden passende Einträge aus den verifizierten Interaktionsdaten eingeblendet.</p></aside>`;
  }
  if (!relevant.length) {
    return `<aside class="counter-card"><p class="eyebrow">Lane-Kontext</p><h3>Keine direkte verifizierte Zuordnung</h3><p>Für ${opponentIds.map((id) => getHero(id)?.display_name).join(" · ")} liegt kein direkt passender Helden-gegen-Helden-Eintrag vor. Es wird nichts dazuerfunden.</p><span class="confidence">0 passende Interaktionen</span></aside>`;
  }
  const sample = relevant[0];
  const owner = getHero(sample.hero_id);
  return `<aside class="counter-card"><p class="eyebrow">Lane-Kontext</p><h3>${relevant.length} verifizierte Sonderinteraktion${relevant.length === 1 ? "" : "en"}</h3><p><strong>${owner?.display_name || sample.hero_id}</strong> · ${sample.mechanic.replaceAll("_", " ")}</p><p>${sample.behavior}</p><span class="confidence">${sample.confidence} confidence · ${sample.test_status}</span><small>Kontextanzeige, keine Counter-Empfehlung</small></aside>`;
}

function renderBuildCard(event) {
  const upgrade = event.upgradeFrom;
  return `<article class="build-card">
    <span class="build-order">${String(event.step).padStart(2, "0")}</span>
    ${itemTile(event.item)}
    <strong>${event.item.name}</strong>
    <small>${upgrade ? `↑ ${upgrade.name}` : `${event.item.category} · T${event.item.tier}`}</small>
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
    panel.innerHTML = `<div class="empty-state"><span>✦</span><h2>Bereit für die Build-Prüfung</h2><p>Wähle Held und Spielstil. Der erste Optimizer-Slice unterstützt Weapon Carry und prüft dafür legale Kaufpfade sowie verifizierte, dauerhaft verfügbare Weapon-Effekte.</p></div>`;
    return;
  }

  const labels = { early: "Early", mid: "Mid", late: "Late" };
  const groups = buildPhaseGroups(state.build.events);
  const combat = state.build.winner.evaluation.scenarios.common;
  const combatInputs = state.build.winner.evaluation.scenarios.inputs;
  const scenarioSummary = `<p><strong>Baseline (offene Modellannahmen):</strong> ${combat.sustained_weapon_dps.toFixed(1)} Sustained Weapon DPS · ${combat.effective_health_bullet?.toFixed(0) || "?"} Bullet-EHP · ${combat.effective_health_spirit?.toFixed(0) || "?"} Spirit-EHP. ${combat.item_kit_synergies.length} belegte Item×Kit-/Range-Bezüge dokumentiert; bedingte Effekte sind nicht als Dauerbonus eingerechnet.</p>`;
  const combatStateSummary = `<p><strong>Vergleichszustand:</strong> ${combatInputs.hero_level.value === null ? "Heldenlevel unbekannt – es gelten nur die kanonischen Basiswerte." : `Heldenlevel ${combatInputs.hero_level.value} ist angegeben, aber ohne verifizierte Level→Boon-Zuordnung nicht in Werte übersetzt.`} ${combatInputs.ability_levels.value === null ? "Skillzustand unbekannt – Fähigkeiten liefern keine stillschweigenden Kampfboni." : "Skillzustand ist angegeben, aber noch nicht in der gemeinsamen Item-/Skill-Suche berechnet."}</p>`;
  const foundations = state.build.winner.evaluation.foundations;
  const foundationSummary = `<p><strong>Robuste Frühbasis:</strong> ${foundations.checkpoints.map((entry) => `${entry.budget.toLocaleString("de-CH")} Souls: ${entry.fulfilled ? "erfüllt" : "nicht erfüllt"}`).join(" · ")}. Schutz zählt nur als Vitality-Schutzitem oder dauerhafte Bullet-/Spirit-Resistenz; Heldenfähigkeiten ersetzen ohne Skill-Reihenfolge kein gekauftes Sustain-Item.</p>`;
  panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">Vollständiger Kaufpfad · bester geprüfter Pfad</p><h2>Warden Weapon Carry</h2></div><span class="meta-chip">${state.build.inventory.length} / ${state.data.slots.item_limit} finale Slots</span></div><div class="build-board">${Object.entries(labels).map(([phase, label]) => `<section class="build-phase build-phase-${phase}"><div class="build-phase-heading"><h3>${label}</h3><span>${groups[phase].length} Schritte</span></div><div class="build-card-row">${groups[phase].map(renderBuildCard).join("") || `<p class="empty-phase">Keine Käufe in dieser Phase.</p>`}</div></section>`).join("")}</div><div class="build-board-footer">${scenarioSummary}${combatStateSummary}${foundationSummary}<p>${state.build.scope}</p>${renderInteractions()}</div>`;
}

function createBuild() {
  const style = $("#playstyle").value;
  if (style !== "weapon") {
    state.build = null;
    $("#result-summary").textContent = "Der erste echte Optimizer-Slice unterstützt derzeit Weapon Carry. Die anderen Presets bleiben bis zu ihrer eigenen Metrik bewusst deaktiviert.";
    renderPhase();
    return;
  }
  state.build = optimizeWeaponCarryFullBuild({
    heroId: state.selectedHeroId,
    objective: "weapon_magazine_dps",
    maxTransactions: 28
  }, state.data);
  state.build = { ...state.build, events: state.build.winner.state.events, inventory: state.build.winner.state.inventory, spent: state.build.winner.state.spent };
  $("#results").dataset.focus = style;
  $("#result-summary").textContent = `${state.build.events.length} geprüfte Schritte · ${formatSouls(state.build.spent)} · bester geprüfter 12-Slot-Weapon-Carry-Build`;
  renderPhase();
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
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
  $("#picker-eyebrow").textContent = mode === "hero" ? "Build-Grundlage" : `Lane-Slot ${slot + 1}`;
  $("#picker-title").textContent = mode === "hero" ? "Held wählen" : "Gegner wählen";
  $("#clear-opponent").hidden = mode === "hero";
  $("#picker-search").value = "";
  renderPicker();
  $("#picker-dialog").showModal();
  $("#picker-search").focus();
}

function chooseHero(heroId) {
  if (state.pickerMode === "hero") {
    state.selectedHeroId = heroId;
    state.opponents = state.opponents.map((opponentId) => opponentId === heroId ? null : opponentId);
  } else {
    state.opponents[state.pickerSlot] = heroId === state.selectedHeroId ? null : heroId;
  }
  state.build = null;
  $("#result-summary").textContent = "Auswahl geändert · Build erneut prüfen";
  $("#picker-dialog").close();
  renderSelections();
  renderAbilities();
  renderPhase();
}

function bindEvents() {
  $("#hero-trigger").addEventListener("click", () => openPicker("hero"));
  $$(".opponent-trigger").forEach((button) => button.addEventListener("click", () => openPicker("opponent", Number(button.dataset.opponentSlot))));
  $("#picker-search").addEventListener("input", (event) => renderPicker(event.target.value));
  $("#clear-opponent").addEventListener("click", () => {
    state.opponents[state.pickerSlot] = null;
    state.build = null;
    $("#picker-dialog").close();
    renderSelections();
    renderPhase();
  });
  $("#playstyle").addEventListener("change", () => {
    state.build = null;
    $("#results").dataset.focus = $("#playstyle").value;
    $("#result-summary").textContent = "Spielstil geändert · Build erneut prüfen";
    renderPhase();
  });
  $$("[data-style]").forEach((button) => button.addEventListener("click", () => {
    $("#playstyle").value = button.dataset.style;
    $("#playstyle").dispatchEvent(new Event("change"));
  }));
  $("#build-button").addEventListener("click", createBuild);
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
