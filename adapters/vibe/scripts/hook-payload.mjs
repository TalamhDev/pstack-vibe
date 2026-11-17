import { readFileSync, statSync } from "node:fs";
import { isatty } from "node:tty";

/**
 * `isatty` rather than `process.stdin.isTTY`: touching the stdin stream puts
 * fd 0 into non-blocking mode, and the read below then races the writer.
 *
 * @returns {object | null}
 */
export function readPayload() {
  if (isatty(0)) return null;
  let text;
  try {
    text = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} object
 * @param {string} key
 * @returns {string}
 */
export function stringField(object, key) {
  if (object === null || typeof object !== "object") return "";
  const value = object[key];
  return typeof value === "string" ? value : "";
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
