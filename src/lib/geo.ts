export interface Place { name: string; lat: number; lon: number; aliases: string[] }
export const PLACES: Place[] = [
  { name: "Caltrain 4th & King", lat: 37.7764, lon: -122.3943, aliases: ["caltrain", "4th and king", "4th & king"] },
  { name: "Caltrain 22nd St", lat: 37.7575, lon: -122.3925, aliases: ["22nd st", "22nd street"] },
  { name: "Mission/16th BART", lat: 37.765, lon: -122.4197, aliases: ["bart", "16th st"] },
  { name: "Downtown / Montgomery", lat: 37.7894, lon: -122.4011, aliases: ["downtown", "fidi", "financial district", "centro"] },
  { name: "UCSF Parnassus", lat: 37.7631, lon: -122.4586, aliases: ["ucsf"] },
  { name: "SoMa", lat: 37.7785, lon: -122.4056, aliases: ["soma"] },
];
/** Approximate neighborhood centroids so listings without lat/lon can still be ranked by distance. */
export const HOODS: Record<string, [number, number]> = {
  "mission district": [37.7599, -122.4148], mission: [37.7599, -122.4148], "noe valley": [37.7502, -122.4337],
  "soma / south beach": [37.7785, -122.4056], soma: [37.7785, -122.4056], "south beach": [37.7823, -122.3912],
  "mission bay": [37.7706, -122.3915], "potrero hill": [37.7577, -122.4006], "dogpatch": [37.7609, -122.3888],
  "lower pac hts": [37.7843, -122.4334], "pacific heights": [37.7925, -122.4382], "nob hill": [37.793, -122.4161],
  "russian hill": [37.8011, -122.4194], "north beach / telegraph hill": [37.8061, -122.4103], "north beach": [37.8061, -122.4103],
  "inner richmond": [37.7802, -122.4645], "outer richmond": [37.7778, -122.4944], "richmond / seacliff": [37.7802, -122.4745],
  "inner sunset / UCSF": [37.7602, -122.4662], "sunset / parkside": [37.7534, -122.4945], "usf / panhandle": [37.7726, -122.4483],
  nopa: [37.7752, -122.4417], "haight ashbury": [37.7692, -122.4481], "lower haight": [37.7717, -122.4312],
  "hayes valley": [37.7759, -122.4245], "western addition": [37.7813, -122.4339], "castro / upper market": [37.7609, -122.435],
  "duboce": [37.7695, -122.4336], "bernal heights": [37.7389, -122.4152], "bayview": [37.7299, -122.3895],
  "tenderloin": [37.7847, -122.4141], "financial district": [37.7946, -122.3999], "marina / cow hollow": [37.8017, -122.4364],
  "glen park": [37.7337, -122.4339], "excelsior / outer mission": [37.7247, -122.4297], "visitacion valley": [37.7136, -122.4048],
  "twin peaks / diamond hts": [37.7473, -122.4418], "west portal / forest hills": [37.7406, -122.4659], "civic / van ness": [37.7793, -122.4193],
  "ingleside / sfsu / ccsf": [37.7219, -122.4549], "downtown / civic / van ness": [37.7836, -122.4156], "lower nob hill": [37.7875, -122.4135], "alamo square / nopa": [37.7766, -122.4347], "mid-market": [37.7793, -122.4146], "outer sunset": [37.7553, -122.5016], "cole valley": [37.7655, -122.4502], "portola district": [37.7275, -122.4078], "pac heights": [37.7925, -122.4382], "parnassus heights": [37.7631, -122.4586], "glenpark": [37.7337, -122.4339],
  "lakeshore": [37.7277, -122.4887], "candlestick point": [37.7104, -122.3866], "laurel hts / presidio": [37.7856, -122.4505],
};
export function hoodCoords(h: string | null): [number, number] | null {
  if (!h) return null;
  const k = h.toLowerCase().trim();
  if (HOODS[k]) return HOODS[k];
  const hit = Object.keys(HOODS).find((x) => k.includes(x) || x.includes(k));
  return hit ? HOODS[hit] : null;
}
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
