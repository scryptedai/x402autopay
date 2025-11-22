import { hexToRgb, getLuminance, hasMinimumContrast, adjustColorForContrast } from "./contrast";
import type { ColorScheme } from "./types";

const MIN_CONTRAST_NORMAL = 4.5;
const MIN_CONTRAST_UI = 3.0;
const MIN_CONTRAST_LARGE = 3.0;

export function adjustTextColor(text: string, background: string, defaultText: string): string {
  const finalText = text || defaultText;
  if (!hasMinimumContrast(finalText, background, MIN_CONTRAST_NORMAL)) {
    return adjustColorForContrast(finalText, background, MIN_CONTRAST_NORMAL);
  }
  return finalText;
}

export function adjustPrimaryColor(primary: string, defaultPrimary: string): string {
  const finalPrimary = primary || defaultPrimary;
  const primaryText = "#ffffff";
  if (!hasMinimumContrast(primaryText, finalPrimary, MIN_CONTRAST_UI)) {
    return adjustColorForContrast(finalPrimary, "#ffffff", MIN_CONTRAST_UI);
  }
  return finalPrimary;
}

export function adjustBorderColor(border: string, background: string, defaultBorder: string): string {
  const finalBorder = border || defaultBorder;
  if (!hasMinimumContrast(finalBorder, background, 1.5)) {
    return adjustColorForContrast(finalBorder, background, 1.5);
  }
  return finalBorder;
}

export function computeInputBackground(background: string): string {
  const bgRgb = hexToRgb(background);
  const bgLum = bgRgb ? getLuminance(bgRgb) : 0.5;
  const isLightBg = bgLum > 0.5;

  if (isLightBg) {
    const rgb = hexToRgb(background) || [255, 255, 255];
    return `#${rgb.map((v) => Math.max(0, v - 8).toString(16).padStart(2, "0")).join("")}`;
  } else {
    const rgb = hexToRgb(background) || [0, 0, 0];
    return `#${rgb.map((v) => Math.min(255, v + 8).toString(16).padStart(2, "0")).join("")}`;
  }
}

export function adjustInputText(inputText: string, inputBackground: string): string {
  if (!hasMinimumContrast(inputText, inputBackground, MIN_CONTRAST_NORMAL)) {
    return adjustColorForContrast(inputText, inputBackground, MIN_CONTRAST_NORMAL);
  }
  return inputText;
}

export function computeInputPlaceholder(inputText: string, inputBackground: string): string {
  const inputTextRgb = hexToRgb(inputText) || [0, 0, 0];
  const inputBgRgb = hexToRgb(inputBackground) || [255, 255, 255];
  const placeholderRgb: [number, number, number] = [
    Math.round(inputTextRgb[0] * 0.5 + inputBgRgb[0] * 0.5),
    Math.round(inputTextRgb[1] * 0.5 + inputBgRgb[1] * 0.5),
    Math.round(inputTextRgb[2] * 0.5 + inputBgRgb[2] * 0.5),
  ];
  let placeholder = `#${placeholderRgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  if (!hasMinimumContrast(placeholder, inputBackground, 1.5)) {
    placeholder = adjustColorForContrast(placeholder, inputBackground, 1.5);
  }
  return placeholder;
}

export function adjustInputBorder(inputBorder: string, inputBackground: string): string {
  if (!hasMinimumContrast(inputBorder, inputBackground, 1.5)) {
    return adjustColorForContrast(inputBorder, inputBackground, 1.5);
  }
  return inputBorder;
}

export function computeLabelColor(text: string, background: string): string {
  const textRgb = hexToRgb(text) || [0, 0, 0];
  const bgRgb = hexToRgb(background);
  const bgLum = bgRgb ? getLuminance(bgRgb) : 0.5;
  const isLightBg = bgLum > 0.5;
  const labelRgb: [number, number, number] = [
    Math.round(textRgb[0] * 0.7 + (isLightBg ? 0 : 255) * 0.3),
    Math.round(textRgb[1] * 0.7 + (isLightBg ? 0 : 255) * 0.3),
    Math.round(textRgb[2] * 0.7 + (isLightBg ? 0 : 255) * 0.3),
  ];
  let labelColor = `#${labelRgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

  if (!hasMinimumContrast(labelColor, background, MIN_CONTRAST_LARGE)) {
    labelColor = adjustColorForContrast(labelColor, background, MIN_CONTRAST_LARGE);
  }
  return labelColor;
}

