import type { Metadata } from "next";
import Planner from "./planner";

export const metadata: Metadata = { title: "Spring 2027 Planner | Big Red Radar" };

export default function PlanPage() {
  return <Planner />;
}
