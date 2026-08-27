import { describe, expect, it } from "vitest";
import { formatDuration, formatFileSize, percentChange } from "./format";
import { previewKindForFile } from "./p2p";

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(45 * 60, true)).toBe("45m");
    expect(formatDuration(2 * 3600 + 18 * 60, true)).toBe("2h 18m");
    expect(formatDuration(3 * 3600)).toBe("3 hours");
  });
});

describe("formatFileSize", () => {
  it("chooses a readable unit", () => {
    expect(formatFileSize(2_621_440)).toBe("2.5 MB");
  });
});

describe("percentChange", () => {
  it("handles growth and an empty baseline", () => {
    expect(percentChange(12, 10)).toBe(20);
    expect(percentChange(8, 0)).toBe(100);
  });
});

describe("P2P media previews", () => {
  it("recognizes audio and image MIME types", () => {
    expect(previewKindForFile("efeito.bin", "audio/wav")).toBe("audio");
    expect(previewKindForFile("frame.bin", "image/png")).toBe("image");
  });

  it("falls back to common extensions when the browser omits MIME", () => {
    expect(previewKindForFile("trilha.MP3", "")).toBe("audio");
    expect(previewKindForFile("referencia.WEBP", "application/octet-stream")).toBe("image");
    expect(previewKindForFile("projeto.aep", "application/octet-stream")).toBeUndefined();
  });
});
