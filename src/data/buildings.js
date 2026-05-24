export const buildings = [
  {
    id: "victoria-arcade",
    name: "Victoria Arcade",
    address: "Market Street, Manchester",
    built: "c. 1898",
    confidence: "Medium",
    position: { lat: 53.4827, lng: -2.2426 },
    sources: ["historic-england", "local-planning", "land-registry", "newspaper-archive"],
    timeline: [
      {
        period: "1890s",
        description: "Likely constructed as a late Victorian commercial arcade serving Market Street retail traffic.",
      },
      {
        period: "1930s-1950s",
        description: "Ground-floor units adapted for smaller shopfronts as central shopping patterns changed.",
      },
      {
        period: "1990s",
        description: "Refurbishment period noted in local planning records and street-level commercial listings.",
      },
    ],
  },
  {
    id: "old-post-office",
    name: "Old Post Office",
    address: "King Street, Manchester",
    built: "c. 1910",
    confidence: "High",
    position: { lat: 53.4815, lng: -2.2475 },
    sources: ["historic-england", "local-planning", "companies-house"],
    timeline: [
      {
        period: "1910",
        description: "Built for civic and postal use during the expansion of commercial services in the city centre.",
      },
      {
        period: "1970s",
        description: "Internal conversion work introduced modern office layouts while retaining the main facade.",
      },
      {
        period: "2010s",
        description: "Later planning applications show mixed commercial reuse and conservation conditions.",
      },
    ],
  },
  {
    id: "station-warehouse",
    name: "Station Warehouse",
    address: "Whitworth Street, Manchester",
    built: "c. 1875",
    confidence: "Medium",
    position: { lat: 53.4755, lng: -2.2406 },
    sources: ["historic-england", "ordnance-survey", "local-archives"],
    timeline: [
      {
        period: "1870s",
        description: "Constructed as rail-adjacent warehouse space supporting textile and goods movement.",
      },
      {
        period: "1940s",
        description: "Bomb-damage and repair records may explain later structural alterations.",
      },
      {
        period: "2000s",
        description: "Converted toward office, hospitality, or residential use as former industrial land was regenerated.",
      },
    ],
  },
];
