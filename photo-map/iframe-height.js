// map.html側(priv/templates/mkdocs_map.html.eex)から届くpostMessageを
// 受けて、このページ(iframeの親)側の処理をする。file://で開いた場合でも
// 親子でoriginが揃うとは限らないため、window.frameElementのような
// 同一origin前提のDOM直接操作ではなくpostMessageを使っている
// (iframe自体・GLightboxとも同じ理由)。
let lightbox = null;

window.addEventListener("message", (event) => {
  if (!event.data) return;
  const frame = document.getElementById("photo-map-iframe");
  if (!frame || event.source !== frame.contentWindow) return;

  switch (event.data.type) {
    // KML(またはGPX等の将来の形式)を実際に読み込み終えた後、chartが
    // 付いたかどうかで自分の高さを教えてくれるので、それに合わせて
    // このiframe自体の高さを更新する。
    case "photo-map-iframe-height":
      frame.style.height = event.data.height + "px";
      break;
    // 写真(クリック時・歩行アニメーション中の自動表示とも)をiframeの
    // 中ではなくこの親ページ側でフルサイズ表示する(iframe内に収めると
    // 地図の高さ(450px固定)までしか表示できないため)。GLightboxは
    // zensical.tomlのextra_javascriptでdocs/assets/に同梱済みのものを
    // 全ページで先読みしており(写真ギャラリー用、extensions/gallery.py
    // 参照)、window.GLightboxとして既に使えるのでここではnewするだけ。
    case "photo-map-lightbox-open":
      openLightbox(event.data.photos, event.data.index || 0);
      break;
    case "photo-map-lightbox-goto":
      if (pendingOpen) {
        pendingOpen.index = event.data.index;
      } else if (lightbox && lightbox.lightboxOpen && !lightbox.closing) {
        lightbox.goToSlide(event.data.index);
      }
      break;
    case "photo-map-lightbox-close":
      pendingOpen = null;
      if (lightbox && lightbox.lightboxOpen && !lightbox.closing) lightbox.close();
      break;
  }
});

// GLightbox(3.3.1)のclose()は表示中スライドの退場アニメーションの
// animationendを待ってから後片付け(lightboxOpen/closingのリセット)をする。
// その途中でsetElements()/openAt()するとスライドのDOMが作り直されて
// 待っているanimationendが二度と来なくなり、closingがtrueのまま残る
// (以降のclose()は×ボタンも含めて全て無視され、写真が出たまま閉じなくなる)。
// 再生中は近接したwaypointが続くと、閉じた直後に次の写真を開く要求が
// すぐ来るため、閉じ終わる("close"イベント)まで開く要求を保留する。
let pendingOpen = null;

function openLightbox(photos, index) {
  if (!window.GLightbox) return;
  if (!lightbox) {
    lightbox = new window.GLightbox({ touchNavigation: true, loop: false });
    // "close"イベントはlightboxOpen/closingをリセットする直前に発火するため、
    // その場で開き直すとまだclosing中と判定されてしまう。次のタスクに回す。
    lightbox.on("close", () => {
      setTimeout(() => {
        if (!pendingOpen) return;
        const { photos, index } = pendingOpen;
        pendingOpen = null;
        openLightbox(photos, index);
      }, 0);
    });
  }
  if (lightbox.closing) {
    pendingOpen = { photos, index };
    return;
  }
  lightbox.setElements(photos.map((p) => ({ href: p.src, type: "image" })));
  // 既に開いている場合はsetElements()が先頭スライドを表示し直すので
  // open()は呼ばず(二重にbuild/イベント登録しない)、目的の位置へ送るだけ。
  if (lightbox.lightboxOpen) {
    if (index) lightbox.goToSlide(index);
  } else {
    lightbox.openAt(index);
  }
}
