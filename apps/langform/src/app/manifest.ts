import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Langform",
    short_name: "Langform",
    description: "Lange Videos auf diesem Gerät. Ohne Kurzvideos, ohne Konto.",
    start_url: "/",
    display: "standalone",
    background_color: "#14110e",
    theme_color: "#14110e",
    lang: "de",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
