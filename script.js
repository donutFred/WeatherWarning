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
let lastResolvedLocationKey = null;

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

function setDisplayValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = String(value);
  }
}

function syncDisplayValues(currentSettings) {
  setDisplayValue("maxWindGustAlarmDisplay", currentSettings.maxWindGustAlarm);
  setDisplayValue(
    "maxWindGustCautionDisplay",
    currentSettings.maxWindGustCaution,
  );
  setDisplayValue("minTempAlarmDisplay", currentSettings.minTempAlarm);
  setDisplayValue("minTempCautionDisplay", currentSettings.minTempCaution);
  setDisplayValue("maxTempAlarmDisplay", currentSettings.maxTempAlarm);
  setDisplayValue("maxTempCautionDisplay", currentSettings.maxTempCaution);
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
  syncDisplayValues(currentSettings);

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
        setThresholdMessage(errors[0]);
        syncDisplayValues(candidate);
        return;
      }

      setThresholdMessage("", false);
      syncDisplayValues(candidate);
      updateWindGustBar(candidate);
      updateTempScaleBar(candidate);
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

function initDragHandles() {
  const handleConfig = [
    { wrapperId: "cautionInputWrapper", inputId: "maxWindGustCaution" },
    { wrapperId: "alarmInputWrapper", inputId: "maxWindGustAlarm" },
    { wrapperId: "minTempCautionInputWrapper", inputId: "minTempCaution" },
    { wrapperId: "maxTempCautionInputWrapper", inputId: "maxTempCaution" },
    { wrapperId: "minTempAlarmInputWrapper", inputId: "minTempAlarm" },
    { wrapperId: "maxTempAlarmInputWrapper", inputId: "maxTempAlarm" },
  ];

  handleConfig.forEach(({ wrapperId, inputId }) => {
    const wrapper = document.getElementById(wrapperId);
    const input = document.getElementById(inputId);
    const bar = wrapper?.closest(".gust-scale-bar");
    if (!wrapper || !input || !bar) return;

    const min = Number(input.min ?? 0);
    const max = Number(input.max ?? min + 100);

    const update = (clientX) => {
      if (typeof clientX !== "number") return;
      const rect = bar.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width),
      );
      const value = Math.round(min + ratio * (max - min));
      if (Number(input.value) === value) return;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    const onPointerDown = (event) => {
      event.preventDefault();
      wrapper.setPointerCapture?.(event.pointerId);
      update(event.clientX);
      const onMove = (moveEvent) => update(moveEvent.clientX);
      const onEnd = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onEnd);
        document.removeEventListener("pointercancel", onEnd);
        wrapper.releasePointerCapture?.(event.pointerId);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onEnd);
      document.addEventListener("pointercancel", onEnd);
    };

    wrapper.addEventListener("pointerdown", onPointerDown);
  });
}

function initMapIfNeeded(lat, lon, zoom = 4) {
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
  const locationKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  if (locationKey !== lastResolvedLocationKey) {
    fetchAddress(latitude, longitude);
    fetchWeather(latitude, longitude);
    lastResolvedLocationKey = locationKey;
  }
}

// initialize settings UI + events
applySettingsToUI();
initSettingsListeners();

function renderDefaultSettingsText() {
  const el = document.getElementById("defaultSettingsDisplay");
  if (!el) return;
  el.textContent =
    `Default thresholds: wind caution ${DEFAULT_SETTINGS.maxWindGustCaution} km/h, wind alarm ${DEFAULT_SETTINGS.maxWindGustAlarm} km/h, min temp alarm ${DEFAULT_SETTINGS.minTempAlarm}°C, min temp caution ${DEFAULT_SETTINGS.minTempCaution}°C, max temp caution ${DEFAULT_SETTINGS.maxTempCaution}°C, max temp alarm ${DEFAULT_SETTINGS.maxTempAlarm}°C.`;
}
renderDefaultSettingsText();

async function updateLatestReleaseDate() {
  const releaseDateEl = document.getElementById("releaseDate");
  if (!releaseDateEl) return;

  const fallback = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  try {
    const response = await fetch(
      "https://api.github.com/repos/DMT-Dev1/WeatherWarning/commits?path=index.html&sha=main&per_page=1",
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const commits = await response.json();
    const committedAt = commits?.[0]?.commit?.committer?.date;
    if (!committedAt) {
      releaseDateEl.textContent = fallback;
      return;
    }

    releaseDateEl.textContent = new Date(committedAt).toLocaleDateString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
      },
    );
  } catch (e) {
    console.warn("Release date fetch failed", e);
    releaseDateEl.textContent = fallback;
  }
}
updateLatestReleaseDate();

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

const FOG_ICON_SVG = `<svg class="fog-svg-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="6"><path d="M26 30c0-9 7-16 16-16 6 0 11 3 14 8 2-2 5-3 9-3 7 0 13 6 13 13"/><path d="M10 44h100"/><path d="M18 56h72"/><path d="M50 68h62"/></svg>`;

const WMO_ICONS = {
  0: "☀️",
  1: "🌤",
  2: "⛅",
  3: "☁️",
  45: FOG_ICON_SVG,
  48: FOG_ICON_SVG,
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
  if (code === 45 || code === 48) return icon;
  if (!isDay) {
    if (code === 0) return "🌙";
    if ([1, 2, 3, 45, 48].includes(code)) return "🌜";
  }
  return icon;
}

function setWeatherIconById(id, iconMarkupOrText) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = iconMarkupOrText ?? "—";
  if (typeof value === "string" && value.includes("<svg")) {
    el.innerHTML = value;
  } else {
    el.textContent = value;
  }
}

