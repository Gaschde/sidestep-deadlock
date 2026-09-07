import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const API_URL = "https://openrouter.ai/api/v1";

function usage() {
  console.log("Verwendung: npm run debatte -- --input debatte/mein-build.json [--rounds 1|2; Standard: 2]");
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

  const envPath = resolve(ROOT, "Debatte.env");
  try {
    const text = await readFile(envPath, "utf8");
    const line = text.split(/\r?\n/).find((entry) => entry.trim().startsWith("OPENROUTER_API_KEY="));
    if (!line) throw new Error("OPENROUTER_API_KEY fehlt");
    return line.slice(line.indexOf("=") + 1).trim().replace(/^['\"]|['\"]$/g, "");
  } catch {
    throw new Error("Kein OpenRouter-Key gefunden. Lege ihn in debatte/Debatte.env ab.");
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, { ...options, signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return response.json();
}

async function freeModels() {
  const response = await request("/models");
  return (response.data ?? [])
    .filter((model) => model.id.endsWith(":free"))
    .filter((model) => model.architecture?.output_modalities?.includes("text"))
    .filter((model) => model.reasoning?.mandatory !== true)
    .filter((model) => !model.id.includes("content-safety"))
    .filter((model) => !model.id.startsWith("thinkingmachines/"))
    .map((model) => model.id)
    .sort(() => Math.random() - 0.5);
}

function structuredPrompt({ role, input, transcript, round }) {
  return `Du nimmst an Debattenrunde ${round} als ${role.title} teil.\n\n${role.instruction}\n\nZiel ist ein durchgehend starker, legaler Kaufpfad vom ersten Kauf bis zum Endbudget. Die vorhandene candidateBuild.purchaseOrder ist nur ein Ausgangspunkt, keine Wahrheit. Bisherige Debattenbeiträge dürfen kritisiert werden, sind aber keine Datenquelle.\n\nAntworte ausschließlich als gültiges JSON mit exakt diesen Feldern:\n- pfad_vorschlag: string[] (vollständige Reihenfolge; je Eintrag "Schritt | item_id | Kauf/Upgrade | kurzer Grund")\n- kritik_am_vorherigen_pfad: string[]\n- early_mid_late_begruendung: { "early": string, "mid": string, "late": string }\n- unsicherheiten: string[]\n- ergebnis_label: "optimal" oder "bester_gepruefter_build"\n\nORIGINALANFRAGE, KANDIDAT UND VERIFIZIERTE DATEN:\n${JSON.stringify(input, null, 2)}\n\nBISHERIGE DEBATTENBEITRÄGE:\n${JSON.stringify(transcript, null, 2)}`;
}

function hasUsableReview(content) {
  const json = content.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try {
    const review = JSON.parse(json);
    return ["pfad_vorschlag", "kritik_am_vorherigen_pfad", "early_mid_late_begruendung", "unsicherheiten", "ergebnis_label"].every((field) => field in review);
  } catch {
    return false;
  }
}

async function callModel({ apiKey, model, prompt }) {
  const response = await request("/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost/sidestep-deadlock",
      "X-OpenRouter-Title": "Sidestep Deadlock Debate"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1600,
      reasoning: { effort: "none", exclude: true },
      messages: [{ role: "user", content: prompt }]
    })
  });
  return {
    requestedModel: model,
    actualModel: response.model ?? model,
    content: response.choices?.[0]?.message?.content ?? "",
    usage: response.usage ?? null
  };
}

async function main() {
  if (process.argv.includes("--help")) return usage();
  const inputPath = argument("--input");
  const rounds = Number(argument("--rounds", "2"));
  if (!inputPath || !Number.isInteger(rounds) || rounds < 1 || rounds > 2) {
    usage();
    process.exitCode = 1;
    return;
  }

  const [apiKey, inputText, rolesText, modelPool] = await Promise.all([
    readKey(),
    readFile(resolve(process.cwd(), inputPath), "utf8"),
    readFile(resolve(ROOT, "roles.json"), "utf8"),
    freeModels()
  ]);
  const input = JSON.parse(inputText);
  const roles = JSON.parse(rolesText);
  const requiredModels = rounds * roles.length;
  if (modelPool.length < requiredModels) {
    throw new Error(`Nur ${modelPool.length} freie Textmodelle verfügbar; benötigt werden ${requiredModels}. Bitte später erneut versuchen oder weniger Runden wählen.`);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = resolve(ROOT, "outputs", runId);
  await mkdir(outputDir, { recursive: true });
  const transcript = [];
  let modelIndex = 0;

  for (let round = 1; round <= rounds; round += 1) {
    for (const role of roles) {
      let result;
      let lastError;
      for (let attempt = 1; attempt <= 8 && !result; attempt += 1) {
        const model = modelPool[modelIndex++];
        if (!model) break;
        console.log(`Runde ${round}: ${role.title} (${model}, Versuch ${attempt})`);
        try {
          const candidate = await callModel({
            apiKey,
            model,
            prompt: structuredPrompt({ role, input, transcript, round })
          });
          if (!hasUsableReview(candidate.content)) {
            throw new Error("Modell lieferte keine vollständige strukturierte Review-Antwort");
          }
          result = candidate;
        } catch (error) {
          lastError = error;
          console.log(`Modell nicht verfügbar, nächster Versuch: ${error.message}`);
        }
      }
      if (!result) throw new Error(`${role.title} konnte nicht erreicht werden: ${lastError?.message ?? "kein freies Modell verfügbar"}`);
      const entry = { round, role: role.id, title: role.title, ...result };
      transcript.push(entry);
      await writeFile(resolve(outputDir, `${String(transcript.length).padStart(2, "0")}-${role.id}.json`), JSON.stringify(entry, null, 2));
    }
  }

  await writeFile(resolve(outputDir, "transcript.json"), JSON.stringify({ input, transcript }, null, 2));
  console.log(`Fertig. Ergebnisse: ${outputDir}`);
}

main().catch((error) => {
  console.error(`Debatte abgebrochen: ${error.message}`);
  process.exitCode = 1;
});
