"use strict";

const THEME_KEY = "kohat-banks-theme";
const KOHAT_BOUNDS = [[33.017, 70.997], [33.764, 72.007]];

const state = {
  points: [],
  markers: new Map(),
  activeId: null,
  picking: false,
  nearest: null
};

const $ = selector => document.querySelector(selector);
const form = $("#filters");
const resultsEl = $("#results");
const countEl = $("#result-count");
const mapArea = $(".map-area");

const escapeHtml = value =>
  String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const formatNumber = n => Number(n).toLocaleString("en-GB");
const formatDistance = m => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
const shortTehsil = name => (name || "").replace(/ Tehsil$/, "");
const kindLabel = type => (type === "ATM" ? "ATM" : "Bank branch");

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `The server answered ${response.status}.`);
  return body;
}

/* Theme */
const themeButton = $("#theme-toggle");
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () => document.documentElement.dataset.theme || (systemDark.matches ? "dark" : "light");

function syncThemeButton() {
  themeButton.setAttribute("aria-pressed", String(currentTheme() === "dark"));
  // Without a saved choice the icon follows the system theme, so it is set here instead of only in CSS.
  document.documentElement.dataset.theme = currentTheme();
}
themeButton.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
  syncThemeButton();
});
systemDark.addEventListener("change", () => {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
  if (!saved) {
    delete document.documentElement.dataset.theme;
    syncThemeButton();
  }
});
syncThemeButton();

$("#brand").addEventListener("click", event => {
  event.preventDefault();
  window.scrollTo({ top: 0 });
  history.replaceState(null, "", location.pathname);
});

/* Map */
// maxBounds is set after the first view: Leaflet cannot clamp a map that has no centre yet.
const map = L.map("map", { zoomSnap: 0.25, minZoom: 8, center: [33.39, 71.5], zoom: 9 });
map.fitBounds(KOHAT_BOUNDS, { padding: [12, 12] });
map.setMaxBounds([[32.4, 70.2], [34.4, 72.8]]);

const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);
const imagery = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 19,
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics"
});

const areaLayer = L.layerGroup().addTo(map);
const pointLayer = L.layerGroup().addTo(map);
const nearestLayer = L.layerGroup().addTo(map);

L.control.layers(
  { "Street map": streets, "Satellite": imagery },
  { "Banks and ATMs": pointLayer, "District and tehsils": areaLayer },
  { position: "topright" }
).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

const legend = L.control({ position: "bottomright" });
legend.onAdd = () => {
  const div = L.DomUtil.create("div", "legend");
  div.innerHTML = `
    <h3>Legend</h3>
    <ul>
      <li><span class="shape shape-branch" aria-hidden="true"></span>Bank branch</li>
      <li><span class="shape shape-atm" aria-hidden="true"></span>ATM</li>
      <li><span class="line" aria-hidden="true"></span>District boundary</li>
      <li><span class="line line-tehsil" aria-hidden="true"></span>Tehsil boundary</li>
      <li class="legend-nearest" hidden><span class="shape ring" aria-hidden="true"></span>Nearest search point</li>
    </ul>`;
  L.DomEvent.disableClickPropagation(div);
  return div;
};
legend.addTo(map);

function areaPopup(p) {
  return `
    <p class="popup-kind">${p.level}</p>
    <h3 class="popup-title">${escapeHtml(p.name)}</h3>
    <dl class="popup-grid">
      <dt>Population, 2023</dt><dd>${formatNumber(p.population_2023)}</dd>
      <dt>Area</dt><dd>${formatNumber(p.area_km2)} km²</dd>
      <dt>Banks and ATMs</dt><dd>${p.points}</dd>
    </dl>`;
}

