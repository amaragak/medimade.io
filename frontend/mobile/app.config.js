/**
 * Merges env into `extra` so URLs resolve at runtime via expo-constants when
 * Metro inlining differs, and keeps parity with EAS env at config time.
 * Expo CLI loads `.env` when you run `npx expo start`.
 *
 * `config` here is the merged `expo` object from app.json (not wrapped in `expo`).
 */
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...(config.extra ?? {}),
    medimadeApiUrl: process.env.EXPO_PUBLIC_MEDIMADE_API_URL?.trim() ?? "",
    medimadeChatUrl: process.env.EXPO_PUBLIC_MEDIMADE_CHAT_URL?.trim() ?? "",
    medimadeMediaBaseUrl:
      process.env.EXPO_PUBLIC_MEDIMADE_MEDIA_BASE_URL?.trim() ?? "",
  },
});
