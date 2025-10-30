import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgoraRTC from 'agora-rtc-sdk-ng';
import CallStatusBar from '../components/CallStatusBar.jsx';
import ConversationVisualizer from '../components/ConversationVisualizer.jsx';
import ChecklistSidebar from '../components/ChecklistSidebar.jsx';
import CallControls from '../components/CallControls.jsx';

const initialChecklist = [
  {
    id: 'item-1',
    question: 'Mixed usage of string and integer UIDs.',
    status: 'pending',
    recommendation: ''
  },
  {
    id: 'item-2',
    question: 'Enabled token and deploy a token server.',
    status: 'pending',
    recommendation: ''
  },
  {
    id: 'item-3',
    question: 'Initialize Agora engine before join the channel.',
    status: 'pending',
    recommendation: ''
  }
];

const AGENT_AUDIO_LEVEL_INTERVAL = 120;
const AGENT_AUDIO_ACTIVE_THRESHOLD = 0.04;
const AGENT_AUDIO_INACTIVE_THRESHOLD = 0.015;
const AGENT_AUDIO_SILENCE_DURATION = 1100;
const AGENT_SILENCE_DEBOUNCE_MS = 600;
const AGENT_LISTENING_RESUME_DELAY_MS = 900;

const sanitizeBaseUrl = (value) => {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '');
    }
    url.search = '';
    url.hash = '';
    return url.href.replace(/\/$/, '');
  } catch {
    return value.replace(/\/chat\/completions$/, '').replace(/\/$/, '');
  }
};

const resolveChecklistApiBase = () => {
  const envBase =
    sanitizeBaseUrl(import.meta.env.VITE_CHECKLIST_API_BASE) ||
    sanitizeBaseUrl(import.meta.env.VITE_CUSTOM_LLM_API_BASE);

  if (envBase) {
    return envBase;
  }

  const publicUrl = sanitizeBaseUrl(import.meta.env.VITE_CUSTOM_LLM_PUBLIC_URL);
  if (publicUrl) {
    return publicUrl;
  }

  if (typeof window !== 'undefined' && window.location) {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3100';
    }
    return window.location.origin;
  }

  return 'http://localhost:3100';
};

const AGORA_APP_ID = import.meta.env.VITE_AGORA_APP_ID;
const AGORA_CHANNEL = import.meta.env.VITE_AGORA_CHANNEL;
const AGORA_TOKEN = import.meta.env.VITE_AGORA_TEMP_TOKEN || null;
const parsedAgoraUid = Number.parseInt(import.meta.env.VITE_AGORA_UID ?? '', 10);
const AGORA_UID = Number.isFinite(parsedAgoraUid) ? parsedAgoraUid : null;
const AGORA_AGENT_LAST_JOIN_KEY = 'agora-agent-last-join';
const AGENT_CONTROLLER_URL =
  import.meta.env.VITE_AGENT_CONTROLLER_URL ?? import.meta.env.VITE_AI_AGENT_SERVER_URL ?? '';
const AGENT_LEAVE_ENDPOINT = AGENT_CONTROLLER_URL
  ? `${AGENT_CONTROLLER_URL.replace(/\/$/, '')}/agent/leave`
  : '';
const AGENT_CONTROLLER_AUTH_TOKEN =
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_TOKEN ??
  import.meta.env.VITE_AGENT_CONTROLLER_AUTH_SECRET ??
  '';

const checklistDefinitionsById = initialChecklist.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {});

const normalizeChecklistItems = (items) =>
  items.map((item, index) => {
    const fallbackDefinition = initialChecklist[index];
    const definition = checklistDefinitionsById[item.id] ?? fallbackDefinition;
    const question = definition?.question ?? item.question;

    return {
      ...definition,
      ...item,
      question
    };
  });

