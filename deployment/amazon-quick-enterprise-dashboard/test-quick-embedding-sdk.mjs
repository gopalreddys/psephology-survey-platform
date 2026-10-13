import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { isQuickEmbedUrl, sessionDeadline, statusForQuickError,
  platformQuickContentOptions } from "../../src/app/enterprise-dashboard/quick-embedding.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compiled = ts.transpileModule(await readFile(new URL(
  "../../src/app/enterprise-dashboard/QuickDashboardEmbed.tsx", import.meta.url
), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const url = "https://ap-south-1.quicksight.aws.amazon.com/embed/example?code=synthetic";
assert.equal(isQuickEmbedUrl(url), true);
for (const bad of ["http://ap-south-1.quicksight.aws.amazon.com/embed", "https://quicksight.aws.amazon.com.evil.test/", "https://user@ap-south-1.quicksight.aws.amazon.com/", "javascript:bad"]) assert.equal(isQuickEmbedUrl(bad), false);
assert.equal(statusForQuickError("Unauthorized"), "expired");
assert.equal(statusForQuickError("Forbidden"), "expired");
assert.equal(statusForQuickError("OTHER"), "error");
assert.equal(sessionDeadline("invalid", 120), null);
assert.equal(sessionDeadline("2026-10-13T00:00:00Z", 120), Date.parse("2026-10-13T02:00:00Z"));
assert.equal(platformQuickContentOptions.themeOptions.themeOverride.UIColorPalette.SecondaryBackground, "#FFF9F5");
assert.equal(platformQuickContentOptions.themeOptions.themeOverride.DataColorPalette, undefined, "semantic party colors are not overwritten");

const jsx = (type, props) => ({ type, props });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness({ failContext = false, pending = false, initialUrl = url } = {}) {
  const slots = [], effects = [], timers = new Map(), hosts = [], frames = [];
  let cursor = 0, timerId = 0, contextCount = 0, renewals = 0, release;
  const root = { children: [], replaceChildren(host) { this.children.forEach((old) => old.remove()); this.children = [host]; host.parent = this; } };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(value) { const index = cursor++; slots[index] ||= { value }; return [slots[index].value, (next) => { slots[index].value = next; }]; },
    useEffect(callback) { effects.push(callback); }
  };
  const context = { exports: {}, URL, Date, document: { createElement() {
    const host = { remove() { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); this.parent = null; },
      querySelector() { return { setAttribute: (name, value) => { host[name] = value; } }; } };
    hosts.push(host); return host;
  } }, setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }, require(key) {
      if (key === "react") return react;
      if (key === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (key === "lucide-react") return { AlertTriangle: "Icon", LoaderCircle: "Icon", RefreshCw: "Icon" };
      if (key === "./quick.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
      if (key === "./quick-embedding") return { isQuickEmbedUrl, sessionDeadline, statusForQuickError, platformQuickContentOptions };
      if (key === "amazon-quicksight-embedding-sdk") return { createEmbeddingContext: async () => {
        contextCount++; if (failContext) throw new Error("sensitive SDK error");
        return { async embedDashboard(frame, content) { frames.push({ frame, content });
          if (pending) await new Promise((resolve) => { release = resolve; });
        } };
      } };
      throw new Error(`Unexpected import ${key}`);
    } };
  runInNewContext(compiled, context);
  const render = () => { cursor = 0; const tree = context.exports.default({ embedUrl: initialUrl,
    issuedAt: "2026-10-13T00:00:00Z", sessionLifetimeMinutes: 120, onRenew: () => renewals++ });
    slots[0].current = root; return tree; };
  const find = (tree, predicate) => {
    if (Array.isArray(tree)) return tree.map((item) => find(item, predicate)).find(Boolean);
    if (!tree?.props) return null;
    return predicate(tree) ? tree : find(tree.props.children, predicate);
  };
  const cleanup = () => effects.shift()();
  return { root, hosts, frames, timers, render, find, cleanup,
    async mount() { const tree = render(); const stop = effects.shift()(); await tick(); return { tree, stop }; },
    async release() { release?.(); await tick(); },
    get contextCount() { return contextCount; }, get renewals() { return renewals; } };
}
const ui = harness();
const { stop } = await ui.mount();
assert.equal(ui.contextCount, 1);
assert.equal(ui.frames.length, 1);
assert.equal(ui.frames[0].frame.width, "100%");
assert.equal(ui.frames[0].frame.resizeHeightOnSizeChangedEvent, true);
assert.equal(ui.render().props["data-state"], "loading", "iframe mounted is not report ready");
ui.frames[0].content.onMessage({ eventName: "CONTENT_LOADED" });
assert.equal(ui.render().props["data-state"], "ready");
assert.equal(ui.hosts[0].title, "Survey reports — Amazon Quick");
ui.frames[0].content.onMessage({ eventName: "ERROR_OCCURRED", message: { errorCode: "Unauthorized" } });
assert.equal(ui.render().props["data-state"], "expired");
assert.equal(ui.root.children.length, 0, "expired frame is removed");
ui.find(ui.render(), (node) => node.type === "button").props.onClick();
assert.equal(ui.renewals, 1, "renewal requests a new API session, not replaying the consumed URL");
stop(); assert.equal(ui.timers.size, 0);
const late = harness({ pending: true });
const mounted = await late.mount(); mounted.stop(); await late.release();
assert.equal(late.root.children.length, 0, "late SDK work cannot remount an unmounted report");
late.frames[0].content.onMessage({ eventName: "CONTENT_LOADED" });
assert.equal(late.render().props["data-state"], "loading", "late event is ignored");
const timeout = harness(); const timeoutMount = await timeout.mount();
[...timeout.timers.values()].find((timer) => timer.delay === 60_000).callback();
assert.equal(timeout.render().props["data-state"], "error"); timeoutMount.stop();
const failure = harness({ failContext: true }); const failed = await failure.mount();
assert.equal(failure.render().props["data-state"], "error"); failed.stop();
const invalid = harness({ initialUrl: "https://evil.test" }); const invalidMount = await invalid.mount();
assert.equal(invalid.frames.length, 0); assert.equal(invalid.render().props["data-state"], "error"); invalidMount.stop();
console.log("Quick SDK responsive/theme, ready/error/expiry/timeout, renewal and async cleanup tests passed.");
