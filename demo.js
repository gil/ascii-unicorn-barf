// DemoCursor — app-only idle "attract" mode. Simulates a mouse wandering the
// page (varying speed, occasional clicks) by dispatching synthetic pointer
// events, which the FluidAscii lib picks up like a real cursor.
//
// Synthetic events are isTrusted:false, so real user input (isTrusted:true)
// pauses the demo; it resumes when the pointer leaves the page.
class DemoCursor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.active = false;
    this.raf = 0;
    this.pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.seg = null;
    this.dwellUntil = 0;
    this.clickTimers = [];
    this.segsSinceClick = 0;
    this.segsBeforeClick = this._nextClickGap();

    this._loop = this._loop.bind(this);
    this._onRealInput = this._onRealInput.bind(this);
    this._onLeave = this._onLeave.bind(this);

    window.addEventListener("pointermove", this._onRealInput, true);
    window.addEventListener("pointerdown", this._onRealInput, true);
    document.addEventListener("mouseleave", this._onLeave);
    document.addEventListener("mouseout", (e) => {
      if (!e.relatedTarget && !e.toElement) this._onLeave();
    });

    if (this.enabled) this.start();
  }

  start() {
    if (this.active || !this.enabled) return;
    this.active = true;
    this.seg = null;
    this.dwellUntil = 0;
    this.raf = requestAnimationFrame(this._loop);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.clickTimers.forEach((t) => clearTimeout(t));
    this.clickTimers = [];
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.start();
    else this.stop();
  }

  _onRealInput(e) {
    if (e.isTrusted && this.active) this.stop();
  }

  _onLeave() {
    if (this.enabled) this.start();
  }

  _dispatchMove(x, y) {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
  }

  _dispatchClick(x, y) {
    window.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, bubbles: true }));
    const t = setTimeout(() => {
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: x, clientY: y, bubbles: true }));
    }, 90);
    this.clickTimers.push(t);
  }

  _nextClickGap() {
    return 3 + Math.floor(Math.random() * 5); // 3-7 moves between clicks
  }

  _randomPoint() {
    const mx = window.innerWidth * 0.06;
    const my = window.innerHeight * 0.08;
    return {
      x: mx + Math.random() * (window.innerWidth - 2 * mx),
      y: my + Math.random() * (window.innerHeight - 2 * my),
    };
  }

  _newSegment(now) {
    const p0 = this.pos;
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    let p2;
    do {
      p2 = this._randomPoint();
    } while (Math.hypot(p2.x - p0.x, p2.y - p0.y) < diag * 0.25);
    const p1 = this._randomPoint(); // control point → organic curved path
    const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
    const speed = 250 + Math.random() * 700; // px/s, varies per segment
    const dur = Math.max(0.4, Math.min(2.6, dist / speed)) * 1000;
    this.seg = { p0, p1, p2, start: now, dur };
  }

  _loop(now) {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this._loop);
    if (now < this.dwellUntil) return;
    if (!this.seg) this._newSegment(now);

    const s = this.seg;
    let t = (now - s.start) / s.dur;
    if (t > 1) t = 1;
    const e = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep → accel/decel
    const u = 1 - e;
    const x = u * u * s.p0.x + 2 * u * e * s.p1.x + e * e * s.p2.x;
    const y = u * u * s.p0.y + 2 * u * e * s.p1.y + e * e * s.p2.y;
    this.pos = { x, y };
    this._dispatchMove(x, y);

    if (t >= 1) {
      this.seg = null;
      this.segsSinceClick++;
      if (this.segsSinceClick >= this.segsBeforeClick) {
        this._dispatchClick(x, y);
        this.segsSinceClick = 0;
        this.segsBeforeClick = this._nextClickGap();
        this.dwellUntil = now + 250 + Math.random() * 400;
      } else {
        this.dwellUntil = now + Math.random() * 250;
      }
    }
  }
}
