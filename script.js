// ---------- Time ----------
function updateClock() {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
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

// Alert settings with localStorage persistence
const SETTINGS_KEY = "weatherWarningSettings";
const DEFAULT_SETTINGS = {
  maxWindGustAlarm: 50,
  maxWindGustCaution: 30,
  minTempAlarm: 0,
  minTempCaution: 10,
  maxTempAlarm: 40,
  maxTempCaution: 30,
};
let settings = loadSettings();

function loadSettings() {
  try {
    const saved = localStorage.getItem(SETTINGS_KEY);
    if (!saved) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(saved);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (e) {
    console.warn("Settings load failed", e);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("Settings save failed", e);
  }
}

function applySettingsToUI(currentSettings = settings) {
  document.getElementById("maxWindGustAlarm").value = currentSettings.maxWindGustAlarm;
  document.getElementById("maxWindGustCaution").value = currentSettings.maxWindGustCaution;
  document.getElementById("minTempAlarm").value = currentSettings.minTempAlarm;
  document.getElementById("minTempCaution").value = currentSettings.minTempCaution;
  document.getElementById("maxTempAlarm").value = currentSettings.maxTempAlarm;
  document.getElementById("maxTempCaution").value = currentSettings.maxTempCaution;
}

function readSettingsFromUI() {
  const loaded = {
    maxWindGustAlarm: Number(document.getElementById("maxWindGustAlarm").value),
    maxWindGustCaution: Number(document.getElementById("maxWindGustCaution").value),
    minTempAlarm: Number(document.getElementById("minTempAlarm").value),
    minTempCaution: Number(document.getElementById("minTempCaution").value),
    maxTempAlarm: Number(document.getElementById("maxTempAlarm").value),
    maxTempCaution: Number(document.getElementById("maxTempCaution").value),
  };

  // normalize relationships
  if (loaded.maxWindGustAlarm <= loaded.maxWindGustCaution) {
    loaded.maxWindGustCaution = Math.max(0, loaded.maxWindGustAlarm - 1);
  }
  if (loaded.maxWindGustCaution >= loaded.maxWindGustAlarm) {
    loaded.maxWindGustAlarm = loaded.maxWindGustCaution + 1;
  }

  if (loaded.minTempAlarm >= loaded.minTempCaution) {
    loaded.minTempCaution = loaded.minTempAlarm + 1;
  }
  if (loaded.minTempCaution <= loaded.minTempAlarm) {
    loaded.minTempAlarm = loaded.minTempCaution - 1;
  }

  if (loaded.maxTempAlarm <= loaded.maxTempCaution) {
    loaded.maxTempCaution = Math.max(0, loaded.maxTempAlarm - 1);
  }
  if (loaded.maxTempCaution >= loaded.maxTempAlarm) {
    loaded.maxTempAlarm = loaded.maxTempCaution + 1;
  }

  return loaded;
}

function initSettingsListeners() {
  [
    "maxWindGustAlarm",
    "maxWindGustCaution",
    "minTempAlarm",
    "minTempCaution",
    "maxTempAlarm",
    "maxTempCaution",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      // live validation only; no re-coloring until Save
      const value = Number(el.value);
      if (Number.isNaN(value)) return;

      // enforce relationships in UI entries
      if (id === "maxWindGustAlarm" && value <= Number(document.getElementById("maxWindGustCaution").value)) {
        document.getElementById("maxWindGustCaution").value = Math.max(0, value - 1);
      }
      if (id === "maxWindGustCaution" && value >= Number(document.getElementById("maxWindGustAlarm").value)) {
        document.getElementById("maxWindGustAlarm").value = value + 1;
      }
      if (id === "minTempAlarm" && value >= Number(document.getElementById("minTempCaution").value)) {
        document.getElementById("minTempCaution").value = value + 1;
      }
      if (id === "minTempCaution" && value <= Number(document.getElementById("minTempAlarm").value)) {
        document.getElementById("minTempAlarm").value = value - 1;
      }
      if (id === "maxTempAlarm" && value <= Number(document.getElementById("maxTempCaution").value)) {
        document.getElementById("maxTempCaution").value = Math.max(0, value - 1);
      }
      if (id === "maxTempCaution" && value >= Number(document.getElementById("maxTempAlarm").value)) {
        document.getElementById("maxTempAlarm").value = value + 1;
      }
    });
  });

  const saveBtn = document.getElementById("saveSettingsButton");
  const status = document.getElementById("settingsSavedMessage");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      settings = readSettingsFromUI();
      saveSettings();
      applySettingsToUI();
      if (window.cachedForecast && window.cachedForecast.time?.length) {
        buildForecast(window.cachedForecast);
      }
      if (status) {
        status.style.display = "inline";
        setTimeout(() => {
          status.style.display = "none";
        }, 2000);
      }
    });
  }
}

