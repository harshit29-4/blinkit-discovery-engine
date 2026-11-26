/**
 * Demo catalogue. Invented items and brands, written for this prototype: no real Blinkit listing is copied.
 * Some attributes are deliberately missing, so the "not stated by the seller" path is visible and testable.
 * The seven categories are the ones where interviewees hesitated (see docs, Part 2 and Part 3).
 */
export type CategoryId = "produce" | "phone" | "footwear" | "pet" | "stationery" | "games" | "appliances";

export type Item = {
  id: string;
  name: string;
  brand: string;
  category: CategoryId;
  price: number; // rupees
  unit: string;
  emoji: string;
  attrs: Record<string, string>;
};

export const CATEGORIES: Record<CategoryId, { name: string; emoji: string; tile: "tile" | "tile-2" }> = {
  produce:    { name: "Fruits & vegetables", emoji: "🍅", tile: "tile-2" },
  phone:      { name: "Phone accessories", emoji: "🔌", tile: "tile" },
  footwear:   { name: "Footwear", emoji: "🩴", tile: "tile" },
  pet:        { name: "Pet care", emoji: "🐈", tile: "tile-2" },
  stationery: { name: "Stationery", emoji: "✉️", tile: "tile" },
  games:      { name: "Games & toys", emoji: "🃏", tile: "tile-2" },
  appliances: { name: "Small appliances", emoji: "🫖", tile: "tile" },
};

/** Plain-English labels for attribute keys (shown on the page and cited by the card). */
export const ATTR_LABEL: Record<string, string> = {
  weight: "Weight", ripeness: "Ripeness", ready_in: "Ready to eat", packed_on: "Packed on", origin: "Origin",
  pieces: "Pieces", connector: "Connector", wattage: "Power", fast_charge: "Fast charging", works_with: "Works with",
  cable_included: "Cable included", length: "Length", warranty: "Warranty", sizes: "Sizes", size_guide: "Size guide",
  strap: "Strap", sole: "Sole", use: "Best for", exchange: "Exchange", pickup: "Return pickup", animal: "For",
  flavour: "Flavour", life_stage: "Life stage", pack: "Pack", per_pouch_price: "Price per pouch", texture: "Texture",
  litter_type: "Litter type", colour: "Colour", scent: "Scent", size: "Size", count: "Count", marker_type: "Marker type",
  colours: "Colours", tip: "Tip", paper: "Paper", seal: "Seal", players: "Players", age: "Age", learn_in: "Learn in",
  game_length: "One game takes", contents: "In the box", language: "Language", capacity: "Capacity", power: "Power",
  inside: "Inside", opening: "Mouth opening", photos: "Photos on listing", auto_off: "Auto shut-off", cord: "Cord",
};

const i = (id: string, name: string, brand: string, category: CategoryId, price: number, unit: string, emoji: string,
  attrs: Record<string, string>): Item => ({ id, name, brand, category, price, unit, emoji, attrs });

