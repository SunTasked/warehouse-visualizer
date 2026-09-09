import * as THREE from "three";
import type { Focus } from "../state/ViewFocusContext";

/**
 * View-mode drill-down emphasis: "full" for whatever's on the currently
 * focused path (Slot -> Sub-slot -> Pallet), "dim" for everything else. At
 * "overview" nothing is dimmed. Approved as an instant color swap (not an
 * animated fade) — see the "Focus/blur effect" question in this feature's
 * planning: "dim + desaturate ... instant/fast crossfade", no new
 * render-pipeline dependency.
 */
export type Emphasis = "full" | "dim";

const DIM_TARGET = new THREE.Color("#6b7280");
const DIM_MIX = 0.65;

export function slotEmphasis(focus: Focus, slotId: string): Emphasis {
  if (focus.level === "overview") return "full";
  return focus.slotId === slotId ? "full" : "dim";
}

export function subSlotEmphasis(focus: Focus, slotId: string, subSlotIndex: number): Emphasis {
  if (focus.level === "overview") return "full";
  if (focus.slotId !== slotId) return "dim";
  if (focus.level === "slot") return "full";
  return focus.subSlotIndex === subSlotIndex ? "full" : "dim";
}

export function palletEmphasis(
  focus: Focus,
  slotId: string,
  subSlotIndex: number,
  palletIndex: number,
): Emphasis {
  if (focus.level === "overview") return "full";
  if (focus.slotId !== slotId) return "dim";
  if (focus.level === "slot") return "full";
  if (focus.subSlotIndex !== subSlotIndex) return "dim";
  if (focus.level === "subslot") return "full";
  return focus.palletIndex === palletIndex ? "full" : "dim";
}

/** Whether anything is drilled into at all — walls dim for any non-overview focus. */
export function sceneEmphasis(focus: Focus): Emphasis {
  return focus.level === "overview" ? "full" : "dim";
}

export function emphasisColor(baseHex: string, emphasis: Emphasis): string {
  if (emphasis === "full") return baseHex;
  return `#${new THREE.Color(baseHex).lerp(DIM_TARGET, DIM_MIX).getHexString()}`;
}
