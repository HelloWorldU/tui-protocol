// Imported first by styled-content.test.ts. Pi's theme builds emphasis through
// chalk, whose color level is detected at module load; the Node test runner
// pipes stdout and this environment sets NO_COLOR, which would strip bold and
// italic from the real renderer. Force truecolor SGR emission and pin the
// detected terminal capabilities so theme colors resolve as RGB values.
// pi-tui does not load chalk, so this import cannot race the assignment above.
process.env.FORCE_COLOR = "3";

import { setCapabilities } from "@earendil-works/pi-tui";

setCapabilities({ images: null, trueColor: true, hyperlinks: false });
