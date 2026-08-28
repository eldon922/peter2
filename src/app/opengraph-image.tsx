import { ImageResponse } from "next/og";

export const alt = "Peter2";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#f8fafc",
          fontSize: 128,
          fontWeight: 600,
        }}
      >
        Peter2
      </div>
    ),
    { ...size }
  );
}
