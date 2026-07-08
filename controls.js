// Generic schema-driven settings panel. Knows nothing about fluids.
// createSettingsPanel(sections, { onChange, onReset })
//   sections: [{ title, controls: [rangeCtrl | selectCtrl] }]
//   rangeCtrl:  { obj, key, label, min, max, step, resize?, enabledWhen? }
//   selectCtrl: { type: "select", obj, key, label, options: [{value,label}] }
const createSettingsPanel = (() => {
  function decimalsOf(step) {
    return (String(step).split(".")[1] || "").length;
  }

  function randomValue(ctrl) {
    if (ctrl.type === "select") {
      return ctrl.options[Math.floor(Math.random() * ctrl.options.length)].value;
    }
    const steps = Math.round((ctrl.max - ctrl.min) / ctrl.step);
    const n = Math.floor(Math.random() * (steps + 1));
    const decimals = decimalsOf(ctrl.step);
    return parseFloat((ctrl.min + n * ctrl.step).toFixed(decimals));
  }

  function buildRange(ctrl, refreshers, onChange) {
    const row = document.createElement("label");
    row.className = "settings-row";

    const head = document.createElement("div");
    head.className = "settings-rowhead";
    const name = document.createElement("span");
    name.className = "settings-label";
    name.textContent = ctrl.label;
    const value = document.createElement("span");
    value.className = "settings-value";
    head.appendChild(name);
    head.appendChild(value);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = ctrl.min;
    slider.max = ctrl.max;
    slider.step = ctrl.step;

    const decimals = decimalsOf(ctrl.step);
    const sync = () => {
      const v = ctrl.obj[ctrl.key];
      slider.value = v;
      value.textContent = Number(v).toFixed(decimals);
      if (ctrl.enabledWhen) {
        const on = ctrl.enabledWhen();
        row.style.opacity = on ? "1" : "0.35";
        slider.disabled = !on;
      }
    };
    sync();
    refreshers.push(sync);

    slider.addEventListener("input", () => {
      ctrl.obj[ctrl.key] = parseFloat(slider.value);
      value.textContent = Number(slider.value).toFixed(decimals);
      onChange(ctrl);
    });

    row.appendChild(head);
    row.appendChild(slider);
    return row;
  }

  function buildCheckbox(ctrl, refreshers, onChange) {
    const row = document.createElement("label");
    row.className = "settings-row";
    const head = document.createElement("div");
    head.className = "settings-rowhead";
    const name = document.createElement("span");
    name.className = "settings-label";
    name.textContent = ctrl.label;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "settings-checkbox";
    head.appendChild(name);
    head.appendChild(box);
    row.appendChild(head);

    const sync = () => { box.checked = !!ctrl.obj[ctrl.key]; };
    sync();
    refreshers.push(sync);

    box.addEventListener("change", () => {
      ctrl.obj[ctrl.key] = box.checked;
      onChange(ctrl);
    });
    return row;
  }

  function buildSelect(ctrl, refreshers, onChange) {
    const row = document.createElement("label");
    row.className = "settings-row";
    const head = document.createElement("div");
    head.className = "settings-rowhead";
    const name = document.createElement("span");
    name.className = "settings-label";
    name.textContent = ctrl.label;

    const select = document.createElement("select");
    select.className = "settings-select";
    for (const opt of ctrl.options) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      select.appendChild(o);
    }
    head.appendChild(name);
    head.appendChild(select);
    row.appendChild(head);

    const sync = () => { select.value = ctrl.obj[ctrl.key]; };
    sync();
    refreshers.push(sync);

    select.addEventListener("change", () => {
      ctrl.obj[ctrl.key] = select.value;
      onChange(ctrl);
    });
    return row;
  }

  return function createSettingsPanel(sections, callbacks = {}) {
    const onChangeCb = callbacks.onChange || (() => {});
    const onResetCb = callbacks.onReset || (() => {});
    const refreshers = [];
    const randomizable = [];

    const refreshAll = () => refreshers.forEach((fn) => fn());
    const onChange = (ctrl) => {
      onChangeCb(ctrl);
      refreshAll(); // keep dependent enable/disable states in sync
    };

    const toggle = document.createElement("button");
    toggle.className = "settings-toggle";
    toggle.setAttribute("aria-label", "Settings");
    toggle.textContent = "⚙";

    const panel = document.createElement("div");
    panel.className = "settings-panel";

    const header = document.createElement("div");
    header.className = "settings-header";
    header.innerHTML = "<span>Parameters</span>";
    const actions = document.createElement("div");
    actions.className = "settings-actions";
    const randomBtn = document.createElement("button");
    randomBtn.className = "settings-btn";
    randomBtn.textContent = "Randomize";
    const resetBtn = document.createElement("button");
    resetBtn.className = "settings-btn";
    resetBtn.textContent = "Reset";
    actions.appendChild(randomBtn);
    actions.appendChild(resetBtn);
    header.appendChild(actions);
    panel.appendChild(header);

    for (const group of sections) {
      const section = document.createElement("div");
      section.className = "settings-group";
      const h = document.createElement("h3");
      h.textContent = group.title;
      section.appendChild(h);
      for (const ctrl of group.controls) {
        let row;
        if (ctrl.type === "select") row = buildSelect(ctrl, refreshers, onChange);
        else if (ctrl.type === "checkbox") row = buildCheckbox(ctrl, refreshers, onChange);
        else row = buildRange(ctrl, refreshers, onChange);
        if (ctrl.type !== "checkbox") randomizable.push(ctrl);
        section.appendChild(row);
      }
      panel.appendChild(section);
    }

    resetBtn.addEventListener("click", () => {
      onResetCb();
      refreshAll();
    });

    randomBtn.addEventListener("click", () => {
      for (const ctrl of randomizable) ctrl.obj[ctrl.key] = randomValue(ctrl);
      for (const ctrl of randomizable) if (ctrl.resize) onChangeCb(ctrl);
      refreshAll();
    });

    toggle.addEventListener("click", () => {
      panel.classList.toggle("open");
      toggle.classList.toggle("active");
    });

    document.body.appendChild(toggle);
    document.body.appendChild(panel);

    return { refresh: refreshAll };
  };
})();
