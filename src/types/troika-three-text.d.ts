// troika-three-text ships no type declarations (drei wraps it for its own
// <Text>); this covers the part Slots.tsx uses directly, for BatchedText.
declare module "troika-three-text" {
  import { Mesh } from "three";

  export class Text extends Mesh {
    text: string;
    fontSize: number;
    color: string | number;
    anchorX: number | "left" | "center" | "right";
    anchorY: number | "top" | "top-baseline" | "middle" | "bottom-baseline" | "bottom";
    sync(callback?: () => void): void;
    dispose(): void;
  }

  /** Renders every Text added to it in a single draw call. */
  export class BatchedText extends Text {
    addText(text: Text): void;
    removeText(text: Text): void;
  }
}