const WIND_ICON_SVG = `<svg class="wind-svg-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="7"><path d="M5 22 H52 Q68 22 68 12 Q68 2 58 2 Q48 2 48 12"/><path d="M5 35 H72 Q84 35 84 45 Q84 55 74 55 Q64 55 64 45"/><path d="M5 50 H46 Q58 50 58 60 Q58 68 50 68 Q42 68 42 60"/></svg>`;

const SOLAR_RATINGS = [
  { label: "Low", className: "solar-poor" },
  { label: "Poor", className: "solar-fair" },
  { label: "Good", className: "solar-good" },
  { label: "Very good", className: "solar-very-good" },
  { label: "Excellent", className: "solar-excellent" },
];

function isSolarEligibleTimeClass(timeClass) {
  return timeClass !== "time-night";
}

function getSolarLevelFromCode(code) {
  if (code === undefined || code === null) return null;
  if (code === 0 || code === 1) return 4;
  if (code === 2) return 3;
  if (code === 3) return 2;
  if (code === 45 || code === 48) return 1;
  if (code >= 51 && code <= 99) return 0;
  return 1;
}

function getSolarRating(code, timeClass, isDaily = false) {
  if (!isDaily && !isSolarEligibleTimeClass(timeClass)) return null;
  const level = getSolarLevelFromCode(code);
  if (level === null) return null;

  let adjustedLevel = level;
  if (
    !isDaily &&
    (timeClass === "time-twilight-morning" ||
      timeClass === "time-twilight-evening")
  ) {
    adjustedLevel = Math.max(0, adjustedLevel - 1);
  }

  return SOLAR_RATINGS[adjustedLevel];
}

// Radiation-based solar rating (W/m²); naturally accounts for sun angle and cloud cover
function getSolarRatingFromRadiation(radiation, timeClass) {
  if (!isSolarEligibleTimeClass(timeClass)) return null;
  if (radiation === undefined || radiation === null) return null;
  let level;
  if (radiation < 200) level = 0;
  else if (radiation < 400) level = 1;
  else if (radiation < 650) level = 2;
  else if (radiation <= 800) level = 3;
  else level = 4;
  return { ...SOLAR_RATINGS[level], radiation: Math.round(radiation) };
}

