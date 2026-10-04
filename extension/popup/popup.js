(function () {
  var toggle = document.getElementById("toggle");
  var status = document.getElementById("status");

  function render(on) {
    toggle.checked = !!on;
    toggle.disabled = false;
    status.textContent = on ? "Aktiv" : "Aus";
    document.body.dataset.on = on ? "1" : "0";
  }

  function readEnabled(result) {
    if (!result || !Object.prototype.hasOwnProperty.call(result, "enabled")) return true;
    return result.enabled !== false;
  }

  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    status.textContent = "Speicher nicht verfügbar";
    toggle.disabled = true;
    return;
  }

  chrome.storage.local.get("enabled", function (result) {
    render(readEnabled(result));
  });

  toggle.addEventListener("change", function () {
    var on = toggle.checked;
    render(on);
    chrome.storage.local.set({ enabled: on });
  });
})();