function initMapIfNeeded(lat, lon, zoom = 8) {
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
  locData.classList.remove("hidden");
  locErr.classList.add("hidden");
  locStatus.textContent = "";

  // Update weather status while we fetch new weather
  wxStatus.textContent = "Loading weather...";
  wxStatus.style.display = "block";
  wxErr.classList.add("hidden");

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

// initialize settings UI + events
applySettingsToUI();
initSettingsListeners();

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
  locStatus.textContent = "";
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

function bearingArrow(deg) {
  if (deg === null || deg === undefined || Number.isNaN(deg)) return "—";
  const d = ((deg % 360) + 360) % 360;
  if (d >= 337.5 || d < 22.5) return "↑";
  if (d >= 22.5 && d < 67.5) return "↗";
  if (d >= 67.5 && d < 112.5) return "→";
  if (d >= 112.5 && d < 157.5) return "↘";
  if (d >= 157.5 && d < 202.5) return "↓";
  if (d >= 202.5 && d < 247.5) return "↙";
  if (d >= 247.5 && d < 292.5) return "←";
  return "↖";
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
    const state = data.address?.state;
    const country = data.address?.country;
    if (suburb) {
      addrEl.textContent = [suburb, state, country].filter(Boolean).join(", ");
    } else {
      const general = data.address?.city || data.address?.town || data.address?.village || data.address?.county || data.address?.state;
      addrEl.textContent = general
        ? [general, state, country].filter(Boolean).join(", ")
        : data.display_name
          ? data.display_name.split(",").slice(-3).join(", ")
          : "Approximate location";
    }
  } catch (err) {
    console.warn("Reverse geocode failed", err);
    addrEl.textContent = "Approximate location unknown";
  }
}

function formatBucket(hour) {
  if (hour >= 6 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 18) return "Daytime";
  if (hour >= 18 && hour < 24) return "Evening";
  return "Night";
}

function getWeatherSeverity(code) {
  if (code === undefined || code === null) return 0;
  // lower is better; higher is more severe.
  if (code <= 1) return 1;
  if (code <= 3) return 2;
  if (code <= 48) return 3;
  if (code <= 51) return 4;
  if (code <= 57) return 5;
  if (code <= 67) return 6;
  if (code <= 77) return 7;
  if (code <= 80) return 5;
  if (code <= 86) return 6;
  if (code <= 99) return 8;
  return 9;
}

