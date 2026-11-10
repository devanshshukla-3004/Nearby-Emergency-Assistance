// Nearby places API: use Photon reverse search with OSM category filters.
// This avoids expensive, broad Overpass interpreter queries for every page visit.
const PHOTON_ENDPOINT = "https://photon.komoot.io/reverse";

const CATEGORIES = [
  { key: "amenity", value: "hospital" },
  { key: "amenity", value: "police" },
  { key: "amenity", value: "fire_station" },
  { key: "amenity", value: "pharmacy" },
  { key: "amenity", value: "clinic" },
  { key: "emergency", value: "ambulance_station" }
];

async function searchCategory(lat, lon, category) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: "5",
    limit: "20",
    osm_tag: `${category.key}:${category.value}`
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${PHOTON_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/geo+json, application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error("Photon returned an invalid GeoJSON response");
    return data.features.map((feature) => {
      const props = feature.properties || {};
      const coordinates = feature.geometry?.coordinates || [];
      const [lonValue, latValue] = coordinates;
      const tags = { name: props.name || props.street || "", ...props.extra };
      tags[category.key] = category.value;
      if (props.housenumber) tags["addr:housenumber"] = props.housenumber;
      if (props.street) tags["addr:street"] = props.street;
      if (props.district) tags["addr:suburb"] = props.district;
      if (props.city) tags["addr:city"] = props.city;
      if (props.phone) tags.phone = props.phone;
      return {
        type: props.osm_type === "W" ? "way" : props.osm_type === "R" ? "relation" : "node",
        id: props.osm_id || `${category.value}-${latValue}-${lonValue}`,
        lat: Number(latValue),
        lon: Number(lonValue),
        tags
      };
    }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "A valid latitude and longitude are required." });
  }

  const results = await Promise.allSettled(
    CATEGORIES.map((category) => searchCategory(lat, lon, category))
  );
  const successful = results.filter((result) => result.status === "fulfilled");
  if (!successful.length) {
    console.error("All Photon category lookups failed", results.map((result) =>
      result.status === "rejected" ? String(result.reason?.message || result.reason) : "ok"
    ));
    return res.status(503).json({
      error: "The OpenStreetMap places search is temporarily unavailable. Please retry shortly."
    });
  }

  const elements = successful.flatMap((result) => result.value);
  const unique = new Map();
  for (const item of elements) {
    const key = `${item.type}-${item.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  return res.status(200).json({
    elements: Array.from(unique.values()),
    source: "OpenStreetMap via Photon",
    categoriesAvailable: successful.length,
    categoriesRequested: CATEGORIES.length
  });
};