async function loadStudyArea() {
  const data = await getJson("/api/study-area");
  const district = data.features.filter(f => f.properties.level === "District");
  const tehsils = data.features.filter(f => f.properties.level === "Tehsil");

  // Tehsils are filled (with no visible fill) so a click inside one opens its pop-up.
  L.geoJSON(tehsils, {
    style: { color: "#48484a", weight: 1.5, dashArray: "5 5", fill: true, fillOpacity: 0 },
    onEachFeature: (feature, layer) => {
      layer.on("click", event => {
        if (state.picking) return runNearest(event.latlng);
        L.popup().setLatLng(event.latlng).setContent(areaPopup(feature.properties)).openOn(map);
      });
    }
  }).addTo(areaLayer);
  L.geoJSON(district, { style: { color: "#1d1d1f", weight: 2.5, fill: false }, interactive: false }).addTo(areaLayer);

  renderTehsilTable(data.features);
}

function renderTehsilTable(features) {
  const district = features.find(f => f.properties.level === "District");
  if (district) {
    const el = document.querySelector(`[data-area="${district.properties.name}"]`);
    if (el) el.textContent = formatNumber(Math.round(district.properties.area_km2));
  }
  const rows = features
    .filter(f => f.properties.level === "Tehsil")
    .map(f => f.properties)
    .sort((a, b) => b.points - a.points || b.population_2023 - a.population_2023);
  $("#tehsil-rows").innerHTML = rows
    .map(t => `<tr><th scope="row">${escapeHtml(shortTehsil(t.name))}</th><td>${formatNumber(t.population_2023)}</td><td>${Number(t.area_km2).toLocaleString("en-GB", { minimumFractionDigits: 1 })}</td><td>${t.points}</td></tr>`)
    .join("");
}