function updateLookaheadSummary(segments) {
  const container = document.getElementById("lookaheadSummary");
  if (!container) return;

  if (!segments || segments.length === 0) {
    container.textContent = "no concern";
    return;
  }

  const maxGust = Math.max(...segments.map((s) => (s.maxGust !== undefined ? s.maxGust : 0)));
  const maxWind = Math.max(...segments.map((s) => (s.maxWind !== undefined ? s.maxWind : 0)));
  const minTemp = Math.min(...segments.map((s) => (s.minTemp !== undefined ? s.minTemp : Infinity)));
  const maxTemp = Math.max(...segments.map((s) => (s.maxTemp !== undefined ? s.maxTemp : -Infinity)));

  const gustStatus = maxGust >= settings.maxWindGustAlarm ? "alarm" : maxGust >= settings.maxWindGustCaution ? "warning" : "normal";
  const tempStatus = (maxTemp >= settings.maxTempAlarm || minTemp <= settings.minTempAlarm) ? "alarm" : (maxTemp >= settings.maxTempCaution || minTemp <= settings.minTempCaution) ? "warning" : "normal";

  const bestCondition = segments.reduce((best, segment) => {
    if (segment.code === undefined) return best;
    const severity = getWeatherSeverity(segment.code);
    if (!best || severity > best.severity) {
      return { severity, code: segment.code };
    }
    return best;
  }, null);

  const conditions = [];
  conditions.push({ priority: gustStatus === "alarm" ? 3 : gustStatus === "warning" ? 2 : 1, label: `Wind Gust: ${maxGust} km/h (${gustStatus})` });
  conditions.push({ priority: tempStatus === "alarm" ? 3 : tempStatus === "warning" ? 2 : 1, label: `Temperature spread: ${isFinite(minTemp) ? Math.round(minTemp) + "°C" : "—"} to ${isFinite(maxTemp) ? Math.round(maxTemp) + "°C" : "—"} (${tempStatus})` });
  if (bestCondition && bestCondition.severity > 2) {
    conditions.push({ priority: bestCondition.severity, label: `Condition: ${WMO_DESCRIPTIONS[bestCondition.code] || "Unknown"}` });
  }

  conditions.sort((a, b) => b.priority - a.priority);

  const hasConcern = conditions.some((c) => c.priority > 1);

  if (!hasConcern) {
    container.textContent = "no concern";
    return;
  }

  const lines = [];
  lines.push(`<div><strong>Winds</strong></div>`);
  lines.push(`<div>${conditions.find((c) => c.label.startsWith("Wind Gust")).label}</div>`);
  lines.push(`<div><strong>Temperature</strong></div>`);
  lines.push(`<div>${conditions.find((c) => c.label.startsWith("Temperature spread")).label}</div>`);

  const additional = conditions.filter((c) => !c.label.startsWith("Wind Gust") && !c.label.startsWith("Temperature spread"));
  if (additional.length) {
    lines.push(`<div><strong>Other</strong></div>`);
    additional.forEach((item) => lines.push(`<div>${item.label}</div>`));
  }

  container.innerHTML = lines.join("");
}

