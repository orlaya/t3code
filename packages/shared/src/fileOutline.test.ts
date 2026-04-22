import { describe, it, expect } from "vitest";
import {
  getFileOutlineOrContent,
  wouldCondense,
  grammarForExtension,
  AUTO_OUTLINE_THRESHOLD_BYTES,
} from "./fileOutline.js";

describe("fileOutline", () => {
  describe("wouldCondense", () => {
    it("returns false for small files", () => {
      expect(wouldCondense(100)).toBe(false);
      expect(wouldCondense(AUTO_OUTLINE_THRESHOLD_BYTES - 1)).toBe(false);
    });

    it("returns true at or above threshold", () => {
      expect(wouldCondense(AUTO_OUTLINE_THRESHOLD_BYTES)).toBe(true);
      expect(wouldCondense(AUTO_OUTLINE_THRESHOLD_BYTES + 1)).toBe(true);
    });
  });

  describe("grammarForExtension", () => {
    it("maps known extensions", () => {
      expect(grammarForExtension(".ts")).toBe("typescript");
      expect(grammarForExtension(".tsx")).toBe("tsx");
      expect(grammarForExtension(".js")).toBe("javascript");
      expect(grammarForExtension(".md")).toBe("markdown");
      expect(grammarForExtension(".rs")).toBe("rust");
      expect(grammarForExtension(".py")).toBe("python");
    });

    it("returns null for unknown extensions", () => {
      expect(grammarForExtension(".xyz")).toBe(null);
      expect(grammarForExtension(".docx")).toBe(null);
    });
  });

  describe("getFileOutlineOrContent", () => {
    it("returns content as-is for small files", async () => {
      const content = "const x = 1\nfunction foo() { return x }\n";
      const result = await getFileOutlineOrContent("test.ts", content);
      expect(result.condensed).toBe(false);
      expect(result.content).toBe(content);
      expect(result.totalLines).toBe(3);
    });

    it("returns outline for large TypeScript files", async () => {
      // Generate a file larger than the threshold
      const lines: string[] = [];
      for (let i = 0; i < 400; i++) {
        lines.push(`export function func${i}(a: string, b: number): void {`);
        lines.push(`  console.log(a, b)`);
        lines.push(`}`);
        lines.push(``);
      }
      const content = lines.join("\n");
      expect(Buffer.byteLength(content)).toBeGreaterThan(AUTO_OUTLINE_THRESHOLD_BYTES);

      const result = await getFileOutlineOrContent("big.ts", content);
      expect(result.condensed).toBe(true);
      expect(result.content).toContain("File outline");
      expect(result.content).toContain("func0");
      expect(result.content).toContain("func399");
      expect(result.content).toContain("[L");
    });

    it("falls back gracefully for large Markdown files (no grammar in tree-sitter-wasms)", async () => {
      const lines: string[] = [];
      for (let i = 0; i < 200; i++) {
        lines.push(`# Heading ${i}`);
        lines.push(``);
        lines.push(`Some paragraph text that takes up space to bulk up the file size.`);
        lines.push(`More text here to make sure we exceed the threshold easily enough.`);
        lines.push(``);
      }
      const content = lines.join("\n");
      expect(Buffer.byteLength(content)).toBeGreaterThan(AUTO_OUTLINE_THRESHOLD_BYTES);

      const result = await getFileOutlineOrContent("doc.md", content);
      expect(result.condensed).toBe(true);
      // Falls back to preview since tree-sitter-wasms doesn't ship a markdown grammar
      expect(result.content).toContain("Heading 0");
    });

    it("falls back to first 1KB for unknown file types above threshold", async () => {
      const content = "x".repeat(AUTO_OUTLINE_THRESHOLD_BYTES + 100);
      const result = await getFileOutlineOrContent("data.xyz", content);
      expect(result.condensed).toBe(true);
      expect(result.content).toContain("File preview");
      expect(result.content.length).toBeLessThan(content.length);
    });
  });
});
