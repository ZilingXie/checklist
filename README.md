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

## Integrating Agora or Other AI Backends

- `src/pages/CallPage.jsx` contains an `evaluateResponse` helper that currently mocks AI scoring. Replace this function with an async call to your Agora Conversational AI endpoint, returning the checklist status, recommendation, and AI response text.
- Use the existing `addConversationMessage` helper to append transcript entries, and `setChecklist` to apply status updates.
- `handleUserSpeech` is the main pipeline for recognized text—augment it with network calls and state management as needed.

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
