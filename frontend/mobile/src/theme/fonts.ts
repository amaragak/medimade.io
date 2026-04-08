import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { Fraunces_500Medium, Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";

/** Pass to useFonts({ ...fontAssets }) */
export const fontAssets = {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
};

export const fonts = {
  /** Page titles — matches web `font-display` / Fraunces */
  displayMedium: "Fraunces_500Medium",
  displaySemiBold: "Fraunces_600SemiBold",
  /** Body — matches web DM Sans */
  sans: "DMSans_400Regular",
  sansMedium: "DMSans_500Medium",
  sansSemiBold: "DMSans_600SemiBold",
  sansBold: "DMSans_700Bold",
} as const;
