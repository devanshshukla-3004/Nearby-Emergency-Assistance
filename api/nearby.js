// Nearby places API using Photon reverse search.
// Photon /reverse supports radius (km), limit and OSM-tag filtering.
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
  const params = new URLSearchParams();
  params.set("lat", String(lat));
  params.set("lon", String(lon));
  params.set("radius", "5"); // Photon radius is in kilometres.
  params.set("limit", "20");
  params.set("lang", "en");
  params.append("osm_tag", `${category.key}:${category.value}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${PHOTON_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/geo+json",
        "User-Agent": "NearbyEmergencyAssistance/1.0 (CSE326 student project)"
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Photon HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.features)) {
      throw new Error(data.message || "Photon returned an invalid GeoJSON response");
    }

    return data.features.map((feature) => {
      const props = feature.properties || {};
      const coordinates = feature.geometry?.coordinates || [];
      const [longitude, latitude] = coordinates;
      const tags = {
        ...(props.extra || {}),
        name: props.name || props.street || props.district || `${category.value.replace("_", " ")} (unnamed)`
      };
      tags[props.osm_key || category.key] = props.osm_value || category.value;
      if (props.housenumber) tags["addr:housenumber"] = props.housenumber;
      if (props.street) tags["addr:street"] = props.street;
      if (props.district) tags["addr:suburb"] = props.district;
      if (props.city) tags["addr:city"] = props.city;
      if (props.phone) tags.phone = props.phone;
      return {
        type: props.osm_type === "W" ? "way" : props.osm_type === "R" ? "relation" : "node",
        id: props.osm_id || `${category.value}-${latitude}-${longitude}`,
        lat: Number(latitude),
        lon: Number(longitude),
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

  const settled = await Promise.allSettled(
    CATEGORIES.map((category) => searchCategory(lat, lon, category))
  );
  const elements = [];
  const failedCategories = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") elements.push(...result.value);
    else {
      failedCategories.push(CATEGORIES[index].value);
      console.error("Photon category lookup failed", {
        category: CATEGORIES[index].value,
        error: String(result.reason?.message || result.reason)
      });
    }
  });

  if (settled.every((result) => result.status === "rejected")) {
    return res.status(503).json({
      error: "The nearby places provider did not respond. This may be a temporary provider or network issue. Please retry shortly.",
      failedCategories
    });
  }

  const unique = new Map();
  for (const item of elements) {
    const key = `${item.type}-${item.id}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  return res.status(200).json({
    elements: Array.from(unique.values()),
    source: "OpenStreetMap via Photon",
    categoriesAvailable: CATEGORIES.length - failedCategories.length,
    categoriesRequested: CATEGORIES.length,
    failedCategories
  });
};
