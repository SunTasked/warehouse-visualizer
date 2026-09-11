import type { PickingList, PickingStop } from "../types/simulation";

// Five lists covering the requested test cases (see specs.md §5.3): a
// simple single-pallet pick, the exact multi-trip/capacity-chaining example
// given in the request, a cross-building pick, a storing run, and a storing
// run that also crosses buildings.

const slot = (id: string): PickingStop => ({ kind: "slot", id });
const depot = (id: string): PickingStop => ({ kind: "depot", id });

export const pickingLists: PickingList[] = [
  {
    id: "quick-pick",
    label: "Quick pick",
    mode: "picking",
    stops: [slot("A02"), depot("DS01")],
  },
  {
    id: "full-batch-pick",
    label: "Full batch pick",
    mode: "picking",
    stops: [
      slot("A01"),
      slot("A04"),
      slot("B03"),
      depot("DS01"),
      slot("M03"),
      slot("N02"),
      depot("DS01"),
    ],
  },
  {
    id: "cross-building-pick",
    label: "Cross-building pick",
    mode: "picking",
    stops: [slot("N01"), slot("C02"), depot("DS01")],
  },
  {
    id: "restock",
    label: "Restock",
    mode: "storing",
    stops: [depot("DS01"), slot("A05"), slot("B05"), slot("N04")],
  },
  {
    id: "annex-restock",
    label: "Annex restock",
    mode: "storing",
    stops: [depot("DS01"), slot("C01"), slot("C02"), slot("C03")],
  },
];