const CallPage = () => {
  const navigate = useNavigate();
  const checklistApiBase = useMemo(() => resolveChecklistApiBase(), []);
  const checklistApiBaseRef = useRef(checklistApiBase);
  const recognitionRef = useRef(null);
  const devicePermissionRequestedRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const volumeAnimationRef = useRef(null);
  const hasGreetedRef = useRef(false);
  const localStreamRef = useRef(null);
  const isComponentMountedRef = useRef(true);
  const agoraClientRef = useRef(null);
  const agoraLocalAudioTrackRef = useRef(null);
  const remoteAudioTracksRef = useRef(new Map());
  const agoraSessionContextRef = useRef(null);
  const hasResetChecklistRef = useRef(false);
  const agentSpeakingRef = useRef(false);
  const agentSilenceTimeoutRef = useRef(null);
  const agentAudioMonitorRef = useRef(null);
  const resumeListeningTimeoutRef = useRef(null);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [callTone, setCallTone] = useState('idle');
  const [statusLabel, setStatusLabel] = useState('Agent not connected');
  const [checklist, setChecklist] = useState(initialChecklist);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const callActiveRef = useRef(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioDevices, setAudioDevices] = useState([{ deviceId: 'default', label: 'System Default' }]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const selectedDeviceIdRef = useRef('default');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [deviceStatusMessage, setDeviceStatusMessage] = useState('');
  const [inputVolume, setInputVolume] = useState(0);
  const [agoraJoined, setAgoraJoined] = useState(false);
  const [isAgentConnected, setIsAgentConnected] = useState(false);

  const isChecklistComplete = checklist.every((item) => item.status !== 'pending');

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    callActiveRef.current = callActive;
  }, [callActive]);

  const applyAgentActivityUi = useCallback(
    (activity) => {
      if (!isComponentMountedRef.current) {
        return;
      }

      if (!isAgentConnected) {
        setStatusLabel('Agent not connected');
        setCallTone('idle');
        return;
      }

      if (activity === 'speaking') {
        setStatusLabel('Agent speaking');
        setCallTone('speaking');
        return;
      }

      if (activity === 'listening') {
        setStatusLabel('Agent listening');
        setCallTone('listening');
        return;
      }

      setStatusLabel('Agent connected');
      setCallTone('connected');
    },
    [isAgentConnected]
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      setIsAgentConnected(false);
      return undefined;
    }

    let isMounted = true;
    let pollTimer = null;
    const storage = window.sessionStorage;

    const evaluateAgentConnection = () => {
      if (!isMounted) {
        return false;
      }

      let serialized;
      try {
        serialized = storage.getItem(AGORA_AGENT_LAST_JOIN_KEY);
      } catch (error) {
        console.warn('Unable to read Agora agent connection details', error);
        setIsAgentConnected(false);
        return false;
      }

      if (!serialized) {
        setIsAgentConnected(false);
        return false;
      }

      try {
        const parsed = JSON.parse(serialized);
        const recordedAt = Number(parsed?.recordedAt);
        if (Number.isFinite(recordedAt) && Date.now() - recordedAt > 5 * 60 * 1000) {
          storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
          setIsAgentConnected(false);
          return false;
        }

        setIsAgentConnected(true);
        return true;
      } catch (error) {
        console.warn('Unable to parse Agora agent session details', error);
        storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
        setIsAgentConnected(false);
        return false;
      }
    };

    const connectedInitially = evaluateAgentConnection();
    if (!connectedInitially) {
      let attempts = 0;
      const MAX_ATTEMPTS = 30;
      pollTimer = window.setInterval(() => {
        const connected = evaluateAgentConnection();
        attempts += 1;
        if ((connected || attempts >= MAX_ATTEMPTS) && pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      }, 1000);
    }

    return () => {
      isMounted = false;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (!isAgentConnected) {
      setStatusLabel('Agent not connected');
      setCallTone('idle');
      return;
    }
    if (agentSpeakingRef.current) {
      applyAgentActivityUi('speaking');
    } else {
      applyAgentActivityUi('listening');
    }
  }, [applyAgentActivityUi, isAgentConnected]);

  useEffect(() => {
    checklistApiBaseRef.current = checklistApiBase;
  }, [checklistApiBase]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const baseUrl = checklistApiBaseRef.current;
    if (!baseUrl) return undefined;

    console.debug('Using checklist API base:', baseUrl);

    let isCancelled = false;
    let reconnectTimer = null;
    let fetchRetryTimer = null;
    let streamAbortController = null;
    const abortController = new AbortController();

    const applySnapshot = (snapshot) => {
      if (!snapshot || !Array.isArray(snapshot.items) || isCancelled) {
        return;
      }

      setChecklist(normalizeChecklistItems(snapshot.items));

      const nextPendingIndex = snapshot.items.findIndex((item) => item.status === 'pending');
      setCurrentIndex(nextPendingIndex === -1 ? snapshot.items.length : nextPendingIndex);
    };

    const scheduleFetchRetry = () => {
      if (fetchRetryTimer !== null) return;
      fetchRetryTimer = window.setTimeout(() => {
        fetchRetryTimer = null;
        if (!isCancelled) {
          fetchInitial();
        }
      }, 3000);
    };

    const fetchInitial = async () => {
      try {
        const response = await fetch(
          `${baseUrl}/checklist?ngrok-skip-browser-warning=true`,
          {
            method: 'GET',
            signal: abortController.signal,
            headers: {
              Accept: 'application/json',
              'ngrok-skip-browser-warning': 'true'
            },
            cache: 'no-store'
          }
        );

        if (!response.ok) {
          throw new Error(`Checklist fetch failed with status ${response.status}`);
        }

        const rawBody = await response.text();

        if (!rawBody) {
          console.warn('Checklist fetch returned an empty payload; retrying shortly.');
          scheduleFetchRetry();
          return;
        }

        let data;

        try {
          data = JSON.parse(rawBody);
        } catch (parseError) {
          const preview = rawBody.slice(0, 160);
          console.error('Checklist response was not valid JSON', {
            error: parseError,
            status: response.status,
            contentType: response.headers.get('content-type'),
            preview
          });
          scheduleFetchRetry();
          return;
        }

        applySnapshot(data);
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('Unable to fetch checklist state', error);
          scheduleFetchRetry();
        }
      }
    };

    const closeStream = () => {
      if (streamAbortController) {
        streamAbortController.abort();
        streamAbortController = null;
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!isCancelled) {
          void connectStream();
        }
      }, 3000);
    };

    const connectStream = async () => {
      closeStream();

      const controller = new AbortController();
      streamAbortController = controller;

      try {
        const response = await fetch(
          `${baseUrl}/checklist/stream?ngrok-skip-browser-warning=true`,
          {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              'ngrok-skip-browser-warning': 'true'
            },
            cache: 'no-store',
            signal: controller.signal
          }
        );

        if (!response.ok) {
          throw new Error(`Checklist stream failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Checklist stream response does not have a readable body.');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        const processBuffer = () => {
          let separatorIndex;
          while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);

            if (!rawEvent.trim()) {
              continue;
            }

            const dataLines = [];
            for (const line of rawEvent.split(/\n/)) {
              if (!line) continue;
              if (line.startsWith(':')) {
                continue;
              }
              if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
              }
            }

            if (dataLines.length === 0) {
              continue;
            }

            const payloadText = dataLines.join('\n');
            if (!payloadText) {
              continue;
            }

            try {
              const payload = JSON.parse(payloadText);
              applySnapshot(payload);
            } catch (parseError) {
              console.warn('Unable to parse checklist stream payload', {
                error: parseError,
                payloadText
              });
            }
          }
        };

        while (!isCancelled) {
          const { value, done } = await reader.read();
          if (done) {
            if (value) {
              buffer += decoder.decode(value, { stream: true });
            }
            break;
          }

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            processBuffer();
          }
        }

        buffer += decoder.decode(new Uint8Array(), { stream: false });
        processBuffer();
      } catch (error) {
        if (!controller.signal.aborted && !isCancelled) {
          console.error('Checklist stream error', error);
        }
      } finally {
        if (streamAbortController === controller) {
          streamAbortController = null;
        }
        if (!isCancelled && !controller.signal.aborted) {
          scheduleReconnect();
        }
      }
    };

    fetchInitial();
    void connectStream();

    return () => {
      isCancelled = true;
      abortController.abort();
      closeStream();
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (fetchRetryTimer !== null) {
        window.clearTimeout(fetchRetryTimer);
      }
    };
  }, [checklistApiBase]);

  const resetChecklistForNewCall = async () => {
    if (!isComponentMountedRef.current) return;
    if (hasResetChecklistRef.current) return;

    hasResetChecklistRef.current = true;

    setChecklist((previous) =>
      previous.map((item) => ({
        ...item,
        status: 'pending',
        recommendation: ''
      }))
    );
    setCurrentIndex(0);

    const baseUrl = checklistApiBaseRef.current;
    if (!baseUrl) {
      console.warn('Checklist API base URL is not available; skipping remote reset request.');
      return;
    }

    try {
      const response = await fetch(
        `${baseUrl}/checklist/reset?ngrok-skip-browser-warning=true`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          cache: 'no-store'
        }
      );

      if (!response.ok) {
        console.error('Checklist reset request failed', {
          status: response.status,
          statusText: response.statusText
        });
        hasResetChecklistRef.current = false;
      }
    } catch (error) {
      console.error('Checklist reset request failed', error);
      hasResetChecklistRef.current = false;
    }
  };

  useEffect(() => {
    isComponentMountedRef.current = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSpeechSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (!transcript) return;

      recognition.stop();
      handleUserSpeech(transcript);
    };

    recognition.onerror = () => {
      if (callActiveRef.current) {
        recognition.stop();
        scheduleResumeListening(1000);
      }
    };

    recognition.onend = () => {
      if (!callActiveRef.current) return;
      if (agentSpeakingRef.current) {
        return;
      }
      if (resumeListeningTimeoutRef.current === null) {
        scheduleResumeListening();
      }
    };

    recognitionRef.current = recognition;
    greetAndStart();

    let isActive = true;
    const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
    agoraClientRef.current = client;
    const remoteTracksForSession = new Map();
    remoteAudioTracksRef.current = remoteTracksForSession;
    const sessionContext = { client, remoteTracks: remoteTracksForSession, localTrack: null };
    agoraSessionContextRef.current = sessionContext;

    const handleRemoteAudioPublished = async (user, mediaType) => {
      if (!isActive || mediaType !== 'audio') {
        return;
      }

      const activeClient = agoraClientRef.current;
      if (!activeClient) return;

      try {
        await activeClient.subscribe(user, mediaType);
        const remoteAudioTrack = user.audioTrack;
        if (!remoteAudioTrack) return;

        const existingEntry = remoteTracksForSession.get(user.uid);
        const existingTrack = existingEntry?.track;
        if (existingTrack) {
          stopAgentAudioMonitor({ track: existingTrack, immediate: false });
          if (typeof existingTrack.off === 'function' && existingEntry.onPlayerStateChange) {
            existingTrack.off('player-state-change', existingEntry.onPlayerStateChange);
          }
          try {
            existingTrack.stop();
          } catch (error) {
            console.error('Failed to stop previous remote Agora track', error);
          }
        }

        const canMonitorLevel = typeof remoteAudioTrack.getAudioLevel === 'function';
        const handlePlayerStateChange = (state) => {
          if (state === 'playing') {
            handleAgentSpeakingChange(true);
          } else if (
            !canMonitorLevel &&
            (state === 'stopped' ||
              state === 'paused' ||
              state === 'idle' ||
              state === 'ended' ||
              state === 'failed' ||
              state === 'aborted')
          ) {
            handleAgentSpeakingChange(false);
          }
        };

        remoteAudioTrack.on('player-state-change', handlePlayerStateChange);
        remoteAudioTrack.play();
        handleAgentSpeakingChange(true);
        remoteTracksForSession.set(user.uid, {
          track: remoteAudioTrack,
          onPlayerStateChange: handlePlayerStateChange
        });
        startAgentAudioMonitor(remoteAudioTrack);
      } catch (error) {
        console.error('Failed to subscribe to remote audio', error);
      }
    };

    const handleRemoteAudioRemoved = (user) => {
      const entry = remoteTracksForSession.get(user.uid);
      if (entry?.track) {
        stopAgentAudioMonitor({ track: entry.track });
        if (typeof entry.track.off === 'function' && entry.onPlayerStateChange) {
          entry.track.off('player-state-change', entry.onPlayerStateChange);
        }
        try {
          entry.track.stop();
        } catch (error) {
          console.error('Failed to stop remote Agora track', error);
        }
      }
      remoteTracksForSession.delete(user.uid);
      if (remoteTracksForSession.size === 0) {
        handleAgentSpeakingChange(false);
      }
    };

    client.on('user-published', handleRemoteAudioPublished);
    client.on('user-unpublished', handleRemoteAudioRemoved);
    client.on('user-left', handleRemoteAudioRemoved);

    const initializeLocalAudio = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setDeviceStatusMessage('Microphone access is not supported in this browser.');
        return;
      }

      try {
        await ensureDeviceAccess();
        await updateDeviceList();
        const applied = await applySelectedInput(selectedDeviceId, { silent: true });
        if (!isActive) {
          return;
        }
        setDeviceStatusMessage((previous) =>
          applied ? '' : previous || 'Unable to access microphone. Check permissions and try again.'
        );
      } catch (error) {
        console.error('Microphone initialization failed', error);
        if (!isActive) return;
        setDeviceStatusMessage('Unable to access microphone. Check permissions and try again.');
      }
    };

    initializeLocalAudio()
      .catch(() => {
        // already handled above
      })
      .finally(() => {
        if (isActive) {
          joinAgoraVoiceCall(sessionContext);
        }
      });

    return () => {
      recognition.stop();
      callActiveRef.current = false;
      clearAgentSilenceTimeout();
      clearResumeListeningTimeout();
      stopAgentAudioMonitor({ immediate: false });
      stopVolumeMonitor();
      stopLocalStream();
      client.off('user-published', handleRemoteAudioPublished);
      client.off('user-unpublished', handleRemoteAudioRemoved);
      client.off('user-left', handleRemoteAudioRemoved);
      isComponentMountedRef.current = false;
      void leaveAgoraVoiceCall(sessionContext);
      if (audioContextRef.current) {
        audioContextRef.current.close?.();
        audioContextRef.current = null;
      }
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureDeviceAccess = async () => {
    if (!navigator?.mediaDevices?.getUserMedia) return;
    if (devicePermissionRequestedRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      devicePermissionRequestedRef.current = true;
    } catch (error) {
      setDeviceStatusMessage('Microphone permission denied. Please allow access to change devices.');
      throw error;
    }
  };

  const updateDeviceList = async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((device) => device.kind === 'audioinput');
      const normalized = audioInputs.map((device, index) => ({
        deviceId: device.deviceId || `device-${index}`,
        label: device.label || `Microphone ${index + 1}`
      }));

      const withDefault = [{ deviceId: 'default', label: 'System Default' }, ...normalized];
      setAudioDevices(withDefault);

      if (!withDefault.some((device) => device.deviceId === selectedDeviceId)) {
        setSelectedDeviceId('default');
      }
    } catch (error) {
      console.error('Unable to enumerate devices', error);
      setDeviceStatusMessage('Unable to list microphones. Check browser permissions.');
    }
  };

  const stopVolumeMonitor = () => {
    if (volumeAnimationRef.current) {
      cancelAnimationFrame(volumeAnimationRef.current);
      volumeAnimationRef.current = null;
    }
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch {
        // ignore disconnect issues
      }
      audioSourceRef.current = null;
    }
    analyserRef.current = null;
    setInputVolume(0);
  };

  const stopLocalStream = () => {
    if (!localStreamRef.current) return;
    const tracks = localStreamRef.current.getTracks?.() ?? [];
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.error('Failed to stop local media track', error);
      }
    });
    localStreamRef.current = null;
  };

  const leaveAgoraVoiceCall = async (sessionContext = agoraSessionContextRef.current) => {
    const client = sessionContext?.client ?? agoraClientRef.current;
    const tracks = sessionContext?.remoteTracks ?? remoteAudioTracksRef.current;
    const localTrack = sessionContext?.localTrack ?? agoraLocalAudioTrackRef.current;

    if (localTrack) {
      try {
        localTrack.stop();
        localTrack.close();
      } catch (error) {
        console.error('Failed to clean up local Agora track', error);
      }
      if (sessionContext) {
        sessionContext.localTrack = null;
      }
      if (agoraLocalAudioTrackRef.current === localTrack) {
        agoraLocalAudioTrackRef.current = null;
      }
    }

    tracks?.forEach((entry, uid) => {
      const remoteTrack = entry?.track;
      if (!remoteTrack) {
        return;
      }
      stopAgentAudioMonitor({ track: remoteTrack });
      if (typeof remoteTrack.off === 'function' && entry.onPlayerStateChange) {
        remoteTrack.off('player-state-change', entry.onPlayerStateChange);
      }
      try {
        remoteTrack.stop();
      } catch (error) {
        console.error(`Failed to stop remote Agora track for user ${uid}`, error);
      }
    });
    stopAgentAudioMonitor();
    tracks?.clear();
    if (tracks && remoteAudioTracksRef.current === tracks) {
      remoteAudioTracksRef.current = new Map();
    }
    clearAgentSilenceTimeout();
    agentSpeakingRef.current = false;
    clearResumeListeningTimeout();

    if (client) {
      try {
        await client.leave();
      } catch (error) {
        console.error('Failed to leave Agora client', error);
      }
      client.removeAllListeners?.();
    }

    if (agoraClientRef.current === client) {
      agoraClientRef.current = null;
      if (isComponentMountedRef.current) {
        setAgoraJoined(false);
      }
    }
    if (sessionContext && agoraSessionContextRef.current === sessionContext) {
      agoraSessionContextRef.current = null;
    }
    hasResetChecklistRef.current = false;
  };

  const joinAgoraVoiceCall = async (sessionContext = agoraSessionContextRef.current) => {
    if (!callActiveRef.current) return;
    if (!AGORA_APP_ID || !AGORA_CHANNEL) {
      console.warn('Missing Agora credentials. Voice call join skipped.');
      void resetChecklistForNewCall();
      return;
    }

    if (agoraJoined) return;

    try {
      await ensureDeviceAccess();
    } catch (error) {
      console.error('Microphone permission is required for Agora voice call', error);
      setDeviceStatusMessage('Allow microphone access to join the voice call.');
      return;
    }

    const client = sessionContext?.client ?? agoraClientRef.current;
    if (sessionContext && agoraSessionContextRef.current !== sessionContext) {
      console.warn('Agora session context changed before join completed; aborting join.');
      return;
    }
    if (!client) {
      console.error('Agora client is not initialized.');
      return;
    }
    if (agoraClientRef.current !== client) {
      console.warn('Agora client changed before join completed; aborting join.');
      return;
    }

    try {

      await client.join(AGORA_APP_ID, AGORA_CHANNEL, AGORA_TOKEN || null, AGORA_UID ?? null);
      const trackConfig =
        selectedDeviceIdRef.current && selectedDeviceIdRef.current !== 'default'
          ? { microphoneId: selectedDeviceIdRef.current }
          : undefined;
      const localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack(trackConfig);
      agoraLocalAudioTrackRef.current = localAudioTrack;
      if (sessionContext) {
        sessionContext.localTrack = localAudioTrack;
      }
      await client.publish([localAudioTrack]);
      if (isComponentMountedRef.current) {
        setAgoraJoined(true);
        setDeviceStatusMessage('');
      }
      void resetChecklistForNewCall();
    } catch (error) {
      console.error('Failed to join Agora voice call', error);
      if (isComponentMountedRef.current) {
        setDeviceStatusMessage('Unable to join the voice call. Check Agora configuration or permissions.');
      }
    }
  };

  const updateAgoraAudioDevice = async (deviceId) => {
    if (!agoraJoined) return true;
    const client = agoraClientRef.current;
    const localTrack = agoraLocalAudioTrackRef.current;
    if (!client || !localTrack) return false;

    const requestedId = deviceId === 'default' ? 'default' : deviceId;

    try {
      await localTrack.setDevice(requestedId);
      return true;
    } catch (error) {
      console.error('Direct Agora microphone switch failed, attempting rebuild', error);
      try {
        await client.unpublish([localTrack]);
        localTrack.stop();
        localTrack.close();
      } catch (cleanupError) {
        console.error('Failed to unpublish existing Agora track during switch', cleanupError);
      }

      try {
        const trackConfig = deviceId === 'default' ? undefined : { microphoneId: deviceId };
        const newTrack = await AgoraRTC.createMicrophoneAudioTrack(trackConfig);
        agoraLocalAudioTrackRef.current = newTrack;
        await client.publish([newTrack]);
        return true;
      } catch (fallbackError) {
        console.error('Failed to rebuild Agora microphone track', fallbackError);
        return false;
      }
    }
  };

  const startVolumeMonitor = async (stream) => {
    if (!stream) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch {
        return;
      }
    }

    stopVolumeMonitor();

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    audioSourceRef.current = source;
    analyserRef.current = analyser;

    const dataArray = new Uint8Array(analyser.fftSize);

    const updateVolume = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const deviation = dataArray[i] - 128;
        sumSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const normalized = Math.min(1, Math.max(0, rms / 20));
      setInputVolume(normalized);
      volumeAnimationRef.current = requestAnimationFrame(updateVolume);
    };

    updateVolume();
  };

  const handleToggleDeviceMenu = async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) {
      setDeviceStatusMessage('Device switching is not supported in this browser.');
      return;
    }

    if (!isDeviceMenuOpen) {
      try {
        await ensureDeviceAccess();
        await updateDeviceList();
        setDeviceStatusMessage('');
      } catch {
        return;
      }
    }

    setIsDeviceMenuOpen((previous) => !previous);
  };

  const applySelectedInput = async (deviceId, { silent = false } = {}) => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      if (!silent) {
        setDeviceStatusMessage('Microphone selection is not supported in this browser.');
      }
      return false;
    }

    try {
      if (!silent) {
        setDeviceStatusMessage('Switching input device…');
      }

      const constraints =
        deviceId === 'default'
          ? { audio: true }
          : { audio: { deviceId: { exact: deviceId } } };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      devicePermissionRequestedRef.current = true;

      stopLocalStream();
      localStreamRef.current = stream;
      await startVolumeMonitor(stream);
      setSelectedDeviceId(deviceId);
      selectedDeviceIdRef.current = deviceId;

      let agoraDeviceUpdated = true;
      if (agoraJoined) {
        agoraDeviceUpdated = await updateAgoraAudioDevice(deviceId);
      }

      if (!agoraDeviceUpdated) {
        const message =
          'Microphone switched locally, but the voice call could not use the selected device.';
        if (!silent) {
          setDeviceStatusMessage(`${message} Try switching again or rejoining the call.`);
        } else {
          setDeviceStatusMessage(message);
        }
        return false;
      }

      if (!silent) {
        setDeviceStatusMessage('Microphone updated.');
        setTimeout(() => setDeviceStatusMessage(''), 2000);
      } else {
        setDeviceStatusMessage('');
      }
      return true;
    } catch (error) {
      console.error('Microphone switch failed', error);
      if (!silent) {
        setDeviceStatusMessage('Unable to switch microphone. Check permissions and try again.');
      } else {
        setDeviceStatusMessage('Unable to access microphone. Check permissions and try again.');
      }
      return false;
    }
  };

  const handleSelectDevice = async (deviceId) => {
    const success = await applySelectedInput(deviceId);
    if (success) {
      setIsDeviceMenuOpen(false);
    }

    if (!success || !callActiveRef.current) return;
    stopListening();
    scheduleResumeListening(500);
  };

  const greetAndStart = () => {
    if (!callActiveRef.current || hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    if (agentSpeakingRef.current) {
      return;
    }
    scheduleResumeListening(200);
  };

  const startListening = () => {
    if (!callActiveRef.current) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;

    try {
      recognition.start();
    } catch {
      // recognition already started, ignore
    }
  };

  const stopListening = () => {
    const recognition = recognitionRef.current;
    recognition?.stop();
  };

  const clearResumeListeningTimeout = () => {
    if (resumeListeningTimeoutRef.current !== null) {
      clearTimeout(resumeListeningTimeoutRef.current);
      resumeListeningTimeoutRef.current = null;
    }
  };

  const clearAgentSilenceTimeout = () => {
    if (agentSilenceTimeoutRef.current !== null) {
      clearTimeout(agentSilenceTimeoutRef.current);
      agentSilenceTimeoutRef.current = null;
    }
  };

  const scheduleResumeListening = (delay = 400) => {
    clearResumeListeningTimeout();
    resumeListeningTimeoutRef.current = setTimeout(() => {
      resumeListeningTimeoutRef.current = null;
      if (!callActiveRef.current || agentSpeakingRef.current) {
        return;
      }
      startListening();
    }, delay);
  };

  const handleAgentSpeakingChange = (isSpeaking, options = {}) => {
    const { immediate = false } = options;

    if (isSpeaking) {
      if (!agentSpeakingRef.current) {
        agentSpeakingRef.current = true;
      }
      clearAgentSilenceTimeout();
      if (!isComponentMountedRef.current) {
        return;
      }
      applyAgentActivityUi('speaking');
      clearResumeListeningTimeout();
      stopListening();
      return;
    }

    if (!agentSpeakingRef.current) {
      return;
    }

    if (immediate) {
      clearAgentSilenceTimeout();
      agentSpeakingRef.current = false;
      if (isComponentMountedRef.current) {
        applyAgentActivityUi('listening');
      }
      if (callActiveRef.current) {
        scheduleResumeListening(AGENT_LISTENING_RESUME_DELAY_MS);
      }
      return;
    }

    if (!isComponentMountedRef.current) {
      agentSpeakingRef.current = false;
      return;
    }

    if (agentSilenceTimeoutRef.current !== null) {
      return;
    }

    agentSilenceTimeoutRef.current = setTimeout(() => {
      agentSilenceTimeoutRef.current = null;
      agentSpeakingRef.current = false;
      if (!isComponentMountedRef.current) {
        return;
      }
      applyAgentActivityUi('listening');
      if (callActiveRef.current) {
        scheduleResumeListening(AGENT_LISTENING_RESUME_DELAY_MS);
      }
    }, AGENT_SILENCE_DEBOUNCE_MS);
  };

  const stopAgentAudioMonitor = ({ immediate = true, track } = {}) => {
    const monitor = agentAudioMonitorRef.current;
    if (monitor && track && monitor.track && monitor.track !== track) {
      return;
    }

    if (typeof window !== 'undefined' && monitor?.timer !== undefined && monitor?.timer !== null) {
      window.clearInterval(monitor.timer);
    }

    if (!monitor || !track || !monitor.track || monitor.track === track) {
      agentAudioMonitorRef.current = null;
    }

    if (immediate) {
      handleAgentSpeakingChange(false, { immediate: true });
    }
  };

  const startAgentAudioMonitor = (remoteAudioTrack) => {
    if (typeof window === 'undefined' || !remoteAudioTrack) {
      return;
    }

    const wasSpeaking = agentSpeakingRef.current;
    stopAgentAudioMonitor({ immediate: false });

    if (typeof remoteAudioTrack.getAudioLevel !== 'function') {
      if (wasSpeaking) {
        handleAgentSpeakingChange(true);
      }
      return;
    }

    const monitorState = {
      timer: null,
      isSpeaking: wasSpeaking,
      lastActiveAt: Date.now(),
      track: remoteAudioTrack
    };

    const pollAudioLevel = () => {
      const level = remoteAudioTrack.getAudioLevel?.() ?? 0;
      const now = Date.now();
      const threshold = monitorState.isSpeaking
        ? AGENT_AUDIO_INACTIVE_THRESHOLD
        : AGENT_AUDIO_ACTIVE_THRESHOLD;

      if (level >= threshold) {
        monitorState.lastActiveAt = now;
        if (!monitorState.isSpeaking) {
          monitorState.isSpeaking = true;
          handleAgentSpeakingChange(true);
        }
        return;
      }

      if (
        monitorState.isSpeaking &&
        now - monitorState.lastActiveAt >= AGENT_AUDIO_SILENCE_DURATION
      ) {
        monitorState.isSpeaking = false;
        handleAgentSpeakingChange(false);
      }
    };

    monitorState.timer = window.setInterval(pollAudioLevel, AGENT_AUDIO_LEVEL_INTERVAL);
    agentAudioMonitorRef.current = monitorState;
    pollAudioLevel();
  };

  const handleUserSpeech = async (text) => {
    if (!callActiveRef.current) return;

    stopListening();

    setIsProcessing(true);

    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed) {
      console.debug('Captured user response for agent evaluation:', trimmed);
    }

    setIsProcessing(false);

    if (!callActiveRef.current) return;

    if (agentSpeakingRef.current) {
      return;
    }

    scheduleResumeListening();
  };

  useEffect(() => {
    if (!callActive || !isChecklistComplete) {
      return;
    }
    recognitionRef.current?.stop();
    clearAgentSilenceTimeout();
    clearResumeListeningTimeout();
    agentSpeakingRef.current = false;
  }, [callActive, isChecklistComplete]);

  const handleDownload = () => {
    const payload = {
      completedAt: new Date().toISOString(),
      checklist
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'reviewed-checklist.json';
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const stopAgoraAgent = async () => {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
      return;
    }

    const storage = window.sessionStorage;
    const serialized = storage.getItem(AGORA_AGENT_LAST_JOIN_KEY);
    if (!serialized) {
      setIsAgentConnected(false);
      return;
    }

    let storedDetails;
    try {
      storedDetails = JSON.parse(serialized);
    } catch (error) {
      console.warn('Unable to parse stored Agora agent session details', error);
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
      setIsAgentConnected(false);
      return;
    }

    const agentId = storedDetails?.agentId ?? storedDetails?.agent_id ?? storedDetails?.id;
    const projectId = storedDetails?.projectId ?? AGORA_APP_ID;
    const leaveUrl =
      storedDetails?.leaveUrl ??
      (agentId && projectId
        ? `https://api.agora.io/api/conversational-ai-agent/v2/projects/${projectId}/agents/${agentId}/leave`
        : undefined);

    if (!AGENT_LEAVE_ENDPOINT || typeof fetch !== 'function') {
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
      setIsAgentConnected(false);
      return;
    }

    if (!agentId) {
      console.warn('Unable to resolve Agora agent identifier; skipping leave request.');
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
      setIsAgentConnected(false);
      return;
    }

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (AGENT_CONTROLLER_AUTH_TOKEN) {
        headers.Authorization = `Bearer ${AGENT_CONTROLLER_AUTH_TOKEN}`;
      }

      const response = await fetch(AGENT_LEAVE_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agentId,
          projectId: storedDetails?.projectId ?? AGORA_APP_ID,
          leaveUrl
        }),
        keepalive: true
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('Agent controller leave request failed', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
      }
    } catch (error) {
      console.error('Failed to invoke agent controller leave request', error);
    } finally {
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
      setIsAgentConnected(false);
    }
  };

  const handleEndCall = async () => {
    callActiveRef.current = false;
    clearAgentSilenceTimeout();
    clearResumeListeningTimeout();
    agentSpeakingRef.current = false;
    setCallActive(false);
    stopListening();
    stopVolumeMonitor();
    stopLocalStream();
    await leaveAgoraVoiceCall();
    if (audioContextRef.current) {
      audioContextRef.current.close?.();
      audioContextRef.current = null;
    }
    setIsDeviceMenuOpen(false);
    void stopAgoraAgent();
    navigate('/');
  };

  if (!isSpeechSupported) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-925 px-6 text-center text-white">
        <h1 className="text-3xl font-bold">Voice Features Unavailable</h1>
        <p className="mt-4 max-w-xl text-base text-white/70">
          Your browser does not fully support the speech recognition features required for this
          experience. Please try again using the latest version of Chrome, Edge, or Safari.
        </p>
        <button
          type="button"
          className="mt-8 rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white/80 hover:bg-white/10"
          onClick={() => navigate('/')}
        >
          Return to Landing Page
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 text-white">
      <CallStatusBar statusLabel={statusLabel} tone={callTone} />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-h-0">
          <ChecklistSidebar items={checklist} />
        </div>
        <div className="flex min-h-0 flex-col gap-6">
          <ConversationVisualizer tone={callTone} isConnected={isAgentConnected} />
        </div>
      </div>
      <CallControls
        onEndCall={handleEndCall}
        onDownload={handleDownload}
        isDownloadReady={isChecklistComplete}
        onToggleDeviceMenu={handleToggleDeviceMenu}
        isDeviceMenuOpen={isDeviceMenuOpen}
        devices={audioDevices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={handleSelectDevice}
        deviceStatusMessage={deviceStatusMessage}
        inputVolume={inputVolume}
      />
    </div>
  );
};

export default CallPage;
