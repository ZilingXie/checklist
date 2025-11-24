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

## PM2 Deployment

Run the production services under PM2 using the checklist repo path:

```bash
pm2 start npm --name frontend --cwd /home/ubuntu/checklist -- run dev -- --host 0.0.0.0 --port 5173
pm2 start /home/ubuntu/checklist/server.js --name server
pm2 start /home/ubuntu/checklist/customllm.js --name customllm
```

## Production Build

```bash
npm run build
npm run preview
```

## Agora Voice Setup

- The call page now connects to Agora for audio-only meetings when you click “Join Call”.
- Add your Agora credentials to `.env` (values exposed to the client must still be prefixed with `VITE_` for Vite):
  - `VITE_AGORA_APP_ID`
  - `VITE_AGORA_CHANNEL`
  - `VITE_AGORA_TEMP_TOKEN` (leave blank when using an app certificate-less project)
  - `VITE_AGORA_UID` (optional numeric UID; Agora will auto-assign if omitted)
- Restart the dev server after updating `.env` so Vite picks up the new variables.

## Conversational AI Agent Join

- Clicking “Join Call” now sends a POST request to the agent controller service (`server.js`), which forwards the payload to Agora’s Conversational AI Agent join API.
- Point `VITE_AGENT_CONTROLLER_URL` (or `VITE_AI_AGENT_SERVER_URL`) in `.env` to the base URL of your deployed controller; the client will call `${baseUrl}/agent/join`.
- Protect the controller by setting a shared bearer token: define `AGENT_CONTROLLER_AUTH_TOKEN` for the Node server (for example in `.env`) and the matching `VITE_AGENT_CONTROLLER_AUTH_TOKEN` for the Vite app. All `/agent/join` and `/agent/leave` requests now require `Authorization: Bearer <token>`.
- Run the controller locally with `node server.js` (default host `0.0.0.0:3000`) and deploy it to AWS EC2 for production. Configure optional `PORT`, `HOST`, or `ALLOWED_ORIGINS` environment variables to fit your hosting environment.
- The controller will automatically read a `.env` file from its working directory—store your `AGORA_*` secrets there when running on EC2 instead of exporting them manually.
- Start from `.env.example` for local testing: copy it to `.env`, fill in the Agora values, and the same settings will be picked up when you run `node server.js`.
- Ending a call triggers a POST to `${baseUrl}/agent/leave`, and the controller forwards the leave request to Agora so the conversational agent disconnects cleanly.
- Provide the controller with Agora credentials and settings via environment variables: `AGORA_APP_ID`, `AGORA_AGENT_AUTH` (Base64 `CustomerID:CustomerSecret`), `AGORA_CHANNEL`, `AGORA_TEMP_TOKEN`, `AGORA_AGENT_NAME`, `AGORA_AGENT_RTC_UID`, `AGORA_AGENT_REMOTE_UIDS`, `AGORA_AGENT_ENABLE_STRING_UID`, `AGORA_AGENT_IDLE_TIMEOUT`, `AGORA_AGENT_ASR_LANGUAGE`, plus optional LLM (`AGORA_AGENT_LLM_API_KEY`, `AGORA_AGENT_LLM_URL`, `AGORA_AGENT_LLM_MODEL`, `AGORA_AGENT_SYSTEM_MESSAGE`, `AGORA_AGENT_GREETING_MESSAGE`, `AGORA_AGENT_FAILURE_MESSAGE`, `AGORA_AGENT_LLM_MAX_HISTORY`) and TTS (`AGORA_AGENT_TTS_KEY`, `AGORA_AGENT_TTS_VENDOR`, `AGORA_AGENT_TTS_REGION`, `AGORA_AGENT_TTS_VOICE`) parameters.
- With the proxy in place the browser no longer needs direct access to the Agora secrets—keep them server-side for production deployments.

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
