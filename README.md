# Nearby — CSE326 Internet Programming Project

**Project title:** Nearby: A Smart Location-Based Emergency Assistance Web Application

A responsive, browser-based emergency assistance website that helps users locate nearby emergency facilities, view directions, save useful places, manage trusted contacts, and prepare a location-sharing message.

## Technology used (mapped to CSE326 syllabus)

- HTML5: semantic page structure, forms, links, accessible labels
- CSS3: responsive design, Flexbox, Grid, variables, transitions, focus states, media queries
- JavaScript: variables, constants, functions, arrays, objects, conditions, DOM manipulation, event handling, validation, regular expressions, error handling
- Browser Geolocation API: current location detection
- Web Storage API / LocalStorage: saved contacts, saved places, theme preference, temporary result cache
- Fetch API and JSON: location lookup and nearby service data
- GitHub Pages: static website deployment

No framework, backend, database, paid API, or build tool is required.

## Run the website

1. Extract the ZIP file.
2. Open `index.html` in a modern browser.
3. Allow location access when prompted, or use **Set location** to search for a city or area.
4. Internet access is needed for live OpenStreetMap/Nominatim/Overpass data and the embedded map.
5. For reliable browser geolocation, run the website from `localhost` or an HTTPS host such as GitHub Pages. Some browsers restrict geolocation on `file://` pages.

## Features

- Current location detection with manual location search fallback (Nominatim, then Photon)
- Nearby hospital, police, fire station, pharmacy, clinic and ambulance-station lookup with sequential Overpass endpoint fallback
- 5 km search radius and distance sorting
- Category filters and text search
- OpenStreetMap map and directions links
- Call links when a facility phone number is available in map data
- Emergency call shortcut (`tel:112`)
- Prepare a location alert with WhatsApp and SMS links
- Trusted contact list with phone validation
- Saved emergency places
- Local result cache and dark mode
- Responsive layout, accessible labels, status messages and reduced-motion support

## Important safety and data limitations

- This is an informational student project. It does **not** dispatch ambulances, police, fire services or emergency responders.
- The SOS area provides a direct phone link and prepares a message for the user to send. It does not silently send alerts or guarantee that a contact receives them.
- In India, use the official emergency number 112 for urgent assistance. If a call cannot connect, use another official local channel.
- Nearby service listings depend on OpenStreetMap community data. Listings, phone numbers, addresses, and operating status may be missing or outdated. Always verify critical details.
- Location access is optional. The app uses the browser's location permission and stores preferences/results locally in the browser. It does not have a server that receives the user's location.
- Public map/search services can be rate-limited or temporarily unavailable. Nearby tries a second Overpass instance if the primary instance fails, uses bounded request timeouts, and only reuses cached results when the cached location is within 1 km of the selected location. This improves resilience but cannot guarantee third-party service uptime.

## External data attribution

Map and place data are provided by OpenStreetMap contributors. Manual geocoding tries the public Nominatim service and then Photon. Nearby place queries use the public Overpass API instances. Review each provider's usage policy before any high-volume or production use; public services are best-effort and are not emergency dispatch infrastructure.

## GitHub Pages deployment

1. Create a GitHub repository for the project.
2. Upload `index.html`, `style.css`, `script.js`, and `README.md` to the repository root.
3. Open **Settings → Pages** in the repository.
4. Under build and deployment, select **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.
6. Open the published URL on an HTTPS connection and test location permission, manual search, filters, saved places, contacts, map and mobile layout.

## Suggested viva topics

Be ready to explain:
- `navigator.geolocation.getCurrentPosition()`
- `fetch()` and JSON parsing
- DOM selection, creation and event listeners
- Arrays, objects, `filter()`, `map()` and `sort()`
- Haversine distance calculation
- Form validation and regular expressions
- `localStorage` and JSON serialization
- Error handling with `try/catch/finally`
- Responsive CSS Grid/Flexbox and media queries
- Limitations of public map data and browser-based SOS links
