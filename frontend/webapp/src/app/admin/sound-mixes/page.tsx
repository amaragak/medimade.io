import { MixerSoundsStudio } from "@/components/mixer-sounds-studio";

export const metadata = {
  title: "Admin — Sound mixes",
};

export default function AdminSoundMixesPage() {
  return <MixerSoundsStudio variant="admin" />;
}
