/**
 * Browser shim for Node.js "util" module.
 * @meshtastic/core imports { formatWithOptions, types } from "util"
 * which doesn't exist in browsers. This provides minimal stubs.
 */

// formatWithOptions(inspectOptions, format, ...args)
export function formatWithOptions(_options, format, ...args) {
  if (typeof format !== "string") return String(format);
  let i = 0;
  return format.replace(/%[sdjifoO%]/g, (match) => {
    if (match === "%%") return "%";
    if (i >= args.length) return match;
    const arg = args[i++];
    switch (match) {
      case "%s": return String(arg);
      case "%d": return Number(arg).toString();
      case "%i": return parseInt(arg, 10).toString();
      case "%f": return parseFloat(arg).toString();
      case "%j": try { return JSON.stringify(arg); } catch { return "[Circular]"; }
      case "%o":
      case "%O": try { return JSON.stringify(arg, null, 2); } catch { return "[Object]"; }
      default: return match;
    }
  });
}

// format(format, ...args) — same as formatWithOptions but without options
export function format(fmt, ...args) {
  return formatWithOptions({}, fmt, ...args);
}

// types — used by @meshtastic/core for buffer checks
export const types = {
  isTypedArray(value) {
    return ArrayBuffer.isView(value) && !(value instanceof DataView);
  },
  isUint8Array(value) {
    return value instanceof Uint8Array;
  },
  isArrayBuffer(value) {
    return value instanceof ArrayBuffer;
  },
};

// inspect stub
export function inspect(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

// inherits stub
export function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

// deprecate stub
export function deprecate(fn) { return fn; }
