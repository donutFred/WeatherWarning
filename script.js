// ---------- Time ----------
function updateClock() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(now);

  const tzName =
    Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "Local Time";

  document.getElementById("clock").textContent = formatted;
  document.getElementById("tz").textContent = tzName;
}
updateClock();
setInterval(updateClock, 1000);

// ---------- Geolocation ----------
const locStatus = document.getElementById("locationStatus");
const locData = document.getElementById("locationData");
const locErr = document.getElementById("locationError");

let map; // Leaflet map instance
let accuracyCircle;
let marker;

// Weather elements
const wxStatus = document.getElementById("weatherStatus");
const wxData = document.getElementById("weatherData");
const wxErr = document.getElementById("weatherError");

function showPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;

  // Update location text UI
  document.getElementById("lat").textContent = latitude.toFixed(6);
  document.getElementById("lon").textContent = longitude.toFixed(6);
  document.getElementById("acc").textContent = Math.round(accuracy);
  locStatus.textContent = "Permission granted.";
  locData.classList.remove("hidden");
  locErr.classList.add("hidden");

  // Initialize Leaflet map (first time only)
  if (!map) {
    map = L.map("map");
    // OSM tiles + attribution
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }

  // Place/Update marker & accuracy circle
  if (marker) {
    marker.setLatLng([latitude, longitude]);
  } else {
    marker = L.marker([latitude, longitude]).addTo(map);
  }

  if (accuracyCircle) {
    accuracyCircle.setLatLng([latitude, longitude]).setRadius(accuracy);
  } else {
    accuracyCircle = L.circle([latitude, longitude], {
      radius: accuracy,
      color: "#22d3ee",
      fillColor: "#22d3ee",
      fillOpacity: 0.15,
      weight: 1,
    }).addTo(map);
  }

  // Fit the map to the accuracy circle bounds (nice first view)
  map.fitBounds(accuracyCircle.getBounds(), { maxZoom: 15 });

  // Load weather for these coordinates
  fetchWeather(latitude, longitude);
}

function showError(err) {
  locData.classList.add("hidden");
  locErr.classList.remove("hidden");

  switch (err.code) {
    case err.PERMISSION_DENIED:
      locStatus.textContent = "Permission denied.";
      locErr.textContent =
        "We can’t show your location or map without permission. You can still see your current time.";
      wxStatus.textContent = "Weather requires your approximate location.";
      break;
    case err.POSITION_UNAVAILABLE:
      locStatus.textContent = "Location unavailable.";
      locErr.textContent =
        "We couldn’t determine your location. Check your network or GPS.";
      wxStatus.textContent = "Weather requires a location.";
      break;
    case err.TIMEOUT:
      locStatus.textContent = "Location timed out.";
      locErr.textContent =
        "Getting your position took too long. Please try again.";
      wxStatus.textContent = "Weather requires a location.";
      break;
    default:
      locStatus.textContent = "Location error.";
      locErr.textContent = "An unknown error occurred.";
      wxStatus.textContent = "Weather requires a location.";
  }
}

// Request location when the page loads (requires HTTPS)
if ("geolocation" in navigator) {
  locStatus.textContent = "Requesting your location…";
  navigator.geolocation.getCurrentPosition(showPosition, showError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
} else {
  locStatus.textContent = "Geolocation not supported in this browser.";
  wxStatus.textContent = "Weather requires a location.";
}

// ---------- Weather (Open‑Meteo, no API key) ----------
const WMO_DESCRIPTIONS = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function degToCompass(deg) {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchWeather(lat, lon) {
  try {
    wxStatus.textContent = "Fetching weather…";

    // Open‑Meteo current weather (no key). Using 2026-style "current=" parameter.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const c = data.current;
    if (!c) throw new Error("No current weather in response");

    const desc = WMO_DESCRIPTIONS[c.weather_code] ?? `Code ${c.weather_code}`;
    const windDir =
      typeof c.wind_direction_10m === "number"
        ? `${degToCompass(c.wind_direction_10m)} (${Math.round(c.wind_direction_10m)}°)`
        : "—";

    document.getElementById("wxDesc").textContent =
      desc + (c.is_day ? " (day)" : " (night)");
    document.getElementById("wxTemp").textContent =
      `${Math.round(c.temperature_2m)}°C`;
    document.getElementById("wxFeels").textContent =
      `${Math.round(c.apparent_temperature)}°C`;
    document.getElementById("wxWind").textContent =
      `${Math.round(c.wind_speed_10m)} km/h ${windDir}`;
    document.getElementById("wxHum").textContent =
      `${Math.round(c.relative_humidity_2m)}%`;
    document.getElementById("wxUpdated").textContent = `Updated: ${c.time}`;

    wxData.classList.remove("hidden");
    wxErr.classList.add("hidden");
    wxStatus.textContent = "Weather loaded.";
  } catch (e) {
    wxData.classList.add("hidden");
    wxErr.classList.remove("hidden");
    wxErr.textContent = "Could not load weather data.";
    wxStatus.textContent = "";
    console.error(e);
  }
}