export const ITEMS: Item[] = [
  // Fruits & vegetables: ripeness and timing decide it (P1 tomatoes, P5 mangoes).
  i("tomato-ripe", "Tomatoes, ripe", "FarmFirst", "produce", 38, "500 g", "🍅",
    { weight: "500 g (6–8 pieces)", ripeness: "Fully ripe, red", ready_in: "Use today or tomorrow", packed_on: "Packed this morning", origin: "Kolar, Karnataka" }),
  i("tomato-mixed", "Tomatoes, mixed ripeness", "FarmFirst", "produce", 34, "1 kg", "🍅",
    { weight: "1 kg (12–16 pieces)", ripeness: "Mix of red and orange-red", ready_in: "About half ready today, the rest in 2–3 days", origin: "Nashik, Maharashtra" }),
  i("tomato-hybrid", "Tomatoes, hybrid", "GreenCart", "produce", 29, "500 g", "🍅",
    { weight: "500 g", origin: "Nashik, Maharashtra" }),
  i("mango-alphonso", "Alphonso mangoes", "KonkanKing", "produce", 349, "6 pieces", "🥭",
    { pieces: "6", weight: "About 1.2 kg", ripeness: "Firm, naturally ripening", ready_in: "2 ready in 1–2 days, 4 in 4–5 days (staggered)", origin: "Ratnagiri, Maharashtra" }),
  i("mango-banganapalli", "Banganapalli mangoes", "FarmFirst", "produce", 189, "1 kg", "🥭",
    { weight: "1 kg (3–4 pieces)", origin: "Andhra Pradesh" }),
  i("banana-robusta", "Bananas, Robusta", "FarmFirst", "produce", 49, "6 pieces", "🍌",
    { pieces: "6", ripeness: "Yellow with green tips", ready_in: "Ready in 1 day", origin: "Theni, Tamil Nadu" }),
  i("avocado", "Avocados", "GreenCart", "produce", 199, "2 pieces", "🥑",
    { pieces: "2", ripeness: "Firm", ready_in: "Ready in 3–4 days at room temperature", origin: "Imported, Tanzania" }),
  i("lettuce-iceberg", "Iceberg lettuce", "LeafLab", "produce", 79, "1 head (about 400 g)", "🥬",
    { weight: "About 400 g", packed_on: "Packed yesterday", origin: "Ooty, Tamil Nadu" }),
  i("salad-mix", "Salad leaves mix", "LeafLab", "produce", 99, "150 g", "🥗",
    { weight: "150 g", origin: "Hydroponic farm, Pune" }),

  // Phone accessories: compatibility decides it (P1's charger).
  i("charger-20w", "20W USB-C fast charger", "VoltPro", "phone", 499, "1 adapter", "🔌",
    { connector: "USB-C port", wattage: "20 W", fast_charge: "USB Power Delivery (PD 3.0)", works_with: "iPhone 12 and later with a USB-C to Lightning or USB-C cable; Pixel phones; most USB-C phones at standard PD speed", cable_included: "No", warranty: "6 months" }),
  i("charger-33w", "33W dual-port charger", "VoltPro", "phone", 799, "1 adapter + cable", "🔌",
    { connector: "USB-C and USB-A ports", wattage: "33 W (single port)", fast_charge: "USB PD 3.0 and Quick Charge 3.0", works_with: "Samsung Galaxy A and M series (Adaptive Fast Charging), Pixel, iPhone 12 and later", cable_included: "Yes, USB-C to USB-C, 1 m", warranty: "12 months" }),
  i("charger-65w", "65W GaN charger", "Zentro", "phone", 1499, "1 adapter", "🔌",
    { connector: "2 × USB-C, 1 × USB-A", wattage: "65 W total", fast_charge: "USB PD 3.0 with PPS", works_with: "Samsung Super Fast Charging (25 W) phones, laptops with USB-C charging, iPhone, Pixel", cable_included: "No", warranty: "18 months" }),
  i("charger-basic", "Wall charger, 12W", "QuickJuice", "phone", 249, "1 adapter", "🔌",
    { connector: "USB-A port", wattage: "12 W", cable_included: "No" }),
  i("cable-c-c", "USB-C to USB-C cable", "VoltPro", "phone", 299, "1 m", "🔗",
    { connector: "USB-C to USB-C", wattage: "Up to 60 W", length: "1 m", works_with: "USB-C phones, tablets and laptops", warranty: "6 months" }),
  i("cable-lightning", "USB-C to Lightning cable", "VoltPro", "phone", 399, "1 m", "🔗",
    { connector: "USB-C to Lightning", length: "1 m", fast_charge: "Supports iPhone fast charging with a 20 W or higher PD adapter", works_with: "iPhone 5 to iPhone 14", warranty: "6 months" }),
  i("earphones-typec", "Wired earphones, USB-C", "SoundBit", "phone", 449, "1 pair", "🎧",
    { connector: "USB-C plug", works_with: "Phones with a USB-C port and no headphone jack, including Samsung Galaxy S and Pixel", length: "1.2 m", warranty: "6 months" }),
  i("earphones-jack", "Wired earphones, 3.5 mm", "SoundBit", "phone", 299, "1 pair", "🎧",
    { connector: "3.5 mm jack", works_with: "Phones and laptops with a 3.5 mm headphone jack", length: "1.2 m", warranty: "6 months" }),
  i("watch-charger", "Smartwatch charging cable", "Zentro", "phone", 349, "1 cable", "⌚",
    { connector: "Magnetic puck to USB-A", length: "1 m" }),

  // Footwear: fit and exchange decide it (P3's slippers).
  i("slippers-cloud", "Cloud home slippers", "Steppa", "footwear", 399, "1 pair", "🩴",
    { sizes: "UK 6, 7, 8, 9, 10", size_guide: "UK 8 fits a foot 26–26.5 cm long; runs true to size", strap: "Soft padded single strap, no buckle", sole: "Cushioned EVA, non-slip", use: "Indoors and short walks", exchange: "Exchange for another size within 7 days if worn indoors only, with tags on", pickup: "Pick-up slot you choose: 8–11 am, 12–4 pm or 6–9 pm" }),
  i("flipflops-classic", "Classic flip-flops", "Steppa", "footwear", 199, "1 pair", "🩴",
    { sizes: "UK 5–11", strap: "Rubber V-strap between the toes", sole: "Rubber", use: "Bathroom and indoors", exchange: "No exchange or return on footwear unless damaged" }),
  i("sliders-sport", "Sport sliders", "Kicko", "footwear", 549, "1 pair", "🩴",
    { sizes: "UK 6–10", sole: "Contoured footbed", use: "Indoors and outdoors" }),
  i("slippers-mens-leather", "Leather kolhapuri-style slippers", "Kicko", "footwear", 699, "1 pair", "🩴",
    { sizes: "UK 7, 8, 9, 10", size_guide: "Runs half a size small; pick one size up", strap: "Leather toe ring and cross strap", sole: "Leather, stitched", use: "Outdoors", exchange: "Size exchange within 3 days, unworn", pickup: "Pick-up next day, 10 am–6 pm" }),
  i("slippers-kids", "Kids' home slippers", "Steppa", "footwear", 299, "1 pair", "🩴",
    { sizes: "Kids 10–13, UK 1–3", size_guide: "Kids 12 fits a foot 18.5 cm long", strap: "Velcro strap", sole: "Soft, non-slip", use: "Indoors" }),

  // Pet care: exact variant decides it (P2's cat food).
  i("cat-chicken-gravy", "Cat food, chicken in gravy", "Purrfect Bowl", "pet", 45, "1 pouch, 85 g", "🐈",
    { animal: "Cats", flavour: "Chicken in gravy", life_stage: "Adult (1+ years)", pack: "1 pouch, 85 g", per_pouch_price: "₹45", texture: "Chunks in gravy" }),
  i("cat-chicken-gravy-box", "Cat food, chicken in gravy, box of 12", "Purrfect Bowl", "pet", 480, "12 × 85 g", "🐈",
    { animal: "Cats", flavour: "Chicken in gravy", life_stage: "Adult (1+ years)", pack: "12 pouches × 85 g", per_pouch_price: "₹40", texture: "Chunks in gravy" }),
  i("cat-tuna-jelly", "Cat food, tuna in jelly", "Purrfect Bowl", "pet", 45, "1 pouch, 85 g", "🐈",
    { animal: "Cats", flavour: "Tuna in jelly", life_stage: "Adult (1+ years)", pack: "1 pouch, 85 g", per_pouch_price: "₹45", texture: "Chunks in jelly" }),
  i("kitten-chicken", "Kitten food, chicken in gravy", "Purrfect Bowl", "pet", 49, "1 pouch, 85 g", "🐈",
    { animal: "Cats", flavour: "Chicken in gravy", life_stage: "Kitten (2–12 months)", pack: "1 pouch, 85 g", per_pouch_price: "₹49", texture: "Mousse" }),
  i("cat-ocean-fish", "Cat food, ocean fish", "WhiskerJoy", "pet", 42, "1 pouch, 80 g", "🐈",
    { animal: "Cats", flavour: "Ocean fish", pack: "1 pouch, 80 g" }),
  i("cat-dry-salmon", "Dry cat food, salmon", "WhiskerJoy", "pet", 399, "1.2 kg", "🐈",
    { animal: "Cats", flavour: "Salmon", life_stage: "Adult (1+ years)", pack: "1.2 kg bag", texture: "Dry kibble" }),
  i("litter-clumping", "Clumping cat litter", "SandyPaws", "pet", 349, "5 kg", "🪣",
    { animal: "Cats", litter_type: "Bentonite, clumping", colour: "Grey", scent: "Unscented", pack: "5 kg" }),
  i("litter-lavender", "Cat litter, lavender", "SandyPaws", "pet", 379, "5 kg", "🪣",
    { animal: "Cats", litter_type: "Bentonite, clumping", scent: "Lavender", pack: "5 kg" }),
  i("dog-chicken", "Dog food, chicken and rice", "TailWag", "pet", 699, "3 kg", "🐕",
    { animal: "Dogs", flavour: "Chicken and rice", life_stage: "Adult, all breeds", pack: "3 kg bag", texture: "Dry kibble" }),

  // Stationery: exact type and size decide it (P1's envelope, P4's markers).
  i("envelope-a4", "A4 envelopes, brown", "PaperPost", "stationery", 60, "Pack of 10", "✉️",
    { size: "32.4 × 22.9 cm (C4, fits A4 unfolded)", count: "10", paper: "100 gsm kraft", seal: "Peel and seal" }),
  i("envelope-dl", "Letter envelopes, white", "PaperPost", "stationery", 45, "Pack of 25", "✉️",
    { size: "22 × 11 cm (DL, fits A4 folded in three)", count: "25", paper: "80 gsm", seal: "Gummed" }),
  i("envelope-cloth", "Cloth-lined envelopes", "DeskMate", "stationery", 120, "Pack of 5", "✉️",
    { count: "5", seal: "Gummed" }),
  i("marker-whiteboard", "Whiteboard markers", "Inkwise", "stationery", 120, "Pack of 4", "🖍️",
    { marker_type: "Whiteboard (dry-erase), wipes off", count: "4", colours: "Black, blue, red, green", tip: "Bullet, 2 mm" }),
  i("marker-permanent", "Permanent markers", "Inkwise", "stationery", 90, "Pack of 4", "🖍️",
    { marker_type: "Permanent, does not wipe off", count: "4", colours: "Black, blue, red, green", tip: "Bullet, 2 mm" }),
  i("marker-black-2", "Black markers", "DeskMate", "stationery", 50, "Pack of 2", "🖍️",
    { count: "2", colours: "Black", tip: "Chisel" }),
  i("sticky-notes", "Sticky notes", "DeskMate", "stationery", 99, "4 pads × 100 sheets", "🗒️",
    { size: "7.6 × 7.6 cm", count: "400 sheets", colours: "Yellow, pink, green, blue" }),
  i("a4-paper", "A4 printing paper", "PaperPost", "stationery", 299, "500 sheets", "📄",
    { size: "A4, 21 × 29.7 cm", count: "500", paper: "75 gsm" }),

  // Games & toys: who can play and how fast to learn decide it (P5's train trip).
  i("cards-classic", "Playing cards, classic", "Ace & Co", "games", 99, "1 deck", "🃏",
    { players: "2 or more", age: "6+", contents: "52 cards and 2 jokers", learn_in: "Depends on the game you play", language: "No text" }),
  i("cards-colour-match", "Colour-match card game", "PlayNest", "games", 249, "1 box", "🃏",
    { players: "2–8", age: "7+", learn_in: "About 5 minutes", game_length: "10–20 minutes", contents: "108 cards and rules sheet", language: "English rules" }),
  i("strategy-board", "Island trading board game", "PlayNest", "games", 1299, "1 box", "🎲",
    { players: "3–4", age: "10+", learn_in: "About 20 minutes", game_length: "60–90 minutes", contents: "Board, 95 cards, 40 tokens, 2 dice" }),
  i("travel-chess", "Magnetic travel chess", "Ace & Co", "games", 399, "1 set", "♟️",
    { players: "2", age: "6+", contents: "Folding magnetic board and 32 pieces", game_length: "15–45 minutes" }),
  i("ludo-snakes", "Ludo and snakes & ladders", "PlayNest", "games", 199, "1 set", "🎲",
    { players: "2–4", age: "4+", learn_in: "About 2 minutes", game_length: "20–30 minutes", contents: "Double-sided board, 16 tokens, 1 die" }),
  i("word-cards", "Word guessing card game", "Ace & Co", "games", 349, "1 box", "🃏",
    { age: "12+", contents: "200 word cards, sand timer", language: "English" }),
  i("puzzle-500", "Jigsaw puzzle, 500 pieces", "PlayNest", "games", 449, "1 box", "🧩",
    { players: "1 or more", age: "10+", contents: "500 pieces, finished size 48 × 34 cm" }),

  // Small appliances: the view you live with decides it (P6's kettle).
  i("kettle-1l", "Electric kettle, 1 L", "HomeHearth", "appliances", 899, "1 kettle", "🫖",
    { capacity: "1 litre", power: "1350 W", inside: "Stainless steel, no exposed element", opening: "Wide mouth, about 9 cm across: a hand fits in to clean", photos: "Front, side, lid open from above, inside", auto_off: "Yes, plus dry-boil protection", cord: "0.75 m, 360° base", warranty: "1 year" }),
  i("kettle-1-5l", "Electric kettle, 1.5 L", "HomeHearth", "appliances", 1099, "1 kettle", "🫖",
    { capacity: "1.5 litres", power: "1500 W", inside: "Stainless steel", photos: "Front, side, on a kitchen counter", auto_off: "Yes", cord: "0.75 m, 360° base", warranty: "1 year" }),
  i("kettle-glass", "Glass electric kettle, 1.7 L", "Brewly", "appliances", 1299, "1 kettle", "🫖",
    { capacity: "1.7 litres", power: "2000 W", inside: "Borosilicate glass, LED lit", opening: "Narrow, about 6 cm: needs a bottle brush to clean", photos: "Front, side, lit up", auto_off: "Yes", warranty: "2 years" }),
  i("iron-dry", "Dry iron", "HomeHearth", "appliances", 749, "1 iron", "🧺",
    { power: "1000 W", photos: "Front, side, soleplate", auto_off: "No", cord: "1.8 m", warranty: "2 years" }),
  i("iron-steam", "Steam iron", "Brewly", "appliances", 1499, "1 iron", "🧺",
    { power: "1600 W", capacity: "220 ml water tank", photos: "Front, side, soleplate, tank filling", auto_off: "Yes, after 8 minutes", cord: "2 m", warranty: "2 years" }),
  i("hand-blender", "Hand blender", "Brewly", "appliances", 1199, "1 blender", "🥣",
    { power: "400 W", photos: "Front, in use in a pot", cord: "1.2 m" }),
  i("sandwich-maker", "Sandwich maker", "HomeHearth", "appliances", 999, "1 maker", "🥪",
    { power: "750 W", inside: "Non-stick plates, fixed (not removable)", photos: "Closed, open with sandwiches", warranty: "1 year" }),
];

