## Consciously Extension (Chrome)

Popup-style Chrome Extension (Manifest V3) with:
- Pomodoro focus timer (runs via service worker alarms + notifications)
- Site blocking (via `declarativeNetRequest` dynamic rules)
- Ambient sounds mixer (bundled audio assets)

### Load in Chrome
- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select `frontend/extension/dist`

### Local dev (hot reload)
Install once:

```bash
cd frontend/extension
npm install
```

Then:
- `npm run dev`: hot reload for the popup UI (open `http://localhost:5173/popup.html`)
- `npm run watch`: continuously rebuilds `dist/` for the actual extension (Chrome still needs a manual refresh of the extension)

### Backend hookup (same as webapp)
The extension can load ambient sounds from the backend endpoint:
`GET /media/background-audio`.

You can configure it two ways:
- **Recommended**: set `VITE_MEDIMADE_API_URL` in `frontend/extension/.env` (this is auto-written by `frontend/webapp/deploy/deploy-web` when `NEXT_PUBLIC_MEDIMADE_API_URL` is present).
- **Manual override**: paste the API base URL in the Sounds tab and click **Save**.

### Ambient sounds assets
This repo does not currently include the meditation background audio files.

To use ambient sounds, drop audio files into:
- `assets/bg-audio/nature/`
- `assets/bg-audio/music/`
- `assets/bg-audio/noise/`

Then update `assets/bg-audio/sounds.json` to reference filenames you added.

Supported formats: `.mp3`, `.wav`, `.ogg` (Chrome-supported codecs).

