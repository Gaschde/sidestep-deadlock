# Sidestep — Deadlock Build Optimizer Design System

## Product context

Sidestep is a desktop-first Deadlock build companion. A user selects a hero, describes the desired playstyle in natural language, and receives a verified staged item path plus an ability-point order. The interface must feel close to Deadlock's occult-noir game world while remaining clearly an independent companion named Sidestep.

Primary job to be done, visibly taught as three steps:

1. `Held wählen` — select a hero from a searchable dropdown with the original hero portrait.
2. `Spielstil beschreiben` — enter a short natural-language goal or use a suggestion chip.
3. `Build berechnen` — generate the legal purchase path and ability-point order.

After generation, the user must immediately understand what to buy, in which order, when thresholds occur, and where ability points go. This is not a match-statistics site. Never display invented win rates, popularity, ranks, player profiles, or match counts.

## Target screen

A single desktop application screen around 1440×960 with:

- a strong product masthead: large `SIDESTEP` title and smaller `DEADLOCK BUILD OPTIMIZER` descriptor;
- a visible three-step composer, integrating the numbers `1`, `2`, and `3` into the control labels instead of adding a separate tutorial;
- searchable hero selector with a real portrait thumbnail and hero name;
- two optional searchable lane-opponent selectors with original hero portraits; never ask for all six enemies in the primary flow;
- prominent playstyle field, suggestion chips, and a clear `Build berechnen` action;
- useful advanced options kept collapsed by default;
- compact purchase rows grouped into system-selected Early, Mid, Late, and Situational phases;
- an Early Game lane-counter panel that reacts only to the two selected lane opponents and keeps conditional purchases separate from the baseline path;
- explicit category-investment thresholds, component upgrades, cooldown checks, and slot legality;
- a game-like ability-point order with original ability icons and the familiar 1/2/5 point diamonds;
- final build summary and a compact validation state.

## Primary visual source and direction

The primary style source is Deadlock's current official green-and-black promotional identity, interpreted for an independent utility. The attached in-game ability-order screenshot is a structural reference for one component, not a second competing brand direction.

- Overall mood: occult noir, 1930s industrial city, worn print, restrained supernatural glow.
- Background: modern green-black `#07100C` with soft layered fog/aurora gradients, subtle vignette and very light grain. Do not use a square grid, graph-paper pattern, or busy illustration. The later app may add an optional atmospheric city image, but this compact-tool design uses the cleaner gradient.
- Main surface: smoked charcoal-green `#101A16`.
- Raised panel: `#15231D`; secondary panel: `#1B2C24`.
- Primary green: muted occult emerald `#66856B`.
- Bright interaction/focus green: `#91AD86`; never neon.
- Text: aged ivory `#E8E0C8`; secondary text `#AAA892`; muted text `#747A70`.
- Brass accent: `#B49A62`, used sparingly for thresholds and important milestones.
- Skill panel: deep desaturated blue-green `#17293A` with alternating lanes `#102033` and `#1C3148`, echoing the supplied game UI while staying inside the green-led palette.
- Ability-point marker: muted arcane violet `#A14BC2`; point-cost diamonds use aged ivory on charcoal.
- Semantic item categories remain distinct: Weapon amber, Vitality moss green, Spirit muted violet. Always include labels/icons, not color alone.
- Hero-specific UI color may appear only as a thin local accent; for Warden use the verified dataset color `#4D68A3`.
- Borders: `rgba(232,224,200,0.13)`; selected borders use `#91AD86` or brass for thresholds.
- Shadows: soft black depth and very restrained green haze; no blue/purple SaaS gradients.

## Typography

- Display/title: `Barlow Condensed`, 700–800, uppercase, slightly distressed through texture rather than decorative letterforms.
- Interface/body: `Inter`, 400–700.
- Main title `SIDESTEP`: 48–64px desktop, clearly the largest text on the screen.
- Descriptor `DEADLOCK BUILD OPTIMIZER`: 13–16px uppercase with tracking.
- Section titles: 20–28px Barlow Condensed, uppercase.
- Labels: 10–12px Inter uppercase with generous tracking.
- Minimum readable body text: 13px.

## Core components

### Three-step composer

- Present the main controls as one coherent strip or panel.
- Every stage starts with a conspicuous numbered seal: `1 Held wählen`, `2 Spielstil beschreiben`, `3 Build berechnen`.
- On narrow screens the three stages stack vertically while retaining order.
- Do not create a separate onboarding modal; the numbered controls teach the workflow in place.

### Hero selector

- Use the original hero portrait in a 44–56px cropped thumbnail, never a letter avatar.
- Show hero name, searchable dropdown affordance, and optional small availability count.
- The full app will populate all public heroes from the local hero dataset. The mockup shows Warden as the selected example.

### Lane opponents

- Directly beneath or beside the selected hero, show an optional compact control labelled `Lane-Gegner (optional)`.
- Provide exactly two searchable opponent slots because the feature optimizes the opening lane; do not place all six enemy selectors in the normal flow.
- Each selected opponent uses the original portrait and canonical hero name. Empty state reads `Gegner 1` or `Gegner 2`.
- Explain the scope in one short line: `Beeinflusst nur Early-Game- und Lane-Counter-Empfehlungen`.
- The optimizer must treat this as contextual input, not as a guarantee that one specific item is always correct.

### Playstyle composer

