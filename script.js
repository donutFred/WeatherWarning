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

// Weather elements
const wxStatus = document.getElementById("weatherStatus");
const wxData = document.getElementById("weatherData");
const wxErr = document.getElementById("weatherError");

// Leaflet instances
let map, marker, accuracyCircle;

function initMapIfNeeded(lat, lon, zoom = 15) {
  if (!map) {
    map = L.map("map").setView([lat, lon], zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  } else {
    map.setView([lat, lon], map.getZoom() || zoom);
  }
}

function showPosition(pos) {
  const { latitude, longitude, accuracy } = pos.coords;

  // Update location text UI
  document.getElementById("lat").textContent = latitude.toFixed(6);
  document.getElementById("lon").textContent = longitude.toFixed(6);
  document.getElementById("acc").textContent = Math.round(accuracy);
  locStatus.textContent = "Permission granted.";
  locData.classList.remove("hidden");
  locErr.classList.add("hidden");

  // Init/center map first
  initMapIfNeeded(latitude, longitude);

  // Place/Update marker & accuracy circle
  if (!marker) {
    marker = L.marker([latitude, longitude]).addTo(map);
  } else {
    marker.setLatLng([latitude, longitude]);
  }

  if (!accuracyCircle) {
    accuracyCircle = L.circle([latitude, longitude], {
      radius: accuracy,
      color: "#22d3ee",
      fillColor: "#22d3ee",
      fillOpacity: 0.15,
      weight: 1,
    }).addTo(map);
  } else {
    accuracyCircle.setLatLng([latitude, longitude]).setRadius(accuracy);
  }

  // Address and weather for these coordinates
  fetchAddress(latitude, longitude);
  fetchWeather(latitude, longitude);
}

function showError(err) {
  locData.classList.add("hidden");
  locErr.classList.remove("hidden");
  wxData.classList.add("hidden");
  wxStatus.textContent = "";

  switch (err.code) {
    case err.PERMISSION_DENIED:
      locStatus.textContent = "Permission denied.";
      locErr.textContent =
        "We can’t show your location or map without permission. You can still see your time.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Weather requires your approximate location.";
      break;
    case err.POSITION_UNAVAILABLE:
      locStatus.textContent = "Location unavailable.";
      locErr.textContent = "We couldn’t determine your location.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Weather requires a location.";
      break;
    case err.TIMEOUT:
      locStatus.textContent = "Location timed out.";
      locErr.textContent = "Getting your position took too long.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Weather requires a location.";
      break;
    default:
      locStatus.textContent = "Location error.";
      locErr.textContent = "An unknown error occurred.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Weather requires a location.";
  }
}

// Request location when the page loads (HTTPS required on most browsers)
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

const WMO_ICONS = {
  0: "☀️",
  1: "🌤",
  2: "⛅",
  3: "☁️",
  45: "🌫",
  48: "🌫",
  51: "🌦",
  53: "🌦",
  55: "🌧",
  56: "🌧❄️",
  57: "🌧❄️",
  61: "🌧",
  63: "🌧",
  65: "⛈",
  66: "🌧❄️",
  67: "🌧❄️",
  71: "🌨",
  73: "🌨",
  75: "🌨",
  77: "🌨",
  80: "🌦",
  81: "🌧",
  82: "⛈",
  85: "❄️",
  86: "❄️",
  95: "⛈",
  96: "⛈",
  99: "⛈",
};

function getWeatherIcon(code, isDay) {
  const icon = WMO_ICONS[code] || "🌈";
  if (!isDay) {
    if (code === 0) return "🌙";
    if ([1, 2, 3, 45, 48].includes(code)) return "🌜";
  }
  return icon;
}

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

function extractSuburb(address) {
  if (!address || typeof address !== "object") return null;
  const keys = [
    "suburb",
    "neighbourhood",
    "city_district",
    "quarter",
    "town",
    "village",
    "city",
    "municipality",
    "county",
    "state",
  ];

  const found = keys.map((k) => address[k]).find(Boolean);
  return found || null;
}

async function fetchAddress(lat, lon) {
  const addrEl = document.getElementById("address");
  try {
    addrEl.textContent = "Fetching general location…";
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`,
      {
        headers: {
          "User-Agent": "WeatherWarning/1.0"
        }
      }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const suburb = extractSuburb(data.address);
    if (suburb) {
      addrEl.textContent = suburb;
    } else {
      // final fallback to broader display name
      addrEl.textContent = data.display_name
        ? data.display_name.split(",").slice(-3).join(", ")
        : "Approximate location";
    }
  } catch (err) {
    console.warn("Reverse geocode failed", err);
    addrEl.textContent = "Approximate location unknown";
  }
}

function buildForecast(data) {
  const today = new Date();
  const rows = document.getElementById("forecastRows");
  rows.innerHTML = "";

  const times = data.time || [];
  const gusts = data.windgusts_10m_max || [];
  const dirs = data.winddirection_10m_dominant || [];

  for (let i = 0; i < Math.min(times.length, 7); i++) {
    const row = document.createElement("tr");
    const dateCell = document.createElement("td");
    const gustCell = document.createElement("td");
    const dirCell = document.createElement("td");

    const d = new Date(times[i]);
    dateCell.textContent = d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    gustCell.textContent = gusts[i] !== undefined ? `${Math.round(gusts[i])}` : "—";
    dirCell.textContent =
      dirs[i] !== undefined
        ? `${degToCompass(dirs[i])} (${Math.round(dirs[i])}°)`
        : "—";

    row.append(dateCell, gustCell, dirCell);
    rows.appendChild(row);
  }
}

async function fetchWeather(lat, lon) {
  try {
    wxStatus.textContent = "Fetching weather…";

    // Open‑Meteo current+daily forecast (7 days) variables
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day` +
      `&daily=windgusts_10m_max,winddirection_10m_dominant` +
      `&forecast_days=7` +
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

    const readableDesc = desc + (c.is_day ? " (day)" : " (night)");
    document.getElementById("wxDesc").textContent = readableDesc;
    document.getElementById("wxIcon").textContent = getWeatherIcon(c.weather_code, c.is_day);
    document.getElementById("wxIconLabel").textContent = readableDesc;
    document.getElementById("wxTemp").textContent =
      `${Math.round(c.temperature_2m)}°C`;
    document.getElementById("wxFeels").textContent =
      `${Math.round(c.apparent_temperature)}°C`;
    document.getElementById("wxWind").textContent =
      `${Math.round(c.wind_speed_10m)} km/h ${windDir}`;
    document.getElementById("wxHum").textContent =
      `${Math.round(c.relative_humidity_2m)}%`;
    document.getElementById("wxUpdated").textContent = `Updated: ${c.time}`;

    // Forecast table (7 days, strongest gust + direction)
    const daily = data.daily || {};
    if (daily.time && daily.windgusts_10m_max) {
      buildForecast(daily);
      document.getElementById("forecastData").classList.remove("hidden");
      document.getElementById("forecastError").classList.add("hidden");
      document.getElementById("forecastStatus").textContent = "7-day wind gust forecast ready.";
    } else {
      document.getElementById("forecastData").classList.add("hidden");
      document.getElementById("forecastError").classList.remove("hidden");
      document.getElementById("forecastError").textContent = "7-day forecast not available.";
      document.getElementById("forecastStatus").textContent = "";
    }

    wxData.classList.remove("hidden");
    wxErr.classList.add("hidden");
    wxStatus.textContent = "Weather loaded.";
  } catch (e) {
    wxData.classList.add("hidden");
    wxErr.classList.remove("hidden");
    wxErr.textContent = "Could not load weather data.";
    document.getElementById("forecastData").classList.add("hidden");
    document.getElementById("forecastError").classList.remove("hidden");
    document.getElementById("forecastError").textContent = "Forecast unavailable.";
    document.getElementById("forecastStatus").textContent = "";
    wxStatus.textContent = "";
    console.error(e);
  }
}
