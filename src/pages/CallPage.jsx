import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AgoraRTC from 'agora-rtc-sdk-ng';
import CallStatusBar from '../components/CallStatusBar.jsx';
import ConversationVisualizer from '../components/ConversationVisualizer.jsx';
import TranscriptPanel from '../components/TranscriptPanel.jsx';
import ChecklistSidebar from '../components/ChecklistSidebar.jsx';
import CallControls from '../components/CallControls.jsx';

const initialChecklist = [
  {
    id: 'item-1',
    question: 'Verify emergency exits remain unobstructed and clearly marked.',
    status: 'pending',
    recommendation: ''
  },
  {
    id: 'item-2',
    question: 'Confirm all fire extinguishers are inspected and tagged within the last 30 days.',
    status: 'pending',
    recommendation: ''
  },
  {
    id: 'item-3',
    question: 'Ensure incident response documentation is up to date and accessible to staff.',
    status: 'pending',
    recommendation: ''
  }
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const evaluateResponse = async ({ userText, item, nextItem }) => {
  await delay(800);

  const normalized = userText.toLowerCase();
  let status = 'pass';

  if (normalized.includes('not') || normalized.includes("n't") || normalized.includes('no')) {
    status = 'fail';
  } else if (
    normalized.includes('pending') ||
    normalized.includes('unsure') ||
    normalized.includes('maybe') ||
    normalized.includes('unknown')
  ) {
    status = 'warning';
  }

  const recommendations = {
    pass: 'Great work. No further action required for this checklist item.',
    warning: 'Please flag this item for follow-up and gather additional confirmation within 24 hours.',
    fail: 'Immediate action required. Assign an owner to resolve the gap and document remediation steps.'
  };

  const statusText = status === 'pass' ? 'marked as pass' : status === 'fail' ? 'marked as failed' : 'set to warning';
  const nextPrompt = nextItem ? `Next, ${nextItem.question}` : 'That completes our checklist.';

  const aiResponse = `Thanks for the update. I have ${statusText} and noted: ${recommendations[status]} ${
    nextItem ? nextPrompt : 'Here is a summary of our findings.'
  }`;

  return {
    status,
    recommendation: recommendations[status],
    aiResponse
  };
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

const CallPage = () => {
  const navigate = useNavigate();
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
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [callTone, setCallTone] = useState('connecting');
  const [statusLabel, setStatusLabel] = useState('Connecting…');
  const [conversation, setConversation] = useState([]);
  const [checklist, setChecklist] = useState(initialChecklist);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioDevices, setAudioDevices] = useState([{ deviceId: 'default', label: 'System Default' }]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const selectedDeviceIdRef = useRef('default');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [deviceStatusMessage, setDeviceStatusMessage] = useState('');
  const [inputVolume, setInputVolume] = useState(0);
  const [agoraJoined, setAgoraJoined] = useState(false);

  const isChecklistComplete = checklist.every((item) => item.status !== 'pending');

  useEffect(() => {
    selectedDeviceIdRef.current = selectedDeviceId;
  }, [selectedDeviceId]);

  useEffect(() => {
    isComponentMountedRef.current = true;

    const canSynthesize = 'speechSynthesis' in window;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!canSynthesize || !SpeechRecognition) {
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
      if (callActive) {
        recognition.stop();
        setTimeout(() => startListening(), 1000);
      }
    };

    recognition.onend = () => {
      if (callActive && !isProcessing) {
        setCallTone('listening');
        setStatusLabel((previous) => (previous === 'Connecting…' ? previous : 'Connected'));
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
        remoteAudioTrack?.play();
        remoteTracksForSession.set(user.uid, remoteAudioTrack);
      } catch (error) {
        console.error('Failed to subscribe to remote audio', error);
      }
    };

    const handleRemoteAudioRemoved = (user) => {
      const remoteTrack = remoteTracksForSession.get(user.uid);
      if (remoteTrack) {
        try {
          remoteTrack.stop();
        } catch (error) {
          console.error('Failed to stop remote Agora track', error);
        }
        remoteTracksForSession.delete(user.uid);
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
      window.speechSynthesis.cancel();
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

    tracks?.forEach((remoteTrack, uid) => {
      try {
        remoteTrack.stop();
      } catch (error) {
        console.error(`Failed to stop remote Agora track for user ${uid}`, error);
      }
    });
    tracks?.clear();
    if (tracks && remoteAudioTracksRef.current === tracks) {
      remoteAudioTracksRef.current = new Map();
    }

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
        setStatusLabel('Disconnected');
        setCallTone('idle');
      }
    }
    if (sessionContext && agoraSessionContextRef.current === sessionContext) {
      agoraSessionContextRef.current = null;
    }
  };

  const joinAgoraVoiceCall = async (sessionContext = agoraSessionContextRef.current) => {
    if (!callActive) return;
    if (!AGORA_APP_ID || !AGORA_CHANNEL) {
      console.warn('Missing Agora credentials. Voice call join skipped.');
      if (isComponentMountedRef.current) {
        setStatusLabel('Connected');
        setCallTone('connected');
      }
      return;
    }

    if (agoraJoined) return;

    try {
      await ensureDeviceAccess();
    } catch (error) {
      console.error('Microphone permission is required for Agora voice call', error);
      setDeviceStatusMessage('Allow microphone access to join the voice call.');
      if (isComponentMountedRef.current) {
        setStatusLabel('Connection failed');
        setCallTone('idle');
      }
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
      setCallTone('connecting');
      setStatusLabel('Connecting…');

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
        setStatusLabel('Connected');
        setCallTone('connected');
      }
    } catch (error) {
      console.error('Failed to join Agora voice call', error);
      if (isComponentMountedRef.current) {
        setDeviceStatusMessage('Unable to join the voice call. Check Agora configuration or permissions.');
        setStatusLabel('Connection failed');
        setCallTone('idle');
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

    if (!success || !callActive) return;
    stopListening();
    setTimeout(() => startListening(), 500);
  };

  const greetAndStart = () => {
    if (!callActive || hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    const firstItem = checklist[0];
    if (!firstItem) return;
    const intro = `Welcome to the checklist review. Let's begin with the first item. ${firstItem.question}`;

    addConversationMessage('ai', intro);
    speakText(intro, startListening);
  };

  const addConversationMessage = (sender, text) => {
    setConversation((previous) => [...previous, { sender, text }]);
  };

  const speakText = (text, onComplete) => {
    if (!('speechSynthesis' in window) || !callActive) {
      onComplete?.();
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;

    setCallTone('speaking');
    setStatusLabel((previous) => (previous === 'Connecting…' ? previous : 'Connected'));

    utterance.onend = () => {
      if (!callActive) return;
      setCallTone('listening');
      setStatusLabel((previous) => (previous === 'Connecting…' ? previous : 'Connected'));
      onComplete?.();
    };

    window.speechSynthesis.speak(utterance);
  };

  const startListening = () => {
    if (!callActive) return;
    const recognition = recognitionRef.current;
    if (!recognition) return;

    try {
      recognition.start();
      setCallTone('listening');
      setStatusLabel((previous) => (previous === 'Connecting…' ? previous : 'Connected'));
    } catch {
      // recognition already started, ignore
    }
  };

  const stopListening = () => {
    const recognition = recognitionRef.current;
    recognition?.stop();
  };

  const handleUserSpeech = async (text) => {
    if (!callActive) return;

    stopListening();
    addConversationMessage('user', text);

    setIsProcessing(true);
    setCallTone('connected');
    setStatusLabel('Processing…');

    const currentItem = checklist[currentIndex];
    const nextItem = checklist[currentIndex + 1];

    const { status, recommendation, aiResponse } = await evaluateResponse({
      userText: text,
      item: currentItem,
      nextItem
    });

    const updatedChecklist = checklist.map((item, index) =>
      index === currentIndex
        ? {
            ...item,
            status,
            recommendation
          }
        : item
    );
    setChecklist(updatedChecklist);

    setIsProcessing(false);

    addConversationMessage('ai', aiResponse);

    const nextIndex = currentIndex + 1;
    if (nextIndex < updatedChecklist.length) {
      setCurrentIndex(nextIndex);
      speakText(aiResponse, () => {
        const prompt = `Please confirm: ${updatedChecklist[nextIndex].question}`;
        addConversationMessage('ai', prompt);
        speakText(prompt, startListening);
      });
    } else {
      setCurrentIndex(nextIndex);
      const passCount = updatedChecklist.filter((item) => item.status === 'pass').length;
      const warningCount = updatedChecklist.filter((item) => item.status === 'warning').length;
      const failCount = updatedChecklist.filter((item) => item.status === 'fail').length;

      speakText(aiResponse, () => {
        const summaryMessage = `Final summary: ${passCount} passed, ${warningCount} warning, ${failCount} failed. Download the reviewed checklist whenever you are ready to wrap up.`;
        addConversationMessage('ai', summaryMessage);
        speakText(summaryMessage, () => {
          setCallTone('connected');
          setStatusLabel('Review complete');
        });
      });
    }
  };

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
      return;
    }

    let storedDetails;
    try {
      storedDetails = JSON.parse(serialized);
    } catch (error) {
      console.warn('Unable to parse stored Agora agent session details', error);
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
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
      return;
    }

    if (!agentId) {
      console.warn('Unable to resolve Agora agent identifier; skipping leave request.');
      storage.removeItem(AGORA_AGENT_LAST_JOIN_KEY);
      return;
    }

    try {
      const response = await fetch(AGENT_LEAVE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
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
    }
  };

  const handleEndCall = async () => {
    setCallActive(false);
    stopListening();
    window.speechSynthesis.cancel();
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
          Your browser does not fully support the Web Speech API features required for this
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
          <ConversationVisualizer tone={callTone} isConnected={agoraJoined} />
          <TranscriptPanel conversation={conversation} />
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