- Multiline text field with a friendly German placeholder.
- Preserve the successful suggestion chips: `Weapon Carry`, `Spirit Burst`, `Ausgewogen`, `Mehr Überleben`.
- Chips should feel like quick presets, not filters that lock the user in.

### Advanced options

Collapsed by default under `Erweiterte Optionen`. When expanded it may contain only useful constraints:

- power-spike focus: Early / Mid / Late / Balanced;
- risk profile: Safe / Balanced / Glass Cannon;
- active-item preference: any / few / none;
- opponent problem: Weapon damage / Spirit damage / Healing / Mobility;
- fixed or excluded items;
- uncertainty visibility and maximum target budget.

These options refine the optimizer; they must never be required for a normal build request.

### Compact purchase list

- Design for roughly 20 or more purchase and upgrade events without hard-coding a maximum.
- Keep every normal item as a dense 38–44px row.
- Include step number, the original game/API item icon at 28–32px, name, raw price, category/tier, short reason, and upgrade/component connector.
- Optional details, alternatives, cooldown explanation, slot behavior, and uncertainty open from a chevron.
- Component upgrades must visually communicate replacement/consumption rather than repurchase.
- Threshold markers appear as slim inline events and keep item cost separate from category investment.
- Avoid oversized item cards and decorative item illustrations.

### Lane counter panel

- Place a narrow `Lane Counter` panel to the right of the Early Game purchase rows on wide screens; stack it directly below Early Game on mobile.
- Show both selected enemy portraits in its header.
- Contain one or two conditional early-item suggestions with original item icons, price, the opponent they address, and a one-line explanation.
- Add a visible label such as `Bedingte Alternative` or `Nur gegen diese Lane`.
- Never silently count these options as mandatory purchases or include them in the final build unless selected by the optimizer.
- User examples that have not been verified by the interaction dataset must remain labelled `Beispiel · noch zu prüfen` in the mockup.

### Ability-point order

- Closely follow the supplied in-game pattern.
- Dark green-black framed panel titled `Fähigkeitspunkte`; avoid the unrelated blue treatment from earlier drafts.
- Each lane begins with a large, high-contrast original ability icon, numeric ability key, and full name. Never substitute a generic symbol.
- Purple diamonds mean **ability unlocks only**. Never repeat a purple diamond beside every tier upgrade.
- Separate unlock order from ability-point spending. The first three non-ultimate abilities may be unlocked in a chosen order; the ultimate uses the fourth unlock.
- Show the three upgrade tiers for each unlocked ability as distinct aged-ivory/brass nodes costing `1 AP`, `2 AP`, and `5 AP`.
- Preferred rendering is one shared, chronological 16-step timeline: four horizontal ability lanes, one purple unlock event per ability, and later ivory/brass `1 AP`, `2 AP`, and `5 AP` events at their actual positions. It must read from left to right like the in-game display, not like four independent upgrade tables.
- Do not present a hero-specific spending order as optimized until the optimizer has calculated it. A mockup may demonstrate the verified unlock/cost structure while labelling the recommendation sequence as pending.
- Clearly label this as ability-point spending, not casting rotation.
- Hover/focus may reveal the exact upgrade effect and reasoning.

### Preferred build navigator direction

- Preserve the full build plan, but make the eventual in-match experience focus on `Jetzt kaufen` plus the next three purchases.
- Early, Mid, and Late are mutually exclusive tab views in the full plan: only the selected phase is rendered in the main content area. Clicking a phase replaces the previous one instead of stacking all phases vertically.
- Show a compact Early → Mid → Late progress line and keep `Gesamten Plan anzeigen` available at all times.
- A purchased/confirmed action advances to the next item; upgrades show only the additional amount due while retaining total-cost context.
- Lane-counter suggestions appear at the relevant point, can be accepted or ignored, and must explain how the visible path changes without inventing a replacement.
- Treat this as the preferred direction for the future application; it does not need to replace the full-plan mockup until explicitly requested.

### Summary rail

- Sticky on desktop, beneath results on smaller screens.
- Show final item slots compactly, total Souls, category investments, threshold state, slot legality, cooldown validation, and confidence.
- Keep demo values visibly marked until live data is connected.

## Layout and composition improvements

- Let the larger title breathe above the composer without becoming a marketing hero section.
- Use subtle vertical guide lines and occult geometric motifs in the background to evoke Deadlock, but keep data legible.
- Preserve the compact item-list density from the selected version.
- Move the ability-point panel high enough that users do not mistake it for an afterthought: directly below the first result summary or beside the opening purchase phases on wide screens.
- Use one green primary call-to-action. Brass is reserved for thresholds and exceptional milestones.
- Use small tooltips for unfamiliar optimizer terms such as category investment and slot legality.

## Motion and accessibility

- 160–220ms transitions for dropdowns, disclosures, hover, and result entrance.
- Results may reveal phase-by-phase after calculation; never delay core readability.
- Respect reduced-motion preferences.
- Strong focus outlines, keyboard-operable selector and disclosures, and readable contrast.
- Long German hero/item/ability names may wrap without clipping.

## Fidelity constraints

Use only the fonts, colors, spacing, and component styles defined here. Do not use generic blue SaaS gradients, glossy glassmorphism, marketing pricing cards, social proof, match statistics, or invented official branding. `SIDESTEP` remains the product identity; `Deadlock Build Optimizer` is the descriptor. Attached screenshots are visual/structural references and never factual data sources.
