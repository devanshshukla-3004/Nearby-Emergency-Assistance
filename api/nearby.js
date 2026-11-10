// Nearby services API using one Photon reverse request per selected location.
// A single multi-tag request avoids bursts of six simultaneous requests to the
// public Photon instance, which may be throttled when users change locations.
const PHOTON_ENDPOINT = "https://photon.komoot.io/reverse";

const CATEGORIES = [
  "amenity:hospital",
  "amenity:police",
  "amenity:fire_station",
  "amenity:pharmacy",
  "amenity:clinic",
  "emergency:ambulance_station"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPhoton(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/geo+json" },
        signal: controller.signal
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Photon temporarily returned HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`Photon returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data || !Array.isArray(data.features)) {
        throw new Error("Photon returned an invalid GeoJSON response");
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await sleep(700);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Photon request failed");
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

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    radius: "5",
    limit: "50",
    lang: "en"
  });
  for (const category of CATEGORIES) params.append("osm_tag", category);

  try {
    const data = await fetchPhoton(`${PHOTON_ENDPOINT}?${params.toString()}`);
    const elements = data.features.map((feature, index) => {
      const props = feature.properties || {};
      const [longitude, latitude] = feature.geometry?.coordinates || [];
      const tags = {
        ...(props.extra || {}),
        name: props.name || props.street || props.district || "Unnamed emergency service"
      };

      if (props.osm_key && props.osm_value) tags[props.osm_key] = props.osm_value;
      if (props.housenumber) tags["addr:housenumber"] = props.housenumber;
      if (props.street) tags["addr:street"] = props.street;
      if (props.district) tags["addr:suburb"] = props.district;
      if (props.city) tags["addr:city"] = props.city;
      if (props.phone) tags.phone = props.phone;

      return {
        type: props.osm_type === "W" ? "way" : props.osm_type === "R" ? "relation" : "node",
        id: props.osm_id || `photon-${index}-${latitude}-${longitude}`,
        lat: Number(latitude),
        lon: Number(longitude),
        tags
      };
    }).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lon));

    return res.status(200).json({
      elements,
      source: "OpenStreetMap via Photon",
      categoriesRequested: CATEGORIES.length
    });
  } catch (error) {
    console.error("Photon nearby lookup failed", {
      lat,
      lon,
      error: String(error?.message || error)
    });
    return res.status(503).json({
      error: error?.name === "AbortError"
        ? "The map data provider timed out. Please retry shortly."
        : "The map data provider is temporarily busy. Please wait a moment before searching another location."
    });
  }
};
