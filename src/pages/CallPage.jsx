import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const CallPage = () => {
  const navigate = useNavigate();
  const recognitionRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const devicePermissionRequestedRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const analyserRef = useRef(null);
  const volumeAnimationRef = useRef(null);
  const hasGreetedRef = useRef(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(true);
  const [callTone, setCallTone] = useState('connected');
  const [statusLabel, setStatusLabel] = useState('AI Assistant - Connected');
  const [conversation, setConversation] = useState([]);
  const [checklist, setChecklist] = useState(initialChecklist);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [callActive, setCallActive] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioDevices, setAudioDevices] = useState([{ deviceId: 'default', label: 'System Default' }]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('default');
  const [isDeviceMenuOpen, setIsDeviceMenuOpen] = useState(false);
  const [deviceStatusMessage, setDeviceStatusMessage] = useState('');
  const [inputVolume, setInputVolume] = useState(0);

  const isChecklistComplete = checklist.every((item) => item.status !== 'pending');

  useEffect(() => {
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
        setStatusLabel('Listening for your response…');
      }
    };

    recognitionRef.current = recognition;
    greetAndStart();
    applySelectedInput('default', { silent: true }).catch(() => {});

    return () => {
      recognition.stop();
      window.speechSynthesis.cancel();
      stopVolumeMonitor();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close?.();
        audioContextRef.current = null;
      }
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
        setDeviceStatusMessage('Device switching is not supported in this browser.');
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
          : {
              audio: {
                deviceId: { exact: deviceId }
              }
            };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      mediaStreamRef.current = stream;
      devicePermissionRequestedRef.current = true;
      await startVolumeMonitor(stream);
      setSelectedDeviceId(deviceId);
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
    setStatusLabel('AI Speaking…');

    utterance.onend = () => {
      if (!callActive) return;
      setCallTone('listening');
      setStatusLabel('Listening for your response…');
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
      setStatusLabel('Listening for your response…');
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
    setStatusLabel('Processing your response…');

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
          setStatusLabel('Review complete.');
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

  const handleEndCall = () => {
    setCallActive(false);
    stopListening();
    window.speechSynthesis.cancel();
    stopVolumeMonitor();
    if (audioContextRef.current) {
      audioContextRef.current.close?.();
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsDeviceMenuOpen(false);
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
      <div className="flex flex-1 flex-col gap-6 lg:flex-row">
        <div className="flex flex-1 flex-col gap-6">
          <ConversationVisualizer tone={callTone} />
          <TranscriptPanel conversation={conversation} />
        </div>
        <div className="lg:w-[28rem]">
          <ChecklistSidebar items={checklist} />
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
