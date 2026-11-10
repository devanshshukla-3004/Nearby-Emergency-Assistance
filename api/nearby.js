// Nearby emergency services API using distinct, public OpenStreetMap Overpass instances.
// Requests are sequential and identify this application to respect provider policies.
const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter"
];

const APP_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  Accept: "application/json",
  "User-Agent": "NearbyEmergencyAssistance/1.0 (+https://nearby-emergency-assistance.vercel.app; contact: devanshshukla3004@gmail.com)",
  Referer: "https://nearby-emergency-assistance.vercel.app/"
};

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
      headers: APP_HEADERS,
      body: query,
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
  const errors = [];
  // Do not fan out requests: public Overpass operators ask clients to query one
  // instance at a time. The second endpoint is a genuine independent fallback.
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const elements = await queryOverpass(endpoint, query);
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
      errors.push(String(error?.message || error));
    }
  }

  console.error("All Overpass endpoints failed", { lat, lon, errors });
  return res.status(503).json({
    error: "OpenStreetMap search services are temporarily unavailable. Please retry shortly."
  });
};
