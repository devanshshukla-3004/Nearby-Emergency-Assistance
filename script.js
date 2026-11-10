/* Nearby — CSE326 Internet Programming project
   Course-aligned concepts: DOM, events, functions, arrays/objects, Fetch API,
   JSON, Geolocation API, Web Storage API, validation and error handling. */

const CONFIG = {
  radius: 5000,
  overpassEndpoints: [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
  ],
  nominatim: "https://nominatim.openstreetmap.org/search",
  photon: "https://photon.komoot.io/api/",
  cacheKey: "nearby_places_v2",
  contactsKey: "nearby_contacts_v1",
  savedKey: "nearby_saved_v1",
  themeKey: "nearby_theme_v1",
  cacheDuration: 6 * 60 * 60 * 1000
};

const CATEGORY_META = {
  hospital: { label: "Hospital", icon: "✚", filter: "hospital" },
  police: { label: "Police station", icon: "⌑", filter: "police" },
  fire: { label: "Fire station", icon: "♨", filter: "fire" },
  pharmacy: { label: "Pharmacy", icon: "✚", filter: "pharmacy" },
  ambulance: { label: "Ambulance station", icon: "＋", filter: "ambulance" },
  clinic: { label: "Clinic", icon: "✚", filter: "hospital" }
};

const state = {
  location: null,
  places: [],
  filter: "all",
  search: "",
  loading: false,
  requestId: 0,
  abortController: null
};

const $ = (selector) => document.querySelector(selector);
const statusMessage = $("#statusMessage");
const serviceList = $("#serviceList");
const locationLabel = $("#locationLabel");

function init() {
  bindEvents();
  applySavedTheme();
  renderContacts();
  renderSavedPlaces();
  updateSavedCount();
  requestCurrentLocation(false);
}

function bindEvents() {
  $("#locateBtn").addEventListener("click", () => requestCurrentLocation(true));
  $("#refreshBtn").addEventListener("click", refreshPlaces);
  $("#manualLocationBtn").addEventListener("click", () => {
    $("#manualPanel").hidden = false;
    $("#manualInput").focus();
  });
  $("#closeManual").addEventListener("click", () => { $("#manualPanel").hidden = true; });
  $("#manualForm").addEventListener("submit", onManualSearch);
  $("#filterList").addEventListener("click", onFilterClick);
  $("#searchInput").addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderPlaces();
  });
  $("#themeToggle").addEventListener("click", toggleTheme);
  $("#prepareAlertBtn").addEventListener("click", prepareLocationAlert);
  $("#closeAlert").addEventListener("click", () => { $("#alertPanel").hidden = true; });
  $("#contactForm").addEventListener("submit", onAddContact);
  $("#savedList").addEventListener("click", onSavedAction);
  $("#contactList").addEventListener("click", onContactAction);
  $("#serviceList").addEventListener("click", onServiceAction);
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
}

