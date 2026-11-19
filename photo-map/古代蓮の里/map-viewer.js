const mapData = JSON.parse(document.getElementById("map-data").textContent);
const kmlText = mapData.kml;
const photosByWaypoint = mapData.photos;
const iconsByWaypoint = mapData.icons;
const trackType = mapData.type;
const DEFAULT_ICON = "photo_camera";

// waypoint名には、以前のphotodbエクスポート機能(廃止済み)が付与した
// 末尾の"_<uuid>"が残っていることがある(レガシーデータ)。表示用には
// それを取り除く(photosByWaypoint/iconsByWaypointのキーは生の名前の
// ままなので、マッチングには使わない)。
function displayName(name) {
  const i = name.lastIndexOf("_");
  return i === -1 ? name : name.slice(0, i);
}

// アイコン画像はエクスポート時にこのページと同じディレクトリの
// icons/<key>.svgへコピー済み(写真のimages/と同じ考え方。
// MkdocsExport.copy_used_icons!/2参照)。アイコンキーごとにStyleを
// キャッシュし、同じアイコンを使う複数のwaypointで使い回す。
const iconStyleCache = new Map();
function iconStyle(icon) {
  const key = icon || DEFAULT_ICON;
  let style = iconStyleCache.get(key);
  if (!style) {
    style = new ol.style.Style({
      image: new ol.style.Icon({
        anchor: [0.5, 0.5],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        // crossOriginは付けない: アイコンはこのページと同じディレクトリの
        // ローカルファイル(icons/<key>.svg)なので不要。file://で開いた場合、
        // originが"null"になりCORSモードのfetch自体がブロックされる
        // (`Access to image at 'file:///...' from origin 'null' has been
        // blocked by CORS policy`)ため、むしろ付けると読み込みに失敗する。
        src: `icons/${key}.svg`,
      }),
    });
    iconStyleCache.set(key, style);
  }
  return style;
}

function labelStyle(name) {
  return new ol.style.Style({
    text: new ol.style.Text({
      text: name,
      font: "bold 14px Arial,Verdana,Courier New",
      overflow: true,
      fill: new ol.style.Fill({ color: "#222" }),
      stroke: new ol.style.Stroke({ color: "#eee", width: 2 }),
      textAlign: "left",
      offsetX: 22,
    }),
  });
}

const source = new ol.source.Vector();
const format = new ol.format.KML({ extractStyles: true });
// 「エクスポートの地図に表示しない」設定のwaypoint(MkdocsExportの
// hidden_waypoint_names)は、読み込み直後に取り除く。描画だけでなく、
// 表示範囲のfitや再生アニメーション(接近時のズーム・写真表示)の
// 対象からも外すため。
const hiddenWaypoints = new Set(mapData.hidden || []);
const features = format
  .readFeatures(kmlText, {
    dataProjection: "EPSG:4326",
    featureProjection: "EPSG:4326",
  })
  .filter(
    (f) =>
      !(
        f.getGeometry() &&
        f.getGeometry().getType() === "Point" &&
        hiddenWaypoints.has(f.get("name") || "")
      ),
  );

for (const feature of features) {
  const geometry = feature.getGeometry();
  if (!geometry) continue;
  const type = geometry.getType();

  if (type === "LineString") {
    const { style } = classifyTrackByType(geometry.getCoordinates(), trackType);
    feature.setStyle(style);
    source.addFeature(feature);
  } else if (type === "Point") {
    const name = feature.get("name") || "";
    if (name.endsWith(". Km")) continue;
    feature.setStyle([iconStyle(iconsByWaypoint[name]), labelStyle(displayName(name))]);
    source.addFeature(feature);
  }
}

const map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({ source: new ol.source.OSM() }),
    new ol.layer.Vector({ source: source }),
  ],
  view: new ol.View({ projection: "EPSG:4326", center: [0, 0], zoom: 2 }),
  controls: [new ol.control.Zoom(), new ol.control.Attribution()],
});
map.getView().fit(source.getExtent(), { size: map.getSize(), padding: [40, 40, 40, 40], maxZoom: 16 });

