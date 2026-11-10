// Nearby emergency services API powered by Geoapify Places.
// The API key is read only on the server from Vercel environment variables.
const GEOAPIFY_ENDPOINT = "https://api.geoapify.com/v2/places";
const RADIUS_METERS = 5000;
const RESULT_LIMIT = 200;
const CATEGORIES = [
  "healthcare.hospital",
  "healthcare.pharmacy",
  "healthcare.clinic_or_praxis",
  "service.police",
  "service.fire_station"
];

function classifyPlace(properties = {}) {
  const categories = Array.isArray(properties.categories) ? properties.categories : [];
  const raw = properties.datasource?.raw || {};
  const values = [
    raw.amenity, raw.healthcare, raw.emergency, raw.police,
    ...categories
  ].filter(Boolean).map(value => String(value).toLowerCase());

  if (values.some(value => value === "service.police" || value === "police" || value.includes(".police"))) return "police";
  if (values.some(value => value === "service.fire_station" || value === "fire_station" || value.includes("fire_station"))) return "fire_station";
  if (values.some(value => value === "healthcare.pharmacy" || value === "pharmacy" || value.endsWith(".pharmacy"))) return "pharmacy";
  if (values.some(value => value === "healthcare.hospital" || value === "hospital" || value.endsWith(".hospital"))) return "hospital";
  if (values.some(value => value.includes("clinic") || value.includes("praxis") || value === "healthcare")) return "clinic";
  return null;
}

function normalizeFeature(feature, index) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates;
  const lat = Number(properties.lat ?? coordinates?.[1]);
  const lon = Number(properties.lon ?? coordinates?.[0]);
  const category = classifyPlace(properties);
  if (!category || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const name = String(properties.name || properties.address_line1 || properties.formatted || "").trim();
  if (!name) return null;

  const raw = properties.datasource?.raw || {};
  const phone = properties.contact?.phone || raw.phone || raw["contact:phone"] || "";
  const address = properties.formatted || [
    properties.address_line1,
    properties.address_line2
  ].filter(Boolean).join(", ") || "Address not listed";

  return {
    type: "geoapify",
    id: String(properties.place_id || feature.id || `${category}-${index}`),
    lat,
    lon,
    tags: {
      name,
      amenity: category === "fire_station" ? "fire_station" :
        category === "hospital" ? "hospital" :
        category === "pharmacy" ? "pharmacy" :
        category === "police" ? "police" : "clinic",
      emergency: "",
      phone: String(phone || ""),
      "addr:full": String(address)
    }
  };
}

async function searchGeoapify(lat, lon, apiKey) {
  const params = new URLSearchParams({
    categories: CATEGORIES.join(","),
    filter: `circle:${lon},${lat},${RADIUS_METERS}`,
    bias: `proximity:${lon},${lat}`,
    limit: String(RESULT_LIMIT),
    lang: "en",
    apiKey
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);
  try {
    const response = await fetch(`${GEOAPIFY_ENDPOINT}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "Geoapify API key is invalid or not authorized."
        : response.status === 429
          ? "Geoapify free-tier request limit reached. Please retry later."
          : `Geoapify Places API returned HTTP ${response.status}.`;
      const error = new Error(message);
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    const data = await response.json();
    if (!Array.isArray(data.features)) throw new Error("Geoapify returned an unexpected places response.");
    return data.features.map(normalizeFeature).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return res.status(400).json({ error: "A valid latitude and longitude are required." });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Nearby search is not configured yet. Add GEOAPIFY_API_KEY to the Vercel project environment." });
  }

  try {
    const elements = await searchGeoapify(lat, lon, apiKey);
    const categoryCounts = {
      hospital: 0, police: 0, fire_station: 0,
      pharmacy: 0, clinic: 0, ambulance_station: 0
    };
    for (const item of elements) {
      const category = item.tags.amenity;
      if (category === "hospital") categoryCounts.hospital++;
      else if (category === "police") categoryCounts.police++;
      else if (category === "fire_station") categoryCounts.fire_station++;
      else if (category === "pharmacy") categoryCounts.pharmacy++;
      else if (category === "clinic") categoryCounts.clinic++;
    }
    return res.status(200).json({
      elements,
      source: "Geoapify Places API",
      categoryCounts,
      notice: "Mapped locations may be incomplete or outdated. In an emergency, contact official emergency services."
    });
  } catch (error) {
    console.error("Geoapify nearby search failed", {
      lat, lon, message: String(error?.message || error)
    });
    return res.status(error.status || 503).json({
      error: error.message || "Nearby search services are temporarily unavailable. Please retry."
    });
  }
};
