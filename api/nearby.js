// Nearby emergency services API.
// Server-side Overpass fallback avoids the public Photon reverse endpoint,
// which currently responds HTTP 503 for every category in this deployment.
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

function buildQuery(lat, lon) {
  return `[out:json][timeout:20];(
    nwr(around:5000,${lat},${lon})["amenity"~"^(hospital|police|fire_station|pharmacy|clinic)$"];
    nwr(around:5000,${lat},${lon})["emergency"="ambulance_station"];
  );out center tags;`;
}

async function queryOverpass(endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json"
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.elements)) throw new Error("Invalid Overpass response");
    return data.elements;
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

  const query = buildQuery(lat, lon);
  const attempts = OVERPASS_ENDPOINTS.map((endpoint) => queryOverpass(endpoint, query));
  try {
    // First healthy mirror wins; the remaining requests are aborted by the
    // platform when the handler completes, avoiding serial mirror delays.
    const elements = await Promise.any(attempts);
    const categoryCounts = {
      hospital: 0, police: 0, fire_station: 0,
      pharmacy: 0, clinic: 0, ambulance_station: 0
    };
    for (const item of elements) {
      const tags = item.tags || {};
      if (tags.amenity === "hospital") categoryCounts.hospital++;
      else if (tags.amenity === "police") categoryCounts.police++;
      else if (tags.amenity === "fire_station") categoryCounts.fire_station++;
      else if (tags.amenity === "pharmacy") categoryCounts.pharmacy++;
      else if (tags.amenity === "clinic") categoryCounts.clinic++;
      else if (tags.emergency === "ambulance_station") categoryCounts.ambulance_station++;
    }
    return res.status(200).json({
      elements,
      source: "OpenStreetMap via Overpass",
      categoryCounts
    });
  } catch (error) {
    console.error("All Overpass mirrors failed", {
      lat, lon,
      errors: (error?.errors || []).map((item) => String(item?.message || item))
    });
    return res.status(503).json({
      error: "OpenStreetMap search services are temporarily unavailable. Please retry shortly."
    });
  }
};
