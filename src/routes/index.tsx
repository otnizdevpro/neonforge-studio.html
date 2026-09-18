import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NeonForge Studio — DAW hors ligne en un fichier HTML" },
      {
        name: "description",
        content:
          "Station de production musicale 100% hors ligne : synthé 3 oscillateurs, batterie, séquenceur, piano roll, export WAV/MP3 et projets .kdaw.",
      },
      { property: "og:title", content: "NeonForge Studio — DAW hors ligne" },
      {
        property: "og:description",
        content:
          "Synthé 3 oscillateurs, batterie, séquenceur, piano roll, mixeur et export WAV/MP3, dans un seul fichier HTML.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <h1 className="sr-only">NeonForge Studio — DAW hors ligne</h1>
      <iframe
        src="/neonforge-studio.html"
        title="NeonForge Studio"
        className="h-full w-full border-0"
        allow="autoplay"
      />
    </main>
  );
}
