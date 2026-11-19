// 各要素は{baseName, title, type, kml}(kmlは生のKML文字列)。baseNameは
// クリック時に各トラックのページ(photo-map/<baseName>.html。use_directory_urls: false
// のため<baseName>/index.htmlではない)へ遷移するために使う。
const tracks = JSON.parse(document.getElementById("tracks-data").textContent);

// 移動手段の種別(TrackStat.type)ごとに色分けする。"walking+train"のような
// 複合種別は、track_type_style.js(先に読み込み済み)のclassifyTrackByTypeで
// 速度から徒歩区間・乗り物区間を自動判定して描き分ける。

// ホバー中のトラックは種別色に関係なくシアン系で描き、zIndexで他のトラック
// より前面に出す。シアンはどの種別色(TRACK_TYPE_COLORS)とも被らない色として選んでいる。
const HOVER_STYLE = new ol.style.Style({
  stroke: new ol.style.Stroke({ color: "#00E5FF", width: 3 }),
  zIndex: 1,
});

const source = new ol.source.Vector();
const format = new ol.format.KML();
// 1トラックが複数のLineStringに分かれることがあるため、ホバー時は
// baseName単位でまとめて強調する。
const featuresByBaseName = new Map();
// 実際に描いた区間の種別(ベース種別のみ)。複合種別は徒歩と乗り物の色で
// 描き分けるので、凡例にも"Walking+Car"等ではなくそれぞれの種別を出す。
const drawnTypes = new Set();

tracks.forEach((track) => {
  const features = format.readFeatures(track.kml, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:4326",
  });
  for (const feature of features) {
    const geometry = feature.getGeometry();
    if (!geometry || geometry.getType() !== "LineString") continue;
    const { style, statsByType } = classifyTrackByType(geometry.getCoordinates(), track.type);
    for (const type of Object.keys(statsByType)) drawnTypes.add(type);
    feature.set("trackTitle", track.title);
    feature.set("trackBaseName", track.baseName);
    feature.set("baseStyle", style);
    feature.setStyle(style);
    source.addFeature(feature);
    if (!featuresByBaseName.has(track.baseName)) featuresByBaseName.set(track.baseName, []);
    featuresByBaseName.get(track.baseName).push(feature);
  }
});

const legend = document.getElementById("legend");
legend.innerHTML = BASE_TRACK_TYPES.filter((t) => drawnTypes.has(t.key))
  .map(
    (t) =>
      `<div><span class="swatch" style="background:${TRACK_TYPE_COLORS[t.key]}"></span>${t.label}</div>`,
  )
  .join("");

const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({ source: new ol.source.OSM() }),
    new ol.layer.Vector({ source: source }),
  ],
  view: new ol.View({ projection: "EPSG:4326", center: [0, 0], zoom: 2 }),
  controls: [new ol.control.Zoom(), new ol.control.Attribution()],
});

if (source.getFeatures().length > 0) {
  map.getView().fit(source.getExtent(), { size: map.getSize(), padding: [20, 20, 20, 20] });
}

const tooltip = document.getElementById("tooltip");
let hoveredBaseName = null;

function setHovered(baseName) {
  if (baseName === hoveredBaseName) return;
  for (const f of featuresByBaseName.get(hoveredBaseName) ?? []) f.setStyle(f.get("baseStyle"));
  for (const f of featuresByBaseName.get(baseName) ?? []) f.setStyle(HOVER_STYLE);
  hoveredBaseName = baseName;
}

map.on("pointermove", (evt) => {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f, { hitTolerance: 5 });
  setHovered(feature ? feature.get("trackBaseName") : null);
  if (!feature) {
    tooltip.style.display = "none";
    map.getTargetElement().style.cursor = "";
    return;
  }
  map.getTargetElement().style.cursor = "pointer";
  tooltip.textContent = feature.get("trackTitle");
  tooltip.style.display = "block";
  tooltip.style.left = evt.pixel[0] + "px";
  tooltip.style.top = evt.pixel[1] + "px";
});

// クリックしたトラックのページへ遷移する。このページ自体はdocs直下の
// iframe経由でAboutページに埋め込まれているため、window.topを操作して
// 埋め込み元のページごと遷移させる(相対パスはdocsルート、つまり
// window.topの現在のURLを基準に解決される)。
map.on("click", (evt) => {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);
  if (!feature) return;
  const baseName = feature.get("trackBaseName");
  if (!baseName) return;
  window.top.location.href = "photo-map/" + encodeURIComponent(baseName) + ".html";
});