// Daily solar: sum all hourly W/m² = total Wh/m² for the day
function getDailySolarRating(totalWh) {
  if (!totalWh || totalWh <= 0) return null;
  let level;
  if (totalWh < 500) level = 0;
  else if (totalWh < 1500) level = 1;
  else if (totalWh < 3000) level = 2;
  else if (totalWh < 5000) level = 3;
  else level = 4;
  const kwh = (totalWh / 1000).toFixed(1);
  return { ...SOLAR_RATINGS[level], displayValue: `${kwh} kWh/m²` };
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
  // Wind direction is the FROM direction; rotate 180° so arrow points WITH the wind
  const d = (((deg + 180) % 360) + 360) % 360;
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

function updateLookaheadSummary(segments, hourlyPoints = [], summaryRows = []) {
  const container = document.getElementById("lookaheadSummary");
  if (!container) return;

  if (!segments || segments.length === 0) {
    container.textContent = "No forecast data available for the next 24 hours.";
    return;
  }

  const timeline = hourlyPoints.length ? hourlyPoints : segments;
  const firstPoint = timeline[0];
  const lastPoint = timeline[timeline.length - 1];

  const now = new Date();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const isSummarySolarEligibleTimeClass = (timeClass) => timeClass === "time-day";

  const describeWhen = (date, fallbackBucketDate = date) => {
    const asDate = date instanceof Date ? date : new Date(date);
    const delta = asDate.getTime() - now.getTime();
    const dayShort = getDayName(asDate, "short");
    if (delta <= ONE_DAY_MS) {
      const hour = formatHour12(asDate.getHours());
      return `${dayShort} ${hour.hour}${hour.suffix.toLowerCase()}`;
    }
    return `${dayShort} ${formatBucket(fallbackBucketDate.getHours()).toLowerCase()}`;
  };

  const gustLevel = (value) => {
    if (value === undefined || value === null) return 0;
    if (value >= settings.maxWindGustAlarm) return 2;
    if (value >= settings.maxWindGustCaution) return 1;
    return 0;
  };

  const findTransition = (points, getLevel, targetLevel, startIdx = 0) => {
    for (let i = Math.max(0, startIdx); i < points.length; i++) {
      if (getLevel(points[i]) === targetLevel) return i;
    }
    return -1;
  };

  const findTransitionAtLeast = (points, getLevel, minLevel, startIdx = 0) => {
    for (let i = Math.max(0, startIdx); i < points.length; i++) {
      if (getLevel(points[i]) >= minLevel) return i;
    }
    return -1;
  };

  const findFirstBelow = (points, getLevel, limit, startIdx = 0) => {
    for (let i = Math.max(0, startIdx); i < points.length; i++) {
      if (getLevel(points[i]) < limit) return i;
    }
    return -1;
  };

  const maxGust = Math.max(
    ...timeline.map((point) =>
      point.maxGust !== undefined
        ? point.maxGust
        : point.gust !== undefined
          ? point.gust
          : 0,
    ),
  );
  const minTemp = Math.min(
    ...timeline.map((point) =>
      point.minTemp !== undefined
        ? point.minTemp
        : point.temp !== undefined
          ? point.temp
          : Infinity,
    ),
  );
  const maxTemp = Math.max(
    ...timeline.map((point) =>
      point.maxTemp !== undefined
        ? point.maxTemp
        : point.temp !== undefined
          ? point.temp
          : -Infinity,
    ),
  );

  const highestRadiationPoint = timeline.reduce((best, point) => {
    if (!isSummarySolarEligibleTimeClass(point.timeClass)) return best;
    const value =
      point.maxRadiation !== undefined
        ? point.maxRadiation
        : point.radiation !== undefined
          ? point.radiation
          : undefined;
    if (value === undefined) return best;
    if (!best || value > best.value) return { point, value };
    return best;
  }, null);

  const highestWeatherPoint = timeline.reduce((best, point) => {
    const code = point.code;
    if (code === undefined) return best;
    const severity = getWeatherSeverity(code);
    if (!best || severity > best.severity) {
      return { point, severity, code };
    }
    return best;
  }, null);

  const windCautionIdx = findTransitionAtLeast(
    timeline,
    (point) => gustLevel(point.maxGust ?? point.gust),
    1,
  );
  const windAlarmIdx = findTransition(
    timeline,
    (point) => gustLevel(point.maxGust ?? point.gust),
    2,
    windCautionIdx >= 0 ? windCautionIdx : 0,
  );
  const alarmDropIdx =
    windAlarmIdx >= 0
      ? findFirstBelow(
          timeline,
          (point) => gustLevel(point.maxGust ?? point.gust),
          2,
          windAlarmIdx + 1,
        )
      : -1;
  const cautionDropIdx =
    windCautionIdx >= 0
      ? findFirstBelow(
          timeline,
          (point) => gustLevel(point.maxGust ?? point.gust),
          1,
          Math.max(windCautionIdx + 1, alarmDropIdx + 1),
        )
      : -1;

  const coldAlarmPoint = timeline.find(
    (point) =>
      (point.minTemp ?? point.temp) !== undefined &&
      (point.minTemp ?? point.temp) <= settings.minTempAlarm,
  );
  const coldCautionPoint = timeline.find(
    (point) =>
      (point.minTemp ?? point.temp) !== undefined &&
      (point.minTemp ?? point.temp) <= settings.minTempCaution,
  );
  const hotAlarmPoint = timeline.find(
    (point) =>
      (point.maxTemp ?? point.temp) !== undefined &&
      (point.maxTemp ?? point.temp) >= settings.maxTempAlarm,
  );
  const hotCautionPoint = timeline.find(
    (point) =>
      (point.maxTemp ?? point.temp) !== undefined &&
      (point.maxTemp ?? point.temp) >= settings.maxTempCaution,
  );

  const isSolarPoor = (radiation, timeClass) => {
    if (!isSummarySolarEligibleTimeClass(timeClass)) return false;
    if (radiation === undefined || radiation === null || radiation <= 0)
      return false;
    const rating = getSolarRatingFromRadiation(radiation, timeClass);
    if (!rating) return false;
    return (
      rating.className === "solar-poor" || rating.className === "solar-fair"
    );
  };

  const poorSolarDays = summaryRows
    .map((entry) => {
      const rating = getDailySolarRating(entry.totalRadiation);
      return Boolean(
        rating &&
          (rating.className === "solar-poor" || rating.className === "solar-fair"),
      );
    })
    .map((isPoor, idx, arr) => {
      if (!isPoor) return false;
      return Boolean(arr[idx - 1] || arr[idx + 1]);
    });

  const findNextWindBreach = () => {
    for (const point of timeline) {
      const pointDate =
        point.date instanceof Date ? point.date : new Date(point.date);
      const gust = point.gust ?? point.maxGust;
      if (gust !== undefined && gust >= settings.maxWindGustAlarm) {
        return { date: pointDate, type: "wind", level: "alarm" };
      }
      if (gust !== undefined && gust >= settings.maxWindGustCaution) {
        return { date: pointDate, type: "wind", level: "caution" };
      }
    }

    for (const entry of summaryRows) {
      for (const [bucketName, period] of Object.entries(entry.periods)) {
        if (
          period.maxGust !== -Infinity &&
          period.maxGust >= settings.maxWindGustAlarm
        ) {
          return {
            date: entry.date,
            type: "wind",
            level: "alarm",
            period: bucketName,
            is7day: true,
          };
        }
        if (
          period.maxGust !== -Infinity &&
          period.maxGust >= settings.maxWindGustCaution
        ) {
          return {
            date: entry.date,
            type: "wind",
            level: "caution",
            period: bucketName,
            is7day: true,
          };
        }
      }
    }

    return null;
  };

  let nearestBreach = findNextWindBreach();
  for (const point of timeline) {
    if (nearestBreach) break;
    const pointDate =
      point.date instanceof Date ? point.date : new Date(point.date);
    const minT = point.temp ?? point.minTemp;
    const maxT = point.maxTemp ?? point.temp;
    const code = point.code;

    if (minT !== undefined && minT <= settings.minTempAlarm) {
      nearestBreach = { date: pointDate, type: "cold", level: "alarm" };
    } else if (minT !== undefined && minT <= settings.minTempCaution) {
      nearestBreach = { date: pointDate, type: "cold", level: "caution" };
    } else if (maxT !== undefined && maxT >= settings.maxTempAlarm) {
      nearestBreach = { date: pointDate, type: "heat", level: "alarm" };
    } else if (maxT !== undefined && maxT >= settings.maxTempCaution) {
      nearestBreach = { date: pointDate, type: "heat", level: "caution" };
    } else if (
      code !== undefined &&
      ((code >= 51 && code <= 67) || (code >= 80 && code <= 99)) &&
      getWeatherSeverity(code) >= 4
    ) {
      nearestBreach = { date: pointDate, type: "rain", level: "caution" };
    }
  }

  if (!nearestBreach && summaryRows && summaryRows.length > 0) {
    outer: for (const [dayIndex, entry] of summaryRows.entries()) {
      for (const [bucketName, period] of Object.entries(entry.periods)) {
        if (
          period.minTemp !== Infinity &&
          period.minTemp <= settings.minTempAlarm
        ) {
          nearestBreach = {
            date: entry.date,
            type: "cold",
            level: "alarm",
            period: bucketName,
            is7day: true,
          };
          break outer;
        } else if (
          period.minTemp !== Infinity &&
          period.minTemp <= settings.minTempCaution
        ) {
          nearestBreach = {
            date: entry.date,
            type: "cold",
            level: "caution",
            period: bucketName,
            is7day: true,
          };
          break outer;
        } else if (
          period.maxTemp !== -Infinity &&
          period.maxTemp >= settings.maxTempAlarm
        ) {
          nearestBreach = {
            date: entry.date,
            type: "heat",
            level: "alarm",
            period: bucketName,
            is7day: true,
          };
          break outer;
        } else if (
          period.maxTemp !== -Infinity &&
          period.maxTemp >= settings.maxTempCaution
        ) {
          nearestBreach = {
            date: entry.date,
            type: "heat",
            level: "caution",
            period: bucketName,
            is7day: true,
          };
          break outer;
        }
      }

      if (nearestBreach) break;

      const dailySolar = getDailySolarRating(entry.totalRadiation);
      if (
        poorSolarDays[dayIndex] &&
        dailySolar &&
        (dailySolar.className === "solar-poor" ||
          dailySolar.className === "solar-fair")
      ) {
        nearestBreach = {
          date: entry.date,
          type: "solar",
          level: "caution",
          solarLabel: dailySolar.label,
          is7day: true,
        };
        break;
      }
    }
  }

  const lines = [];
  if (nearestBreach) {
    const isAlarm = nearestBreach.level === "alarm";
    const msTill = nearestBreach.date - now;
    const isImminent = msTill < TWO_HOURS_MS;
    const timeRef =
      nearestBreach.is7day && nearestBreach.period
        ? `${getDayName(nearestBreach.date, "short")} ${nearestBreach.period}`
        : describeWhen(nearestBreach.date);
    let actionLine = "";

    switch (nearestBreach.type) {
      case "wind":
        actionLine = isAlarm
          ? `Bring in the awning and secure outdoor equipment before ${timeRef} when wind gusts are forecast to reach alarm level.`
          : `Consider bringing in the awning before ${timeRef} when caution-level wind gusts are expected.`;
        if (isImminent) {
          actionLine = isAlarm
            ? "Take immediate action: bring in the awning and secure outdoor equipment now."
            : "Consider securing the awning now as caution-level gusts are imminent.";
        }
        break;
      case "cold":
        actionLine = isAlarm
          ? `Close up the windows and turn on the heater before ${timeRef} — cold alarm expected.`
          : `Consider closing up and turning on heating before ${timeRef} when cold caution is expected.`;
        if (isImminent) {
          actionLine = isAlarm
            ? "Take immediate action: close up windows and turn on heating now."
            : "Consider preparing heating now as cold caution is imminent.";
        }
        break;
      case "heat":
        actionLine = isAlarm
          ? `Prepare cooling and maximise ventilation before ${timeRef} — heat alarm expected.`
          : `Consider opening up for ventilation before ${timeRef} when heat caution is expected.`;
        if (isImminent) {
          actionLine = isAlarm
            ? "Take immediate action: maximise ventilation and prepare cooling now."
            : "Consider increasing ventilation now as heat caution is imminent.";
        }
        break;
      case "rain":
        actionLine = isImminent
          ? "Close windows and take action to protect against rain now."
          : `Close windows and prepare for rain expected from ${timeRef}.`;
        break;
      case "solar": {
        const solarLbl = nearestBreach.solarLabel || "Low";
        actionLine = `Solar generation is forecast to be ${solarLbl.toLowerCase()} from ${timeRef}.`;
        break;
      }
    }

    lines.push(
      `<div class="summary-action-required summary-action-${nearestBreach.level}"><strong>Next Action Required:</strong> ${actionLine}</div>`,
    );
  } else {
    lines.push(
      `<div class="summary-action-required summary-action-none"><strong>Next Action Required:</strong> None — no alerts or alarms expected in the next 7 days.</div>`,
    );
  }

  lines.push(
    `<div><strong>Next 24 hours:</strong></div>`,
  );

  const riskSentences = [];
  if (windAlarmIdx >= 0 && windCautionIdx >= 0) {
    let sentence = `Wind gusts are likely to reach caution level from ${describeWhen(timeline[windCautionIdx].date ?? timeline[windCautionIdx])} and then alarm level at ${describeWhen(timeline[windAlarmIdx].date ?? timeline[windAlarmIdx])}.`;
    if (alarmDropIdx >= 0) {
      sentence += ` Gusts should drop below alarm around ${describeWhen(timeline[alarmDropIdx].date ?? timeline[alarmDropIdx])}.`;
    }
    if (cautionDropIdx >= 0) {
      sentence += ` They should drop below caution around ${describeWhen(timeline[cautionDropIdx].date ?? timeline[cautionDropIdx])}.`;
    }
    riskSentences.push(sentence);
  } else if (windCautionIdx >= 0) {
    riskSentences.push(
      `Wind gusts are likely to reach caution level from ${describeWhen(timeline[windCautionIdx].date ?? timeline[windCautionIdx])}, peaking near ${Math.round(maxGust)} km/h.`,
    );
  }

  if (coldAlarmPoint) {
    riskSentences.push(
      `Low temperature alarm risk begins around ${describeWhen(coldAlarmPoint.date ?? coldAlarmPoint)} (down to about ${Math.round(minTemp)}°C).`,
    );
  } else if (coldCautionPoint) {
    riskSentences.push(
      `Low temperature caution starts around ${describeWhen(coldCautionPoint.date ?? coldCautionPoint)} (down to about ${Math.round(minTemp)}°C).`,
    );
  }

  if (hotAlarmPoint) {
    riskSentences.push(
      `High temperature alarm risk starts around ${describeWhen(hotAlarmPoint.date ?? hotAlarmPoint)} (up to about ${Math.round(maxTemp)}°C).`,
    );
  } else if (hotCautionPoint) {
    riskSentences.push(
      `High temperature caution starts around ${describeWhen(hotCautionPoint.date ?? hotCautionPoint)} (up to about ${Math.round(maxTemp)}°C).`,
    );
  }

  if (highestWeatherPoint && highestWeatherPoint.severity >= 6) {
    const weatherText =
      WMO_DESCRIPTIONS[highestWeatherPoint.code] || "unsettled weather";
    riskSentences.push(
      `The roughest weather period looks to be ${weatherText.toLowerCase()} around ${describeWhen(highestWeatherPoint.point.date ?? highestWeatherPoint.point)}.`,
    );
  }

  if (highestRadiationPoint && highestRadiationPoint.value !== undefined) {
    const solarRating = getSolarRatingFromRadiation(
      highestRadiationPoint.value,
      highestRadiationPoint.point.timeClass,
    );
    if (
      solarRating &&
      (solarRating.className === "solar-poor" ||
        solarRating.className === "solar-fair")
    ) {
      riskSentences.push(
        `Solar intensity is expected to stay ${solarRating.label.toLowerCase()}, weakest near ${describeWhen(highestRadiationPoint.point.date ?? highestRadiationPoint.point)}.`,
      );
    }
  }

  if (!riskSentences.length) {
    riskSentences.push(
      "No caution or alarm thresholds are currently expected in the next 24 hours.",
    );
  }
  riskSentences.forEach((sentence) => lines.push(`<div>${sentence}</div>`));

  if (summaryRows && summaryRows.length > 0) {
    lines.push(
      `<div style="margin-top:10px"><strong>7 day lookahead:</strong></div>`,
    );

    summaryRows.forEach((entry, dayIndex) => {
      const dayLabel = `${getDayName(entry.date, "long")} ${entry.date.getDate()} ${entry.date.toLocaleDateString(undefined, { month: "short" })}`;
      const alerts = [];

      let maxDayGust = -Infinity;
      let maxDayGustPeriod = null;
      let minDayTemp = Infinity;
      let minDayTempPeriod = null;
      let maxDayTemp = -Infinity;
      let maxDayTempPeriod = null;
      let worstCode = undefined;
      let worstSeverity = -Infinity;

      for (const [bucketName, period] of Object.entries(entry.periods)) {
        if (period.maxGust !== -Infinity && period.maxGust > maxDayGust) {
          maxDayGust = period.maxGust;
          maxDayGustPeriod = bucketName;
        }
        if (period.minTemp !== Infinity && period.minTemp < minDayTemp) {
          minDayTemp = period.minTemp;
          minDayTempPeriod = bucketName;
        }
        if (period.maxTemp !== -Infinity && period.maxTemp > maxDayTemp) {
          maxDayTemp = period.maxTemp;
          maxDayTempPeriod = bucketName;
        }
        if (period.bestCode !== undefined) {
          const sev = getWeatherSeverity(period.bestCode);
          if (sev > worstSeverity) {
            worstSeverity = sev;
            worstCode = period.bestCode;
          }
        }
      }

      if (maxDayGust >= settings.maxWindGustAlarm) {
        alerts.push(
          `Wind alarm (gusts up to ${Math.round(maxDayGust)} km/h in the ${maxDayGustPeriod})`,
        );
      } else if (maxDayGust >= settings.maxWindGustCaution) {
        alerts.push(
          `Wind caution (gusts up to ${Math.round(maxDayGust)} km/h in the ${maxDayGustPeriod})`,
        );
      }

      if (minDayTemp !== Infinity && minDayTemp <= settings.minTempAlarm) {
        alerts.push(
          `Cold alarm (down to ${Math.round(minDayTemp)}°C in the ${minDayTempPeriod})`,
        );
      } else if (
        minDayTemp !== Infinity &&
        minDayTemp <= settings.minTempCaution
      ) {
        alerts.push(
          `Cold caution (down to ${Math.round(minDayTemp)}°C in the ${minDayTempPeriod})`,
        );
      }

      if (maxDayTemp !== -Infinity && maxDayTemp >= settings.maxTempAlarm) {
        alerts.push(
          `Heat alarm (up to ${Math.round(maxDayTemp)}°C in the ${maxDayTempPeriod})`,
        );
      } else if (
        maxDayTemp !== -Infinity &&
        maxDayTemp >= settings.maxTempCaution
      ) {
        alerts.push(
          `Heat caution (up to ${Math.round(maxDayTemp)}°C in the ${maxDayTempPeriod})`,
        );
      }

      if (worstCode !== undefined && worstSeverity >= 6) {
        const weatherText = WMO_DESCRIPTIONS[worstCode] || "unsettled weather";
        alerts.push(weatherText);
      }

      const dailySolar = getDailySolarRating(entry.totalRadiation);
      if (
        poorSolarDays[dayIndex] &&
        dailySolar &&
        (dailySolar.className === "solar-poor" ||
          dailySolar.className === "solar-fair")
      ) {
        alerts.push(`Solar ${dailySolar.label.toLowerCase()} generation expected`);
      }

      if (alerts.length) {
        lines.push(
          `<div>• <strong>${dayLabel}:</strong> ${alerts.join("; ")}.</div>`,
        );
      }
    });
  }

  container.innerHTML = lines.join("");
}

function getTempAlertClass(minTemp, maxTemp) {
  if (minTemp === undefined || maxTemp === undefined) return "";
  if (minTemp <= settings.minTempAlarm) return "forecast-alarm-cold";
  if (minTemp <= settings.minTempCaution) return "forecast-caution-cold";
  if (maxTemp >= settings.maxTempAlarm) return "forecast-alarm";
  if (maxTemp >= settings.maxTempCaution) return "forecast-warning";
  return "";
}

function getGustAlertClass(maxGust) {
  if (maxGust === undefined) return "";
  if (maxGust >= settings.maxWindGustAlarm) return "forecast-alarm";
  if (maxGust >= settings.maxWindGustCaution) return "forecast-warning";
  return "";
}

function getSegmentAlertMeta(segment) {
  const triggers = [];

  if (segment.maxGust !== undefined) {
    if (segment.maxGust >= settings.maxWindGustAlarm) {
      triggers.push({
        type: "wind",
        level: "alarm",
        icon: WIND_ICON_SVG,
        label: "Wind alarm",
      });
    } else if (segment.maxGust >= settings.maxWindGustCaution) {
      triggers.push({
        type: "wind",
        level: "caution",
        icon: WIND_ICON_SVG,
        label: "Wind caution",
      });
    }
  }

  if (segment.minTemp !== undefined) {
    if (segment.minTemp <= settings.minTempAlarm) {
      triggers.push({
        type: "cold",
        level: "alarm",
        icon: "❄",
        label: "Cold alarm",
      });
    } else if (segment.minTemp <= settings.minTempCaution) {
      triggers.push({
        type: "cold",
        level: "caution",
        icon: "❄",
        label: "Cold caution",
      });
    }
  }

  if (segment.maxTemp !== undefined) {
    if (segment.maxTemp >= settings.maxTempAlarm) {
      triggers.push({
        type: "heat",
        level: "alarm",
        icon: "🔥",
        label: "Heat alarm",
      });
    } else if (segment.maxTemp >= settings.maxTempCaution) {
      triggers.push({
        type: "heat",
        level: "caution",
        icon: "🔥",
        label: "Heat caution",
      });
    }
  }

  const hasAlarm = triggers.some((trigger) => trigger.level === "alarm");
  const hasCaution = triggers.some((trigger) => trigger.level === "caution");

  if (!triggers.length) {
    return {
      className: "segment-normal",
      label: "Normal",
      detail: "Within limits",
      triggers,
    };
  }

  return {
    className: hasAlarm ? "segment-alarm" : "segment-caution",
    label: hasAlarm ? "Alarm" : hasCaution ? "Caution" : "Normal",
    detail: triggers.map((trigger) => trigger.label).join(" • "),
    triggers,
  };
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
  const radiation = data.shortwave_radiation || [];

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
  const hourlyPoints = [];
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
    let maxRadiation = -Infinity;
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
      const rad = radiation[idx];

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
      if (rad !== undefined && rad > maxRadiation) maxRadiation = rad;

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
      maxRadiation: maxRadiation === -Infinity ? undefined : maxRadiation,
    });
  }

  for (let idx = start; idx < end; idx++) {
    hourlyPoints.push({
      date: new Date(times[idx]),
      gust: gusts[idx],
      temp: temps[idx],
      code: codes[idx],
      radiation: radiation[idx],
      timeClass: getSegmentTimeClass(new Date(times[idx])),
    });
  }

  // Draw risk row and time header row for the next 24h timeline.
  const symbolRow = document.getElementById("forecast24SymbolRow");

  if (symbolRow) {
    symbolRow.innerHTML = "<th>Risk</th>";
    segments.forEach((segment) => {
      const alertMeta = getSegmentAlertMeta(segment);
      const symbolCell = document.createElement("th");
      symbolCell.classList.add("symbol-cell");
      symbolCell.classList.add(segment.timeClass);
      symbolCell.classList.add(alertMeta.className);

      const iconMarkup = alertMeta.triggers.length
        ? alertMeta.triggers
            .map(
              (trigger) =>
                `<span class="risk-icon risk-${trigger.level}" title="${trigger.label}">${trigger.icon}</span>`,
            )
            .join("")
        : "";

      symbolCell.innerHTML = `<span class="risk-chip">${alertMeta.label}</span><span class="risk-icons">${iconMarkup}</span>`;
      symbolRow.appendChild(symbolCell);
    });
  }

  segments.forEach((segment) => {
    const dayText = `${getDayName(segment.date, "short")} ${segment.date.getDate()}`;
    const cell = document.createElement("th");
    cell.innerHTML = `<span class="time-day-tag">${dayText}</span><span class="time-range">${segment.label}</span>`;
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

  const conditionRow = rowDef("Weather");
  const tempRow = rowDef("Temp");
  const windAndGustRow = rowDef("Wind Gust");
  const solarRow = rowDef("Solar (W/m²)");

  segments.forEach((segment) => {
    const condCell = document.createElement("td");
    const description = WMO_DESCRIPTIONS[segment.code] || "—";
    condCell.setAttribute("title", description);
    condCell.innerHTML = `<span class="condition-icon" aria-label="${description}">${getWeatherIcon(
      segment.code,
      true,
    )}</span><span class="condition-label">${description}</span>`;
    condCell.classList.add("forecast-weather-cell");
    condCell.classList.add(segment.timeClass);
    conditionRow.appendChild(condCell);

    const tempCell = document.createElement("td");
    if (segment.minTemp !== undefined) {
      const minTempValue = Math.round(segment.minTemp);
      const maxTempValue = Math.round(segment.maxTemp);
      tempCell.textContent =
        minTempValue === maxTempValue
          ? `${minTempValue}°`
          : `${minTempValue}°-${maxTempValue}°`;
    } else {
      tempCell.textContent = "—";
    }
    tempCell.classList.add(segment.timeClass);
    tempRow.appendChild(tempCell);

    const windCell = document.createElement("td");
    if (segment.maxGust !== undefined) {
      const gustText = `${Math.round(segment.maxGust)} km/h`;
      const dirText =
        segment.gustDir !== undefined
          ? `${bearingArrow(segment.gustDir)} ${degToCompass(segment.gustDir)}`
          : "—";
      windCell.innerHTML = `<span class="wind-speed-line">${gustText}</span><span class="wind-direction-line">${dirText}</span>`;
    } else {
      windCell.textContent = "—";
    }
    windCell.classList.add(segment.timeClass);
    windAndGustRow.appendChild(windCell);

    const solarCell = document.createElement("td");
    const solarRating = getSolarRatingFromRadiation(
      segment.maxRadiation,
      segment.timeClass,
    );
    if (solarRating) {
      solarCell.innerHTML = `<span class="solar-label">${solarRating.label}</span><span class="solar-value">${solarRating.radiation} W/m²</span>`;
      solarCell.classList.add("solar-cell", solarRating.className);
    } else {
      solarCell.textContent = "—";
      solarCell.classList.add("solar-cell", "solar-na");
    }
    solarCell.classList.add(segment.timeClass);
    solarRow.appendChild(solarCell);
  });

  body24.append(conditionRow, tempRow, windAndGustRow, solarRow);

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
    const rad = radiation[i];

    if (!dayStats[dayKey]) {
      dayStats[dayKey] = {
        date: d,
        totalRadiation: 0,
        periods: {
          morning: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
            maxRadiation: -Infinity,
          },
          daytime: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
            maxRadiation: -Infinity,
          },
          evening: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
            maxRadiation: -Infinity,
          },
          night: {
            minTemp: Infinity,
            maxTemp: -Infinity,
            maxGust: -Infinity,
            bestCode: undefined,
            bestSeverity: -Infinity,
            maxGustDir: undefined,
            maxRadiation: -Infinity,
          },
        },
      };
    }

    const entry = dayStats[dayKey];
    if (rad !== undefined && rad >= 0) entry.totalRadiation += rad;
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
    if (rad !== undefined && rad > period.maxRadiation) {
      period.maxRadiation = rad;
    }
  }

  const summaryRows = Object.values(dayStats).sort((a, b) => a.date - b.date);
  updateLookaheadSummary(segments, hourlyPoints, summaryRows);

  const header = document.getElementById("forecastSummaryHeader");
  if (header) {
    header.innerHTML = "";
    const topRow = document.createElement("tr");
    const dayHeader = document.createElement("th");
    dayHeader.textContent = "Day";
    dayHeader.rowSpan = 2;
    topRow.appendChild(dayHeader);

    const riskHeader = document.createElement("th");
    riskHeader.textContent = "Risk";
    riskHeader.rowSpan = 2;
    topRow.appendChild(riskHeader);

    const groups = [
      { label: "Conditions", span: 4 },
      { label: "Temperature (min-max)", span: 4 },
      { label: "Max Wind Gusts", span: 4 },
      { label: "Solar Generation", span: 1 },
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
    const solarTh = document.createElement("th");
    solarTh.textContent = "Daily";
    subRow.appendChild(solarTh);

    header.append(topRow, subRow);
  }

  const summaryBuckets = ["morning", "daytime", "evening", "night"];

  if (!rowsSummary) return;
  if (!summaryRows.length) {
    const placeholder = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 14;
    cell.textContent = "Forecast summary unavailable.";
    placeholder.appendChild(cell);
    rowsSummary.appendChild(placeholder);
    return;
  }

  summaryRows.forEach((entry) => {
    const row = document.createElement("tr");
    const dayCell = document.createElement("td");
    dayCell.textContent = `${getDayName(entry.date, "short")} ${entry.date.getDate()}`;
    row.appendChild(dayCell);

    let dayMaxGust = -Infinity;
    let dayMinTemp = Infinity;
    let dayMaxTemp = -Infinity;
    summaryBuckets.forEach((bucket) => {
      const period = entry.periods[bucket];
      if (!period) return;
      if (period.maxGust !== -Infinity)
        dayMaxGust = Math.max(dayMaxGust, period.maxGust);
      if (period.minTemp !== Infinity)
        dayMinTemp = Math.min(dayMinTemp, period.minTemp);
      if (period.maxTemp !== -Infinity)
        dayMaxTemp = Math.max(dayMaxTemp, period.maxTemp);
    });

    const riskMeta = getSegmentAlertMeta({
      maxGust: dayMaxGust === -Infinity ? undefined : dayMaxGust,
      minTemp: dayMinTemp === Infinity ? undefined : dayMinTemp,
      maxTemp: dayMaxTemp === -Infinity ? undefined : dayMaxTemp,
    });

    const riskTriggers = [...riskMeta.triggers];
    const dailySolarForRisk = getDailySolarRating(entry.totalRadiation);
    if (
      dailySolarForRisk &&
      (dailySolarForRisk.className === "solar-poor" ||
        dailySolarForRisk.className === "solar-fair")
    ) {
      riskTriggers.push({
        type: "solar",
        level: "caution",
        icon:
          dailySolarForRisk.className === "solar-poor" ? "☀️" : "🌤",
        label: `Solar ${dailySolarForRisk.label}`,
      });
    }

    const riskCell = document.createElement("td");
    riskCell.classList.add("summary-risk-cell");
    if (riskTriggers.length) {
      riskCell.innerHTML = `<span class="risk-icons">${riskTriggers
        .map(
          (trigger) =>
            `<span class="risk-icon risk-${trigger.level}" title="${trigger.label}">${trigger.icon}</span>`,
        )
        .join("")}</span>`;
    } else {
      riskCell.textContent = "—";
    }
    row.appendChild(riskCell);

    summaryBuckets.forEach((bucket) => {
      const cell = document.createElement("td");
      const period = entry.periods[bucket];
      if (period && period.bestCode !== undefined) {
        const title = WMO_DESCRIPTIONS[period.bestCode] || "—";
        cell.setAttribute("title", title);
        cell.innerHTML = `<span class="condition-icon" aria-label="${title}">${getWeatherIcon(
          period.bestCode,
          true,
        )}</span>`;
      } else {
        cell.textContent = "—";
      }
      row.appendChild(cell);
    });

    summaryBuckets.forEach((bucket) => {
      const cell = document.createElement("td");
      const period = entry.periods[bucket];
      if (
        period &&
        period.minTemp !== Infinity &&
        period.maxTemp !== -Infinity
      ) {
        const minT = Math.round(period.minTemp);
        const maxT = Math.round(period.maxTemp);
        cell.textContent = minT === maxT ? `${minT}` : `${minT}-${maxT}`;
        if (period.minTemp <= settings.minTempAlarm)
          cell.classList.add("forecast-alarm-cold");
        else if (period.minTemp <= settings.minTempCaution)
          cell.classList.add("forecast-caution-cold");
        else if (period.maxTemp >= settings.maxTempAlarm)
          cell.classList.add("forecast-alarm");
        else if (period.maxTemp >= settings.maxTempCaution)
          cell.classList.add("forecast-warning");
      } else {
        cell.textContent = "—";
      }
      row.appendChild(cell);
    });

    summaryBuckets.forEach((bucket) => {
      const cell = document.createElement("td");
      const period = entry.periods[bucket];
      if (period && period.maxGust !== -Infinity) {
        const speed = Math.round(period.maxGust);
        const dirText =
          period.maxGustDir !== undefined
            ? `${bearingArrow(period.maxGustDir)} ${degToCompass(period.maxGustDir)}`
            : "—";
        cell.innerHTML = `<span class="wind-speed-line">${speed} km/h</span><span class="wind-direction-line">${dirText}</span>`;
        if (period.maxGust >= settings.maxWindGustAlarm)
          cell.classList.add("forecast-alarm");
        else if (period.maxGust >= settings.maxWindGustCaution)
          cell.classList.add("forecast-warning");
      } else {
        cell.textContent = "—";
      }
      row.appendChild(cell);
    });

    const solarCell = document.createElement("td");
    const dailySolarRating = getDailySolarRating(entry.totalRadiation);
    if (dailySolarRating) {
      solarCell.innerHTML = `<span class="solar-label">${dailySolarRating.label}</span><span class="solar-value">${dailySolarRating.displayValue}</span>`;
      solarCell.classList.add("solar-cell", dailySolarRating.className);
    } else {
      solarCell.textContent = "—";
      solarCell.classList.add("solar-cell", "solar-na");
    }
    row.appendChild(solarCell);

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
      `&hourly=temperature_2m,weathercode,winddirection_10m,wind_speed_10m,windgusts_10m,relativehumidity_2m,shortwave_radiation` +
      `&forecast_days=7` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const c = data.current_weather;
    if (!c) throw new Error("No current weather in response");

    const hourly = data.hourly || {};
    const todayHumidity = hourly.relativehumidity_2m?.[0];
    const todayTemp = c.temperature;
    const todayWindSpeed = c.windspeed;
    const todayWindDir = c.winddirection;

    const desc = WMO_DESCRIPTIONS[c.weathercode] ?? `Code ${c.weathercode}`;
    const readableDesc = desc;
    setWeatherIconById("wxIcon", getWeatherIcon(c.weathercode, true));
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
    const radiationIndex = (hourly.time || []).findIndex((t) => t === c.time);
    const currentSolar =
      radiationIndex >= 0
        ? hourly.shortwave_radiation?.[radiationIndex]
        : undefined;
    setTextById(
      "wxSolar",
      currentSolar !== undefined && currentSolar !== null
        ? `${Math.round(currentSolar)} W/m²`
        : "—",
    );
    setTextById("updatedInfo", `Updated: ${c.time}`);

    // Forecast table (hourly + 6h steps) from hourly payload

    // Cache forecast data for settings changes
    window.cachedForecast = {
      time: hourly.time || [],
      temperature_2m: hourly.temperature_2m || [],
      weathercode: hourly.weathercode || [],
      windgusts_10m: hourly.windgusts_10m || [],
      winddirection_10m: hourly.winddirection_10m || [],
      wind_speed_10m: hourly.wind_speed_10m || [],
      shortwave_radiation: hourly.shortwave_radiation || [],
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