// tracklog(高度付きのgx:Track由来LineString)がある場合だけ、
// 距離・高度の断面図をc3.jsで表示する。stroll.jsのChart/getTrackと
// 同じ考え方(区間ごとの距離を積算してdistance/elevationの列を作る)。
// timestampは<gx:Track>の<when>から来る4番目の座標成分(coord[3]、
// ミリ秒epoch)の区間差分。<when>は必須要素ではないため無い場合は
// nullのままにし、後段の再生アニメーションはcanAnimateがfalseになって
// 無効化される(assets/svelte/map.tsのgetTrackStatsと同じ前提)。
const tracks = [];
for (const feature of features) {
  const geometry = feature.getGeometry();
  if (!geometry || geometry.getType() !== "LineString") continue;
  const coords = geometry.getCoordinates();
  if (coords.length === 0 || coords[0].length < 3) continue;

  tracks.push({ distance: 0, timestamp: 0, coord: coords[0] });
  for (let i = 0; i < coords.length - 1; i++) {
    const distance = ol.sphere.getDistance(coords[i], coords[i + 1]);
    const hasTime = coords[i].length > 3 && coords[i + 1].length > 3;
    let timestamp = hasTime ? coords[i + 1][3] - coords[i][3] : null;
    // <when>が時系列順である前提が崩れている(逆順/重複KMLの編集ミスなど)場合、
    // 所要時間が負になり再生アニメーションのCSS transitionが不正な値になる。
    // <when>が無い場合と同様nullにして、canAnimateがfalseになり再生自体を
    // 無効化されるようにする(一部区間だけ壊れた状態での再生はサポートしない)。
    if (timestamp !== null && timestamp < 0) {
      console.warn(
        `[stroll] track point ${i + 1} has an out-of-order <when> timestamp ` +
          `(prev=${coords[i][3]}, next=${coords[i + 1][3]}, Δ=${timestamp}ms). ` +
          `Disabling playback animation for this track.`,
      );
      timestamp = null;
    }
    tracks.push({ distance: distance, timestamp: timestamp, coord: coords[i + 1] });
  }
}

// 全区間に時刻があるトラックだけ再生アニメーションを有効にする
// (一部区間だけ時刻ありという半端な状態はサポートしない)。
const canAnimate =
  tracks.length > 1 && tracks.slice(1).every((t) => typeof t.timestamp === "number");

if (tracks.length > 0) {
  document.body.classList.add("has-chart");
  map.updateSize();

  const chart = c3.generate({
    bindto: "#chart",
    padding: { top: 10, right: 10 },
    data: { x: "x", columns: [] },
    axis: {
      x: {
        type: "indexed",
        label: { text: "距離 (km)", position: "outer-center" },
        tick: {
          format: (v) => `${Math.round(v * 10) / 10}`,
          count: 20,
        },
      },
      y: { label: { text: "高度 (m)", position: "outer-middle" } },
    },
    legend: { show: false },
  });

  let total_distance = 0;
  const distance = [];
  const elevation = [];
  for (const track of tracks) {
    total_distance += track.distance;
    elevation.push(track.coord[2]);
    distance.push(Math.round((total_distance / 1000) * 100) / 100);
  }
  chart.load({
    columns: [["x"].concat(distance), ["高度"].concat(elevation)],
    done: () => setChartPoint(0),
  });
}

// 地図上のトラック線にマウスを合わせると、最も近いトラック点に
// 対応するチャート上の点を赤くする(stroll.jsのonPoint/handlePointerMoveと同じ考え方)。
// 再生アニメーション中はhandlePointerMove自体を外して、チャート上の点は
// 再生位置(setChartPoint)側だけが更新するようにする。
function setChartPoint(index) {
  d3.selectAll("#chart .c3-circle").style("fill", (data, i) =>
    i === index ? "red" : "transparent",
  );
}