function pointPopup(p) {
  const rows = [
    ["Bank", p.bank],
    ["Locality", p.locality],
    ["Tehsil", shortTehsil(p.tehsil)],
    ["Address", p.address],
    p.facility_type === "Branch" ? ["ATM on site", p.atm_on_site === true ? "Yes" : p.atm_on_site === false ? "No" : "Not listed"] : null,
    ["Phone", p.phone ? `<a href="tel:${p.phone.replace(/\s/g, "")}">${escapeHtml(p.phone)}</a>` : null, true],
    ["Hours", p.opening_hours],
    p.distance_m !== undefined ? ["Distance", formatDistance(p.distance_m)] : null
  ].filter(row => row && row[1]);
  const [lng, lat] = state.points.find(f => f.properties.id === p.id)?.geometry.coordinates ?? [];
  const checked = new Date(`${p.checked_on}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `
    <p class="popup-kind"><span class="shape shape-${p.facility_type === "ATM" ? "atm" : "branch"}" aria-hidden="true"></span>${kindLabel(p.facility_type)}</p>
    <h3 class="popup-title">${escapeHtml(p.name)}</h3>
    <dl class="popup-grid">
      ${rows.map(([label, value, isHtml]) => `<dt>${label}</dt><dd>${isHtml ? value : escapeHtml(value)}</dd>`).join("")}
      ${lat !== undefined ? `<dt>Coordinates</dt><dd>${lat.toFixed(5)}, ${lng.toFixed(5)}</dd>` : ""}
    </dl>
    <p class="popup-source">Source: ${escapeHtml(p.source)}, checked ${checked}</p>`;
}

// The visible symbol is 14 to 16 px, but the clickable box is 24 px so it meets WCAG 2.5.8.
function makeIcon(type, isNear) {
  const kind = type === "ATM" ? "atm" : "branch";
  return L.divIcon({
    className: `point-marker ${kind}${isNear ? " is-near" : ""}`,
    html: '<span class="symbol"></span>',
    iconSize: [24, 24],
    popupAnchor: [0, -10]
  });
}

function drawPoints(features) {
  pointLayer.clearLayers();
  state.markers.clear();
  const nearIds = new Set(state.nearest?.features.map(f => f.properties.id));
  for (const feature of features) {
    const p = feature.properties;
    const [lng, lat] = feature.geometry.coordinates;
    const marker = L.marker([lat, lng], {
      icon: makeIcon(p.facility_type, nearIds.has(p.id)),
      title: p.name,
      // Keyboard users get the same pop-ups from the result list, one tab stop per point.
      keyboard: false,
      riseOnHover: true
    });
    marker.bindPopup(() => pointPopup({ ...p, distance_m: state.nearest?.features.find(f => f.properties.id === p.id)?.properties.distance_m }));
    marker.on("popupopen", () => setActive(p.id));
    marker.on("popupclose", () => setActive(null));
    marker.addTo(pointLayer);
    state.markers.set(p.id, marker);
  }
}

function setActive(id) {
  state.activeId = id;
  for (const button of resultsEl.querySelectorAll(".result")) {
    button.classList.toggle("is-active", Number(button.dataset.id) === id);
  }
}

function renderList(features, { distances = false } = {}) {
  if (!features.length) {
    resultsEl.innerHTML = '<li class="results-empty">No points match these filters.</li>';
    return;
  }
  resultsEl.innerHTML = features
    .map(f => {
      const p = f.properties;
      const kind = p.facility_type === "ATM" ? "atm" : "branch";
      return `<li><button class="result" type="button" data-id="${p.id}">
        <span class="shape shape-${kind}" aria-hidden="true"></span>
        <strong>${escapeHtml(p.name)}</strong>
        <small>${escapeHtml(kindLabel(p.facility_type))} · ${escapeHtml(p.locality)}</small>
        ${distances ? `<span class="distance">${formatDistance(p.distance_m)}</span>` : ""}
      </button></li>`;
    })
    .join("");
}

resultsEl.addEventListener("click", event => {
  const button = event.target.closest(".result");
  if (!button) return;
  const marker = state.markers.get(Number(button.dataset.id));
  if (!marker) return;
  map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 0.6 });
  map.once("moveend", () => marker.openPopup());
  // Bring the whole map into view so the pop-up never opens under the sticky nav.
  if (window.matchMedia("(max-width: 900px)").matches) $("#map").scrollIntoView({ block: "center" });
  else $(".map-shell").scrollIntoView({ block: "nearest" });
});

/* Filters */
function filterParams() {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const key of ["q", "type", "bank", "tehsil"]) {
    const value = String(data.get(key) || "").trim();
    if (value) params.set(key, value);
  }
  return params;
}

let requestId = 0;
async function loadPoints() {
  const id = ++requestId;
  const params = filterParams();
  try {
    const data = await getJson(`/api/points?${params}`);
    if (id !== requestId) return; // a newer request has started
    state.points = data.features;
    clearNearest(false);
    drawPoints(data.features);
    renderList(data.features);
    const total = Number($('[data-stat="points"]').textContent) || data.features.length;
    countEl.textContent = params.size
      ? `${data.features.length} of ${total} points match`
      : `${data.features.length} points from the database`;
  } catch (error) {
    countEl.textContent = `Could not load points. ${error.message}`;
    resultsEl.innerHTML = "";
  }
}

let typingTimer;
form.addEventListener("input", event => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(loadPoints, event.target.type === "search" ? 250 : 0);
});
form.addEventListener("submit", event => event.preventDefault());
form.addEventListener("reset", () => {
  setPicking(false);
  setTimeout(() => {
    loadPoints();
    map.fitBounds(KOHAT_BOUNDS, { padding: [12, 12] });
  });
});

/* Nearest search */
const nearestButton = $("#nearest-toggle");
const hint = $("#map-hint");

function setPicking(on) {
  state.picking = on;
  nearestButton.setAttribute("aria-pressed", String(on));
  hint.hidden = !on;
  mapArea.classList.toggle("is-picking", on);
  if (on) map.closePopup();
}

nearestButton.addEventListener("click", () => {
  setPicking(!state.picking);
  if (state.picking) countEl.textContent = "Click the map to choose a point";
});

function clearNearest(redraw = true) {
  nearestLayer.clearLayers();
  document.querySelector(".legend-nearest")?.toggleAttribute("hidden", true);
  if (!state.nearest) return;
  state.nearest = null;
  if (redraw) {
    drawPoints(state.points);
    renderList(state.points);
  }
}

// Called from the map and from the tehsil polygons, because a click on a polygon does not reach the map.
async function runNearest({ lat, lng }) {
  if (!state.picking) return;
  setPicking(false);
  countEl.textContent = "Searching the database";
  const params = new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6), limit: 3 });
  const filters = filterParams();
  for (const key of ["type", "bank"]) if (filters.get(key)) params.set(key, filters.get(key));
  const what = { Branch: "branches", ATM: "ATMs" }[filters.get("type")] || "points";
  try {
    const data = await getJson(`/api/nearest?${params}`);
    if (!data.features.length) {
      countEl.textContent = "No points match these filters.";
      return;
    }
    nearestLayer.clearLayers();
    state.nearest = data;
    // Nearest search covers every point, so make sure the markers it returns are on the map.
    const shown = new Set(state.points.map(f => f.properties.id));
    for (const f of data.features) if (!shown.has(f.properties.id)) state.points.push(f);
    drawPoints(state.points);

    const origin = L.circleMarker([lat, lng], { radius: 7, className: "nearest-origin", interactive: false });
    nearestLayer.addLayer(origin);
    for (const f of data.features) {
      const [plng, plat] = f.geometry.coordinates;
      nearestLayer.addLayer(L.polyline([[lat, lng], [plat, plng]], { className: "nearest-line", interactive: false }));
    }
    document.querySelector(".legend-nearest")?.toggleAttribute("hidden", false);

    renderList(data.features, { distances: true });
    const outside = data.query.inside_district ? "" : " This point is outside Kohat District.";
    const bankText = filters.get("bank") ? ` (${filters.get("bank")})` : "";
    countEl.textContent = `Nearest ${what}${bankText} to ${lat.toFixed(4)}, ${lng.toFixed(4)}.${outside}`;
    resultsEl.insertAdjacentHTML("beforeend", '<li><button class="text-button results-note" type="button" id="nearest-clear">Show all points again</button></li>');
    $("#nearest-clear").addEventListener("click", () => {
      clearNearest();
      loadPoints();
    });
    // Leave room for the legend in the bottom-right corner so the clicked point is never hidden under it.
    const legendBox = document.querySelector(".legend")?.getBoundingClientRect();
    map.fitBounds(L.latLngBounds([[lat, lng], ...data.features.map(f => [f.geometry.coordinates[1], f.geometry.coordinates[0]])]), {
      paddingTopLeft: [56, 56],
      paddingBottomRight: [(legendBox?.width ?? 0) + 24, (legendBox?.height ?? 0) + 24],
      maxZoom: 15
    });
  } catch (error) {
    countEl.textContent = `Nearest search failed. ${error.message}`;
  }
}

map.on("click", event => runNearest(event.latlng));

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && state.picking) setPicking(false);
});

/* Summary numbers and drop-downs */
async function loadSummary() {
  const summary = await getJson("/api/summary");
  for (const key of ["points", "branches", "atms", "banks"]) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = summary[key];
  }
  const bankSelect = $("#filter-bank");
  for (const row of summary.byBank) bankSelect.add(new Option(`${row.bank} (${row.total})`, row.bank));
  const tehsilSelect = $("#filter-tehsil");
  for (const row of summary.byTehsil) tehsilSelect.add(new Option(`${shortTehsil(row.tehsil)} (${row.points})`, row.tehsil));
}

async function loadVersions() {
  const health = await getJson("/api/health");
  $("#stack-versions").textContent = `PostgreSQL ${health.postgresql} with PostGIS ${health.postgis}`;
}

loadSummary().catch(() => {}).finally(loadPoints);
loadStudyArea().catch(error => console.warn("Study area:", error.message));
loadVersions().catch(() => {});
