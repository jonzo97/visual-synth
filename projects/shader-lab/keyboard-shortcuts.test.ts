import { describe, expect, it } from "vitest";
import { isTextEditingTarget, isUndoShortcut } from "./keyboard-shortcuts";

function targetFor(matches: Record<string, unknown>) {
  return {
    closest(selector: string) {
      for (const option of selector.split(",")) {
        const match = matches[option.trim()];
        if (match) return match as Element;
      }
      return null;
    },
  } as unknown as EventTarget;
}

function input(type?: string) {
  return {
    type,
    getAttribute(name: string) {
      return name === "type" ? type ?? null : null;
    },
  } as HTMLInputElement;
}

describe("keyboard shortcuts", () => {
  it("accepts lowercase and uppercase undo keys from browsers and test drivers", () => {
    expect(isUndoShortcut({ key: "z", ctrlKey: true })).toBe(true);
    expect(isUndoShortcut({ key: "Z", ctrlKey: true })).toBe(true);
    expect(isUndoShortcut({ key: "Z", metaKey: true })).toBe(true);
    expect(isUndoShortcut({ key: "x", ctrlKey: true })).toBe(false);
    expect(isUndoShortcut({ key: "z" })).toBe(false);
  });

  it("classifies only text-entry controls as editing targets", () => {
    expect(isTextEditingTarget(targetFor({ input: input("text") }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ input: input("search") }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ input: input("number") }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ input: input() }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ textarea: {} }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ select: {} }))).toBe(true);
    expect(isTextEditingTarget(targetFor({ "[contenteditable]": {} }))).toBe(true);

    expect(isTextEditingTarget(targetFor({ input: input("range") }))).toBe(false);
    expect(isTextEditingTarget(targetFor({ input: input("checkbox") }))).toBe(false);
    expect(isTextEditingTarget(targetFor({ "[role=slider]": {} }))).toBe(false);
  });
});
