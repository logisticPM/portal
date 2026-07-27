import { type DocLoader, type LoadResult, UnsupportedDocumentError } from "./types";

export const textlayerLoader: DocLoader = {
  name: "textlayer",
  async load(): Promise<LoadResult> {
    throw new Error("textlayer loader not implemented yet (see Task 2)");
  },
};