function handlePointerMove(evt) {
  if (evt.dragging) return;
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f, {
    hitTolerance: 5,
  });
  if (!feature || feature.getGeometry().getType() !== "LineString") return;

  let nearestIndex = 0;
  let minDiff = Infinity;
  for (let i = 0; i < tracks.length; i++) {
    const c = tracks[i].coord;
    const diff =
      Math.abs(c[0] - evt.coordinate[0]) + Math.abs(c[1] - evt.coordinate[1]);
    if (diff < minDiff) {
      minDiff = diff;
      nearestIndex = i;
    }
  }
  setChartPoint(nearestIndex);
}

if (tracks.length > 0) {
  map.on("pointermove", handlePointerMove);
}

// このページを埋め込む<iframe>(mkdocs_export.md.eex)の高さを、実際に
// chartが付いたかどうか(has-chartクラス、上のtracks.length>0判定)に
// 合わせて親ページに伝える。KMLのタグを見てchartの有無をElixir側で
// 事前に推測する(<gx:Track>限定など)と、gx:Track以外のトラック形式
// (今回の日光.kmlのような高度付きの素の<LineString>や、将来GPX等を
// 対応した場合)で判定がズレる。OpenLayersで実際にパースし終えた後の
// ここでなら、元データの形式に関わらずbody.scrollHeightがそのまま
// 正しい高さになる。window.frameElementで直接親のiframeを書き換える
// 方法だと、file://で開いた場合(親子とも"null" origin扱いになりうる)
// に親子が同一originと見なされずアクセスできないことがあるため、
// originを問わず届くpostMessageで親に高さを通知する
// (priv/templates/mkdocs_export.md.eexが受け取って反映する)。
if (window.parent !== window) {
  window.parent.postMessage(
    { type: "photo-map-iframe-height", height: document.body.scrollHeight },
    "*",
  );
}

