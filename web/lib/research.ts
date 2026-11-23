/** The eight research questions from the brief, and labels for theme kinds. */
export const RESEARCH_QUESTIONS: Record<number, string> = {
  1: "Why do users repeatedly buy from the same categories?",
  2: "What prevents users from exploring new categories?",
  3: "How do users discover products today?",
  4: "What role do habits play in shopping behaviour?",
  5: "What information do users need before trying a new category?",
  6: "What frustrations emerge repeatedly?",
  7: "Which user segments are more likely to experiment?",
  8: "What unmet needs emerge consistently across discussions?",
};

export const KIND_LABEL: Record<string, string> = {
  exploration_barrier: "Exploration barrier",
  habit: "Habit",
  discovery: "Discovery",
  information_need: "Information need",
  general_friction: "General friction",
  positive_experience: "Positive experience",
};

/** Landis & Koch (1977) bands, the usual way to read Cohen's kappa. */
export function kappaBand(k: number | null | undefined): string {
  if (k === null || k === undefined) return "Not enough data";
  if (k < 0) return "Poor";
  if (k <= 0.2) return "Slight";
  if (k <= 0.4) return "Fair";
  if (k <= 0.6) return "Moderate";
  if (k <= 0.8) return "Substantial";
  return "Almost perfect";
}
