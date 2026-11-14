// Loaded before the stylesheet paints, so a saved dark theme never flashes light first.
(function () {
  try {
    var saved = localStorage.getItem("kohat-banks-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch (e) {}
})();
