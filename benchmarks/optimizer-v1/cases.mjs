const CONTROLLED_ITEMS = Object.freeze([
  "upgrade_rapid_rounds",
  "upgrade_headshot_booster",
  "upgrade_health",
  "upgrade_health_stimpak",
  "upgrade_titan_round",
  "upgrade_vampire",
  "upgrade_weighted_shots",
  "upgrade_improved_bullet_armor",
  "upgrade_soaring_spirit"
]);

const productionCases = ["warden", "infernus"].flatMap((hero) =>
  ["weapon", "spirit", "hybrid"].map((focus) => ({
    id: `production-40k-${hero}-carry-${focus}`,
    level: "production-40k",
    hero,
    role: "carry",
    focus,
    backend: "beam",
    budget: 40000,
    timeBudgetMs: 25000,
    referenceTimeMs: 1500,
    referenceCaptureTimeMs: 7500,
    initialBeamWidth: 4,
    maxBeamWidth: 32,
    widenFactor: 2,
    milestones: [],
    opponentBulletResist: 0,
    opponentSpiritResist: 0,
    itemIds: null,
    exactOracle: false
  }))
);

export const BENCHMARK_CASES = Object.freeze([
  Object.freeze({
    id: "small-exact-warden-carry-weapon",
    level: "small-exact",
    hero: "warden",
    role: "carry",
    focus: "weapon",
    backend: "beam",
    budget: 800,
    timeBudgetMs: 5000,
    referenceTimeMs: 1000,
    referenceCaptureTimeMs: 5000,
    initialBeamWidth: 64,
    maxBeamWidth: 64,
    widenFactor: 2,
    milestones: [800],
    opponentBulletResist: 0,
    opponentSpiritResist: 0,
    itemIds: ["upgrade_rapid_rounds", "upgrade_health"],
    exactOracle: true
  }),
  Object.freeze({
    id: "controlled-warden-carry-hybrid",
    level: "controlled-medium",
    hero: "warden",
    role: "carry",
    focus: "hybrid",
    backend: "beam",
    budget: 8000,
    timeBudgetMs: 5000,
    referenceTimeMs: 1000,
    referenceCaptureTimeMs: 5000,
    initialBeamWidth: 8,
    maxBeamWidth: 16,
    widenFactor: 2,
    milestones: [],
    opponentBulletResist: 0,
    opponentSpiritResist: 0,
    itemIds: CONTROLLED_ITEMS,
    exactOracle: false
  }),
  Object.freeze({
    id: "controlled-infernus-carry-hybrid",
    level: "controlled-medium",
    hero: "infernus",
    role: "carry",
    focus: "hybrid",
    backend: "beam",
    budget: 8000,
    timeBudgetMs: 5000,
    referenceTimeMs: 1000,
    referenceCaptureTimeMs: 5000,
    initialBeamWidth: 8,
    maxBeamWidth: 16,
    widenFactor: 2,
    milestones: [],
    opponentBulletResist: 0,
    opponentSpiritResist: 0,
    itemIds: CONTROLLED_ITEMS,
    exactOracle: false
  }),
  ...productionCases.map(Object.freeze)
]);

export function benchmarkCases(level = "all") {
  if (level === "all") return [...BENCHMARK_CASES];
  const aliases = { small: "small-exact", controlled: "controlled-medium", production: "production-40k" };
  const wanted = aliases[level] || level;
  return BENCHMARK_CASES.filter((entry) => entry.level === wanted);
}
