// 移動手段の種別一覧・既定値・色・区間分類ロジック(vanilla JS版)。
// assets/svelte/trackTypes.tsと同じ内容の独立コピー——mkdocs/zensicalエクスポート
// される静的ページ(mkdocs_map_viewer.js・mkdocs_overview_map_viewer.js)はビルド
// パイプラインを通さずCDN読み込みのolをグローバルとして使うため、ESMのtrackTypes.ts
// をそのままimportできない(MkdocsExport.@type_order/@type_labelsが独立コピーを
// 持っているのと同じ事情)。ロジックを変更する場合は両方を更新すること。
//
// このファイル自身はol.jsより後・map-viewer.js/overview-map-viewer.jsより前に
// <script>で読み込む想定(トップレベルのconst/functionは同じドキュメント内の
// 後続scriptから参照できる)。

const DEFAULT_TRACK_TYPE = "walking";

const TRACK_TYPE_COLORS = {
  walking: "#1267ff",
  car: "#228b22",
  train: "#ff8c00",
  bus: "#d81b60",
  ferry: "#795548",
  motorcycle: "#8e44ad",
  bicycle: "#00a3a3",
};

const BASE_TRACK_TYPES = [
  { key: "walking", label: "Walking" },
  { key: "car", label: "Car" },
  { key: "train", label: "Train" },
  { key: "bus", label: "Bus" },
  { key: "ferry", label: "Ferry" },
  { key: "motorcycle", label: "Motorcycle" },
  { key: "bicycle", label: "Bicycle" },
];

const TRACK_TYPES = [
  ...BASE_TRACK_TYPES,
  ...BASE_TRACK_TYPES.filter((t) => t.key !== "walking").map((t) => ({
    key: `walking+${t.key}`,
    label: `Walking+${t.label}`,
  })),
];

const TRACK_TYPE_LABELS = Object.fromEntries(TRACK_TYPES.map((t) => [t.key, t.label]));

function parseTrackType(type) {
  const key = TRACK_TYPES.some((t) => t.key === type) ? type : DEFAULT_TRACK_TYPE;
  const [first, second] = key.split("+");
  return second ? { mixed: true, vehicle: second } : { mixed: false, vehicle: first };
}

function trackTypeStrokeStyle(type, geometry) {
  const color = TRACK_TYPE_COLORS[type] ?? TRACK_TYPE_COLORS[DEFAULT_TRACK_TYPE];
  return new ol.style.Style({
    geometry: geometry,
    stroke: new ol.style.Stroke({ color: color, width: 3 }),
  });
}

// この速度(m/s)より速い区間を乗り物とみなす(時速10km)
const WALKING_SPEED_LIMIT = 10 / 3.6;

// GPSのぶれを均すため、前後この時間(ms)の平均速度で判定する
const SPEED_WINDOW = 30 * 1000;

// GPSロガーによっては、時刻(時分秒)は正しいのに日付だけが丸1日単位でずれた点が
// 混じる。隣の点との時刻差を丸何日か縮めるとこの時間(ms)以内に収まる場合は、
// 日付の誤りとみなして縮めた差を使う。
const DAY = 24 * 60 * 60 * 1000;
const MAX_DATE_FIX_GAP = 60 * 60 * 1000;

// それでも時刻が戻る箇所に置く空白(ms)。SPEED_WINDOWより十分大きければよい
const TIME_BREAK = 60 * 60 * 1000;

// 乗り物の区間に挟まれた、これより短い(m)徒歩の区間は信号待ちなどの停車とみなして
// 乗り物に含める(停車で乗り物の区間が細切れになり、下の判定で徒歩に戻されるのを防ぐ)。
const MIN_STOP_DISTANCE = 100;

// これより短い(m)乗り物の区間はGPSの飛びとみなして徒歩に戻す
const MIN_VEHICLE_DISTANCE = 500;

