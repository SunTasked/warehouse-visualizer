import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type CameraControlsImpl from "camera-controls";
import { useEditor } from "./EditorContext";

export interface HoverPoint {
  slotId: string;
  /** Set when hovering a sub-slot's rack (at "slot" level) or a pallet tier (at "slot-space" level). */
  subSlotIndex?: number;
  /** Set only when hovering a pallet tier (at "slot-space" level). */
  palletIndex?: number;
  /** Page (client) coordinates, for positioning the HTML hover card. */
  x: number;
  y: number;
}

/** plant (whole map) -> warehouse (one building) -> slot -> slot-space -> pallet. */
export type FocusLevel = "plant" | "warehouse" | "slot" | "slot-space" | "pallet";

export interface Focus {
  level: FocusLevel;
  buildingId?: string;
  slotId?: string;
  subSlotIndex?: number;
  palletIndex?: number;
}

const PLANT: Focus = { level: "plant" };

interface ViewFocusContextValue {
  focus: Focus;
  focusWarehouse: (buildingId: string) => void;
  /** buildingId is the slot's resolved building (see src/lib/buildings.ts), if known. */
  focusSlot: (slotId: string, buildingId: string | undefined) => void;
  focusSlotSpace: (slotId: string, subSlotIndex: number, buildingId: string | undefined) => void;
  focusPallet: (
    slotId: string,
    subSlotIndex: number,
    palletIndex: number,
    buildingId: string | undefined,
  ) => void;
  /** Rolls back one drill-down level (pallet -> slot-space -> slot -> warehouse -> plant). */
  back: () => void;
  /** Jumps straight back to plant (the whole map) from any level. */
  reset: () => void;
  /** The slot currently under the pointer in view mode, and where to anchor its hover card. */
  hover: HoverPoint | null;
  setHover: (hover: HoverPoint | null) => void;
  cameraControlsRef: MutableRefObject<CameraControlsImpl | null>;
}

const ViewFocusContext = createContext<ViewFocusContextValue | null>(null);

export function ViewFocusProvider({ children }: { children: ReactNode }) {
  const { mode } = useEditor();
  const [focus, setFocus] = useState<Focus>(PLANT);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const cameraControlsRef = useRef<CameraControlsImpl | null>(null);

  const focusWarehouse = useCallback((buildingId: string) => {
    setFocus({ level: "warehouse", buildingId });
    setHover(null);
  }, []);

  const focusSlot = useCallback((slotId: string, buildingId: string | undefined) => {
    setFocus({ level: "slot", slotId, buildingId });
    setHover(null);
  }, []);

  const focusSlotSpace = useCallback(
    (slotId: string, subSlotIndex: number, buildingId: string | undefined) => {
      setFocus({ level: "slot-space", slotId, subSlotIndex, buildingId });
      setHover(null);
    },
    [],
  );

  const focusPallet = useCallback(
    (slotId: string, subSlotIndex: number, palletIndex: number, buildingId: string | undefined) => {
      setFocus({ level: "pallet", slotId, subSlotIndex, palletIndex, buildingId });
      setHover(null);
    },
    [],
  );

  const back = useCallback(() => {
    setFocus((current) => {
      if (current.level === "pallet") {
        return {
          level: "slot-space",
          slotId: current.slotId,
          subSlotIndex: current.subSlotIndex,
          buildingId: current.buildingId,
        };
      }
      if (current.level === "slot-space") {
        return { level: "slot", slotId: current.slotId, buildingId: current.buildingId };
      }
      if (current.level === "slot") return { level: "warehouse", buildingId: current.buildingId };
      if (current.level === "warehouse") return PLANT;
      return current;
    });
  }, []);

  const reset = useCallback(() => setFocus(PLANT), []);

  // Leaving view mode (toggling to edit) drops any drill-down state so it
  // doesn't linger stale for the next time view mode is entered.
  useEffect(() => {
    if (mode !== "view") setFocus(PLANT);
  }, [mode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      reset();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [reset]);

  const value = useMemo<ViewFocusContextValue>(
    () => ({
      focus,
      focusWarehouse,
      focusSlot,
      focusSlotSpace,
      focusPallet,
      back,
      reset,
      hover,
      setHover,
      cameraControlsRef,
    }),
    [focus, focusWarehouse, focusSlot, focusSlotSpace, focusPallet, back, reset, hover],
  );

  return <ViewFocusContext.Provider value={value}>{children}</ViewFocusContext.Provider>;
}

export function useViewFocus(): ViewFocusContextValue {
  const ctx = useContext(ViewFocusContext);
  if (!ctx) throw new Error("useViewFocus must be used within a ViewFocusProvider");
  return ctx;
}
