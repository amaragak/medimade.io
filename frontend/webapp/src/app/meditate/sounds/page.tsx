import { MixerSoundsStudio } from "@/components/mixer-sounds-studio";
import { listBackgroundAudio } from "@/lib/medimade-api";
import type { MixerFactoryPreset } from "@/lib/mixer-factory-presets";

export const metadata = {
  title: "Sounds",
};

export const dynamic = "force-dynamic";

export default async function MeditateSoundsPage() {
  let initialFactoryPresets: MixerFactoryPreset[] | null = null;
  try {
    const data = await listBackgroundAudio();
    initialFactoryPresets = data.factoryMixes ?? [];
  } catch {
    initialFactoryPresets = null;
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <MixerSoundsStudio initialFactoryPresets={initialFactoryPresets} />
    </div>
  );
}
