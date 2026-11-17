import { verify as composeVerify } from "./verify.mjs";
import { verifySessionContext } from "../scripts/mock-drive.mjs";

export { doctor } from "./doctor.mjs";

export function verify(options) {
  return composeVerify({ ...options, drive: verifySessionContext });
}
