// Shared by every site page: top bar state, nav highlight, scroll reveals.
(function () {
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Top bar border once the page scrolls.
  var bar = document.querySelector(".topbar");
  if (bar) {
    var onBar = function () { bar.classList.toggle("scrolled", window.scrollY > 8); };
    onBar();
    window.addEventListener("scroll", onBar, { passive: true });
  }

  // Nav: highlight the link whose section is on screen (and the link for the current page).
  var here = location.pathname.replace(/index\.html$/, "");
  document.querySelectorAll(".nav a").forEach(function (a) {
    var p = a.getAttribute("href");
    if (p && p.charAt(0) === "/" && p === here) a.setAttribute("aria-current", "page");
  });
  var spies = Array.prototype.slice.call(document.querySelectorAll(".nav a[data-spy]"));
  if (spies.length && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var link = document.querySelector('.nav a[data-spy="' + en.target.id + '"]');
        if (!link) return;
        if (en.isIntersecting) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-35% 0px -45% 0px" });
    spies.forEach(function (a) { var t = document.getElementById(a.getAttribute("data-spy")); if (t) io.observe(t); });
  }

  // Scroll reveals.
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var ro = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        en.target.dispatchEvent(new CustomEvent("revealed"));
        ro.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { ro.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); el.dispatchEvent(new CustomEvent("revealed")); });
  }
})();