// トラックログに沿ってさるのアイコンをアニメーション再生する
// (assets/svelte/stroll.jsのStrollMapの考え方の移植。ただしこのページは
// EPSG:4326のままなので、stroll.js側にあったEPSG:3857<->経緯度の変換は
// 不要)。距離/経過時間/速度の表示は、チャート分の高さを増やしたくない
// ため<style>の.stroll-hudで地図左下に重ねる(#map/#chartの高さは
// 上のpostMessageで自動的に合うため、高さが変わる要素を増やしたくない)。
if (canAnimate) {
  const SPEED = 120;
  const OFFSET = 32;
  // さるがwaypointに近づいたら地図を拡大する(stroll.jsのKmlMap.zoomInMap/
  // NEAR_MARKER_ZOOMと同じ考え方)。倍率は固定値とし、離れたら再生開始時の
  // ズーム(baseZoom、handleMoveEndで随時更新)に戻す。
  const ZOOM_IN_DISTANCE = 100; // メートル
  const START_ZOOM = 16; // さるクリック時にこのズームへ寄る(baseZoomの初期値にもなる)
  const NEAR_MARKER_ZOOM = 18; // START_ZOOMとの差でマーカー接近時に寄った感を出す
  const waypoints = features
    .filter((f) => f.getGeometry() && f.getGeometry().getType() === "Point")
    .map((f) => ({ name: f.get("name") || "", coord: f.getGeometry().getCoordinates() }))
    .filter((w) => !w.name.endsWith(". Km"));
  const zoomInMap = new Map();
  // waypointごとに「ZOOM_IN_DISTANCE以内に入り、かつ最も近づく」trackの
  // indexを記録する(ズームイン演出用)。
  const closestByWaypoint = new Map();
  // waypointごとの「ルート上で最も近づく」trackのindex(距離の上限なし)。
  // 写真表示のトリガーに使う — ZOOM_IN_DISTANCEより離れた場所に立てた
  // waypoint(GPSの揺れや、道から少し外れた展望台など)でも、ズームイン判定
  // とは関係なくルート上で一番近づいた瞬間に写真を見せたいため、別に計算する。
  const closestTrackIndexByWaypoint = new Map();
  for (const waypoint of waypoints) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < tracks.length; i++) {
      const d = ol.sphere.getDistance(tracks[i].coord, waypoint.coord);
      if (d <= ZOOM_IN_DISTANCE) {
        if (!zoomInMap.has(i)) zoomInMap.set(i, []);
        zoomInMap.get(i).push(waypoint);
        const closest = closestByWaypoint.get(waypoint.name);
        if (!closest || d < closest.distance) {
          closestByWaypoint.set(waypoint.name, { index: i, distance: d });
        }
      }
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
      }
    }
    closestTrackIndexByWaypoint.set(waypoint.name, bestIndex);
  }
  // 写真を持つwaypointを、ルート上で最も近づくtrack点のindexに割り当てる。
  // 複数のwaypointが同じindexに最も近づくこともあるため、index→waypoint配列
  // で持つ(indexの上書きで片方の写真だけが表示されなくなるのを防ぐため)。
  const photoTriggerIndex = new Map();
  for (const waypoint of waypoints) {
    if ((photosByWaypoint[waypoint.name] || []).length === 0) continue;
    const index = closestTrackIndexByWaypoint.get(waypoint.name);
    if (!photoTriggerIndex.has(index)) photoTriggerIndex.set(index, []);
    photoTriggerIndex.get(index).push(waypoint);
  }
  const hud = document.createElement("div");
  hud.className = "stroll-hud";
  document.getElementById("map").appendChild(hud);

  const elmSaru = document.createElement("img");
  elmSaru.src = "stroll/saru.png";
  elmSaru.className = "stroll-marker";
  const elmGoal = document.createElement("img");
  elmGoal.src = "stroll/saru-goal.png";
  elmGoal.className = "stroll-marker";

  const overlay = new ol.Overlay({ element: elmSaru, positioning: "center-center" });
  map.addOverlay(overlay);
  overlay.setPosition(tracks[0].coord);

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map((v) => v.toString().padStart(2, "0")).join(":");
  };
  // 値と単位を別々に返す([値, 単位])。数値の桁数が変わっても単位の
  // 表示位置がズレないよう、setHud側で数値部分だけを固定幅にするため。
  const distanceText = (d) => [Math.round((d / 1000) * 100) / 100, "km"];
  const elapsedText = (elapsed, speed) => [formatTime((elapsed * speed) / 1000), "hrs"];
  // 区間の実速度(km/h)。distanceはメートル、rawMsは<when>由来の実時間の
  // ミリ秒(SPEEDによる圧縮前の値)を渡す — 再生を何倍速にしても実際に
  // 歩いた速さの表示は変わらないようにするため。
  const speedText = (d, rawMs) => {
    if (!rawMs) return [0, "km/h"];
    return [Math.round((d / (rawMs / 1000)) * 3.6 * 10) / 10, "km/h"];
  };
  const statHtml = (icon, title, [value, unit]) =>
    `<span class="stroll-stat" title="${title}"><span class="stroll-icon">${icon}</span>` +
    `<span class="stroll-value"><span class="stroll-number">${value}</span><span class="stroll-unit">${unit}</span></span></span>`;
  const setHud = (d, t, s) => {
    hud.innerHTML =
      statHtml("📏", "Distance", d) + statHtml("⏱️", "Elapsed", t) + statHtml("⚡", "Speed", s);
  };

  let total_distance = 0;
  let total_time = 0;
  for (const track of tracks) {
    total_distance += track.distance;
    total_time += track.timestamp;
  }
  setHud(distanceText(total_distance), elapsedText(total_time, 1), ["Click to play", ""]);

  const isOutside = (coord) => {
    const mapSize = map.getSize();
    const innerSize = [mapSize[0] - OFFSET * 2, mapSize[1] - OFFSET * 2];
    const extent = map.getView().calculateExtent(innerSize);
    return (
      coord[0] >= extent[2] ||
      coord[0] <= extent[0] ||
      coord[1] >= extent[3] ||
      coord[1] <= extent[1]
    );
  };

  // TimeKeeper: requestAnimationFrameで経過時間を積算するだけの
  // 汎用タイマー(stroll.jsのTimeKeeperと同じ考え方)。callbackの戻り値の
  // 分だけ次フレームの経過時間をスキップできる(遠方へジャンプする間の
  // 一時停止に使う。下のtk.start参照)。
  function createTimeKeeper() {
    const STOPPED = 0;
    const PAUSED = 1;
    const RUNNING = 2;
    let callback;
    let ref;
    let prevTimestamp;
    let elapsed = 0;
    let state = STOPPED;
    let skipTime = 0;

    function loop(timestamp) {
      if (prevTimestamp === undefined) prevTimestamp = timestamp;
      timestamp += skipTime;
      elapsed += timestamp - prevTimestamp;
      skipTime += callback(Math.trunc(elapsed));
      prevTimestamp = timestamp;
      if (state === RUNNING) ref = requestAnimationFrame(loop);
    }

    return {
      start(cb) {
        if (state !== STOPPED) return;
        state = RUNNING;
        prevTimestamp = undefined;
        skipTime = 0;
        elapsed = 0;
        callback = cb;
        ref = requestAnimationFrame(loop);
      },
      resume() {
        if (state !== PAUSED) return;
        state = RUNNING;
        ref = requestAnimationFrame(loop);
      },
      pause() {
        if (state !== RUNNING) return;
        state = PAUSED;
        prevTimestamp = undefined;
        skipTime = 0;
        if (ref !== undefined) {
          cancelAnimationFrame(ref);
          ref = undefined;
        }
      },
      stop() {
        state = STOPPED;
        if (ref !== undefined) {
          cancelAnimationFrame(ref);
          ref = undefined;
        }
      },
      getElapsed: () => elapsed,
    };
  }

  const tk = createTimeKeeper();
  // waypointに最接近した瞬間、walkerを止めて写真を1枚ずつ順番に見せる
  // (/tmp/stroll.jsのdoStrollコールバックのqueue処理と同じ考え方。
  // 複数枚ある場合は先頭から順にPHOTO_DISPLAY_MSずつ表示して最後に閉じる)。
  // 同じtrack点が複数waypointの最接近点になることもあるため、waypoint配列
  // を受け取り、それぞれの写真をまとめて1つの列として順番に見せる。
  const PHOTO_DISPLAY_MS = 2000;
  const playPhotosThenAdvance = (waypointsHere, advanceToTrack) => {
    const photos = waypointsHere.flatMap((w) => photosByWaypoint[w.name] || []);
    if (photos.length === 0) {
      advanceToTrack();
      return;
    }
    tk.pause();
    // waypointの座標(地図の端寄り)にポップアップを出すと、ズームインで
    // マーカーが地図の端近くに来た時にポップアップ自体が地図の外へ
    // はみ出すことがあるため、常に地図の中心に表示する。
    const center = map.getView().getCenter();
    let i = 0;
    const showNext = () => {
      showPopup(photos[i].image_path, center, "center-center");
      i++;
      setTimeout(() => {
        if (i < photos.length) {
          showNext();
        } else {
          hidePopup();
          tk.resume();
          advanceToTrack();
        }
      }, PHOTO_DISPLAY_MS);
    };
    showNext();
  };
  let isRunning = false;
  let legFrom = tracks[0].coord;
  let legTo = tracks[0].coord;
  let legDuration = 0;
  let legStartElapsed = 0;
  let suppressMoveHandlers = false;
  let baseZoom = map.getView().getZoom();
  let isNearMarker = false;

  const legFraction = () => {
    if (legDuration <= 0) return 1;
    return Math.min(1, Math.max(0, (tk.getElapsed() - legStartElapsed) / legDuration));
  };
  const currentCoord = () => {
    const fraction = legFraction();
    return [
      legFrom[0] + (legTo[0] - legFrom[0]) * fraction,
      legFrom[1] + (legTo[1] - legFrom[1]) * fraction,
    ];
  };
  const handleMoveStart = () => {
    if (suppressMoveHandlers) return;
    elmSaru.parentNode.style.transition = "";
    overlay.setPosition(currentCoord());
    tk.pause();
  };
  const handleMoveEnd = () => {
    if (suppressMoveHandlers) return;
    if (isRunning) baseZoom = map.getView().getZoom();
    const remaining = legDuration * (1 - legFraction());
    elmSaru.parentNode.style.transition = remaining > 0 ? `all ${remaining}ms linear` : "";
    overlay.setPosition(legTo);
    tk.resume();
  };

  elmSaru.onclick = () => {
    if (isRunning) return;
    isRunning = true;
    map.un("pointermove", handlePointerMove);
    // クリックした瞬間に開始地点へ寄る(stroll.jsのelmKuma.onclickと同じ
    // 考え方)。この時点のズームをbaseZoomにする(以後ユーザーが手動で
    // ズームを変えればhandleMoveEndがそれを新しいbaseZoomに更新する)。
    map.getView().setCenter(tracks[0].coord);
    map.getView().setZoom(START_ZOOM);
    baseZoom = START_ZOOM;
    // ゴール到達後にリプレイした時、前回終了時点の値(ゴール地点の座標)が
    // 残らないよう区間状態を開始地点にリセットする。
    legFrom = tracks[0].coord;
    legTo = tracks[0].coord;
    legDuration = 0;
    legStartElapsed = 0;
    isNearMarker = false;
    hidePopup();
    let index = 0;
    let distance = 0;
    let timestamp = 0;
    let currentSpeedText = ["-", ""];

    tk.start((elapsed) => {
      // 距離/速度はadvanceToTrack内(区間が進んだ時)だけ更新し、経過時間
      // だけ毎フレーム更新する(stroll.jsのelmKuma.onclickと同じ考え方。
      // distance/speedを毎フレーム上書きすると区間の途中で表示が
      // リセットされてしまう)。
      setHud(distanceText(distance), elapsedText(elapsed, SPEED), currentSpeedText);
      if (timestamp <= elapsed) {
        if (index < tracks.length) {
          setChartPoint(index);
          const track = tracks[index];
          // track.timestampは<when>由来の実時間(ms)。再生(timestamp
          // アキュムレータ/CSS transition)はtk.elapsed(実時間)と直接
          // 比較するため、SPEED倍だけ圧縮したlegMsを使う。速度表示だけは
          // 圧縮前のtrack.timestampをそのまま渡して実際の歩行速度を出す
          // (ここをtrack.timestampのままにするとSPEED倍遅く進む上、
          // speedTextの分母も引きずられて速度が0近くに丸まっていた)。
          const advanceToTrack = () => {
            const legMs = track.timestamp / SPEED;
            distance += track.distance;
            timestamp += legMs;
            legFrom = legTo;
            legTo = track.coord;
            legDuration = legMs;
            legStartElapsed = elapsed;
            elmSaru.parentNode.style.transition = `all ${legMs}ms linear`;
            overlay.setPosition(track.coord);
            currentSpeedText = speedText(track.distance, track.timestamp);
            setHud(distanceText(distance), elapsedText(elapsed, SPEED), currentSpeedText);
            index++;
          };
          // waypointに近づいたら拡大し、離れたらbaseZoomに戻す
          // (stroll.jsのzoomInMap/NEAR_MARKER_ZOOMと同じ考え方)。今の
          // indexの100m圏内にwaypointがあるかどうかだけで判定する
          // (訪問済みかどうかは見ない。一度圏内→圏外→圏内と出入りしてから
          // 最接近するルートで、既訪問扱いにして最接近時のズームを
          // 取りこぼすことがあったため)。
          const zoomMarkers = zoomInMap.get(index) || [];
          const shouldZoomIn = zoomMarkers.length > 0;
          const zoomChanged = shouldZoomIn !== isNearMarker;
          const photoWaypoints = photoTriggerIndex.get(index);
          if (isOutside(track.coord) || zoomChanged) {
            isNearMarker = shouldZoomIn;
            suppressMoveHandlers = true;
            tk.pause();
            elmSaru.parentNode.style.transition = "";
            map.getView().setCenter(track.coord);
            if (zoomChanged) {
              map.getView().setZoom(shouldZoomIn ? NEAR_MARKER_ZOOM : baseZoom);
            }
            const onMoveEnd = () => {
              map.un("moveend", onMoveEnd);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  suppressMoveHandlers = false;
                  tk.resume();
                  if (photoWaypoints) {
                    playPhotosThenAdvance(photoWaypoints, advanceToTrack);
                  } else {
                    advanceToTrack();
                  }
                });
              });
            };
            map.on("moveend", onMoveEnd);
          } else if (photoWaypoints) {
            playPhotosThenAdvance(photoWaypoints, advanceToTrack);
          } else {
            advanceToTrack();
          }
        } else {
          hidePopup();
          elmSaru.parentNode.style.transition = "";
          overlay.setElement(elmGoal);
          elmGoal.onclick = () => {
            setChartPoint(0);
            overlay.setElement(elmSaru);
            overlay.setPosition(tracks[0].coord);
            setHud(distanceText(total_distance), elapsedText(total_time, 1), ["Click to play", ""]);
            map.getView().fit(source.getExtent(), { size: map.getSize(), padding: [40, 40, 40, 40], maxZoom: 16 });
          };
          map.un("movestart", handleMoveStart);
          map.un("moveend", handleMoveEnd);
          map.on("pointermove", handlePointerMove);
          tk.stop();
          isRunning = false;
        }
      }
      // 遠方へのジャンプでカメラをパンしている間はtk.pause()するため、
      // 6時間以上先にジャンプする区間だけはその間の経過時間をスキップする
      // (パン待ちのために実時間で6時間相当も止まらせないため。
      // stroll.jsのelmKuma.onclickと同じ考え方)。
      const hour = ((timestamp - elapsed) * SPEED) / 1000 / 3600;
      return hour >= 6 ? timestamp - elapsed : 0;
    });
    map.on("movestart", handleMoveStart);
    map.on("moveend", handleMoveEnd);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tk.resume();
    if (document.visibilityState === "hidden") tk.pause();
  });
}

