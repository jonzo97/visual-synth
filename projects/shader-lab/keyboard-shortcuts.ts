export type ShortcutKeyEvent = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

type ClosestTarget = {
  closest(selector: string): Element | null;
};

const textInputTypes = new Set([
  "email",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

export const isUndoShortcut = (event: ShortcutKeyEvent) =>
  Boolean(event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";

export const isTextEditingTarget = (target: EventTarget | null) => {
  if (!target || typeof (target as Partial<ClosestTarget>).closest !== "function") return false;
  const closest = (selector: string) => (target as unknown as ClosestTarget).closest(selector);
  const input = closest("input") as HTMLInputElement | null;
  if (input) return textInputTypes.has((input.type || input.getAttribute("type") || "text").toLowerCase());
  return Boolean(closest("textarea,select,[contenteditable],[role=spinbutton]"));
};
