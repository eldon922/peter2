import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Peter2";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  // `public/icon.png` is the app icon — the same artwork as
  // `app/favicon.ico`, decoded to PNG because Satori (the renderer
  // behind next/og) cannot rasterize .ico. Inlined as a data URI
  // rather than referenced by URL so rendering needs no network
  // round-trip back into our own server.
  const iconData = await readFile(join(process.cwd(), "public/icon.png"));
  const iconSrc = `data:image/png;base64,${iconData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 48,
          background: "#020617",
          color: "#f8fafc",
        }}
      >
        <div style={{ fontSize: 128, fontWeight: 600 }}>Peter2</div>
        <img
          src={iconSrc}
          width={220}
          height={220}
          style={{ borderRadius: 32 }}
        />
      </div>
    ),
    { ...size }
  );
}
