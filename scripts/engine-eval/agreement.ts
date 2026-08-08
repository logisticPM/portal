// scripts/engine-eval/agreement.ts
import { tokenSet, jaccard } from "./util";

export interface EngineCommitments { engine: string; actions: string[] }
export interface AgreementReport {
  unionSize: number;
  perEngine: { engine: string; found: number; corroborated: number }[];
}

interface Cluster { engines: Set<string>; sig: Set<string>; members: { engine: string; idx: number }[] }

export function computeAgreement(engines: EngineCommitments[], simThreshold = 0.6): AgreementReport {
  const clusters: Cluster[] = [];
  for (const e of engines) {
    e.actions.forEach((action, idx) => {
      const sig = tokenSet(action);
      let hit = clusters.find((c) => jaccard(c.sig, sig) >= simThreshold);
      if (!hit) { hit = { engines: new Set(), sig, members: [] }; clusters.push(hit); }
      hit.engines.add(e.engine);
      hit.members.push({ engine: e.engine, idx });
    });
  }
  const perEngine = engines.map((e) => {
    const found = e.actions.length;
    const corroborated = clusters.filter((c) => c.engines.size >= 2 && c.engines.has(e.engine)).length;
    return { engine: e.engine, found, corroborated };
  });
  return { unionSize: clusters.length, perEngine };
}
