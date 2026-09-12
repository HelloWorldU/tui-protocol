import { prepareExample } from "../../../examples/streaming-text/prepare.ts";
import { createPtyHost } from "./vite.config.ts";

export default createPtyHost(prepareExample(), true);
