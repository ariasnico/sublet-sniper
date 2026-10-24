"use client";
import { useEffect, useRef } from "react";
import type { Map as LMap, LayerGroup, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { hoodCoords } from "@/lib/geo";
import type { RankedListing } from "@/lib/types";

const VERDICT = { green: "Looks safe", yellow: "Caution", red: "Likely scam" } as const;
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Small deterministic offset so listings sharing a neighborhood centroid don't stack. */
function jitter(id: string): [number, number] {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return [((h & 0xff) / 255 - 0.5) * 0.006, (((h >> 8) & 0xff) / 255 - 0.5) * 0.008];
}
function coords(l: RankedListing): [number, number] | null {
  if (l.lat && l.lon) return [l.lat, l.lon];
  const c = hoodCoords(l.neighborhood ?? l.hood);
  if (!c) return null;
  const j = jitter(l.id);
  return [c[0] + j[0], c[1] + j[1]];
}

export default function MapView({ listings, near, hovered }: { listings: RankedListing[]; near: { name: string; lat: number; lon: number }[]; hovered: string | null }) {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<LMap | null>(null);
  const layer = useRef<LayerGroup | null>(null);
  const markers = useRef(new Map<string, Marker>());

  useEffect(() => {
    let alive = true;
    void import("leaflet").then((L) => {
      if (!alive || !el.current || map.current) return;
      map.current = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([37.7649, -122.4294], 12);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      draw(L);
    });
    return () => { alive = false; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = (L: typeof import("leaflet")) => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers(); markers.current.clear();
    const pts: [number, number][] = [];
    for (const p of near) {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: `<div class="mk-near">★ ${p.name}</div>`, iconSize: [0, 0] }), zIndexOffset: 500 }).addTo(layer.current);
      pts.push([p.lat, p.lon]);
    }
    for (const l of listings) {
      const c = coords(l); if (!c) continue;
      pts.push(c);
      const price = l.priceMonthly ? `$${(l.priceMonthly / 1000).toFixed(1)}k` : "?";
      const m = L.marker(c, { icon: L.divIcon({ className: "", html: `<div class="mk ${l.scam.light}">${l.scam.light === "red" ? "⚠ " : ""}${price}</div>`, iconSize: [0, 0] }), zIndexOffset: l.scam.light === "red" ? 0 : 100 })
        .bindPopup(`<div class="mk-pop ${l.scam.light}"><b>${esc(l.title.replace(/^\[DEMO DATA\]\s*/i, "").replace(/[\s\-–—]+$/, ""))}</b><span><strong>$${l.priceMonthly?.toLocaleString("en-US") ?? "?"}</strong>/mo · <em>${VERDICT[l.scam.light]}</em> · risk ${l.scam.score}/100</span><a href="${esc(l.url)}" target="_blank" rel="noreferrer">Open listing</a></div>`, { closeButton: false, offset: [0, -10] })
        .addTo(layer.current);
      markers.current.set(l.id, m);
    }
    if (pts.length > 1) map.current.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  };

  useEffect(() => { void import("leaflet").then((L) => draw(L)); }, [listings, near]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const [id, m] of markers.current) m.getElement()?.querySelector(".mk")?.classList.toggle("hot", id === hovered);
  }, [hovered]);

  return <div ref={el} className="map" />;
}
