// Test helper: FAKE_NOW=2026-11-02T10:00:00+05:30 node --import ./dev/fake-date.mjs --test …
// `new Date()` / Date.now() us waqt se shuru hote hain (aage badhte rehte hain), explicit dates waise hi.
const target = process.env.FAKE_NOW ? Date.parse(process.env.FAKE_NOW) : NaN;
if (Number.isFinite(target)) {
  const RealDate = Date;
  const offset = target - RealDate.now();
  class FakeDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = FakeDate;
}
