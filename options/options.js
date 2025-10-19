(async function(){
  const defaults = {
    apiKey: "",
    apiBase: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    identityLine: "I'm Cooper, Boston College ’27, Human-Centered Engineering.",
    companyInterestTemplate: "Strong interest in {{company}}.",
    tone: "neutral",
    includeCompany: true
  };

  const stored = await chrome.storage.sync.get(defaults);
  const root = document.body;
  root.style.fontFamily = "system-ui";
  root.style.padding = "16px";

  function row(label, input, help="") {
    const div = document.createElement("div");
    div.style.marginBottom = "12px";
    const lab = document.createElement("div");
    lab.textContent = label;
    lab.style.fontSize = "12px";
    lab.style.color = "#6b7280";
    div.appendChild(lab);
    div.appendChild(input);
    if (help) {
      const H = document.createElement("div");
      H.textContent = help;
      H.style.fontSize = "12px";
      H.style.color = "#9ca3af";
      div.appendChild(H);
    }
    return div;
  }

  const key = document.createElement("input");
  key.type = "password"; key.style.width = "420px"; key.value = stored.apiKey;

  const base = document.createElement("input");
  base.type = "text"; base.style.width = "420px"; base.value = stored.apiBase;

  const model = document.createElement("input");
  model.type = "text"; model.style.width = "420px"; model.value = stored.model;

  const identity = document.createElement("input");
  identity.type = "text"; identity.style.width = "420px"; identity.value = stored.identityLine;

  const tmpl = document.createElement("input");
  tmpl.type = "text"; tmpl.style.width = "420px"; tmpl.value = stored.companyInterestTemplate;

  const tone = document.createElement("select");
  ["neutral","casual","formal"].forEach(t => {
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    if (t === stored.tone) opt.selected = true;
    tone.appendChild(opt);
  });

  const includeCompany = document.createElement("input");
  includeCompany.type = "checkbox"; includeCompany.checked = !!stored.includeCompany;

  const save = document.createElement("button");
  save.textContent = "Save";
  save.style.marginTop = "8px";

  const msg = document.createElement("div");
  msg.style.color = "#16a34a"; msg.style.marginTop = "8px";

  root.innerHTML = "<h2>LinkedIn Note Settings</h2>";
  root.appendChild(row("API Base", base, "Default: https://api.openai.com/v1 (you can swap to another compatible endpoint)"));
  root.appendChild(row("Model", model, "e.g., gpt-4o-mini (use any chat model your key can access)"));
  root.appendChild(row("API Key", key));
  root.appendChild(row("Identity line", identity));
  root.appendChild(row("Company interest template (use {{company}})", tmpl));
  root.appendChild(row("Tone", tone));

  const label = document.createElement("label");
  label.style.display = "flex"; label.style.alignItems = "center"; label.style.gap = "8px";
  label.appendChild(includeCompany);
  label.appendChild(document.createTextNode("Include company interest"));
  root.appendChild(label);

  root.appendChild(save);
  root.appendChild(msg);

  save.addEventListener("click", async () => {
    await chrome.storage.sync.set({
      apiKey: key.value.trim(),
      apiBase: base.value.trim() || defaults.apiBase,
      model: model.value.trim() || defaults.model,
      identityLine: identity.value.trim(),
      companyInterestTemplate: tmpl.value.trim(),
      tone: tone.value,
      includeCompany: includeCompany.checked
    });
    msg.textContent = "Saved ✓";
    setTimeout(() => msg.textContent = "", 1200);
  });
})();