// 区間ごとに乗り物(true)か徒歩(false)かを判定する。
// coordsは[lon, lat, alt, timeMs]の配列、distancesはcoords間の距離(m、長さcoords.length-1)。
function classifyTrackSegments(coords, distances) {
  if (coords[0].length < 4) return distances.map(() => false);
  const cumulative = [0];
  for (const distance of distances) {
    cumulative.push(cumulative[cumulative.length - 1] + distance);
  }
  // 時刻が戻ったまま窓を動かすと以降の速度がすべて0(徒歩)になるので、日付の
  // ずれを直し、それでも戻る所は窓に入らないほど大きな空白とみなして、
  // 単調増加の時刻に直して使う。補正後の時刻を次の点の基準にすると、
  // 直せなかった1点の誤りが以降へ連鎖するため、隣どうしの時刻差だけで判断する。
  const times = [coords[0][3]];
  for (let i = 1; i < coords.length; i++) {
    let dt = coords[i][3] - coords[i - 1][3];
    const fixed = dt - Math.round(dt / DAY) * DAY;
    if (fixed >= 0 && fixed <= MAX_DATE_FIX_GAP) dt = fixed;
    times.push(times[i - 1] + (dt >= 0 ? dt : TIME_BREAK));
  }
  const speeds = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < coords.length; i++) {
    while (times[i] - times[lo] > SPEED_WINDOW) lo++;
    hi = Math.max(hi, i);
    while (hi < coords.length - 1 && times[hi + 1] - times[i] <= SPEED_WINDOW) {
      hi++;
    }
    const from = Math.min(lo, Math.max(i - 1, 0));
    const to = Math.max(hi, Math.min(i + 1, coords.length - 1));
    const seconds = (times[to] - times[from]) / 1000;
    speeds.push(seconds > 0 ? (cumulative[to] - cumulative[from]) / seconds : 0);
  }
  const isVehicle = distances.map((_, i) => (speeds[i] + speeds[i + 1]) / 2 > WALKING_SPEED_LIMIT);
  for (let start = 0; start < isVehicle.length; ) {
    let end = start;
    while (end < isVehicle.length && isVehicle[end] === isVehicle[start]) end++;
    if (
      !isVehicle[start] &&
      start > 0 &&
      end < isVehicle.length &&
      cumulative[end] - cumulative[start] < MIN_STOP_DISTANCE
    ) {
      isVehicle.fill(true, start, end);
    }
    start = end;
  }
  for (let start = 0; start < isVehicle.length; ) {
    let end = start;
    while (end < isVehicle.length && isVehicle[end] === isVehicle[start]) end++;
    if (isVehicle[start] && cumulative[end] - cumulative[start] < MIN_VEHICLE_DISTANCE) {
      isVehicle.fill(false, start, end);
    }
    start = end;
  }
  return isVehicle;
}

function addElevationAndMax(stats, prevAlt, alt) {
  if (typeof alt === "number") {
    stats.maxElevationM = stats.maxElevationM == null ? alt : Math.max(stats.maxElevationM, alt);
    if (typeof prevAlt === "number" && alt > prevAlt) {
      stats.elevationGainM += alt - prevAlt;
    }
  }
}

function emptyTrackTypeStats() {
  return { distanceM: 0, elevationGainM: 0, maxElevationM: null };
}

// ルート(LineStringの座標列)の移動種別ごとのスタイルと、種別ごとの距離(m)・
// 獲得標高(m)・最高標高(m)を返す。徒歩＋乗り物のときは、徒歩と乗り物の区間
// ごとに色を分けたスタイルの配列になる。assets/svelte/trackTypes.tsの
// classifyTrackByTypeと同じロジック(そちらのコメント参照)。
function classifyTrackByType(coords, type) {
  const { mixed, vehicle } = parseTrackType(type);
  const statsByType = {};

  const distances = [];
  for (let i = 0; i < coords.length - 1; i++) {
    distances.push(
      ol.sphere.getDistance([coords[i][0], coords[i][1]], [coords[i + 1][0], coords[i + 1][1]]),
    );
  }

  if (!mixed || coords.length < 2) {
    const stats = emptyTrackTypeStats();
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) {
        stats.distanceM += distances[i - 1];
      }
      addElevationAndMax(stats, coords[i - 1] ? coords[i - 1][2] : undefined, coords[i][2]);
    }
    statsByType[vehicle] = stats;
    return { style: trackTypeStrokeStyle(vehicle), statsByType };
  }

  const isVehicle = classifyTrackSegments(coords, distances);
  const styles = [];
  let start = 0;
  for (let i = 1; i <= distances.length; i++) {
    if (i < distances.length && isVehicle[i] === isVehicle[start]) continue;
    const runType = isVehicle[start] ? vehicle : "walking";
    styles.push(trackTypeStrokeStyle(runType, new ol.geom.LineString(coords.slice(start, i + 1))));

    const stats = statsByType[runType] ?? emptyTrackTypeStats();
    for (let j = start; j < i; j++) {
      stats.distanceM += distances[j];
      addElevationAndMax(stats, coords[j][2], coords[j + 1][2]);
    }
    if (start === 0) {
      addElevationAndMax(stats, undefined, coords[start][2]);
    }
    statsByType[runType] = stats;

    start = i;
  }
  return { style: styles, statsByType };
}
