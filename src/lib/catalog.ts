export const ROOMS = [
  { key: "kitchen", label: "the kitchen" },
  { key: "bathroom", label: "the bathroom" },
  { key: "walk_in_closet", label: "the walk-in closet" },
  { key: "living_room", label: "the living room" },
  { key: "home_office", label: "the home office" },
  { key: "garage", label: "the garage" },
  { key: "balcony", label: "the balcony" },
] as const;

export type RoomKey = (typeof ROOMS)[number]["key"];

export const SIMPLE_TASKS = [
  { type: "change_sheets", label: "Change the sheets" },
  { type: "laundry", label: "Do the laundry" },
  { type: "dishes", label: "Do the dishes" },
  { type: "trash", label: "Take out the trash & recycling" },
  { type: "vacuum", label: "Vacuum" },
  { type: "mop", label: "Mop the floors" },
  { type: "dishwasher", label: "Empty the dishwasher" },
  { type: "windows", label: "Clean the windows" },
  { type: "plants", label: "Water the plants" },
  { type: "pets", label: "Feed the pets" },
  { type: "ironing", label: "Iron the clothes" },
] as const;

export type SimpleTaskType = (typeof SIMPLE_TASKS)[number]["type"];

export const STORE_SUGGESTIONS = ["Hemköp", "Coop", "City Gross", "ICA", "Salaam Livs", "IKEA"];

const MAX_TEXT_LEN = 500;

export type RawSubmittedItem =
  | { type: "room"; room: RoomKey; mode: "clean" }
  | { type: "room_spot"; room: RoomKey; text: string }
  | { type: SimpleTaskType }
  | { type: "supermarket_item"; text: string }
  | { type: "store_item"; place: string; text: string }
  | { type: "general"; text: string };

export interface ResolvedTask {
  type: string;
  label: string;
  place: string | null;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_TEXT_LEN);
}

/**
 * Validates and converts one item from the create-list form into a
 * DB-ready task (type + frozen display label). Returns null for anything
 * malformed or empty so the caller can silently drop it.
 */
export function resolveSubmittedItem(item: unknown): ResolvedTask | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;

  switch (raw.type) {
    case "room": {
      const room = ROOMS.find((r) => r.key === raw.room);
      if (!room || raw.mode !== "clean") return null;
      return { type: `clean_${room.key}`, label: `Clean ${room.label}`, place: null };
    }
    case "room_spot": {
      const room = ROOMS.find((r) => r.key === raw.room);
      const text = cleanText(raw.text);
      if (!room || !text) return null;
      return { type: `spot_clean_${room.key}`, label: `Spot clean ${room.label}: ${text}`, place: null };
    }
    case "supermarket_item": {
      const text = cleanText(raw.text);
      if (!text) return null;
      return { type: "supermarket_item", label: `Pick up from the supermarket: ${text}`, place: null };
    }
    case "store_item": {
      const place = cleanText(raw.place);
      const text = cleanText(raw.text);
      if (!place || !text) return null;
      return { type: "store_item", label: `Pick up from ${place}: ${text}`, place };
    }
    case "general": {
      const text = cleanText(raw.text);
      if (!text) return null;
      return { type: "general", label: text, place: null };
    }
    default: {
      const found = SIMPLE_TASKS.find((t) => t.type === raw.type);
      if (!found) return null;
      return { type: found.type, label: found.label, place: null };
    }
  }
}
