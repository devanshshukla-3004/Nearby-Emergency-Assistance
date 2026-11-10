# Nearby — CSE326 Internet Programming Project

**Project title:** Nearby: A Smart Location-Based Emergency Assistance Web Application

A responsive, browser-based emergency assistance website that helps users find nearby emergency facilities, view directions, save useful places, manage trusted contacts, and prepare a location-sharing message.

## Technology used (mapped to CSE326 syllabus)

- HTML5: semantic page structure, forms, links and accessible labels
- CSS3: responsive design, Flexbox, Grid, variables, transitions, focus states and media queries
- JavaScript: functions, arrays, objects, conditions, DOM manipulation, event handling, validation and error handling
- Browser Geolocation API: current location detection
- Web Storage API / LocalStorage: saved contacts, saved places, theme preference and temporary result cache
- Fetch API and JSON: geocoding and nearby-service requests
- Node.js serverless API route on Vercel: keeps the Geoapify API key on the server
- Geoapify Places API: nearby hospital, clinic, pharmacy, police-station and fire-station data
- OpenStreetMap: map display, directions links and map-data attribution
- Vercel: hosting for the frontend and `/api/nearby` backend route

## Run and deploy

The complete application requires Vercel hosting because nearby-place lookup is handled by the server-side `/api/nearby` route. Opening `index.html` directly or deploying only the static files to GitHub Pages will not provide the nearby search API.

1. Fork or clone this repository.
2. Create a free Geoapify account at https://myprojects.geoapify.com/ and generate an API key.
3. Import the repository into Vercel.
4. In **Project Settings → Environment Variables**, add `GEOAPIFY_API_KEY` with the Geoapify key for Preview and Production environments.
5. Deploy the project.
6. Open the HTTPS deployment, allow location access or choose **Set location**, and test nearby search.

The API key must remain a server-side environment variable. Do not place it in `script.js`, HTML, public environment variables, or source control.

## Features

- Current location detection with manual location search fallback (Nominatim, then Photon)
- Nearby hospitals, clinics, pharmacies, police stations, fire stations and ambulance stations through Geoapify Places API
- 5 km search radius, distance sorting and up to 200 results
- Scrollable results panel so a large result set does not extend the full page
- Category filters and text search
- OpenStreetMap map and directions links
- Call links when a facility phone number is available in provider data
- Emergency call shortcut (`tel:112`)
- Prepare a location alert with WhatsApp and SMS links
- Trusted contact list with phone validation
- Saved emergency places
- Location-aware local result cache and dark mode
- Responsive layout, accessible labels, keyboard focus, status messages and reduced-motion support
- Server-side request timeout, API-key protection, input validation and short-lived response caching

## Important safety and data limitations

- This is an informational student project. It does **not** dispatch ambulances, police, fire services or emergency responders.
- The SOS area provides a direct phone link and prepares a message for the user to send. It does not silently send alerts or guarantee that a contact receives them.
- In India, use the official emergency number **112** for urgent assistance. If a call cannot connect, use another official local channel.
- Nearby listings depend on third-party and community-maintained place data. Names, locations, phone numbers, addresses and operating status may be missing or outdated. Always verify critical details.
- Location access is optional. The browser obtains location permission and sends the selected coordinates to the app's server-side nearby-search route to retrieve local places. Saved contacts, saved places, theme and result cache are stored in the browser's local storage.
- Geoapify free-plan quotas and provider availability apply. If the provider is unavailable or the quota is exceeded, the app may show an error or location-matched cached results.
- Map and place listings are informational only and must not be treated as official emergency dispatch information.

## External data attribution

The embedded map and map links use OpenStreetMap. Nearby place search is powered by Geoapify Places API, which includes OpenStreetMap-derived and other provider data. Manual location search uses public Nominatim with Photon as a fallback. Follow each provider's current terms, attribution requirements and usage limits.

## Suggested viva topics

Be ready to explain:
- `navigator.geolocation.getCurrentPosition()`
- `fetch()`, HTTP requests and JSON parsing
- DOM selection, creation and event listeners
- Arrays, objects, `filter()`, `map()` and `sort()`
- Haversine distance calculation
- Form validation and regular expressions
- `localStorage` and JSON serialization
- Error handling with `try/catch/finally` and request timeouts
- Responsive CSS Grid/Flexbox and media queries
- Serverless API routes and environment variables
- API quotas, third-party data limitations and emergency-safety disclaimers
