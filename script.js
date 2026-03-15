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

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

updateClock();
setInterval(updateClock, 1000);

// ---------- Geolocation ----------
const locStatus = document.getElementById("locationStatus");
const locData = document.getElementById("locationData");
const locErr = document.getElementById("locationError");

function setPageSectionsVisible(visible) {
  const cards = document.querySelectorAll("main.container .card");
  const footer = document.querySelector("footer");
  cards.forEach((card) => {
    // always keep current-grid visible even when location fails
    if (card.classList.contains("current-grid")) {
      card.style.display = "grid";
    } else {
      card.style.display = visible ? "" : "none";
    }
  });
  if (footer) footer.style.display = visible ? "block" : "none";
}

function setManualLocationVisible(visible) {
  const el = document.getElementById("manualLocationFallback");
  if (!el) return;
  el.classList.toggle("hidden", !visible);
}

function setManualLocationMessage(message = "", isError = false) {
  const el = document.getElementById("manualLocationMessage");
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? "block" : "none";
  el.style.color = isError ? "#ff6f9e" : "#9bb6d6";
}

async function geocodePlaceName(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(
    query,
  )}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "WeatherWarning/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const results = await response.json();
  if (!results?.length) throw new Error("No matching location found");
  const place = results[0];
  return {
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    displayName: place.display_name,
  };
}

function applyManualLocation(lat, lon, locationLabel) {
  locStatus.textContent = "Location set manually.";
  setManualLocationMessage("", false);
  setManualLocationVisible(false);
  setPageSectionsVisible(true);

  const fakePosition = {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy: 100,
    },
  };

  if (locationLabel) {
    const addressEl = document.getElementById("address");
    if (addressEl) addressEl.textContent = locationLabel;
  }

  showPosition(fakePosition);
}

// Timeout guard for geolocation being stuck in pending state
const LOCATION_WAIT_LIMIT_MS = 15000;
let locationWaitTimer = null;

function clearLocationWaitTimer() {
  if (locationWaitTimer) {
    clearTimeout(locationWaitTimer);
    locationWaitTimer = null;
  }
}

function startLocationWaitTimer() {
  clearLocationWaitTimer();
  locationWaitTimer = setTimeout(() => {
    if (
      locStatus.textContent.includes("Waiting for your location") ||
      locStatus.textContent.includes("Retrying location")
    ) {
      setPageSectionsVisible(false);
      locStatus.textContent =
        "Still waiting for location. Please check location permissions/settings.";
      locErr.classList.remove("hidden");
      locErr.textContent =
        "Location request is taking too long. Ensure your browser allows location access, refresh, and use Retry location.";
      wxStatus.textContent = "Weather requires your location.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Location timeout, unable to load weather.";
      const retryButton = document.getElementById("retryLocationButton");
      if (retryButton) retryButton.style.display = "block";
    }
  }, LOCATION_WAIT_LIMIT_MS);
}

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
  minTempAlarm: 5,
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

function updateScaleBar(config) {
  const {
    barId,
    fillId,
    cautionMarkerId,
    alarmMarkerId,
    cautionInputWrapperId,
    alarmInputWrapperId,
    normalLabelId,
    cautionLabelId,
    alarmLabelId,
    cautionValue,
    alarmValue,
    unit,
  } = config;

  const bar = document.getElementById(barId);
  const barFill = document.getElementById(fillId);
  const cautionMarker = document.getElementById(cautionMarkerId);
  const alarmMarker = document.getElementById(alarmMarkerId);
  const cautionInputWrapper = document.getElementById(cautionInputWrapperId);
  const alarmInputWrapper = document.getElementById(alarmInputWrapperId);
  const normalLabel = normalLabelId
    ? document.getElementById(normalLabelId)
    : null;
  const cautionLabel = cautionLabelId
    ? document.getElementById(cautionLabelId)
    : null;
  const alarmLabel = alarmLabelId
    ? document.getElementById(alarmLabelId)
    : null;

  if (
    !bar ||
    !barFill ||
    !cautionMarker ||
    !alarmMarker ||
    !cautionInputWrapper ||
    !alarmInputWrapper
  )
    return;

  const caution = Number(cautionValue || 0);
  const alarm = Number(alarmValue || 0);
  const max = Math.max(alarm, caution, 100);

  const cautionPct = Math.min(100, (caution / max) * 100);
  const alarmPct = Math.min(100, (alarm / max) * 100);

  const normalColour = config.normalColour || "transparent";
  const cautionColour = config.cautionColour;
  const alarmColour = config.alarmColour;

  barFill.style.background = `linear-gradient(to right, ${normalColour} 0%, ${normalColour} ${cautionPct}%, ${cautionColour} ${cautionPct}%, ${cautionColour} ${alarmPct}%, ${alarmColour} ${alarmPct}%, ${alarmColour} 100%)`;

  cautionMarker.style.left = `${cautionPct}%`;
  alarmMarker.style.left = `${alarmPct}%`;

  cautionInputWrapper.style.left = `${cautionPct}%`;
  alarmInputWrapper.style.left = `${alarmPct}%`;

  if (cautionLabel) {
    cautionLabel.textContent = `Caution (${caution} ${unit})`;
    cautionLabel.style.color = "rgba(255,165,0,1)";
  }
  if (alarmLabel) {
    alarmLabel.textContent = `Alarm (${alarm} ${unit})`;
    alarmLabel.style.color = "rgba(255,0,0,1)";
  }
  if (normalLabel) {
    normalLabel.textContent = "Normal";
    normalLabel.style.color = "#ffffff";
  }

  cautionMarker.style.backgroundColor = "rgba(255,165,0,1)";
  alarmMarker.style.backgroundColor = "rgba(255,0,0,1)";

  if (config.zeroMarkerId) {
    const zeroMarker = document.getElementById(config.zeroMarkerId);
    if (zeroMarker) {
      const rangeMin = Number.isFinite(config.rangeMin) ? config.rangeMin : 0;
      const rangeMax = Number.isFinite(config.rangeMax)
        ? config.rangeMax
        : Math.max(alarm, caution, 100);
      if (rangeMax > rangeMin) {
        const zeroIsAtBoundary = rangeMin === 0 || rangeMax === 0;
        if (rangeMin < 0 && rangeMax > 0 && !zeroIsAtBoundary) {
          const zeroPct = ((0 - rangeMin) / (rangeMax - rangeMin)) * 100;
          zeroMarker.style.left = `${zeroPct}%`;
          zeroMarker.style.display = "block";
        } else {
          zeroMarker.style.display = "none";
        }
      } else {
        zeroMarker.style.display = "none";
      }
    }
  }
}

