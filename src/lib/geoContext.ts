type LatLng = [number, number];

type OSMTags = Record<string, string | undefined>;

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: OSMTags;
}

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const formatFeatureType = (tags: OSMTags = {}) => {
  if (tags.natural) return `natural=${tags.natural}`;
  if (tags.water) return `water=${tags.water}`;
  if (tags.waterway) return `waterway=${tags.waterway}`;
  if (tags.landuse) return `landuse=${tags.landuse}`;
  if (tags.military) return `military=${tags.military}`;
  if (tags.amenity) return `amenity=${tags.amenity}`;
  if (tags.healthcare) return `healthcare=${tags.healthcare}`;
  if (tags.highway) return `highway=${tags.highway}`;
  if (tags.railway) return `railway=${tags.railway}`;
  if (tags.place) return `place=${tags.place}`;
  if (tags.building) return `building=${tags.building}`;
  if (tags.leisure) return `leisure=${tags.leisure}`;
  return "mapped object";
};

const formatFeature = (element: OverpassElement) => {
  const tags = element.tags || {};
  const name = tags.name || tags["name:en"] || tags["name:ru"] || tags.operator;
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  const coords = typeof lat === "number" && typeof lng === "number"
    ? ` (${lat.toFixed(5)}, ${lng.toFixed(5)})`
    : "";

  return `- ${name ? `${name}: ` : ""}${formatFeatureType(tags)}${coords}`;
};

const isWaterFeature = (tags: OSMTags = {}) => {
  return tags.natural === "water" || Boolean(tags.water) || Boolean(tags.waterway);
};

const makeFallbackContext = ([lat, lng]: LatLng, reason?: string) => {
  return [
    `Origin coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`,
    reason ? `Live terrain lookup failed: ${reason}.` : "Live terrain lookup was not available.",
    "Use the coordinates as the outbreak origin, but do not assume there are roads, hospitals, bases, or dense population at the exact point unless the scenario says so.",
    "When the point appears to be water, forest, farmland, or wilderness, place map objects on plausible nearby shores, roads, settlements, or facilities instead of piling markers directly on the origin."
  ].join("\n");
};

export async function buildTerrainContext(location: LatLng): Promise<string> {
  const [lat, lng] = location;

  try {
    const reverseUrl = new URL("https://nominatim.openstreetmap.org/reverse");
    reverseUrl.searchParams.set("format", "jsonv2");
    reverseUrl.searchParams.set("lat", String(lat));
    reverseUrl.searchParams.set("lon", String(lng));
    reverseUrl.searchParams.set("zoom", "18");
    reverseUrl.searchParams.set("addressdetails", "1");
    reverseUrl.searchParams.set("extratags", "1");

    const reverseResponse = await fetchWithTimeout(reverseUrl.toString(), {
      headers: {
        "Accept": "application/json",
      },
    }, 7000);

    const reverseData = reverseResponse.ok ? await reverseResponse.json() : undefined;

    const overpassQuery = `
[out:json][timeout:8];
(
  node(around:1800,${lat},${lng})["natural"~"water|wood|scrub|wetland|beach"];
  way(around:1800,${lat},${lng})["natural"~"water|wood|scrub|wetland|beach"];
  relation(around:1800,${lat},${lng})["natural"~"water|wood|scrub|wetland|beach"];
  node(around:1800,${lat},${lng})["water"];
  way(around:1800,${lat},${lng})["water"];
  relation(around:1800,${lat},${lng})["water"];
  node(around:1800,${lat},${lng})["waterway"];
  way(around:1800,${lat},${lng})["waterway"];
  node(around:1800,${lat},${lng})["landuse"];
  way(around:1800,${lat},${lng})["landuse"];
  node(around:2500,${lat},${lng})["amenity"~"hospital|clinic|doctors|pharmacy|police|fire_station|school|shelter"];
  way(around:2500,${lat},${lng})["amenity"~"hospital|clinic|doctors|pharmacy|police|fire_station|school|shelter"];
  node(around:3000,${lat},${lng})["healthcare"];
  way(around:3000,${lat},${lng})["healthcare"];
  node(around:4000,${lat},${lng})["military"];
  way(around:4000,${lat},${lng})["military"];
  node(around:1200,${lat},${lng})["highway"];
  way(around:1200,${lat},${lng})["highway"];
  node(around:3500,${lat},${lng})["place"];
);
out center tags 35;
`;

    const overpassResponse = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "application/json",
      },
      body: `data=${encodeURIComponent(overpassQuery)}`,
    }, 10000);

    const overpassData = overpassResponse.ok ? await overpassResponse.json() : { elements: [] };
    const elements: OverpassElement[] = Array.isArray(overpassData?.elements) ? overpassData.elements : [];
    const waterFeatures = elements.filter(element => isWaterFeature(element.tags)).slice(0, 6);
    const nearbyFeatures = elements
      .filter(element => !isWaterFeature(element.tags))
      .slice(0, 18);

    const address = reverseData?.display_name || "Unknown named place";
    const exactType = [reverseData?.category, reverseData?.type].filter(Boolean).join("/") || "unknown surface";
    const isLikelyWater = reverseData?.category === "natural" && reverseData?.type === "water";
    const waterWarning = isLikelyWater || waterFeatures.length > 0
      ? "Water or shoreline features are nearby. If the origin is in a pond/lake/river, put people, vehicles, bases, clinics, checkpoints, and perimeters on reachable land, roads, shorelines, or nearby settlements unless the story explicitly requires water activity."
      : "No strong water signal was found near the origin. Still keep objects tied to plausible roads, facilities, settlements, and terrain.";

    return [
      `Origin coordinates: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`,
      `Reverse-geocoded place: ${address}.`,
      `Exact mapped category/type: ${exactType}.`,
      waterWarning,
      waterFeatures.length ? `Nearby water/terrain features:\n${waterFeatures.map(formatFeature).join("\n")}` : "Nearby water/terrain features: none found in lookup radius.",
      nearbyFeatures.length ? `Nearby useful map features:\n${nearbyFeatures.map(formatFeature).join("\n")}` : "Nearby useful map features: none found in lookup radius.",
      "Generation rule: story events and map objects must respect this geography. Do not create hospitals, military bases, roads, crowds, or vehicle routes in the middle of water, forest, farmland, or empty terrain unless the scenario explicitly makes that plausible."
    ].join("\n");
  } catch (e: any) {
    return makeFallbackContext(location, e?.message || "unknown error");
  }
}
