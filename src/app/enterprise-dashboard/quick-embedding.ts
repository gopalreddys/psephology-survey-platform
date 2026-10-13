import type { DashboardContentOptions } from "amazon-quicksight-embedding-sdk";

// Supported Quick theme properties only. Data colors remain governed by the
// published semantic mappings (BRS pink, BJP saffron and Congress green).
export const platformQuickContentOptions: DashboardContentOptions = {
  locale: "en-US",
  sheetOptions: { singleSheet: false, emitSizeChangedEventOnSheetChange: true },
  toolbarOptions: {
    export: false, undoRedo: false, reset: true, bookmarks: false,
    thresholdAlerts: false, scheduling: false, recentSnapshots: false,
    executiveSummary: false
  },
  themeOptions: {
    themeOverride: {
      UIColorPalette: {
        PrimaryBackground: "#FFFFFF", PrimaryForeground: "#3F2F35",
        SecondaryBackground: "#FFF9F5", SecondaryForeground: "#3F2F35",
        Accent: "#B9475C", AccentForeground: "#FFFFFF",
        Danger: "#B42318", DangerForeground: "#FFFFFF",
        Success: "#168C7F", SuccessForeground: "#FFFFFF",
        Warning: "#8A651E", WarningForeground: "#FFFFFF"
      },
      Typography: { FontFamilies: [{ FontFamily: "Arial" }] },
      Sheet: {
        Tile: { Border: { Show: false } },
        TileLayout: { Gutter: { Show: true }, Margin: { Show: true } }
      }
    }
  }
};

export type QuickEmbedStatus = "loading" | "ready" | "expired" | "error";

export function statusForQuickError(code: unknown): QuickEmbedStatus {
  return code === "Forbidden" || code === "Unauthorized" ? "expired" : "error";
}

export function isQuickEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      (url.hostname.endsWith(".quicksight.aws.amazon.com") ||
       url.hostname.endsWith(".quicksight.aws.amazon.com.cn"));
  } catch { return false; }
}

export function sessionDeadline(issuedAt?: string, lifetimeMinutes?: number): number | null {
  const issued = Date.parse(issuedAt || "");
  if (!Number.isFinite(issued) || !Number.isFinite(lifetimeMinutes) ||
      !lifetimeMinutes || lifetimeMinutes <= 0 || lifetimeMinutes > 600) return null;
  return issued + lifetimeMinutes * 60_000;
}