function updateWindGustBar(currentSettings = settings) {
  updateScaleBar({
    barId: "gustScaleBar",
    fillId: "gustScaleFill",
    cautionMarkerId: "gustCautionMarker",
    alarmMarkerId: "gustAlarmMarker",
    cautionInputWrapperId: "cautionInputWrapper",
    alarmInputWrapperId: "alarmInputWrapper",
    normalLabelId: "gustNormalLabel",
    cautionLabelId: "gustCautionLabel",
    alarmLabelId: "gustAlarmLabel",
    cautionValue: currentSettings.maxWindGustCaution,
    alarmValue: currentSettings.maxWindGustAlarm,
    unit: "km/h",
    normalColour: "rgba(0,0,0,1)",
    cautionColour: "rgba(255,165,0,0.8)",
    alarmColour: "rgba(255,0,0,0.9)",
  });

  const gustZeroEl = document.getElementById("gustScaleZero");
  if (gustZeroEl) {
    gustZeroEl.classList.remove("hidden");
  }
}

function updateTempScaleBar(currentSettings = settings) {
  const bar = document.getElementById("tempScaleBar");
  const fill = document.getElementById("tempScaleFill");
  if (!bar || !fill) return;

  const minAlarm = Number(currentSettings.minTempAlarm);
  const minCaution = Number(currentSettings.minTempCaution);
  const maxCaution = Number(currentSettings.maxTempCaution);
  const maxAlarm = Number(currentSettings.maxTempAlarm);

  const minValue = Math.min(minAlarm, minCaution, maxCaution, maxAlarm, 0);
  const maxValue = Math.max(minAlarm, minCaution, maxCaution, maxAlarm, 40);
  const range = Math.max(1, maxValue - minValue);

  const pct = (value) => Math.round(((value - minValue) / range) * 100);
  const minAlarmPct = pct(minAlarm);
  const minCautionPct = pct(minCaution);
  const maxCautionPct = pct(maxCaution);
  const maxAlarmPct = pct(maxAlarm);

  fill.style.background = `linear-gradient(to right,
      rgba(0,51,153,0.9) 0%, rgba(0,51,153,0.9) ${minAlarmPct}%,
      rgba(0,85,255,0.8) ${minAlarmPct}%, rgba(0,85,255,0.8) ${minCautionPct}%,
      rgba(0,0,0,1) ${minCautionPct}%, rgba(0,0,0,1) ${maxCautionPct}%,
      rgba(255,165,0,0.8) ${maxCautionPct}%, rgba(255,165,0,0.8) ${maxAlarmPct}%,
      rgba(255,0,0,0.9) ${maxAlarmPct}%, rgba(255,0,0,0.9) 100%)`;
  const markers = [
    ["minTempCautionMarker", minCautionPct],
    ["minTempAlarmMarker", minAlarmPct],
    ["maxTempCautionMarker", maxCautionPct],
    ["maxTempAlarmMarker", maxAlarmPct],
  ];

  markers.forEach(([id, left]) => {
    const el = document.getElementById(id);
    if (el) el.style.left = `${left}%`;
  });

  const wrappers = [
    ["minTempCautionInputWrapper", minCautionPct],
    ["maxTempCautionInputWrapper", maxCautionPct],
    ["minTempAlarmInputWrapper", minAlarmPct],
    ["maxTempAlarmInputWrapper", maxAlarmPct],
  ];

  wrappers.forEach(([id, left]) => {
    const el = document.getElementById(id);
    if (el) el.style.left = `${left}%`;
  });

  const zeroEl = document.getElementById("tempScaleZero");
  if (zeroEl) {
    const scaleMin = -20;
    const scaleMax = 50;
    if (scaleMin < 0 && scaleMax > 0 && scaleMin !== 0 && scaleMax !== 0) {
      const zeroPct = ((0 - scaleMin) / (scaleMax - scaleMin)) * 100;
      zeroEl.style.left = `${zeroPct}%`;
      zeroEl.style.display = "block";
    } else {
      zeroEl.style.display = "none";
    }
  }
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = value;
  }
}

function getInputNumber(id, fallback) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = Number(el.value);
  return Number.isNaN(v) ? fallback : v;
}

function applySettingsToUI(currentSettings = settings) {
  setInputValue("maxWindGustAlarm", currentSettings.maxWindGustAlarm);
  setInputValue("maxWindGustCaution", currentSettings.maxWindGustCaution);
  setInputValue("minTempAlarm", currentSettings.minTempAlarm);
  setInputValue("minTempCaution", currentSettings.minTempCaution);
  setInputValue("maxTempAlarm", currentSettings.maxTempAlarm);
  setInputValue("maxTempCaution", currentSettings.maxTempCaution);

  updateWindGustBar(currentSettings);
  updateTempScaleBar(currentSettings);
}

