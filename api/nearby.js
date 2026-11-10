// Vercel serverless proxy for OpenStreetMap Overpass.
// Keeps third-party CORS handling off the browser and tries providers in parallel.
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

function buildQuery(lat, lon) {
  const categories = "hospital|police|fire_station|pharmacy|clinic";
  return `[out:json][timeout:8];(nwr(around:5000,${lat},${lon})["amenity"~"^(${categories})$"];nwr(around:5000,${lat},${lon})["emergency"="ambulance_station"];);out center tags;`;
}

async function queryEndpoint(endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "application/json",
        "User-Agent": "NearbyEmergencyAssistance/1.0 (CSE326 educational project)"
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !Array.isArray(data.elements)) throw new Error("Provider returned invalid map data");
    return data;
  } finally {
    clearTimeout(timer);
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

  const query = buildQuery(lat, lon);
  const attempts = ENDPOINTS.map((endpoint) => queryEndpoint(endpoint, query));
  try {
    const data = await Promise.any(attempts);
    return res.status(200).json({ elements: data.elements, source: "OpenStreetMap Overpass" });
  } catch (error) {
    const reasons = error instanceof AggregateError ? error.errors : [error];
    const timedOut = reasons.some((item) => item && item.name === "AbortError");
    return res.status(503).json({
      error: timedOut
        ? "Public map data providers timed out. Please retry shortly."
        : "Public map data providers are temporarily unavailable. Please retry shortly."
    });
  }
};
