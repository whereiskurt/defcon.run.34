import { BrowserGate } from "@/components/browser-gate";
import { WizardContainer } from "@/components/wizard/wizard-container";

export default function FlashPage() {
  return (
    <BrowserGate>
      <WizardContainer />
    </BrowserGate>
  );
}
