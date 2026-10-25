import { useState } from "react";
import { Key } from "@/icons";
import { ActivationDialog } from "@/components/account/ActivationDialog";
import { useLicense } from "@/stores/useLicenseStore";
import { isSignedIn, useAccountStore } from "@/stores/useAccountStore";
import { ToolbarButton } from "./ToolbarButton";

/**
 * Quiet header reminder while this computer isn't activated. Online features
 * otherwise just stop working, with nothing in view saying why. Neutral, never
 * red: red in the header means something is on screen. Renders nothing once
 * activated, signed out (onboarding owns that), or before the status loads.
 */
export default function ActivationChip(): React.ReactElement | null {
  const license = useLicense();
  const signedIn = useAccountStore((state) => isSignedIn(state.session));
  const [open, setOpen] = useState(false);
  if (!signedIn || !license || (license.activated && !open)) return null;
  return (
    <>
      <ToolbarButton
        label="Activate"
        title="This computer isn't activated — live transcription, scripture lookup and lyric tools are off. Click to activate."
        onClick={() => setOpen(true)}
      >
        <Key size={14} aria-hidden="true" />
      </ToolbarButton>
      <ActivationDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
