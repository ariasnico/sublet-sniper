import type { RawListing } from "./types";

export const DEMO_TAG = "DEMO DATA";
const SCAM_BODY = "Beautiful newly renovated 2 bedroom flat on 15th Street in the heart of Duboce Triangle, second floor of a three-unit Victorian. Hardwood floors, in-unit laundry, chef kitchen, steps to Duboce Park and the N Judah. Furnished on request. Open house this weekend.";

/** Seeded demo listings, clearly labeled. Never contacts real people. */
export function demoListings(): RawListing[] {
  const accomplice = process.env.DEMO_LANDLORD_EMAIL || "landlord-demo@example.com";
  return [
    {
      id: "demo-mission-bay", source: "demo", url: "https://example.com/demo/mission-bay-1br",
      title: `[${DEMO_TAG}] Furnished 1BR sublet near Caltrain, Nov 1 - Dec 15`, priceText: "$3,600", hood: "mission bay", category: "sub",
      body: "Sunny furnished 1BR in Mission Bay, 6 min walk to Caltrain 4th & King. Available 11/1 to 12/15 while I travel for work. In-unit laundry, gym in building. Happy to do a video tour or show in person. Rent paid via the building portal, standard lease addendum.",
      attrs: ["1BR / 1Ba", "rent period: monthly", "furnished", "laundry in unit"], lat: 37.7718, lon: -122.3925,
      images: ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=600&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=600&q=70"], posted: "2026-10-23T18:00:00-0700",
      demo: { kind: "accomplice", landlordEmail: accomplice, note: "Seeded demo listing. The 'landlord' is a teammate replying to the agent mailbox." },
    },
    {
      id: "demo-duboce-scam", source: "demo", url: "https://example.com/demo/duboce-scam-copy",
      title: `[${DEMO_TAG}] 2BR Duboce Triangle flat, renovated Victorian`, priceText: "$6,200", hood: "duboce", category: "apa",
      body: `${SCAM_BODY} I am currently out of the country so my assistant will show it. To secure the unit wire $18,600 (first, last and deposit) today, Zelle also OK.`,
      attrs: ["2BR / 1Ba", "rent period: monthly"], lat: 37.7676, lon: -122.4319, imageHashes: ["c4d1b38e8e3b1c63"], images: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=70"],
      demo: { kind: "scam_fixture", note: "Fixture inspired by the real Aug 2026 Duboce Triangle case: a fake Craigslist copy of a real Zillow listing took $18,600 by wire (SF Standard, KQED)." },
    },
    {
      id: "demo-duboce-original", source: "demo", url: "https://example.com/demo/duboce-original-zillow",
      title: `[${DEMO_TAG}] (original owner listing) 2BR Duboce Triangle`, priceText: "$6,200", hood: "duboce", category: "apa",
      body: `${SCAM_BODY} Contact the owner through the listing agent. Applications via our property manager portal.`,
      attrs: ["2BR / 1Ba", "rent period: monthly"], lat: 37.7676, lon: -122.4319, imageHashes: ["c4d1b38e8e3b1c67"], images: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&q=70"],
      demo: { kind: "scam_fixture", note: "The genuine listing the scammer copied (text and photos), used to show duplicate detection." },
    },
  ];
}