function buildForecast(data) {
  const headerRow = document.getElementById("forecast24HeaderRow");
  const body24 = document.getElementById("forecast24Body");
  const rowsSummary = document.getElementById("forecastRowsSummary");

  headerRow.innerHTML = "<th></th>";
  body24.innerHTML = "";
  rowsSummary.innerHTML = "";

  const times = data.time || [];
  const temps = data.temperature_2m || [];
  const feels = data.apparent_temperature_2m || [];
  const codes = data.weathercode || [];
  const gusts = data.windgusts_10m || [];
  const windDirs = data.winddirection_10m || [];
  const windSpeeds = data.wind_speed_10m || [];

  // next full hour
  const now = new Date();
  const nextFullHour = new Date(now);
  nextFullHour.setMinutes(0, 0, 0);
  nextFullHour.setHours(nextFullHour.getHours() + 1);
  const startIndex = times.findIndex((t) => new Date(t).getTime() >= nextFullHour.getTime());
  const start = startIndex >= 0 ? startIndex : 0;
  const end = Math.min(start + 24, times.length);

  const startDate = times[start] ? new Date(times[start]) : now;
  const forecast24Heading = document.getElementById("forecast24Heading");
  if (forecast24Heading) {
    forecast24Heading.textContent = `Next 24h (2-hour grouped, starting ${startDate.toLocaleString()})`;
  }

  // group into 2-hour intervals (12 segments max)
  const segments = [];
  for (let segStart = start; segStart < end; segStart += 2) {
    const segEnd = Math.min(segStart + 2, end);
    let minTemp = Infinity;
    let maxTemp = -Infinity;
    let minFeel = Infinity;
    let maxFeel = -Infinity;
    let maxWind = -Infinity;
    let windDir = undefined;
    let maxGust = -Infinity;
    let gustDir = undefined;
    let bestCode = undefined;
    let bestSeverity = -Infinity;
    let bestWind = -Infinity;

    for (let idx = segStart; idx < segEnd; idx++) {
      const temp = temps[idx];
      const feel = feels[idx];
      const wind = windSpeeds[idx];
      const gust = gusts[idx];
      const code = codes[idx];
      const dir = windDirs[idx];

      if (temp !== undefined) {
        minTemp = Math.min(minTemp, temp);
        maxTemp = Math.max(maxTemp, temp);
      }
      if (feel !== undefined) {
        minFeel = Math.min(minFeel, feel);
        maxFeel = Math.max(maxFeel, feel);
      }
      if (wind !== undefined && wind > maxWind) {
        maxWind = wind;
        windDir = dir;
      }
      if (gust !== undefined && gust > maxGust) {
        maxGust = gust;
        gustDir = dir;
      }

      const severity = code !== undefined ? getWeatherSeverity(code) : 0;
      const keyScale = Math.max(gust || 0, wind || 0);
      if (severity > bestSeverity || (severity === bestSeverity && keyScale > bestWind)) {
        bestSeverity = severity;
        bestWind = keyScale;
        bestCode = code;
      }
    }

    const startHour = new Date(times[segStart]).getHours();
    const labelHour2 = (startHour + 1) % 24;

    segments.push({
      label: `${startHour.toString().padStart(2, "0")}-${labelHour2.toString().padStart(2, "0")}`,
      code: bestCode,
      minTemp: minTemp === Infinity ? undefined : minTemp,
      maxTemp: maxTemp === -Infinity ? undefined : maxTemp,
      minFeel: minFeel === Infinity ? undefined : minFeel,
      maxFeel: maxFeel === -Infinity ? undefined : maxFeel,
      maxWind: maxWind === -Infinity ? undefined : maxWind,
      windDir,
      maxGust: maxGust === -Infinity ? undefined : maxGust,
      gustDir,
    });
  }

  // draw headers
  segments.forEach((segment) => {
    const cell = document.createElement("th");
    cell.textContent = segment.label;
    headerRow.appendChild(cell);
  });

  const rowDef = (label) => {
    const row = document.createElement("tr");
    const cell = document.createElement("th");
    cell.textContent = label;
    row.appendChild(cell);
    return row;
  };

  const conditionRow = rowDef("Condition");
  const tempRow = rowDef("Temp");
  const feelsRow = rowDef("Feels like");
  const windRow = rowDef("Wind");
  const gustRow = rowDef("Max Gust");

  segments.forEach((segment) => {
    const condCell = document.createElement("td");
    condCell.innerHTML = `<span class="condition-icon">${getWeatherIcon(segment.code, true)}</span> <span class="condition-text">${WMO_DESCRIPTIONS[segment.code] || "—"}</span>`;
    conditionRow.appendChild(condCell);

    const tempCell = document.createElement("td");
    tempCell.innerHTML = segment.minTemp !== undefined
      ? `<span class="digits">${Math.round(segment.minTemp)}</span><span class="unit">°C</span> / <span class="digits">${Math.round(segment.maxTemp)}</span><span class="unit">°C</span>`
      : "—";
    if (segment.minTemp !== undefined) {
      if (segment.minTemp <= settings.minTempAlarm) tempCell.classList.add("forecast-alarm-cold");
      else if (segment.minTemp <= settings.minTempCaution) tempCell.classList.add("forecast-caution-cold");
      else if (segment.maxTemp >= settings.maxTempAlarm) tempCell.classList.add("forecast-alarm");
      else if (segment.maxTemp >= settings.maxTempCaution) tempCell.classList.add("forecast-warning");
    }
    tempRow.appendChild(tempCell);

    const feelsCell = document.createElement("td");
    feelsCell.innerHTML = segment.minFeel !== undefined
      ? `<span class="digits">${Math.round(segment.minFeel)}</span><span class="unit">°C</span> / <span class="digits">${Math.round(segment.maxFeel)}</span><span class="unit">°C</span>`
      : "—";
    feelsRow.appendChild(feelsCell);

    const windCell = document.createElement("td");
    windCell.innerHTML = segment.maxWind !== undefined
      ? `<span class="digits">${Math.round(segment.maxWind)}</span><span class="unit"> km/h </span><span class="unit">${segment.windDir !== undefined ? bearingArrow(segment.windDir) + ' ' + degToCompass(segment.windDir) : ""}</span>`
      : "—";
    windRow.appendChild(windCell);

    const gustCell = document.createElement("td");
    gustCell.innerHTML = segment.maxGust !== undefined
      ? `<span class="digits">${Math.round(segment.maxGust)}</span><span class="unit"> km/h </span><span class="unit">${segment.gustDir !== undefined ? bearingArrow(segment.gustDir) + ' ' + degToCompass(segment.gustDir) : ""}</span>`
      : "—";
    if (segment.maxGust !== undefined) {
      if (segment.maxGust >= settings.maxWindGustAlarm) gustCell.classList.add("forecast-alarm");
      else if (segment.maxGust >= settings.maxWindGustCaution) gustCell.classList.add("forecast-warning");
    }
    gustRow.appendChild(gustCell);
  });

  body24.append(conditionRow, tempRow, feelsRow, windRow, gustRow);
  updateLookaheadSummary(segments);

  // summary 25h-7d by day/bucket
  const buckets = {}; // {day|bucket: stats}
  for (let i = 24; i < Math.min(times.length, 168); i++) {
    const d = new Date(times[i]);
    const hour = d.getHours();
    const bucket = formatBucket(hour);
    const dayKey = d.toLocaleDateString();
    const key = `${dayKey}|${bucket}`;

    const temp = temps[i];
    const gust = gusts[i];
    const wind = windSpeeds[i];
    const code = codes[i];
    const dir = windDirs[i];

    if (!buckets[key]) {
      buckets[key] = {
        day: dayKey,
        bucket,
        maxTemp: temp === undefined ? -Infinity : temp,
        minTemp: temp === undefined ? Infinity : temp,
        maxGust: gust === undefined ? -Infinity : gust,
        maxGustDir: dir,
        maxWind: wind === undefined ? -Infinity : wind,
        maxWindDir: dir,
        bestCode: code,
      };
    }
    const entry = buckets[key];

    if (temp !== undefined) {
      entry.maxTemp = Math.max(entry.maxTemp, temp);
      entry.minTemp = Math.min(entry.minTemp, temp);
    }
    if (gust !== undefined && gust > entry.maxGust) {
      entry.maxGust = gust;
      entry.maxGustDir = dir;
    }
    if (wind !== undefined && wind > entry.maxWind) {
      entry.maxWind = wind;
      entry.maxWindDir = dir;
    }
    if (code !== undefined) {
      // pick most severe by gust + wind
      if (entry.bestCode === undefined || gust > entry.maxGust || wind > entry.maxWind) {
        entry.bestCode = code;
      }
    }
  }

  const summaryRows = Object.values(buckets).sort((a, b) => {
    const dateA = new Date(a.day);
    const dateB = new Date(b.day);
    if (dateA - dateB !== 0) return dateA - dateB;
    const order = { Morning: 0, Daytime: 1, Evening: 2, Night: 3 };
    return order[a.bucket] - order[b.bucket];
  });

  summaryRows.forEach((entry) => {
    const row = document.createElement("tr");
    const periodCell = document.createElement("td");
    const condCell = document.createElement("td");
    const tempCell = document.createElement("td");
    const gustCell = document.createElement("td");
    const windCell = document.createElement("td");

    periodCell.textContent = `${entry.day} ${entry.bucket}`;
    condCell.textContent = `${getWeatherIcon(entry.bestCode, true)} ${WMO_DESCRIPTIONS[entry.bestCode] || "—"}`;
    tempCell.textContent = `${entry.minTemp === Infinity ? "—" : Math.round(entry.minTemp) + "°C"} / ${entry.maxTemp === -Infinity ? "—" : Math.round(entry.maxTemp) + "°C"}`;

    gustCell.textContent = entry.maxGust === -Infinity ? "—" : `${Math.round(entry.maxGust)} km/h ${entry.maxGustDir !== undefined ? bearingArrow(entry.maxGustDir) + " " + degToCompass(entry.maxGustDir) : ""}`;
    windCell.textContent = entry.maxWind === -Infinity ? "—" : `${Math.round(entry.maxWind)} km/h ${entry.maxWindDir !== undefined ? bearingArrow(entry.maxWindDir) + " " + degToCompass(entry.maxWindDir) : ""}`;

    // threshold for summary by worst values
    tempCell.className = "";
    gustCell.className = "";
    if (entry.minTemp !== Infinity) {
      if (entry.minTemp <= settings.minTempAlarm) tempCell.classList.add("forecast-alarm-cold");
      else if (entry.minTemp <= settings.minTempCaution) tempCell.classList.add("forecast-caution-cold");
      else if (entry.maxTemp >= settings.maxTempAlarm) tempCell.classList.add("forecast-alarm");
      else if (entry.maxTemp >= settings.maxTempCaution) tempCell.classList.add("forecast-warning");
    }
    if (entry.maxGust !== -Infinity) {
      if (entry.maxGust >= settings.maxWindGustAlarm) gustCell.classList.add("forecast-alarm");
      else if (entry.maxGust >= settings.maxWindGustCaution) gustCell.classList.add("forecast-warning");
    }

    row.append(periodCell, condCell, tempCell, gustCell, windCell);
    rowsSummary.appendChild(row);
  });
}


