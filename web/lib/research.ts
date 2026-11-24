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

/** V9: the engine's hypotheses tested in six user interviews (notes kept off the repo). Human research,
 *  so the verdicts are recorded here rather than computed by the pipeline. */
export type Verdict = "confirmed" | "contradicted" | "unclear";
export const INTERVIEW_VERDICTS: { id: string; hypothesis: string; verdict: Verdict; note: string }[] = [
  { id: "H1", hypothesis: "Fear of a bad product with no easy return is the main barrier", verdict: "contradicted",
    note: "5 of 6 contradict; the exception was footwear fit" },
  { id: "H2", hypothesis: "Freshness and expiry doubts stop perishable purchases", verdict: "confirmed",
    note: "Narrowed to fresh produce whose ripeness can't be judged from the listing" },
  { id: "H3", hypothesis: "Quality and authenticity doubts grow with price and unfamiliar brands", verdict: "unclear",
    note: "Familiarity mattered, but no one raised authenticity" },
  { id: "H4", hypothesis: "Habit and reordering keep baskets narrow", verdict: "confirmed",
    note: "For routine orders; browsing stays inside familiar categories" },
  { id: "H5", hypothesis: "Price and fees matter less than trust", verdict: "unclear",
    note: "Depends on urgency and on new order vs add-on" },
  { id: "H6", hypothesis: "People don't know many categories are sold", verdict: "confirmed",
    note: "Each gap was closed by a person, not the app" },
];
export const VERDICT_LABEL: Record<Verdict, string> = { confirmed: "Confirmed", contradicted: "Contradicted", unclear: "Unclear" };
