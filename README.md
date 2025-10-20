# AI Checklist Review App

React + Vite single-page application that delivers a two-step experience for running conversational checklist reviews with an AI assistant. Tailwind CSS drives the styling, while the Web Speech API powers live speech recognition and synthesis.

## Stack

- React 18 with Vite build tooling
- React Router for `/` and `/call` navigation
- Tailwind CSS + PostCSS for styling
- Web Speech API (SpeechRecognition + speechSynthesis) for voice interactivity

## Features

- Landing page with hero messaging and “Join Call” CTA that routes to the call interface
- Call UI simulating an active AI call: status bar, animated visualizer, transcript, and real-time checklist
- Voice-first workflow: AI greets, speaks responses, listens for user speech, and updates checklist statuses
- Device switching support with live microphone input meter and fallback messaging when voice APIs are unavailable
- Downloadable JSON summary once the checklist is complete

## Local Development

```bash
npm install
npm run dev
```

The dev server opens automatically. Grant microphone access and use a supported browser (Chrome, Edge, or Safari) to test the speech features.

## Production Build

```bash
npm run build
npm run preview
```

## Agora Voice Setup

- The call page now connects to Agora for audio-only meetings when you click “Join Call”.
- Add your Agora credentials to `.env.local` (values must be prefixed with `VITE_` for Vite):
  - `VITE_AGORA_APP_ID`
  - `VITE_AGORA_CHANNEL`
  - `VITE_AGORA_TEMP_TOKEN` (leave blank when using an app certificate-less project)
  - `VITE_AGORA_UID` (optional numeric UID; Agora will auto-assign if omitted)
- Restart the dev server after updating `.env.local` so Vite picks up the new variables.

## Conversational AI Agent Join

- Clicking “Join Call” now invokes the Agora Conversational AI Agent join API (`/api/conversational-ai-agent/v2/projects/{projectId}/join`).
- Provide the agent configuration via `.env.local`:
  - `VITE_AGORA_AGENT_AUTH`: Base64 string of `CustomerID:CustomerSecret` for Basic auth.
  - `VITE_AGORA_AGENT_JOIN_URL`: Optional override for the join endpoint. Defaults to the project URL built from `VITE_AGORA_APP_ID`.
  - `VITE_AGORA_AGENT_NAME`, `VITE_AGORA_AGENT_RTC_UID`, `VITE_AGORA_AGENT_REMOTE_UIDS`, `VITE_AGORA_AGENT_ENABLE_STRING_UID`, `VITE_AGORA_AGENT_IDLE_TIMEOUT`.
  - `VITE_AGORA_AGENT_ASR_LANGUAGE` (defaults to `en-US`).
  - Optional LLM params: `VITE_AGORA_AGENT_LLM_URL`, `VITE_AGORA_AGENT_LLM_API_KEY`, `VITE_AGORA_AGENT_LLM_MODEL`, `VITE_AGORA_AGENT_SYSTEM_MESSAGE`, `VITE_AGORA_AGENT_GREETING_MESSAGE`, `VITE_AGORA_AGENT_FAILURE_MESSAGE`, `VITE_AGORA_AGENT_LLM_MAX_HISTORY`.
  - Optional TTS params: `VITE_AGORA_AGENT_TTS_VENDOR`, `VITE_AGORA_AGENT_TTS_KEY`, `VITE_AGORA_AGENT_TTS_REGION`, `VITE_AGORA_AGENT_TTS_VOICE`.
- These credentials are exposed client-side; deploy only in trusted environments or proxy the request through your backend for production scenarios.

## Extending Voice Capabilities

- `src/pages/CallPage.jsx` mocks AI scoring inside the `evaluateResponse` helper. Replace this function with a call to your backend when you are ready to integrate real intelligence.
- Voice capture currently relies solely on the browser microphone via `navigator.mediaDevices.getUserMedia`. Swap in a streaming provider by wiring your connection logic into the initialization block and `applySelectedInput` helper.
- The conversation flow is orchestrated by `handleUserSpeech`. Extend that function to relay transcripts to your service and handle its responses.

## Voice API Notes

- The app depends on `window.SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis`. Unsupported browsers trigger a graceful fallback page.
- Microphone level monitoring uses the Web Audio API (`AudioContext`). Ensure your deployment target allows microphone capture over HTTPS.

## Folder Structure

```
.
├── src
│   ├── components   # Reusable UI pieces
│   ├── pages        # Landing and Call views
│   ├── App.jsx      # Router setup
│   └── main.jsx     # App bootstrap
├── public           # Static assets (if added)
├── index.html
└── tailwind.config.js
```

## Accessibility Considerations

- Buttons have descriptive labels and rely on large touch targets.
- Transcript distinguishes between AI and user with orientation and labels.
- Voice-only workflows include real-time text transcript as an alternative modality.

## License

MIT © 2024