function readSettingsFromUI() {
  const loaded = {
    maxWindGustAlarm: getInputNumber(
      "maxWindGustAlarm",
      settings.maxWindGustAlarm,
    ),
    maxWindGustCaution: getInputNumber(
      "maxWindGustCaution",
      settings.maxWindGustCaution,
    ),
    minTempAlarm: getInputNumber("minTempAlarm", settings.minTempAlarm),
    minTempCaution: getInputNumber("minTempCaution", settings.minTempCaution),
    maxTempAlarm: getInputNumber("maxTempAlarm", settings.maxTempAlarm),
    maxTempCaution: getInputNumber("maxTempCaution", settings.maxTempCaution),
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

function setThresholdMessage(message, isError = true) {
  const gustEl = document.getElementById("gustThresholdStatus");
  const tempEl = document.getElementById("tempThresholdStatus");
  if (gustEl) {
    gustEl.textContent = message;
    gustEl.style.color = isError ? "#ff6f9e" : "#bfcffd";
  }
  if (tempEl) {
    tempEl.textContent = message;
    tempEl.style.color = isError ? "#ff6f9e" : "#bfcffd";
  }
}

function validateThresholdValues(values) {
  if (values.maxWindGustCaution >= values.maxWindGustAlarm) {
    return ["Wind gust caution must be less than wind gust alarm."];
  }
  if (values.minTempAlarm >= values.minTempCaution) {
    return ["Min temp alarm must be less than min temp caution."];
  }
  if (values.minTempCaution >= values.maxTempCaution) {
    return ["Min temp caution must be less than max temp caution."];
  }
  if (values.maxTempCaution >= values.maxTempAlarm) {
    return ["Max temp caution must be less than max temp alarm."];
  }
  return [];
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

    el.dataset.prevValue = el.value;

    el.addEventListener("focus", () => {
      el.dataset.prevValue = el.value;
    });

    el.addEventListener("input", () => {
      const value = Number(el.value);
      if (Number.isNaN(value)) {
        setThresholdMessage("Please enter a numeric value.");
        return;
      }

      const candidate = {
        maxWindGustAlarm: getInputNumber(
          "maxWindGustAlarm",
          settings.maxWindGustAlarm,
        ),
        maxWindGustCaution: getInputNumber(
          "maxWindGustCaution",
          settings.maxWindGustCaution,
        ),
        minTempAlarm: getInputNumber("minTempAlarm", settings.minTempAlarm),
        minTempCaution: getInputNumber(
          "minTempCaution",
          settings.minTempCaution,
        ),
        maxTempCaution: getInputNumber(
          "maxTempCaution",
          settings.maxTempCaution,
        ),
        maxTempAlarm: getInputNumber("maxTempAlarm", settings.maxTempAlarm),
      };

      candidate[id] = value;

      const errors = validateThresholdValues(candidate);
      if (errors.length) {
        el.value = el.dataset.prevValue ?? el.value;
        setThresholdMessage(errors[0]);
        return;
      }

      setThresholdMessage("", false);
      el.dataset.prevValue = el.value;
    });
  });

  const saveBtn = document.getElementById("saveSettingsButton");
  const resetBtn = document.getElementById("resetSettingsButton");
  const status = document.getElementById("settingsSavedMessage");
  const showStatus = (text = "Settings saved.") => {
    if (!status) return;
    status.textContent = text;
    status.style.display = "inline";
    setTimeout(() => {
      status.style.display = "none";
    }, 2000);
  };

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const candidate = readSettingsFromUI();
      const errors = validateThresholdValues(candidate);
      if (errors.length) {
        setThresholdMessage("Save failed: " + errors.join(" "));
        showStatus("Settings not saved.");
        return;
      }

      settings = candidate;
      saveSettings();
      applySettingsToUI();
      setThresholdMessage("", false);
      if (window.cachedForecast && window.cachedForecast.time?.length) {
        buildForecast(window.cachedForecast);
      }
      showStatus("Settings saved.");
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const confirmed = window.confirm(
        "Are you sure you want to reset your settings to defaults?",
      );
      if (!confirmed) return;
      settings = { ...DEFAULT_SETTINGS };
      saveSettings();
      applySettingsToUI();
      if (window.cachedForecast && window.cachedForecast.time?.length) {
        buildForecast(window.cachedForecast);
      }
      showStatus("Defaults restored.");
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
  clearLocationWaitTimer();
  setPageSectionsVisible(true);
  const retryButton = document.getElementById("retryLocationButton");
  if (retryButton) retryButton.style.display = "none";

  const { latitude, longitude, accuracy } = pos.coords;

  // Update location text UI
  document.getElementById("lat").textContent = latitude.toFixed(6);
  document.getElementById("lon").textContent = longitude.toFixed(6);
  locData.classList.remove("hidden");
  locErr.classList.add("hidden");
  locStatus.textContent = "Location resolved.";

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

// release date (adjust as needed)
const RELEASE_DATE = "2026-03-15";
const releaseDateEl = document.getElementById("releaseDate");
if (releaseDateEl) {
  releaseDateEl.textContent = RELEASE_DATE;
}

function showError(err) {
  clearLocationWaitTimer();
  locData.classList.add("hidden");
  locErr.classList.remove("hidden");
  wxData.classList.add("hidden");
  wxStatus.textContent = "";

  setPageSectionsVisible(false);
  const retryButton = document.getElementById("retryLocationButton");
  if (retryButton) retryButton.style.display = "block";

  switch (err.code) {
    case err.PERMISSION_DENIED:
      locStatus.textContent = "Permission denied.";
      locErr.textContent =
        "This app needs your location to work. Please allow location access to continue by enabling it in the browser site settings.";
      wxErr.classList.remove("hidden");
      wxErr.textContent =
        "Weather requires your approximate location. Refresh and click Retry location after permission grant.";
      break;
    case err.POSITION_UNAVAILABLE:
      locStatus.textContent = "Location unavailable.";
      locErr.textContent = "We couldn’t determine your location.";
      wxErr.classList.remove("hidden");
      wxErr.textContent = "Weather requires a location.";
      break;
    case err.TIMEOUT:
      locStatus.textContent = "Location timed out.";
      locErr.textContent =
        "Getting your position took too long. Try moving to an open area, enable high accuracy, or retry after a moment.";
      wxErr.classList.remove("hidden");
      wxErr.textContent =
        "Weather requires a location. Click Retry location, refresh page, or check browser location permissions.";
      break;
    default:
      locStatus.textContent = "Location error.";
      locErr.textContent =
        "An unknown error occurred. Verify the browser allows location access, refresh, and retry.";
      wxErr.classList.remove("hidden");
      wxErr.textContent =
        "Weather requires a location. Click Retry location, check location services, and ensure HTTPS/localhost.";
  }

  setManualLocationVisible(true);
  setManualLocationMessage(
    "Auto location failed. Enter latitude/longitude or suburb/city below.",
    false,
  );
}

// Hide non-essential panels until location is resolved
setPageSectionsVisible(false);

// Request location when the page loads (HTTPS required on most browsers)
if ("geolocation" in navigator) {
  locStatus.textContent = "Waiting for your location...";
  startLocationWaitTimer();
  navigator.geolocation.getCurrentPosition(showPosition, showError, {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  });
} else {
  setPageSectionsVisible(false);
  locStatus.textContent = "Geolocation not supported in this browser.";
  wxStatus.textContent = "Weather requires a location.";
  setManualLocationVisible(true);
  setManualLocationMessage(
    "No automatic location available. Enter latitude/longitude or suburb/city below.",
  );
}

// Retry button
const retryButton = document.getElementById("retryLocationButton");
if (retryButton) {
  retryButton.addEventListener("click", () => {
    retryButton.style.display = "none";
    locStatus.textContent = "Retrying location...";
    locErr.classList.add("hidden");
    if ("geolocation" in navigator) {
      startLocationWaitTimer();
      navigator.geolocation.getCurrentPosition(showPosition, showError, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    } else {
      locStatus.textContent = "Geolocation not supported in this browser.";
    }
  });
}

const manualLocationApplyButton = document.getElementById(
  "manualLocationApply",
);
if (manualLocationApplyButton) {
  manualLocationApplyButton.addEventListener("click", async () => {
    const latRaw = document.getElementById("manualLat")?.value?.trim();
    const lonRaw = document.getElementById("manualLon")?.value?.trim();
    const placeRaw = document.getElementById("manualPlace")?.value?.trim();

    const lat = Number(latRaw);
    const lon = Number(lonRaw);

    if (
      latRaw !== "" &&
      lonRaw !== "" &&
      !Number.isNaN(lat) &&
      !Number.isNaN(lon)
    ) {
      applyManualLocation(lat, lon, placeRaw || "Manual coordinates");
      return;
    }

    if (placeRaw) {
      setManualLocationMessage("Geocoding location; please wait...", false);
      try {
        const result = await geocodePlaceName(placeRaw);
        applyManualLocation(
          result.latitude,
          result.longitude,
          result.displayName,
        );
      } catch (error) {
        console.warn(error);
        setManualLocationMessage(
          "Could not resolve location name; please check spelling or enter lat/lon.",
          true,
        );
      }
      return;
    }

    setManualLocationMessage(
      "Please enter latitude/longitude or a suburb/city",
      true,
    );
  });
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
          "User-Agent": "WeatherWarning/1.0",
        },
      },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const suburb = extractSuburb(data.address);
    const state = data.address?.state;
    const country = data.address?.country;
    if (suburb) {
      addrEl.textContent = [suburb, state, country].filter(Boolean).join(", ");
    } else {
      const general =
        data.address?.city ||
        data.address?.town ||
        data.address?.village ||
        data.address?.county ||
        data.address?.state;
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

function formatHour12(hour) {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized < 12 ? "AM" : "PM";
  const base = normalized % 12 || 12;
  return { hour: base, suffix };
}

function formatHourRange(startHour, endHour) {
  const start = formatHour12(startHour);
  const end = formatHour12(endHour);

  const startPart = `${start.hour}`;
  const endPart = `${end.hour}${end.suffix}`;

  if (start.suffix === end.suffix) {
    if (start.hour === 11 && end.hour === 12 && start.suffix === "AM") {
      // crosses AM->PM at 12
      return `${start.hour}${start.suffix}-${endPart}`;
    }
    return `${startPart}-${endPart}`;
  }

  return `${start.hour}${start.suffix}-${endPart}`;
}

function getDayName(date, weekdayStyle = "long") {
  return date.toLocaleDateString(undefined, { weekday: weekdayStyle });
}

function getSegmentTimeClass(date) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 8) return "time-twilight-morning";
  if (hour >= 8 && hour < 18) return "time-day";
  if (hour >= 18 && hour < 20) return "time-twilight-evening";
  return "time-night";
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

  const maxGust = Math.max(
    ...segments.map((s) => (s.maxGust !== undefined ? s.maxGust : 0)),
  );
  const maxWind = Math.max(
    ...segments.map((s) => (s.maxWind !== undefined ? s.maxWind : 0)),
  );
  const minTemp = Math.min(
    ...segments.map((s) => (s.minTemp !== undefined ? s.minTemp : Infinity)),
  );
  const maxTemp = Math.max(
    ...segments.map((s) => (s.maxTemp !== undefined ? s.maxTemp : -Infinity)),
  );

  const gustStatus =
    maxGust >= settings.maxWindGustAlarm
      ? "alarm"
      : maxGust >= settings.maxWindGustCaution
        ? "warning"
        : "normal";
  const tempStatus =
    maxTemp >= settings.maxTempAlarm || minTemp <= settings.minTempAlarm
      ? "alarm"
      : maxTemp >= settings.maxTempCaution || minTemp <= settings.minTempCaution
        ? "warning"
        : "normal";

  const bestCondition = segments.reduce((best, segment) => {
    if (segment.code === undefined) return best;
    const severity = getWeatherSeverity(segment.code);
    if (!best || severity > best.severity) {
      return { severity, code: segment.code };
    }
    return best;
  }, null);

  const conditions = [];
  conditions.push({
    priority: gustStatus === "alarm" ? 4 : gustStatus === "warning" ? 3 : 1,
    label: `Wind Gust: ${maxGust} km/h (${gustStatus})`,
  });
  conditions.push({
    priority: tempStatus === "alarm" ? 4 : tempStatus === "warning" ? 3 : 1,
    label: `Temperature spread: ${isFinite(minTemp) ? Math.round(minTemp) + "°C" : "—"} to ${isFinite(maxTemp) ? Math.round(maxTemp) + "°C" : "—"} (${tempStatus})`,
  });
  if (bestCondition && bestCondition.severity > 2) {
    conditions.push({
      priority: bestCondition.severity,
      label: `Condition: ${WMO_DESCRIPTIONS[bestCondition.code] || "Unknown"}`,
    });
  }

  conditions.sort((a, b) => b.priority - a.priority);

  const hasConcern = conditions.some((c) => c.priority > 1);

  const eventDetails = segments
    .flatMap((segment) => {
      const entries = [];
      if (segment.maxGust !== undefined) {
        if (segment.maxGust >= settings.maxWindGustAlarm) {
          entries.push({
            severity: 4,
            text: `Gust ALARM ${Math.round(segment.maxGust)} km/h`,
          });
        } else if (segment.maxGust >= settings.maxWindGustCaution) {
          entries.push({
            severity: 3,
            text: `Gust WARNING ${Math.round(segment.maxGust)} km/h`,
          });
        }
      }
      if (segment.minTemp !== undefined && segment.maxTemp !== undefined) {
        if (
          segment.minTemp <= settings.minTempAlarm ||
          segment.maxTemp >= settings.maxTempAlarm
        ) {
          entries.push({
            severity: 4,
            text: `Temp ALARM ${Math.round(segment.minTemp)}-${Math.round(segment.maxTemp)}°C`,
          });
        } else if (
          segment.minTemp <= settings.minTempCaution ||
          segment.maxTemp >= settings.maxTempCaution
        ) {
          entries.push({
            severity: 3,
            text: `Temp WARNING ${Math.round(segment.minTemp)}-${Math.round(segment.maxTemp)}°C`,
          });
        }
      }
      if (segment.code !== undefined && getWeatherSeverity(segment.code) >= 6) {
        entries.push({
          severity: getWeatherSeverity(segment.code),
          text: `${WMO_DESCRIPTIONS[segment.code] || "Weather alert"}`,
        });
      }
      return entries.map((entry) => ({ ...entry, when: segment.label }));
    })
    .sort((a, b) => b.severity - a.severity);

  const topEvent = eventDetails[0];
  const topEventHeading = topEvent
    ? `Most critical single event: ${topEvent.text} at ${topEvent.when}`
    : "Most critical single event: none";

  const tempDescriptor = (minT, maxT) => {
    if (minT <= settings.minTempAlarm) return "COLD";
    if (minT <= settings.minTempCaution) return "COOL";
    if (maxT >= settings.maxTempAlarm) return "VERY HOT";
    if (maxT >= settings.maxTempCaution) return "HOT";
    return "MILD";
  };

  const gustStatusOf = (g) => {
    if (g >= settings.maxWindGustAlarm) return "ALARM";
    if (g >= settings.maxWindGustCaution) return "CAUTION";
    return "NORMAL";
  };

  const firstAlertSegment = segments.find((segment) => {
    const isGustAlert =
      segment.maxGust !== undefined &&
      segment.maxGust >= settings.maxWindGustCaution;
    const isTempAlert =
      (segment.minTemp !== undefined &&
        segment.minTemp <= settings.minTempCaution) ||
      (segment.maxTemp !== undefined &&
        segment.maxTemp >= settings.maxTempCaution);
    const isWeatherAlert =
      segment.code !== undefined && getWeatherSeverity(segment.code) > 3;
    return isGustAlert || isTempAlert || isWeatherAlert;
  });

  const formattedHeadline = (() => {
    if (!firstAlertSegment) return "No immediate alert period identified.";

    const part = firstAlertSegment.timeClass
      .replace("time-", "")
      .replace("-", " ")
      .toUpperCase();
    const day = getDayName(firstAlertSegment.date, "long").toUpperCase();

    let text = `${part} (${day}) WILL BE ${tempDescriptor(firstAlertSegment.minTemp ?? 0, firstAlertSegment.maxTemp ?? 0)}`;

    const wmo =
      firstAlertSegment.code !== undefined
        ? WMO_DESCRIPTIONS[firstAlertSegment.code]
        : null;
    if (wmo) {
      const weatherText = wmo.toUpperCase();
      text += ` AND ${weatherText}`;
    }

    // if 1pm style from label if exact hours exist
    const periodLabel = firstAlertSegment.label.toUpperCase();
    text += ` STARTING FROM ${periodLabel}.`;

    return text;
  })();

  const gustAlerts = segments.map((segment) => ({
    when: segment.label,
    day: getDayName(segment.date, "long"),
    period: segment.timeClass.replace("time-", "").toUpperCase(),
    status: gustStatusOf(segment.maxGust ?? 0),
    value: Math.round(segment.maxGust ?? 0),
  }));

  const cautionStart = gustAlerts.find((s) => s.status === "CAUTION");
  const alarmStart = gustAlerts.find((s) => s.status === "ALARM");
  const downToNormal = gustAlerts.reverse().find((s) => s.status === "NORMAL");

  const tempAlertSentences = [];
  const firstCold = segments.find(
    (s) => s.minTemp !== undefined && s.minTemp <= settings.minTempAlarm,
  );
  const firstCool = segments.find(
    (s) => s.minTemp !== undefined && s.minTemp <= settings.minTempCaution,
  );
  const firstHot = segments.find(
    (s) => s.maxTemp !== undefined && s.maxTemp >= settings.maxTempCaution,
  );
  const firstVeryHot = segments.find(
    (s) => s.maxTemp !== undefined && s.maxTemp >= settings.maxTempAlarm,
  );

  if (firstCold) {
    tempAlertSentences.push(
      `${getDayName(firstCold.date, "long")} will be a COLD morning`,
    );
  }
  if (firstCool && firstCool !== firstCold) {
    tempAlertSentences.push(`and COOL evening into night`);
  }
  if (firstVeryHot) {
    tempAlertSentences.push(`MAX ALERT: VERY HOT conditions expected`);
  } else if (firstHot) {
    tempAlertSentences.push(`and HOT conditions can develop`);
  }

  const gustSentence = [];
  if (cautionStart) {
    gustSentence.push(
      `WIND GUST WARNING: CAUTION level begins ${cautionStart.period.toLowerCase()} ${cautionStart.day}`,
    );
  }
  if (alarmStart) {
    gustSentence.push(
      `reaching ALARM by ${alarmStart.period.toLowerCase()} (${alarmStart.value} km/h)`,
    );
  }
  if (downToNormal) {
    gustSentence.push(
      `reducing to CAUTION/normal by ${downToNormal.period.toLowerCase()} ${downToNormal.day}`,
    );
  }

  if (!hasConcern) {
    container.innerHTML = `
      <div><strong>${formattedHeadline}</strong></div>
      <div>All clear for the next 24 hours.</div>
      <div>${gustSentence.join(", ")}.</div>
      <div>${tempAlertSentences.join("; ")}.</div>
    `;
    return;
  }

  const lines = [];
  lines.push(`<div><strong>${formattedHeadline}</strong></div>`);
  lines.push(`<div>${gustSentence.join(", ")}.</div>`);
  lines.push(`<div>${tempAlertSentences.join("; ")}.</div>`);
  lines.push(`<div>${conditions[0].label}</div>`);
  lines.push(`<div>${conditions[1]?.label || ""}</div>`);

  if (conditions.length > 2) {
    lines.push(`<div><strong>Other conditions</strong></div>`);
    conditions
      .slice(2)
      .forEach((item) => lines.push(`<div>${item.label}</div>`));
  }

  // Chronological alert timeline from segments
  const timeline = segments
    .map((segment) => {
      const entries = [];
      const segGust = segment.maxGust;
      const segMinTemp = segment.minTemp;
      const segMaxTemp = segment.maxTemp;
      const segCode = segment.code;

      if (segGust !== undefined) {
        if (segGust >= settings.maxWindGustAlarm) {
          entries.push(`Gust ALARM ${Math.round(segGust)} km/h`);
        } else if (segGust >= settings.maxWindGustCaution) {
          entries.push(`Gust WARNING ${Math.round(segGust)} km/h`);
        }
      }

      if (segMinTemp !== undefined && segMaxTemp !== undefined) {
        if (
          segMinTemp <= settings.minTempAlarm ||
          segMaxTemp >= settings.maxTempAlarm
        ) {
          entries.push(
            `Temp ALARM ${Math.round(segMinTemp)}-${Math.round(segMaxTemp)}°C`,
          );
        } else if (
          segMinTemp <= settings.minTempCaution ||
          segMaxTemp >= settings.maxTempCaution
        ) {
          entries.push(
            `Temp WARNING ${Math.round(segMinTemp)}-${Math.round(segMaxTemp)}°C`,
          );
        }
      }

      if (segCode !== undefined && getWeatherSeverity(segCode) > 3) {
        entries.push(`${WMO_DESCRIPTIONS[segCode] || "Weather"}`);
      }

      if (!entries.length) return null;
      return `<div><strong>${segment.label}:</strong> ${entries.join("; ")}</div>`;
    })
    .filter(Boolean);

  if (timeline.length) {
    lines.push(`<div><strong>Alert timeline</strong></div>`);
    timeline.forEach((entry) => lines.push(entry));
  }

  container.innerHTML = lines.join("");
}

