import { describe, it, expect } from "vitest";
import {
  DC34_PRESETS,
  BUNDLED_LOGOS,
  relativeLuminance,
  contrastWarning,
  type QrStyle,
} from "../styles";

describe("relativeLuminance", () => {
  it("black=0, white=1, dark teal is dark", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#12836f")).toBeLessThan(0.25);
  });
});

describe("contrastWarning", () => {
  const base: QrStyle = {
    moduleShape: "square",
    moduleColor: "#000000",
    background: "#ffffff",
    eyeShape: "square",
    eyeColor: "#000000",
  };
  it("silent for black-on-white", () => {
    expect(contrastWarning(base)).toBeNull();
  });
  it("warns on light modules and inverted schemes", () => {
    expect(contrastWarning({ ...base, moduleColor: "#2fe3c6" })).toBeTruthy();
    expect(
      contrastWarning({ ...base, moduleColor: "#ffffff", background: "#000000" })
    ).toBeTruthy();
  });
  it("warns on light eyes even if modules are fine", () => {
    expect(contrastWarning({ ...base, eyeColor: "#ffe6f3" })).toBeTruthy();
  });
});

describe("DC34_PRESETS", () => {
  it("every preset is scannable: dark marks on light background", () => {
    for (const p of DC34_PRESETS) {
      expect(contrastWarning(p.style), p.id).toBeNull();
    }
  });
  it("includes classic as the first preset, no logo", () => {
    expect(DC34_PRESETS[0].id).toBe("classic");
    expect(DC34_PRESETS[0].style.logo).toBeUndefined();
  });
  it("preset logos reference bundled files", () => {
    const paths = BUNDLED_LOGOS.map((l) => l.path);
    for (const p of DC34_PRESETS) {
      if (p.style.logo) expect(paths).toContain(p.style.logo);
    }
  });
});
