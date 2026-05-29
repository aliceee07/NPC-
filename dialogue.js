(function () {
  const D = window.NPCDialogue = window.NPCDialogue || {};

  window.DialogueState = D.publicApi.createPublicApi();

  function setupDialogue() {
    if (D.settings && typeof D.settings.setup === "function") {
      D.settings.setup();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupDialogue);
  } else {
    setupDialogue();
  }
})();