function buildForecast(data) {
  const headerRow = document.getElementById("forecast24HeaderRow");
  const body24 = document.getElementById("forecast24Body");
  const rowsSummary = document.getElementById("forecastRowsSummary");

  headerRow.innerHTML = "<th>Time</th>";
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
  const startIndex = times.findIndex(
    (t) => new Date(t).getTime() >= nextFullHour.getTime(),
  );
  const start = startIndex >= 0 ? startIndex : 0;
  const end = Math.min(start + 24, times.length);

  const forecast24Heading = document.getElementById("forecast24Heading");
  if (forecast24Heading) {
    forecast24Heading.textContent = "Next 24 hours";
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
      if (
        severity > bestSeverity ||
        (severity === bestSeverity && keyScale > bestWind)
      ) {
        bestSeverity = severity;
        bestWind = keyScale;
        bestCode = code;
      }
    }

    const startDate = new Date(times[segStart]);
    const startHour = startDate.getHours();
    const labelHour2 = (startHour + 1) % 24;

    segments.push({
      label: formatHourRange(startHour, labelHour2),
      date: startDate,
      timeClass: getSegmentTimeClass(startDate),
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

  // draw 24-hour symbol row and label row
  const symbolRow = document.getElementById("forecast24SymbolRow");

  if (symbolRow) {
    symbolRow.innerHTML = "<th></th>";
    segments.forEach((segment) => {
      const symbolCell = document.createElement("th");
      symbolCell.classList.add("symbol-cell");
      symbolCell.classList.add(segment.timeClass);
      symbolCell.textContent = segment.timeClass === "time-night" ? "🌙" : "☀";
      symbolRow.appendChild(symbolCell);
    });
  }

  segments.forEach((segment) => {
    const cell = document.createElement("th");
    cell.textContent = segment.label;
    cell.classList.add(segment.timeClass);
    headerRow.appendChild(cell);
  });

  const rowDef = (label) => {
    const row = document.createElement("tr");
    const cell = document.createElement("th");
    cell.textContent = label;
    row.appendChild(cell);
    return row;
  };

  const dayRow = document.createElement("tr");
  const dayLabelCell = document.createElement("th");
  dayLabelCell.textContent = "Day";
  dayRow.appendChild(dayLabelCell);

  let currentDayName = null;
  let currentDayCell = null;
  let daySpan = 0;

  segments.forEach((segment, index) => {
    const dayName = getDayName(segment.date);
    const dayLabel = `${dayName} ${segment.date.getDate()}`;
    if (dayName !== currentDayName) {
      if (currentDayCell) {
        currentDayCell.colSpan = daySpan;
      }
      currentDayName = dayName;
      daySpan = 1;
      currentDayCell = document.createElement("th");
      currentDayCell.textContent = dayLabel;
      dayRow.appendChild(currentDayCell);
    } else {
      daySpan += 1;
      if (currentDayCell) {
        currentDayCell.textContent = dayLabel;
      }
    }
    if (index === segments.length - 1 && currentDayCell) {
      currentDayCell.colSpan = daySpan;
    }
  });

  const conditionRow = rowDef("Condition");
  const tempRow = rowDef("Temp");
  const windRow = rowDef("Wind");
  const gustRow = rowDef("Max Gust");

  segments.forEach((segment) => {
    const condCell = document.createElement("td");
    condCell.innerHTML = `<span class="condition-icon">${getWeatherIcon(segment.code, true)}</span> <span class="condition-text">${WMO_DESCRIPTIONS[segment.code] || "—"}</span>`;
    conditionRow.appendChild(condCell);

    const tempCell = document.createElement("td");
    if (segment.minTemp !== undefined) {
      const minTempValue = Math.round(segment.minTemp);
      const maxTempValue = Math.round(segment.maxTemp);
      tempCell.textContent =
        minTempValue === maxTempValue
          ? `${minTempValue}°C`
          : `${minTempValue}-${maxTempValue}°C`;
      if (segment.minTemp <= settings.minTempAlarm)
        tempCell.classList.add("forecast-alarm-cold");
      else if (segment.minTemp <= settings.minTempCaution)
        tempCell.classList.add("forecast-caution-cold");
      else if (segment.maxTemp >= settings.maxTempAlarm)
        tempCell.classList.add("forecast-alarm");
      else if (segment.maxTemp >= settings.maxTempCaution)
        tempCell.classList.add("forecast-warning");
    } else {
      tempCell.textContent = "—";
    }
    tempRow.appendChild(tempCell);

    const windCell = document.createElement("td");
    windCell.innerHTML =
      segment.maxWind !== undefined
        ? `<span class="digits">${Math.round(segment.maxWind)}</span><span class="unit"> km/h </span><span class="unit">${segment.windDir !== undefined ? bearingArrow(segment.windDir) + " " + degToCompass(segment.windDir) : ""}</span>`
        : "—";
    windRow.appendChild(windCell);

    const gustCell = document.createElement("td");
    gustCell.innerHTML =
      segment.maxGust !== undefined
        ? `<span class="digits">${Math.round(segment.maxGust)}</span><span class="unit"> km/h </span><span class="unit">${segment.gustDir !== undefined ? bearingArrow(segment.gustDir) + " " + degToCompass(segment.gustDir) : ""}</span>`
        : "—";
    if (segment.maxGust !== undefined) {
      if (segment.maxGust >= settings.maxWindGustAlarm)
        gustCell.classList.add("forecast-alarm");
      else if (segment.maxGust >= settings.maxWindGustCaution)
        gustCell.classList.add("forecast-warning");
    }
    gustRow.appendChild(gustCell);
  });

  body24.append(conditionRow, dayRow, tempRow, windRow, gustRow);
  updateLookaheadSummary(segments);

  // summary 25h-7d by day with morning/day/evening/night columns
  const dayStats = {}; // {day: stats}
  for (let i = 24; i < Math.min(times.length, 192); i++) {
    const d = new Date(times[i]);
    const dayKey = d.toLocaleDateString();
    const bucketKey = formatBucket(d.getHours()).toLowerCase();

    const temp = temps[i];
    const gust = gusts[i];
    const code = codes[i];
    const dir = windDirs[i];

    if (!dayStats[dayKey]) {
      dayStats[dayKey] = {
        date: d,
        periods: {
          morning: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
          },
          daytime: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
          },
          evening: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
          },
          night: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
          },
        },
      };
    }

    const entry = dayStats[dayKey];
    const period = entry.periods[bucketKey];
    if (!period) continue;

    if (temp !== undefined) {
      period.minTemp = Math.min(period.minTemp, temp);
      period.maxTemp = Math.max(period.maxTemp, temp);
    }
    if (gust !== undefined && gust > period.maxGust) {
      period.maxGust = gust;
      period.maxGustDir = dir;
    }
    if (code !== undefined) {
      const severity = getWeatherSeverity(code);
      if (severity > period.bestSeverity) {
        period.bestSeverity = severity;
        period.bestCode = code;
      }
    }
  }

  const summaryRows = Object.values(dayStats).sort((a, b) => a.date - b.date);

  const header = document.getElementById("forecastSummaryHeader");
  if (header) {
    header.innerHTML = "";
    const topRow = document.createElement("tr");
    const dayHeader = document.createElement("th");
    dayHeader.textContent = "Day";
    dayHeader.rowSpan = 2;
    topRow.appendChild(dayHeader);

    const groups = [
      { label: "Conditions", span: 4 },
      { label: "Temperature (min-max)", span: 4 },
      { label: "Max Wind Gusts", span: 4 },
    ];

    groups.forEach((group) => {
      const th = document.createElement("th");
      th.colSpan = group.span;
      th.textContent = group.label;
      topRow.appendChild(th);
    });

    const subRow = document.createElement("tr");
    ["Condition", "Temp", "Max Gust"].forEach(() => {
      ["Morning", "Daytime", "Evening", "Night"].forEach((periodName) => {
        const th = document.createElement("th");
        th.textContent = periodName;
        subRow.appendChild(th);
      });
    });

    header.append(topRow, subRow);
  }

  summaryRows.forEach((entry) => {
    const row = document.createElement("tr");
    const dayCell = document.createElement("td");
    dayCell.textContent = `${getDayName(entry.date, "short")} ${entry.date.getDate()}`;
    row.appendChild(dayCell);

    const buckets = ["morning", "daytime", "evening", "night"];

    // conditions first
    buckets.forEach((bucket) => {
      const period = entry.periods[bucket];
      const condCell = document.createElement("td");
      if (period && period.bestCode !== undefined) {
        condCell.innerHTML = `${getWeatherIcon(period.bestCode, true)} ${WMO_DESCRIPTIONS[period.bestCode] || "—"}`;
      } else {
        condCell.textContent = "—";
      }
      row.appendChild(condCell);
    });

    // temps next
    buckets.forEach((bucket) => {
      const period = entry.periods[bucket];
      const tempCell = document.createElement("td");
      if (
        period &&
        period.minTemp !== Infinity &&
        period.maxTemp !== -Infinity
      ) {
        const minT = Math.round(period.minTemp);
        const maxT = Math.round(period.maxTemp);
        tempCell.textContent =
          minT === maxT ? `${minT}°C` : `${minT}-${maxT}°C`;
        if (period.minTemp <= settings.minTempAlarm)
          tempCell.classList.add("forecast-alarm-cold");
        else if (period.minTemp <= settings.minTempCaution)
          tempCell.classList.add("forecast-caution-cold");
        else if (period.maxTemp >= settings.maxTempAlarm)
          tempCell.classList.add("forecast-alarm");
        else if (period.maxTemp >= settings.maxTempCaution)
          tempCell.classList.add("forecast-warning");
      } else {
        tempCell.textContent = "—";
      }
      row.appendChild(tempCell);
    });

    // max gust next
    buckets.forEach((bucket) => {
      const period = entry.periods[bucket];
      const gustCell = document.createElement("td");
      if (period && period.maxGust !== -Infinity) {
        gustCell.textContent = `${Math.round(period.maxGust)} km/h ${period.maxGustDir !== undefined ? bearingArrow(period.maxGustDir) + " " + degToCompass(period.maxGustDir) : ""}`;
        if (period.maxGust >= settings.maxWindGustAlarm)
          gustCell.classList.add("forecast-alarm");
        else if (period.maxGust >= settings.maxWindGustCaution)
          gustCell.classList.add("forecast-warning");
      } else {
        gustCell.textContent = "—";
      }
      row.appendChild(gustCell);
    });

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

    const readableDesc = desc;
    setTextById("wxDesc", readableDesc);
    setTextById("wxIcon", getWeatherIcon(c.weathercode, true));
    setTextById("wxIconLabel", readableDesc);
    setTextById(
      "wxTemp",
      todayTemp !== undefined ? `${Math.round(todayTemp)}°C` : "—",
    );
    setTextById(
      "wxFeels",
      todayTemp !== undefined ? `${Math.round(todayTemp)}°C` : "—",
    );
    setTextById(
      "wxWind",
      todayWindSpeed !== undefined && todayWindDir !== undefined
        ? `${Math.round(todayWindSpeed)} km/h ${bearingArrow(todayWindDir)} ${degToCompass(todayWindDir)}`
        : "—",
    );
    setTextById(
      "wxHum",
      todayHumidity !== undefined ? `${Math.round(todayHumidity)}%` : "—",
    );
    setTextById("updatedInfo", `Updated: ${c.time}`);

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
      document.getElementById("forecastError").textContent =
        "Forecast data not available.";
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
    document.getElementById("forecastError").textContent =
      `Forecast unavailable: ${e.message || e}`;
    document.getElementById("forecastStatus").textContent = "";

    wxStatus.textContent = "Could not load weather data.";
    wxStatus.style.display = "block";
    console.error(e);
  }
}
