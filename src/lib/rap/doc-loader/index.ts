import { textractLoader } from "./textract";
import { textlayerLoader } from "./textlayer";
import type { DocLoader } from "./types";

export * from "./types";
export { buildTextFromLayoutBlocks } from "./textract";

// Explicit selection only. An unset or unrecognised DOC_LOADER is a deploy
// misconfiguration, and this project has been bitten twice by quiet defaults
// (empty DIGEST_* degrading email to "skipped"; pipeline.ts's bare
// runExtractionMock fallthrough serving fake extractions). Fail loudly here.
export function selectLoader(env: NodeJS.ProcessEnv = process.env): DocLoader {
  switch (env.DOC_LOADER) {
    case "textract":
      return textractLoader;
    case "textlayer":
      return textlayerLoader;
    default:
      throw new Error(
        `DOC_LOADER must be "textract" or "textlayer" (got ${JSON.stringify(env.DOC_LOADER)}). ` +
          "Set it explicitly in the deploy environment — there is no default.",
      );
  }
}