function requestCurrentLocation(showMessage) {
  if (!("geolocation" in navigator)) {
    setStatus("This browser does not support location detection. Set a location manually.", true);
    $("#manualPanel").hidden = false;
    return;
  }
  setStatus("Requesting your location…");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      setLocation(latitude, longitude, "Current location");
      loadNearbyPlaces();
    },
    (error) => {
      const message = error.code === 1
        ? "Location permission was denied. You can search for a city or area instead."
        : "Could not detect your location. Check your device settings or search manually.";
      setStatus(message, true);
      $("#manualPanel").hidden = false;
      loadCachedPlaces();
      if (showMessage) $("#manualInput").focus();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

function setLocation(lat, lon, label) {
  const nextLocation = { lat: Number(lat), lon: Number(lon), label };
  const locationChanged = !state.location ||
    distanceKm(state.location.lat, state.location.lon, nextLocation.lat, nextLocation.lon) > 1;
  if (state.abortController) state.abortController.abort();
  state.requestId += 1;
  state.loading = false;
  state.location = nextLocation;
  if (locationChanged) {
    state.places = [];
    renderPlaces();
  }
  locationLabel.textContent = label;
  updateMap();
}

async function onManualSearch(event) {
  event.preventDefault();
  const query = $("#manualInput").value.trim();
  if (query.length < 2) {
    setStatus("Enter at least two characters for the location.", true);
    return;
  }
  setStatus("Finding that location…");
  const submitButton = event.submitter;
  if (submitButton) submitButton.disabled = true;
  try {
    const result = await geocodeLocation(query);
    if (!result) {
      setStatus("No matching location found. Try a nearby city or landmark.", true);
      return;
    }
    setLocation(result.lat, result.lon, result.label);
    $("#manualPanel").hidden = true;
    loadNearbyPlaces();
  } catch (error) {
    setStatus(error.message || "Location search failed. Please try again.", true);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

async function geocodeLocation(query) {
  const attempts = [
    async () => {
      const url = `${CONFIG.nominatim}?q=${encodeURIComponent(query)}&format=json&limit=1`;
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 10000);
      if (!response.ok) throw new Error(`Nominatim returned HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data) || !data[0]) return null;
      return {
        lat: Number(data[0].lat),
        lon: Number(data[0].lon),
        label: String(data[0].display_name || query).split(",").slice(0, 2).join(",")
      };
    },
    async () => {
      const url = `${CONFIG.photon}?q=${encodeURIComponent(query)}&limit=1`;
      const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 10000);
      if (!response.ok) throw new Error(`Photon returned HTTP ${response.status}`);
      const data = await response.json();
      const feature = data.features?.[0];
      if (!feature?.geometry?.coordinates) return null;
      const [lon, lat] = feature.geometry.coordinates;
      const props = feature.properties || {};
      return {
        lat: Number(lat),
        lon: Number(lon),
        label: [props.name, props.city || props.town || props.village, props.state].filter(Boolean).slice(0, 2).join(", ") || query
      };
    }
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && Number.isFinite(result.lat) && Number.isFinite(result.lon)) return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw new Error("Location search services are temporarily unavailable. Please retry or use a nearby landmark.");
  return null;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildOverpassQuery(lat, lon) {
  const amenityPattern = "hospital|police|fire_station|pharmacy|clinic";
  return `[out:json][timeout:20];(nwr(around:${CONFIG.radius},${lat},${lon})["amenity"~"^(${amenityPattern})$"];nwr(around:${CONFIG.radius},${lat},${lon})["emergency"="ambulance_station"];);out center tags;`;
}

async function loadNearbyPlaces() {
  if (!state.location) return;
  if (state.abortController) state.abortController.abort();

  const requestId = ++state.requestId;
  const controller = new AbortController();
  state.abortController = controller;
  state.loading = true;
  setStatus("Searching for emergency services within 5 km…");
  $("#refreshBtn").disabled = true;

  try {
    const query = buildOverpassQuery(state.location.lat, state.location.lon);
    let payload = null;
    const failures = [];

    for (const endpoint of CONFIG.overpassEndpoints) {
      if (controller.signal.aborted || requestId !== state.requestId) return;
      const endpointController = new AbortController();
      const abortFromParent = () => endpointController.abort();
      controller.signal.addEventListener("abort", abortFromParent, { once: true });
      const timeoutId = window.setTimeout(() => endpointController.abort(), 18000);

      try {
        const url = `${endpoint}?data=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: endpointController.signal,
          mode: "cors",
          cache: "no-store"
        });

        if (!response.ok) {
          failures.push(`HTTP ${response.status}`);
          continue;
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.elements)) {
          failures.push("Invalid map response");
          continue;
        }

        payload = data;
        break;
      } catch (error) {
        if (controller.signal.aborted || requestId !== state.requestId) return;
        failures.push(error?.name === "AbortError" ? "Request timed out" : "Network/CORS request failed");
      } finally {
        window.clearTimeout(timeoutId);
        controller.signal.removeEventListener("abort", abortFromParent);
      }
    }

    if (controller.signal.aborted || requestId !== state.requestId) return;
    if (!payload) {
      const hadTimeout = failures.includes("Request timed out");
      const hadNetworkFailure = failures.includes("Network/CORS request failed");
      const reason = hadTimeout
        ? "Nearby map servers took too long to respond."
        : hadNetworkFailure
          ? "Your browser could not connect to the public map servers."
          : "Nearby map servers are temporarily unavailable.";
      throw new Error(`${reason} Please retry in a moment.`);
    }

    state.places = payload.elements
      .map(normalizePlace)
      .filter(Boolean)
      .map((place) => ({
        ...place,
        distance: distanceKm(state.location.lat, state.location.lon, place.lat, place.lon)
      }))
      .filter((place) => Number.isFinite(place.distance) && place.distance <= CONFIG.radius / 1000)
      .sort((a, b) => a.distance - b.distance);

    savePlacesCache(state.places);
    renderPlaces();
    updateMap();
    setStatus(state.places.length
      ? `${state.places.length} services found near ${state.location.label}. Results are sorted by distance.`
      : "No mapped emergency services were found within 5 km. Try another area or use official emergency numbers.");
  } catch (error) {
    if (requestId !== state.requestId || controller.signal.aborted) return;
    const hasCachedResults = loadCachedPlaces();
    setStatus(
      `${error.message || "Could not load nearby services."}${hasCachedResults ? " Showing saved results for this area." : " Check your connection and retry."}`,
      true
    );
  } finally {
    if (requestId === state.requestId) {
      state.loading = false;
      state.abortController = null;
      $("#refreshBtn").disabled = false;
    }
  }
}

