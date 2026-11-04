import { describe, expect, test } from "vitest";
import { decodeMemory, encodeMemory } from "@/lib/memory/format";
import { NS } from "@/lib/memory/namespaces";

describe("memory format", () => {
  test("round trip", () => {
    const t = encodeMemory("lesson", "Lakers won.", { q: 0.41 });
    expect(decodeMemory(t)).toEqual({ kind: "lesson", human: "Lakers won.", data: { q: 0.41 } });
  });

  test("human text comes first so semantic recall embeds the sentence", () => {
    expect(encodeMemory("call", "Sharp Line 50%.", {}).startsWith("Sharp Line 50%.\n§credence/v1 ")).toBe(true);
  });

  test("plain text decodes to null", () => expect(decodeMemory("hello")).toBeNull());

  test("corrupt payload decodes to null", () => expect(decodeMemory("x\n§credence/v1 {not json")).toBeNull());

  test("too long throws", () => expect(() => encodeMemory("lesson", "x".repeat(12001), {})).toThrow());

  test("namespaces", () => {
    expect(NS.voices).toBe("credence-voices");
    expect(NS.calls).toBe("credence-calls");
    expect(NS.lessons).toBe("credence-lessons");
    expect(NS.checkpoints).toBe("credence-checkpoints");
    expect(NS.user("Ravi_K")).toBe("credence-user-ravi_k");
  });
});
