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
  /** Page (client) coordinates, for positioning the HTML hover card. */
  x: number;
  y: number;
}

export type FocusLevel = "overview" | "slot" | "subslot" | "pallet";

export interface Focus {
  level: FocusLevel;
  slotId?: string;
  subSlotIndex?: number;
  palletIndex?: number;
}

const OVERVIEW: Focus = { level: "overview" };

interface ViewFocusContextValue {
  focus: Focus;
  focusSlot: (slotId: string) => void;
  focusSubSlot: (slotId: string, subSlotIndex: number) => void;
  focusPallet: (slotId: string, subSlotIndex: number, palletIndex: number) => void;
  /** Rolls back one drill-down level (pallet -> subslot -> slot -> overview). */
  back: () => void;
  /** Jumps straight back to overview from any level. */
  reset: () => void;
  /** The slot currently under the pointer in view mode, and where to anchor its hover card. */
  hover: HoverPoint | null;
  setHover: (hover: HoverPoint | null) => void;
  cameraControlsRef: MutableRefObject<CameraControlsImpl | null>;
}

const ViewFocusContext = createContext<ViewFocusContextValue | null>(null);

export function ViewFocusProvider({ children }: { children: ReactNode }) {
  const { mode } = useEditor();
  const [focus, setFocus] = useState<Focus>(OVERVIEW);
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const cameraControlsRef = useRef<CameraControlsImpl | null>(null);

  const focusSlot = useCallback((slotId: string) => {
    setFocus({ level: "slot", slotId });
    setHover(null);
  }, []);

  const focusSubSlot = useCallback((slotId: string, subSlotIndex: number) => {
    setFocus({ level: "subslot", slotId, subSlotIndex });
  }, []);

  const focusPallet = useCallback((slotId: string, subSlotIndex: number, palletIndex: number) => {
    setFocus({ level: "pallet", slotId, subSlotIndex, palletIndex });
  }, []);

  const back = useCallback(() => {
    setFocus((current) => {
      if (current.level === "pallet") return { level: "subslot", slotId: current.slotId, subSlotIndex: current.subSlotIndex };
      if (current.level === "subslot") return { level: "slot", slotId: current.slotId };
      if (current.level === "slot") return OVERVIEW;
      return current;
    });
  }, []);

  const reset = useCallback(() => setFocus(OVERVIEW), []);

  // Leaving view mode (toggling to edit) drops any drill-down state so it
  // doesn't linger stale for the next time view mode is entered.
  useEffect(() => {
    if (mode !== "view") setFocus(OVERVIEW);
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
      focusSlot,
      focusSubSlot,
      focusPallet,
      back,
      reset,
      hover,
      setHover,
      cameraControlsRef,
    }),
    [focus, focusSlot, focusSubSlot, focusPallet, back, reset, hover],
  );

  return <ViewFocusContext.Provider value={value}>{children}</ViewFocusContext.Provider>;
}

export function useViewFocus(): ViewFocusContextValue {
  const ctx = useContext(ViewFocusContext);
  if (!ctx) throw new Error("useViewFocus must be used within a ViewFocusProvider");
  return ctx;
}