function normalizePlace(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (!tags.name || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;

  let category = "";
  if (tags.amenity === "hospital") category = "hospital";
  else if (tags.amenity === "police") category = "police";
  else if (tags.amenity === "fire_station") category = "fire";
  else if (tags.amenity === "pharmacy") category = "pharmacy";
  else if (tags.emergency === "ambulance_station") category = "ambulance";
  else if (tags.amenity === "clinic") category = "clinic";
  if (!category) return null;

  const addressParts = [
    tags["addr:housenumber"], tags["addr:street"], tags["addr:suburb"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"]
  ].filter(Boolean);
  return {
    id: `${element.type}-${element.id}`,
    name: String(tags.name),
    category,
    address: addressParts.join(", ") || "Address not listed on OpenStreetMap",
    phone: tags.phone || tags["contact:phone"] || "",
    lat: Number(lat),
    lon: Number(lon)
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderPlaces() {
  const visible = state.places.filter((place) => {
    const categoryMatch = state.filter === "all" ||
      CATEGORY_META[place.category]?.filter === state.filter;
    const textMatch = !state.search ||
      `${place.name} ${place.address} ${CATEGORY_META[place.category]?.label || ""}`.toLowerCase().includes(state.search);
    return categoryMatch && textMatch;
  });

  $("#resultCount").textContent = String(state.places.length);
  serviceList.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.textContent = state.places.length
      ? "No services match this filter. Try another category or search."
      : "No services to display yet. Find your location to begin.";
    serviceList.append(empty);
    return;
  }

  visible.forEach((place) => {
    const meta = CATEGORY_META[place.category];
    const item = document.createElement("li");
    item.className = "service-card";

    const top = document.createElement("div");
    top.className = "service-card-top";
    const titleWrap = document.createElement("div");
    titleWrap.className = "service-title-wrap";
    const icon = document.createElement("span");
    icon.className = "service-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = meta.icon;
    const textWrap = document.createElement("div");
    const title = document.createElement("h3");
    title.className = "service-name";
    title.textContent = place.name;
    const type = document.createElement("span");
    type.className = "service-type";
    type.textContent = meta.label;
    textWrap.append(title, type);
    titleWrap.append(icon, textWrap);

    const distance = document.createElement("span");
    distance.className = "distance-tag";
    distance.textContent = `${place.distance.toFixed(1)} km`;
    top.append(titleWrap, distance);

    const address = document.createElement("p");
    address.className = "service-address";
    address.textContent = place.address;

    const actions = document.createElement("div");
    actions.className = "service-actions";
    if (place.phone) {
      const call = document.createElement("a");
      call.href = `tel:${place.phone.replace(/[^\d+]/g, "")}`;
      call.textContent = "Call";
      actions.append(call);
    }
    const directions = document.createElement("a");
    directions.href = `https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;
    directions.target = "_blank";
    directions.rel = "noopener noreferrer";
    directions.textContent = "Directions ↗";
    actions.append(directions);

    const save = document.createElement("button");
    save.type = "button";
    save.dataset.action = "save";
    save.dataset.id = place.id;
    save.textContent = isSaved(place.id) ? "Saved ✓" : "Save place";
    actions.append(save);

    item.append(top, address, actions);
    serviceList.append(item);
  });
}

function onFilterClick(event) {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.classList.toggle("active", chip === button);
  });
  renderPlaces();
}

function onServiceAction(event) {
  const button = event.target.closest("button[data-action='save']");
  if (!button) return;
  const place = state.places.find((item) => item.id === button.dataset.id);
  if (!place) return;
  const saved = getSavedPlaces();
  const exists = saved.some((item) => item.id === place.id);
  const next = exists ? saved.filter((item) => item.id !== place.id) : [...saved, place];
  localStorage.setItem(CONFIG.savedKey, JSON.stringify(next));
  renderSavedPlaces();
  updateSavedCount();
  renderPlaces();
}

function getSavedPlaces() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG.savedKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function isSaved(id) { return getSavedPlaces().some((place) => place.id === id); }

function renderSavedPlaces() {
  const list = $("#savedList");
  const saved = getSavedPlaces();
  list.replaceChildren();
  $("#savedCountSmall").textContent = `${saved.length} saved`;
  if (!saved.length) {
    const empty = document.createElement("li");
    empty.className = "saved-empty";
    empty.textContent = "Save a useful place to find it quickly later.";
    list.append(empty);
    return;
  }
  saved.forEach((place) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = place.name;
    const actions = document.createElement("span");
    const direction = document.createElement("a");
    direction.href = `https://www.openstreetmap.org/directions?to=${place.lat}%2C${place.lon}`;
    direction.target = "_blank";
    direction.rel = "noopener noreferrer";
    direction.textContent = "Map";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "remove";
    remove.dataset.id = place.id;
    remove.textContent = "Remove";
    actions.append(direction, document.createTextNode(" · "), remove);
    item.append(name, actions);
    list.append(item);
  });
}
function onSavedAction(event) {
  const button = event.target.closest("button[data-action='remove']");
  if (!button) return;
  const next = getSavedPlaces().filter((place) => place.id !== button.dataset.id);
  localStorage.setItem(CONFIG.savedKey, JSON.stringify(next));
  renderSavedPlaces();
  updateSavedCount();
  renderPlaces();
}
function updateSavedCount() {
  const count = getSavedPlaces().length;
  $("#savedCount").textContent = String(count);
  $("#savedCountSmall").textContent = `${count} saved`;
}

function updateMap() {
  if (!state.location) return;
  const { lat, lon } = state.location;
  const delta = 0.025;
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lon}`;
  const frame = document.createElement("iframe");
  frame.title = "Map showing your selected location";
  frame.loading = "lazy";
  frame.referrerPolicy = "no-referrer-when-downgrade";
  frame.src = src;
  $("#mapFrame").replaceChildren(frame);
}

function loadCachedPlaces() {
  try {
    const cached = JSON.parse(localStorage.getItem(CONFIG.cacheKey) || "null");
    if (!cached || !Array.isArray(cached.places) || !cached.location || !state.location ||
        Date.now() - cached.savedAt >= CONFIG.cacheDuration) return false;
    const offset = distanceKm(state.location.lat, state.location.lon, cached.location.lat, cached.location.lon);
    if (offset > 1) return false;
    state.places = cached.places.map((place) => ({
      ...place,
      distance: distanceKm(state.location.lat, state.location.lon, place.lat, place.lon)
    })).sort((a, b) => a.distance - b.distance);
    renderPlaces();
    setStatus("Showing recently saved nearby services. Refresh when you have a connection.");
    return true;
  } catch {
    setStatus("Saved results could not be read. Search again when online.", true);
    return false;
  }
}
function savePlacesCache(places) {
  try {
    localStorage.setItem(CONFIG.cacheKey, JSON.stringify({
      places,
      location: state.location ? { lat: state.location.lat, lon: state.location.lon, label: state.location.label } : null,
      savedAt: Date.now()
    }));
  } catch { /* Storage may be unavailable or full. */ }
}

function prepareLocationAlert() {
  if (!state.location) {
    setStatus("Set your location first, then prepare a location alert.", true);
    $("#manualPanel").hidden = false;
    return;
  }
  const mapLink = `https://www.openstreetmap.org/?mlat=${state.location.lat}&mlon=${state.location.lon}#map=17/${state.location.lat}/${state.location.lon}`;
  const message = `I may need assistance. My current location is: ${mapLink}`;
  $("#alertMessage").textContent = message;
  $("#whatsappShare").href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  $("#smsShare").href = `sms:?&body=${encodeURIComponent(message)}`;
  $("#alertPanel").hidden = false;
  $("#alertPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function onAddContact(event) {
  event.preventDefault();
  const name = $("#contactName").value.trim();
  const phone = $("#contactPhone").value.trim();
  const phonePattern = /^\+?[0-9\s()-]{7,18}$/;
  if (name.length < 2) {
    $("#contactName").setCustomValidity("Enter a name with at least two characters.");
    $("#contactName").reportValidity();
    return;
  }
  $("#contactName").setCustomValidity("");
  if (!phonePattern.test(phone)) {
    $("#contactPhone").setCustomValidity("Enter a valid phone number.");
    $("#contactPhone").reportValidity();
    return;
  }
  $("#contactPhone").setCustomValidity("");
  const contacts = getContacts();
  contacts.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name, phone });
  localStorage.setItem(CONFIG.contactsKey, JSON.stringify(contacts));
  $("#contactForm").reset();
  renderContacts();
}
function getContacts() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG.contactsKey) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}
function renderContacts() {
  const list = $("#contactList");
  list.replaceChildren();
  const contacts = getContacts();
  if (!contacts.length) {
    const empty = document.createElement("li");
    empty.className = "saved-empty";
    empty.textContent = "No personal contacts added yet.";
    list.append(empty);
    return;
  }
  contacts.forEach((contact) => {
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = `${contact.name} · ${contact.phone}`;
    const actions = document.createElement("span");
    actions.className = "contact-actions";
    const call = document.createElement("a");
    call.href = `tel:${contact.phone.replace(/[^\d+]/g, "")}`;
    call.textContent = "Call";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "delete";
    remove.dataset.id = contact.id;
    remove.textContent = "Remove";
    actions.append(call, remove);
    item.append(name, actions);
    list.append(item);
  });
}
function onContactAction(event) {
  const button = event.target.closest("button[data-action='delete']");
  if (!button) return;
  const contacts = getContacts().filter((contact) => contact.id !== button.dataset.id);
  localStorage.setItem(CONFIG.contactsKey, JSON.stringify(contacts));
  renderContacts();
}

function applySavedTheme() {
  const theme = localStorage.getItem(CONFIG.themeKey);
  if (theme === "dark") document.body.classList.add("dark");
}
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(CONFIG.themeKey, document.body.classList.contains("dark") ? "dark" : "light");
}
function refreshPlaces() {
  if (!state.location) {
    requestCurrentLocation(true);
    return;
  }
  loadNearbyPlaces();
}

init();
