
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  return [
    Number.parseInt(match[1], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[3], 16),
  ];
}

export function getLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((val) => {
    const normalized = val / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  if (!rgb1 || !rgb2) return 1;

  const lum1 = getLuminance(rgb1);
  const lum2 = getLuminance(rgb2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);

  return (lighter + 0.05) / (darker + 0.05);
}

export function hasMinimumContrast(
  foreground: string,
  background: string,
  minRatio: number = 4.5,
): boolean {
  return getContrastRatio(foreground, background) >= minRatio;
}

export function adjustColorForContrast(
  color: string,
  background: string,
  minRatio: number,
): string {
  const rgb = hexToRgb(color);
  if (!rgb) return color;

  const currentRatio = getContrastRatio(color, background);
  if (currentRatio >= minRatio) return color;

  const bgRgb = hexToRgb(background);
  if (!bgRgb) return color;

  const bgLum = getLuminance(bgRgb);
  const isLightBg = bgLum > 0.5;
  const targetRgb: [number, number, number] = isLightBg ? [0, 0, 0] : [255, 255, 255];

  for (let step = 0.1; step <= 1.0; step += 0.1) {
    const adjustedRgb: [number, number, number] = [
      Math.round(rgb[0] * (1 - step) + targetRgb[0] * step),
      Math.round(rgb[1] * (1 - step) + targetRgb[1] * step),
      Math.round(rgb[2] * (1 - step) + targetRgb[2] * step),
    ];
    const adjustedHex = `#${adjustedRgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const ratio = getContrastRatio(adjustedHex, background);

    if (ratio >= minRatio) {
      return adjustedHex;
    }
  }

  return `#${targetRgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

import {
  adjustTextColor,
  adjustPrimaryColor,
  adjustBorderColor,
  computeInputBackground,
  adjustInputText,
  computeInputPlaceholder,
  adjustInputBorder,
  computeLabelColor,
} from "./contrast-colors";

export function ensureReadableColors(colorScheme: {
  primary?: string;
  background?: string;
  text?: string;
  accent?: string;
  border?: string;
}): {
  primary: string;
  background: string;
  text: string;
  accent: string;
  border: string;
  inputBackground: string;
  inputText: string;
  inputPlaceholder: string;
  inputBorder: string;
  labelColor: string;
} {
  const defaultBg = "#ffffff";
  const defaultText = "#111827";
  const defaultPrimary = "#2563eb";
  const defaultBorder = "#d4d4d8";

  const background = colorScheme.background || defaultBg;
  const text = adjustTextColor(colorScheme.text, background, defaultText);
  const primary = adjustPrimaryColor(colorScheme.primary, defaultPrimary);
  const border = adjustBorderColor(colorScheme.border, background, defaultBorder);
  const accent = colorScheme.accent || primary;

  const inputBackground = computeInputBackground(background);
  const inputText = adjustInputText(text, inputBackground);
  const inputPlaceholder = computeInputPlaceholder(inputText, inputBackground);
  const inputBorder = adjustInputBorder(border, inputBackground);
  const labelColor = computeLabelColor(text, background);

  return {
    primary,
    background,
    text,
    accent,
    border,
    inputBackground,
    inputText,
    inputPlaceholder,
    inputBorder,
    labelColor,
  };
}

