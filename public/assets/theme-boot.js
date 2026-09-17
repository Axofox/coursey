/* Applies the saved theme before first paint. Loaded synchronously in <head>
   of every page so there is no flash of the wrong theme. */
(function () {
  try {
    if (localStorage.getItem("coursehub-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark");
  } catch (e) {}
})();
