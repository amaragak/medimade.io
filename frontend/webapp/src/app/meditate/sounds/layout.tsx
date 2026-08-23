import type { ReactNode } from "react";
import { MixerSoundsStudio } from "@/components/mixer-sounds-studio";
import { listBackgroundAudio } from "@/lib/medimade-api";
import type { MixerFactoryPreset } from "@/lib/mixer-factory-presets";

/**
 * Sounds list + editor share one mounted studio so route switches
 * only change URL + local view state (no remount / re-fetch).
 */
export default async function MeditateSoundsLayout({
  children,
}: {
  children: ReactNode;
}) {
  let initialFactoryPresets: MixerFactoryPreset[] | null = null;
  try {
    const data = await listBackgroundAudio();
    initialFactoryPresets = data.factoryMixes ?? [];
  } catch {
    initialFactoryPresets = null;
  }

  return (
    <>
      <div className="hidden" aria-hidden>
        {children}
      </div>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <MixerSoundsStudio initialFactoryPresets={initialFactoryPresets} />
      </div>
    </>
  );
}