export const ITEM_BY_ID = new Map(ITEMS.map((x) => [x.id, x]));

export const itemsIn = (c: CategoryId) => ITEMS.filter((x) => x.category === c);

/**
 * Details the seller left out on purpose in this demo, so the card's "not stated by the seller" answer can be
 * seen and tested. Each one is the deciding detail for that item (from the interviews).
 */
export const UNSTATED: Record<string, string[]> = {
  "tomato-hybrid": ["ripeness", "ready_in"],
  "mango-banganapalli": ["ripeness", "ready_in"],
  "salad-mix": ["packed_on"],
  "charger-basic": ["fast_charge", "works_with"],
  "watch-charger": ["works_with"],
  "flipflops-classic": ["size_guide"],
  "sliders-sport": ["size_guide", "exchange"],
  "slippers-kids": ["exchange"],
  "cat-ocean-fish": ["life_stage"],
  "litter-lavender": ["colour"],
  "envelope-cloth": ["size"],
  "marker-black-2": ["marker_type"],
  "word-cards": ["players", "learn_in"],
  "kettle-1-5l": ["opening"],
  "hand-blender": ["warranty"],
};

/** What the listing shows: stated values, then the deliberately missing ones as "not stated". */
export function listingRows(item: Item): { key: string; label: string; value: string | null }[] {
  return [
    ...Object.entries(item.attrs).map(([k, v]) => ({ key: k, label: ATTR_LABEL[k] ?? k, value: v })),
    ...(UNSTATED[item.id] ?? []).map((k) => ({ key: k, label: ATTR_LABEL[k] ?? k, value: null })),
  ];
}

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Demo MRP, for Blinkit-style "% OFF" ribbons. Invented like the rest of the catalogue: a fixed discount per item
 * (from its id, so it never changes between loads), and no discount on about a third of items.
 */
const OFFS = [0, 0, 0, 5, 8, 10, 12, 15, 18, 20];
export function mrpOf(item: Item): { mrp: number; off: number } | null {
  const h = [...item.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const off = OFFS[h % OFFS.length];
  if (!off) return null;
  const mrp = Math.round(item.price / (1 - off / 100) / 5) * 5;
  return mrp > item.price ? { mrp, off: Math.round((1 - item.price / mrp) * 100) } : null;
}