async function fetchWeather(lat, lon) {
  try {
    wxStatus.textContent = "Loading weather...";

    // Open‑Meteo current + hourly forecast for 7 days
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current_weather=true` +
      `&hourly=temperature_2m,weathercode,winddirection_10m,wind_speed_10m,windgusts_10m,relativehumidity_2m` +
      `&forecast_days=7` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const c = data.current_weather;
    if (!c) throw new Error("No current weather in response");

    const todayHumidity = data.hourly?.relativehumidity_2m?.[0];
    const todayTemp = c.temperature;
    const todayWindSpeed = c.windspeed;
    const todayWindDir = c.winddirection;

    const desc = WMO_DESCRIPTIONS[c.weathercode] ?? `Code ${c.weathercode}`;
    const windDirText =
      typeof todayWindDir === "number"
        ? `${degToCompass(todayWindDir)} (${Math.round(todayWindDir)}°)`
        : "—";

    const readableDesc = desc + " (current)";
    document.getElementById("wxDesc").textContent = readableDesc;
    document.getElementById("wxIcon").textContent = getWeatherIcon(c.weathercode, true);
    document.getElementById("wxIconLabel").textContent = readableDesc;
    document.getElementById("wxTemp").textContent =
      todayTemp !== undefined ? `${Math.round(todayTemp)}°C` : "—";
    document.getElementById("wxFeels").textContent =
      todayTemp !== undefined ? `${Math.round(todayTemp)}°C` : "—";
    document.getElementById("wxWind").textContent =
      todayWindSpeed !== undefined && todayWindDir !== undefined
        ? `${Math.round(todayWindSpeed)} km/h ${bearingArrow(todayWindDir)} ${degToCompass(todayWindDir)}`
        : "—";
    document.getElementById("wxHum").textContent =
      todayHumidity !== undefined ? `${Math.round(todayHumidity)}%` : "—";
    document.getElementById("updatedInfo").textContent = `Updated: ${c.time}`;

    // Forecast table (hourly + 6h steps) from hourly payload
    const hourly = data.hourly || {};

    // Cache forecast data for settings changes
    window.cachedForecast = {
      time: hourly.time || [],
      temperature_2m: hourly.temperature_2m || [],
      weathercode: hourly.weathercode || [],
      windgusts_10m: hourly.windgusts_10m || [],
      winddirection_10m: hourly.winddirection_10m || [],
      wind_speed_10m: hourly.wind_speed_10m || [],
    };

    const hasForecast =
      Array.isArray(hourly.time) &&
      Array.isArray(hourly.temperature_2m) &&
      Array.isArray(hourly.weathercode) &&
      Array.isArray(hourly.winddirection_10m) &&
      Array.isArray(hourly.wind_speed_10m) &&
      Array.isArray(hourly.windgusts_10m);

    if (hasForecast) {
      buildForecast(hourly);
      document.getElementById("forecastData").classList.remove("hidden");
      document.getElementById("forecastError").classList.add("hidden");
      document.getElementById("forecastStatus").textContent = "Forecast ready.";
    } else {
      document.getElementById("forecastData").classList.add("hidden");
      document.getElementById("forecastError").classList.remove("hidden");
      document.getElementById("forecastError").textContent = "Forecast data not available.";
      document.getElementById("forecastStatus").textContent = "";
    }

    wxData.classList.remove("hidden");
    wxErr.classList.add("hidden");
    wxStatus.textContent = "";
    wxStatus.style.display = "none";
  } catch (e) {
    wxData.classList.add("hidden");
    wxErr.classList.remove("hidden");
    wxErr.textContent = `Could not load weather data: ${e.message || e}`;

    document.getElementById("forecastData").classList.add("hidden");
    document.getElementById("forecastError").classList.remove("hidden");
    document.getElementById("forecastError").textContent = `Forecast unavailable: ${e.message || e}`;
    document.getElementById("forecastStatus").textContent = "";

    wxStatus.textContent = "Could not load weather data.";
    wxStatus.style.display = "block";
    console.error(e);
  }
}
