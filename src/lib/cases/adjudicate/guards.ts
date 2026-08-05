// Spec §9.1 as a pure function, so it can have a test that fails when it is removed. A guard
// buried in an I/O runner cannot have one, and on a sibling branch that gap let a counter ship
// that could never fire.

// The whole measurement is "does an INDEPENDENT reader agree with the summarizer's citedPara".
// If the summarizer adjudicates, the answer is self-consistency and the report would present it
// as corroboration — the failure mode #228 was written to avoid, reintroduced one layer up.

// Bedrock model ids show up in several equivalent forms for the SAME model: a bare id
// ("meta.llama3-3-70b-instruct-v1:0"), a cross-region inference-profile id prefixed with a
// routing region ("us.meta.llama3-3-70b-instruct-v1:0"), and a full inference-profile ARN
// ("arn:aws:bedrock:us-east-1:111111111111:inference-profile/us.meta.llama3-3-70b-instruct-v1:0").
// Comparing with === lets `ADJ_JUDGE_MODEL=meta.llama3-3-70b-instruct-v1:0` — the summarizer's
// own id with the "us." prefix dropped — pass this guard while still naming the model under
// test: undetectable from the run's output, and a plausible accident rather than only a
// malicious one, since Bedrock ids appear in both forms in normal use. Spec §7 requires
// normalising before comparing (see `modelSlug` below), not an exact string match.
const REGION_PREFIXES = ["us-gov-west-1", "us-gov", "us", "eu", "apac", "au", "ca", "jp"];

function modelSlug(id: string): string {
  const trimmed = id.trim();
  // Undo an ARN path: keep only the segment after the last "/".
  const afterArn = trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed;
  // Undo a cross-region routing prefix, if present. A genuinely different model's slug does not
  // start with any of these + ".", so this step is a no-op for it and the two still differ.
  for (const prefix of REGION_PREFIXES) {
    if (afterArn.startsWith(prefix + ".")) return afterArn.slice(prefix.length + 1);
  }
  return afterArn;
}

export function assertJudgeIsNotSummarizer(judge: string, summarizer: string): void {
  if (modelSlug(judge) === modelSlug(summarizer)) {
    throw new Error(`the judge must not be the summarizer (${summarizer}) — it would be grading ` +
      `its own bookkeeping, and the result would be self-consistency presented as corroboration`);
  }
}
