import raw from "./taxonomy.json";

/** Tag vocabulary shared with the pipeline (pipeline/engine/ai/taxonomy.py reads the same JSON). */
type Vocab = Record<string, string>;
const { _comment: _ignored, ...taxonomy } = raw as Record<string, Vocab | string>;
void _ignored;

export const TAXONOMY = taxonomy as Record<
  | "sentiment" | "categories" | "category_behavior" | "barriers" | "funnel_stage"
  | "discovery_channels" | "info_needs" | "segment_signals",
  Vocab
>;

export const label = (field: keyof typeof TAXONOMY, key: string | null | undefined) =>
  key ? TAXONOMY[field][key] ?? key : "";

export const isKey = (field: keyof typeof TAXONOMY, key: string | undefined): key is string =>
  !!key && Object.prototype.hasOwnProperty.call(TAXONOMY[field], key);
