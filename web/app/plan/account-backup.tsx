"use client";

import { useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { useFollows } from "@/lib/follows";
import { mergeImportedPlans, readPlanStore, type PlanStore } from "@/lib/academics/plan-store";
import styles from "./planner.module.css";

function AccountActions({ store, replace, notice }: {
  store: PlanStore; replace: (store: PlanStore) => void; notice: (message: string) => void;
}) {
  const [revision, setRevision] = useState<number>();
  const [busy, setBusy] = useState(false);

  async function backup(save: boolean) {
    setBusy(true);
    try {
      let expected = revision;
      if (!save || expected === undefined) {
        const account = await apiGet<{ revision: number; data: unknown }>("/plans");
        expected = account.revision;
        if (account.data) {
          const loaded = readPlanStore(account.data);
          const existing = new Map(store.plans.map((plan) => [plan.id, JSON.stringify(plan)]));
          const incoming = { ...loaded, plans: loaded.plans.filter((plan) => existing.get(plan.id) !== JSON.stringify(plan)) };
          if (incoming.plans.length) {
            replace(mergeImportedPlans(store, incoming));
            setRevision(expected);
            notice("Loaded account plans. Conflicting versions were kept as separate plans.");
            return;
          }
        }
        setRevision(expected);
        if (!save) { notice(account.data ? "These account plans are already on this device." : "There are no account plans to load."); return; }
      }
      const result = await apiSend<{ revision: number }>("/plans", "PUT", { revision: expected, data: store });
      setRevision(result.revision);
      notice("Saved a backup to your account.");
    } catch (error) {
      notice(error instanceof Error && error.message.endsWith("409")
        ? "Your account backup changed. Load it and review the plans before saving."
        : "The account backup is unavailable. Your browser copy is still available.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.row}>
    <button type="button" disabled={busy} onClick={() => void backup(false)}>Load account backup</button>
    <button type="button" disabled={busy} onClick={() => void backup(true)}>Save account backup</button>
  </div>;
}

export function AccountBackup(props: Parameters<typeof AccountActions>[0]) {
  const { me } = useFollows();
  return me ? <AccountActions key={me.id} {...props} /> : null;
}
