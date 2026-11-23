import { ImageResponse } from "next/og";

// Link-preview card (LinkedIn, Slack, WhatsApp) for when the site is shared, e.g. from a resume.
export const alt = "Category Discovery Engine: what public reviews say about trying new categories on Blinkit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
                    justifyContent: "space-between", padding: 72, background: "#f8cb46", color: "#1c1c1c" }}>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>Category Discovery Engine</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
            Why do quick-commerce shoppers stick to the same categories?
          </div>
          <div style={{ fontSize: 30, color: "#4a3f12" }}>
            Public Play Store, App Store and Reddit feedback about Blinkit, collected hourly and analysed with AI.
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#4a3f12" }}>
          Independent research project · not affiliated with Blinkit
        </div>
      </div>
    ),
    size,
  );
}