const popup = document.getElementById("popup");
const popupOverlay = new ol.Overlay({ element: popup, positioning: "bottom-center" });
map.addOverlay(popupOverlay);

// クリック時のポップアップと、歩行アニメーション中にwaypointへ最接近した
// 時のポップアップ(playPhotosThenAdvance参照)の両方から使う共通関数。
// function宣言はホイスティングされるため、canAnimateブロック内から
// (ソース上はこの宣言より前に書かれていても)問題なく呼び出せる。
// positioningは"bottom-center"(coordの真上に吹き出しのように出す。
// クリック時のwaypoint直上表示向け)と"center-center"(画像自体の中心を
// coordに合わせる。地図中心に出す歩行アニメーション向け)を使い分ける。
function showPopup(imagePath, coord, positioning = "bottom-center") {
  popup.innerHTML = '<img src="' + encodeURI(imagePath) + '">';
  // .popupのtransformはwaypoint直上に吹き出しを出す前提で決め打ちされて
  // いるため(mkdocs_map.html.eex参照)、地図中心に画像の中心を合わせる
  // 場合はそれを上書きするpopup-centeredクラスを付け替える。
  popup.classList.toggle("popup-centered", positioning === "center-center");
  popup.style.display = "block";
  popupOverlay.setPositioning(positioning);
  popupOverlay.setPosition(coord);
}

function hidePopup() {
  popup.style.display = "none";
}

map.on("click", (evt) => {
  const feature = map.forEachFeatureAtPixel(evt.pixel, (f) => f);
  if (!feature || feature.getGeometry().getType() !== "Point") {
    hidePopup();
    return;
  }

  const name = feature.get("name") || "";
  const photos = photosByWaypoint[name] || [];
  if (!photos[0]) {
    hidePopup();
    return;
  }
  showPopup(photos[0].image_path, feature.getGeometry().getCoordinates());
});
