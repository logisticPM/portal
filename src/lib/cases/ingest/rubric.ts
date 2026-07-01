// The labeling rubric IS the methodology — versioned and committed (spec §5).
// Each theme: a one-line inclusion test the LLM applies to the case text.
import type { Theme } from "../types";

export const RUBRIC_VERSION = "2026-06-28.1";

export const THEME_RUBRIC: Record<Theme, string> = {
  land_rights: "The case turns on Aboriginal title or land rights (ownership/possession/use of land).",
  resource_revenue: "The case concerns resource revenue, royalties, or revenue-sharing from resources.",
  duty_to_consult: "The case turns on the Crown's duty to consult/accommodate or the honour of the Crown.",
  treaty: "The case concerns treaty rights, treaty interpretation, or treaty implementation.",
  fiduciary: "The case turns on the Crown's fiduciary duty to Indigenous peoples.",
  self_determination: "The case concerns self-government or the economic dimensions of self-determination.",
};

export const ALL_THEMES = Object.keys(THEME_RUBRIC) as Theme[];

export function labelPrompt(text: string): string {
  const lines = ALL_THEMES.map((t) => `- ${t}: ${THEME_RUBRIC[t]}`).join("\n");
  return `You label Canadian legal cases by economic-justice theme. Apply each test to the case text. ` +
    `Return ONLY a JSON array of the matching theme keys (zero or more), no prose.\n\nThemes:\n${lines}\n\n` +
    `Case text:\n"""${text.slice(0, 6000)}"""`;
}
