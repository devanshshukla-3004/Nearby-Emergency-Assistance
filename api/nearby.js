// Nearby emergency services API.
// Query each OSM category independently: Photon reverse filters are applied
// per request, then the results are merged and deduplicated.
const PHOTON_ENDPOINT = "https://photon.komoot.io/reverse";

const CATEGORIES = [
  { id: "hospital", tag: "amenity:hospital" },
  { id: "police", tag: "amenity:police" },
  { id: "fire_station", tag: "amenity:fire_station" },
  { id: "pharmacy", tag: "amenity:pharmacy" },
  { id: "clinic", tag: "amenity:clinic" },
  { id: "ambulance_station", tag: "emergency:ambulance_station" }
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchCategory(lat, lon, category) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: "5",
    limit: "50",
    lang: "en",
    osm_tag: category.tag
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${PHOTON_ENDPOINT}?${params.toString()}`, {
      headers: { Accept: "application/geo+json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data || !Array.isArray(data.features)) {
      throw new Error("Invalid GeoJSON response");
    }

    return data.features.map((feature, index) => {
      const props = feature.properties || {};
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      const tags = {
        ...(props.extra || {}),
        name: props.name || props.street || props.district || "Unnamed emergency service",
        [category.tag.split(":")[0]]: category.tag.split(":")[1]
      };

      if (props.osm_key && props.osm_value) tags[props.osm_key] = props.osm_value;
      if (props.housenumber) tags["addr:housenumber"] = props.housenumber;
      if (props.street) tags["addr:street"] = props.street;
      if (props.district) tags["addr:suburb"] = props.district;
      if (props.city) tags["addr:city"] = props.city;
      if (props.phone) tags.phone = props.phone;

      return {
        type: props.osm_type === "W" ? "way" : props.osm_type === "R" ? "relation" : "node",
        id: props.osm_id || `photon-${category.id}-${index}-${latitude}-${longitude}`,
        lat: Number(latitude),
        lon: Number(longitude),
        tags
      };
    }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=3600");
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

  const combined = [];
  const categoryCounts = {};
  const categoryErrors = {};

  // Sequential requests avoid triggering the public instance's burst limiter.
  for (const category of CATEGORIES) {
    try {
      const features = await fetchCategory(lat, lon, category);
      categoryCounts[category.id] = features.length;
      combined.push(...features);
    } catch (error) {
      categoryCounts[category.id] = 0;
      categoryErrors[category.id] = error?.name === "AbortError"
        ? "timeout"
        : String(error?.message || error);
    }
    await wait(250);
  }

  const unique = new Map();
  for (const item of combined) {
    const key = `${item.type}-${item.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  const elements = Array.from(unique.values());
  if (!elements.length) {
    console.error("All category lookups failed or returned no features", { lat, lon, categoryErrors });
    return res.status(503).json({
      error: "No emergency service categories could be loaded. Please retry shortly.",
      categoryCounts,
      categoryErrors
    });
  }

  return res.status(200).json({
    elements,
    source: "OpenStreetMap via Photon",
    categoryCounts,
    partial: Object.keys(categoryErrors).length > 0
  });
};
