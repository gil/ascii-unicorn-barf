// App: instantiate the FluidAscii lib and bind a settings panel to its config.
const fx = new FluidAscii(".ambient-canvas");
const c = fx.config;

// Idle demo (app-only, not part of the lib).
const demo = new DemoCursor();
const demoState = { enabled: demo.enabled };

const sections = [
  {
    title: "Fluid",
    controls: [
      { obj: c, key: "velocityDissipation", label: "Velocity decay", min: 0.9, max: 1, step: 0.001 },
      { obj: c, key: "dyeDissipation", label: "Dye decay", min: 0.9, max: 1, step: 0.001 },
      { obj: c, key: "curl", label: "Curl (swirl)", min: 0, max: 50, step: 1 },
      { obj: c, key: "pressureIterations", label: "Pressure iters", min: 1, max: 50, step: 1 },
      { obj: c, key: "pressureClear", label: "Pressure clear", min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: "Mouse splat",
    controls: [
      { obj: c, key: "splatForce", label: "Force", min: 0, max: 10000, step: 100 },
      { obj: c, key: "splatRadius", label: "Radius", min: 0.0005, max: 0.02, step: 0.0005 },
      { obj: c, key: "splatDyeStrength", label: "Dye strength", min: 0.5, max: 6, step: 0.1 },
      { obj: c, key: "clickMultiplier", label: "Drag multiplier", min: 1, max: 5, step: 0.5 },
    ],
  },
  {
    title: "Click ripple",
    controls: [
      { obj: c, key: "rippleForce", label: "Force", min: 0, max: 20000, step: 500 },
      { obj: c, key: "rippleDye", label: "Dye strength", min: 0, max: 5, step: 0.25 },
      { obj: c, key: "rippleRings", label: "Rings", min: 1, max: 10, step: 1 },
      { obj: c, key: "rippleRingStep", label: "Ring spacing", min: 0.01, max: 0.15, step: 0.005 },
    ],
  },
  {
    title: "Render",
    controls: [
      { obj: c, key: "fontSize", label: "Font size", min: 8, max: 28, step: 1 },
      { obj: c, key: "densityThreshold", label: "Ink threshold", min: 0, max: 0.2, step: 0.005 },
      { obj: c, key: "hueOffset", label: "Hue rotate", min: 0, max: 360, step: 5 },
      { obj: c, key: "saturationBase", label: "Saturation", min: 0, max: 100, step: 5 },
      { obj: c, key: "lightnessBase", label: "Brightness", min: 0, max: 60, step: 5 },
    ],
  },
  {
    title: "Ink color",
    controls: [
      {
        type: "select", obj: c, key: "colorMode", label: "Mode",
        options: [{ value: "random", label: "Random" }, { value: "fixed", label: "Fixed" }],
      },
      { obj: c, key: "colorHue", label: "Fixed hue", min: 0, max: 360, step: 5, enabledWhen: () => c.colorMode === "fixed" },
    ],
  },
  {
    title: "Demo",
    controls: [
      { type: "checkbox", obj: demoState, key: "enabled", label: "Play when idle" },
    ],
  },
];

createSettingsPanel(sections, {
  onChange: (ctrl) => {
    if (ctrl.obj === demoState) demo.setEnabled(demoState.enabled);
  },
  onReset: () => fx.reset(),
});
