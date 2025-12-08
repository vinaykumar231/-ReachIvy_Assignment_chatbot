const WS_URL = 'ws://localhost:8000/ws';

let state = {
    ws: null,
    sessionId: null,
    questionCount: 0,
    totalQuestions: 7,
    isRecording: false,
    isInterviewStarted: false,
    recordingStartTime: null,
    timerInterval: null,
    sessionStartTime: null,
    currentStructure: null,
    answers: [],
    lastInputMethod: 'text', // Track if last input was 'voice' or 'text'
    
    // Audio & Speech Recognition
    mediaRecorder: null,
    audioChunks: [],
    audioStream: null,
    speechRecognition: null,
    isTranscribing: false,
    isAudioRecording: false,
    
    // Voice visualization
    audioContext: null,
    analyser: null,
    animationFrameId: null,
    
    // Browser capabilities
    browserCapabilities: {
        hasSpeechRecognition: false,
        hasMediaRecorder: false,
        hasAudioContext: false
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    checkBrowserCapabilities();
    initWebSocket();
    setupEventListeners();
    startSessionTimer();
    checkMicrophonePermission();
    
    // Initialize speech recognition if supported
    if (state.browserCapabilities.hasSpeechRecognition) {
        initSpeechRecognition();
    } else {
        showStatus('info', 'Voice input not available. Please type your responses.');
        updateVoiceUIForNoSupport();
    }
});

// ==================== BROWSER CAPABILITIES CHECK ====================

function checkBrowserCapabilities() {
    // Check for Web Speech API
    state.browserCapabilities.hasSpeechRecognition = 
        'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    
    // Check for MediaRecorder API
    state.browserCapabilities.hasMediaRecorder = 
        'MediaRecorder' in window;
    
    // Check for Web Audio API
    state.browserCapabilities.hasAudioContext = 
        'AudioContext' in window || 'webkitAudioContext' in window;
    
    console.log('Browser capabilities:', state.browserCapabilities);
}

function updateVoiceUIForNoSupport() {
    const voiceButton = document.getElementById('voiceButton');
    const voiceStatus = document.getElementById('voiceStatus');
    
    if (voiceButton) {
        voiceButton.style.opacity = '0.5';
        voiceButton.style.cursor = 'not-allowed';
        voiceButton.title = 'Voice input not supported in this browser';
    }
    
    if (voiceStatus) {
        voiceStatus.textContent = 'Voice input not supported';
    }
}

// ==================== MICROPHONE PERMISSION ====================

async function checkMicrophonePermission() {
    try {
        const result = await navigator.permissions.query({ name: 'microphone' });
        console.log(' Microphone permission:', result.state);
        
        if (result.state === 'denied') {
            showStatus('error', 'Microphone access denied. Please enable it in browser settings.');
        }
    } catch (error) {
        console.log(' Permission API not supported');
    }
}

// ==================== WEBSOCKET ====================

function initWebSocket() {
    console.log('🔌 Connecting to WebSocket:', WS_URL);
    
    state.ws = new WebSocket(WS_URL);
    
    state.ws.onopen = () => {
        console.log(' WebSocket connected');
        showStatus('connected', 'Connected to server');
        
        // Send connect message
        state.ws.send(JSON.stringify({ type: 'connect' }));
    };
    
    state.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log(' Received:', data.type);
        handleWebSocketMessage(data);
    };
    
    state.ws.onerror = (error) => {
        console.error(' WebSocket error:', error);
        showStatus('error', 'Connection error - Using offline mode');
        initOfflineMode();
    };
    
    state.ws.onclose = () => {
        console.log('🔌 WebSocket closed');
        showStatus('error', 'Disconnected. Reconnecting...');
        
        // Attempt reconnection after 3 seconds
        setTimeout(initWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'connected':
            state.sessionId = data.session_id;
            console.log(' Session ID:', state.sessionId);
            showStatus('connected', 'Ready to start');
            setTimeout(hideStatus, 2000);
            break;
        
        case 'interview_started':
            state.isInterviewStarted = true;
            addMessage('ai', data.text);
            // Only play audio if last input was voice
            if (data.audio && state.lastInputMethod === 'voice') {
                playAudio(data.audio);
            }
            hideStatus();
            break;
        
        case 'response':
            addMessage('ai', data.text);
            // Only play audio if last input was voice
            if (data.audio && state.lastInputMethod === 'voice') {
                playAudio(data.audio);
            }
            state.questionCount++;
            updateProgress();
            hideStatus();
            
            // Show preview button when all questions answered
            if (state.questionCount >= state.totalQuestions) {
                const previewBtn = document.getElementById('previewBtn');
                if (previewBtn) {
                    previewBtn.disabled = false;
                    previewBtn.style.display = 'inline-flex';
                }
            }
            break;
        
        case 'interview_complete':
            addMessage('ai', data.text);
            // Only play audio if last input was voice
            if (data.audio && state.lastInputMethod === 'voice') {
                playAudio(data.audio);
            }
            if (data.structure) {
                state.currentStructure = data.structure;
                const previewBtn = document.getElementById('previewBtn');
                if (previewBtn) {
                    previewBtn.disabled = false;
                    previewBtn.style.display = 'inline-flex';
                }
                setTimeout(() => {
                    showStatus('success', 'Structure ready! Click "Preview Answers"');
                }, 2000);
            }
            hideStatus();
            break;
        
        case 'status':
            showStatus('thinking', data.message);
            break;
        
        case 'error':
            showStatus('error', data.message);
            addMessage('ai', ' ' + data.message);
            hideStatus();
            break;
        
        case 'pong':
            console.log('Pong received');
            break;
            
        case 'conversation_cleared':
            addMessage('system', ' ' + data.message);
            break;
        
        default:
            console.log('Unknown message type:', data.type);
    }
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Voice button
    const voiceButton = document.getElementById('voiceButton');
    if (voiceButton) {
        voiceButton.addEventListener('click', toggleVoiceRecording);
    }
    
    // Send button
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            state.lastInputMethod = 'text'; // Mark as text input
            sendMessage();
        });
    }
    
    // Enter key in textarea
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                state.lastInputMethod = 'text'; // Mark as text input
                sendMessage();
            }
        });
        
        // Auto-resize textarea
        messageInput.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        });
    }
    
    // Start button
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startInterview);
    }
    
    // Restart button
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.addEventListener('click', resetSession);
        restartBtn.style.display = 'none'; // Hide initially
    }
    
    // Preview button
    const previewBtn = document.getElementById('previewBtn');
    if (previewBtn) {
        previewBtn.addEventListener('click', () => {
            if (state.currentStructure) {
                showStructureModal(state.currentStructure);
            } else {
                showStructureModal(generateOfflineStructure());
            }
        });
        previewBtn.style.display = 'none'; // Hide initially
    }
    
    // Modal close buttons
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeModal);
    }
    
    const modalClose = document.getElementById('closeModal');
    if (modalClose) {
        modalClose.addEventListener('click', closeModal);
    }
    
    // Download button
    const downloadBtn = document.getElementById('downloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadStructure);
    }
    
    // Listen button (manually trigger audio playback)
    const listenBtn = document.getElementById('listenBtn');
    if (listenBtn) {
        listenBtn.addEventListener('click', () => {
            const messages = document.querySelectorAll('.message.ai .message-text');
            if (messages.length === 0) return;
            
            const lastMessage = messages[messages.length - 1];
            speakText(lastMessage.textContent);
            showStatus('thinking', 'Playing audio...');
        });
    }
    
    // Initialize audio visualization
    if (state.browserCapabilities.hasAudioContext) {
        initAudioVisualization();
    }
}

// ==================== SPEECH RECOGNITION ====================

function initSpeechRecognition() {
    if (state.browserCapabilities.hasSpeechRecognition) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        state.speechRecognition = new SpeechRecognition();
        
        // Configure speech recognition
        state.speechRecognition.continuous = false;
        state.speechRecognition.interimResults = true;
        state.speechRecognition.lang = 'en-US';
        state.speechRecognition.maxAlternatives = 1;
        
        // Event handlers
        state.speechRecognition.onstart = () => {
            console.log('🎤 Speech recognition started');
            state.isTranscribing = true;
            state.lastInputMethod = 'voice'; // Mark as voice input
            showVoiceIndicator(true);
            updateVoiceStatus('Listening... Speak now');
            startAudioVisualization();
        };
        
        state.speechRecognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Update input field with interim results
            if (interimTranscript) {
                const messageInput = document.getElementById('messageInput');
                if (messageInput) {
                    messageInput.value = interimTranscript;
                }
            }
            
            // When final result is ready, auto-send
            if (finalTranscript) {
                console.log(' Final transcript:', finalTranscript);
                const messageInput = document.getElementById('messageInput');
                if (messageInput) {
                    messageInput.value = finalTranscript;
                }
                
                // Auto-send after a short delay
                setTimeout(() => {
                    sendMessage();
                }, 500);
            }
        };
        
        state.speechRecognition.onerror = (event) => {
            console.error(' Speech recognition error:', event.error);
            state.isTranscribing = false;
            state.lastInputMethod = 'text'; // Reset to text on error
            showVoiceIndicator(false);
            updateVoiceStatus('Tap to speak');
            stopAudioVisualization();
            
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                showStatus('error', 'Speech recognition denied. Please allow microphone access.');
            } else if (event.error === 'no-speech') {
                showStatus('warning', 'No speech detected. Please try again.');
            } else if (event.error === 'audio-capture') {
                showStatus('error', 'No microphone found. Please connect a microphone.');
            }
        };
        
        state.speechRecognition.onend = () => {
            console.log('🎤 Speech recognition ended');
            state.isTranscribing = false;
            showVoiceIndicator(false);
            updateVoiceStatus('Tap to speak');
            stopAudioVisualization();
        };
        
        console.log(' Speech recognition initialized');
    }
}

// ==================== VOICE RECORDING ====================

async function toggleVoiceRecording() {
    // If speech recognition is not available, show message
    if (!state.browserCapabilities.hasSpeechRecognition) {
        showStatus('error', 'Voice input not supported in this browser. Please type your response.');
        return;
    }
    
    if (state.isTranscribing) {
        stopVoiceRecording();
    } else {
        await startVoiceRecording();
    }
}

async function startVoiceRecording() {
    if (!state.speechRecognition) {
        showStatus('error', 'Speech recognition not initialized');
        return;
    }
    
    try {
        // Request microphone access first
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        // Store stream for visualization
        state.audioStream = stream;
        
        // Start speech recognition
        state.speechRecognition.start();
        
        // Update UI
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            voiceButton.classList.add('recording');
        }
        
    } catch (error) {
        console.error(' Microphone access error:', error);
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            showStatus('error', 'Microphone access denied. Please allow microphone access.');
        } else if (error.name === 'NotFoundError') {
            showStatus('error', 'No microphone found. Please connect a microphone.');
        } else {
            showStatus('error', 'Error accessing microphone. Please use text input.');
        }
    }
}

function stopVoiceRecording() {
    if (state.speechRecognition && state.isTranscribing) {
        state.speechRecognition.stop();
    }
    
    // Stop and clean up audio stream
    if (state.audioStream) {
        state.audioStream.getTracks().forEach(track => track.stop());
        state.audioStream = null;
    }
    
    // Update UI
    const voiceButton = document.getElementById('voiceButton');
    if (voiceButton) {
        voiceButton.classList.remove('recording');
    }
}

// ==================== AUDIO VISUALIZATION ====================

function initAudioVisualization() {
    if (!state.browserCapabilities.hasAudioContext) {
        console.warn(' Web Audio API not supported');
        return;
    }
}

function startAudioVisualization() {
    if (!state.browserCapabilities.hasAudioContext || !state.audioStream) return;
    
    try {
        if (!state.audioContext) {
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }
        
        state.analyser = state.audioContext.createAnalyser();
        const source = state.audioContext.createMediaStreamSource(state.audioStream);
        source.connect(state.analyser);
        
        state.analyser.fftSize = 256;
        const bufferLength = state.analyser.frequencyBinCount;
        state.dataArray = new Uint8Array(bufferLength);
        
        // Start animation
        animateBars();
        
    } catch (error) {
        console.error(' Audio visualization error:', error);
    }
}

function animateBars() {
    if (!state.analyser || !state.dataArray || !state.isTranscribing) {
        return;
    }
    
    state.analyser.getByteFrequencyData(state.dataArray);
    
    const bars = document.querySelectorAll('.voice-bars .bar');
    if (bars.length > 0) {
        const step = Math.floor(state.dataArray.length / bars.length);
        
        bars.forEach((bar, index) => {
            const value = state.dataArray[index * step] || 0;
            const height = 10 + (value / 256) * 40;
            bar.style.height = `${height}px`;
            bar.style.opacity = 0.3 + (value / 256) * 0.7;
        });
    }
    
    state.animationFrameId = requestAnimationFrame(animateBars);
}

function stopAudioVisualization() {
    if (state.animationFrameId) {
        cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = null;
    }
    
    // Reset bars to default height
    const bars = document.querySelectorAll('.voice-bars .bar');
    bars.forEach(bar => {
        bar.style.height = '20px';
        bar.style.opacity = '0.5';
    });
}

// ==================== START INTERVIEW ====================

function startInterview() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        showStatus('error', 'Not connected to server. Please wait...');
        return;
    }
    
    console.log('🎬 Starting interview');
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
        startBtn.disabled = true;
    }
    
    // Hide start button, show restart button
    if (startBtn) startBtn.style.display = 'none';
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.style.display = 'inline-flex';
    
    // Send start message with input method preference
    state.ws.send(JSON.stringify({ 
        type: 'start_interview',
        wants_audio: state.lastInputMethod === 'voice'
    }));
    
    showStatus('thinking', 'Starting interview...');
    
    state.isInterviewStarted = true;
}

// ==================== SEND MESSAGE ====================

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    
    showStatus('thinking', 'AI is thinking...');
    
    // Send to WebSocket if connected
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'text',
            message: message,
            wants_audio: state.lastInputMethod === 'voice' // Tell server if we want audio
        }));
    } else {
        // Offline mode
        setTimeout(() => {
            processOfflineAnswer(message);
        }, 1500);
    }
}

function processOfflineAnswer(userInput) {
    state.answers.push(userInput);
    state.questionCount++;
    
    updateProgress();
    
    const offlineQuestions = [
        "That's interesting! Can you tell me more about why this specific goal matters to you?",
        "Now, thinking about your long-term vision - where do you see yourself 10-15 years from now?",
        "Great! What specific skills or knowledge do you think you need to develop?",
        "How does Stanford GSB specifically fit into your journey?",
        "Can you share a specific example from your background that demonstrates you're prepared?",
        "Finally, how do your short-term and long-term goals connect?"
    ];
    
    if (state.questionCount < state.totalQuestions) {
        const nextQuestion = offlineQuestions[state.questionCount - 1] || 
            "Thank you for sharing. Can you elaborate more on that?";
        
        setTimeout(() => {
            addMessage('ai', nextQuestion);
            // Only speak if last input was voice
            if (state.lastInputMethod === 'voice') {
                speakText(nextQuestion);
            }
            hideStatus();
        }, 1000);
    } else {
        const finalMessage = "Excellent! We've gathered all the information needed. Let me create your essay structure now.";
        setTimeout(() => {
            addMessage('ai', finalMessage);
            // Only speak if last input was voice
            if (state.lastInputMethod === 'voice') {
                speakText(finalMessage);
            }
            const previewBtn = document.getElementById('previewBtn');
            if (previewBtn) {
                previewBtn.disabled = false;
                previewBtn.style.display = 'inline-flex';
            }
            
            setTimeout(() => {
                showStatus('success', 'Structure ready! Click "Preview Answers"');
            }, 2000);
        }, 1000);
    }
}

// ==================== UI FUNCTIONS ====================

function addMessage(role, text) {
    const messagesContainer = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = role === 'ai' ? 'AI' : 'U';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;
    
    contentDiv.appendChild(textDiv);
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateProgress() {
    const percent = Math.round((state.questionCount / state.totalQuestions) * 100);
    
    const questionCountEl = document.getElementById('questionCount');
    if (questionCountEl) {
        questionCountEl.textContent = `${state.questionCount}/${state.totalQuestions} questions answered`;
    }
    
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = percent + '%';
    }
}

function startSessionTimer() {
    state.sessionStartTime = Date.now();
    
    state.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        const timerElement = document.getElementById('timer');
        if (timerElement) {
            timerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function showStatus(type, text) {
    const indicator = document.getElementById('statusIndicator');
    const statusMessage = document.getElementById('statusMessage');
    
    if (!indicator || !statusMessage) return;
    
    indicator.className = `status-indicator show ${type}`;
    statusMessage.textContent = text;
}

function hideStatus() {
    const indicator = document.getElementById('statusIndicator');
    if (!indicator) return;
    
    setTimeout(() => {
        indicator.classList.remove('show');
    }, 3000);
}

function showVoiceIndicator(show) {
    const indicator = document.getElementById('voiceIndicator');
    if (!indicator) return;
    
    if (show) {
        indicator.classList.add('show');
    } else {
        indicator.classList.remove('show');
    }
}

function updateVoiceStatus(text) {
    const voiceStatus = document.getElementById('voiceStatus');
    if (voiceStatus) {
        voiceStatus.textContent = text;
    }
}

function speakText(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.lang = 'en-US';
        
        utterance.onstart = () => {
            showStatus('thinking', 'Playing audio...');
        };
        
        utterance.onend = () => {
            hideStatus();
        };
        
        window.speechSynthesis.speak(utterance);
    }
}

function playAudio(base64Audio) {
    try {
        const audio = new Audio('data:audio/mp3;base64,' + base64Audio);
        audio.play().catch(err => {
            console.error('Error playing audio:', err);
        });
    } catch (error) {
        console.error('Error creating audio:', error);
    }
}

function showStructureModal(structure) {
    const modal = document.getElementById('structureModal');
    const content = document.getElementById('structureContent');
    
    if (!modal || !content) return;
    
    let html = `
        <div class="structure-intro">
            <h3>${structure.title || "Stanford MBA Essay Structure"}</h3>
            <p><strong>Total Words:</strong> ${structure.total_words || 350}</p>
            <p><strong>Overall Advice:</strong> ${structure.overall_advice || 'Focus on specific examples and concrete outcomes.'}</p>
        </div>
    `;
    
    if (structure.sections && structure.sections.length > 0) {
        html += '<div class="structure-sections">';
        structure.sections.forEach(section => {
            html += `
                <div class="structure-section">
                    <div class="section-header">
                        <h4>${section.section_name}</h4>
                        <span class="word-count">${section.word_count} words</span>
                    </div>
                    <p class="section-purpose">${section.purpose}</p>
                    
                    ${section.key_points && section.key_points.length > 0 ? `
                        <div class="key-points">
                            <strong>Key Points:</strong>
                            <ul>
                                ${section.key_points.map(point => `<li>${point}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            `;
        });
        html += '</div>';
    }
    
    content.innerHTML = html;
    modal.classList.add('show');
}

function closeModal() {
    const modal = document.getElementById('structureModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function downloadStructure() {
    const structure = state.currentStructure || generateOfflineStructure();
    
    const dataStr = JSON.stringify(structure, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stanford-essay-structure.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showStatus('success', 'Structure downloaded!');
}

function generateOfflineStructure() {
    return {
        title: "Stanford MBA Essay - Short & Long-term Goals",
        total_words: 350,
        overall_advice: "Focus on specific examples and concrete outcomes that demonstrate your readiness for Stanford GSB.",
        sections: [
            {
                section_name: "Introduction",
                word_count: 50,
                purpose: "Hook the reader with your passion and set up your short-term and long-term goals.",
                key_points: [
                    "Opening statement about your interest",
                    "Brief mention of immediate goal"
                ]
            },
            {
                section_name: "Short-term Goals",
                word_count: 100,
                purpose: "Describe what you want to achieve in the next 3-5 years.",
                key_points: [
                    "Specific career milestone",
                    "Skills you want to develop",
                    "Industries or companies of interest"
                ]
            },
            {
                section_name: "Long-term Vision",
                word_count: 100,
                purpose: "Paint a picture of your ultimate career aspirations.",
                key_points: [
                    "Leadership role or impact you envision",
                    "Problems you want to solve",
                    "Legacy you want to create"
                ]
            },
            {
                section_name: "Why Stanford",
                word_count: 75,
                purpose: "Connect Stanford's resources to your goals.",
                key_points: [
                    "Specific programs or courses",
                    "Faculty or research opportunities",
                    "How Stanford uniquely prepares you"
                ]
            },
            {
                section_name: "Conclusion",
                word_count: 25,
                purpose: "Strong closing that ties everything together.",
                key_points: [
                    "Reinforce commitment to goals",
                    "Express enthusiasm for Stanford"
                ]
            }
        ]
    };
}

function resetSession() {
    if (confirm('Are you sure you want to reset? All progress will be lost.')) {
        // Stop voice recording
        if (state.isTranscribing) {
            stopVoiceRecording();
        }
        
        // Reset state
        state.questionCount = 0;
        state.answers = [];
        state.currentStructure = null;
        state.isInterviewStarted = false;
        state.lastInputMethod = 'text'; // Reset to text
        
        // Clear messages
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        
        // Reset UI
        const startBtn = document.getElementById('startBtn');
        if (startBtn) {
            startBtn.style.display = 'inline-flex';
            startBtn.innerHTML = '<i class="fas fa-play"></i> Start Brainstorming';
            startBtn.disabled = false;
        }
        
        const restartBtn = document.getElementById('restartBtn');
        if (restartBtn) {
            restartBtn.style.display = 'none';
        }
        
        const previewBtn = document.getElementById('previewBtn');
        if (previewBtn) {
            previewBtn.disabled = true;
            previewBtn.style.display = 'none';
        }
        
        updateProgress();
        
        // Reset timer
        clearInterval(state.timerInterval);
        startSessionTimer();
        
        // Reconnect WebSocket if needed
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            initWebSocket();
        }
        
        showStatus('success', 'Session reset. Ready to start fresh!');
    }
}

// ==================== OFFLINE MODE ====================

function initOfflineMode() {
    console.log(' Running in offline mode');
    
    setTimeout(() => {
        if (state.questionCount === 0 && !state.isInterviewStarted) {
            const welcomeMessage = "Hello! I'm your AI essay coach. I'll help you brainstorm your Stanford MBA essay. Ready to start?";
            addMessage('ai', welcomeMessage);
            // Only speak in offline mode if explicitly requested
            
            // Enable start button
            const startBtn = document.getElementById('startBtn');
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.innerHTML = '<i class="fas fa-play"></i> Start Brainstorming';
            }
        }
    }, 2000);
}

// ==================== KEEP ALIVE ====================

setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000);

window.addEventListener('beforeunload', () => {
    // Cleanup
    if (state.isTranscribing) {
        stopVoiceRecording();
    }
    
    if (state.audioContext) {
        state.audioContext.close();
    }
    
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.close();
    }
    
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
    }
});

console.log('Voice Essay Brainstormer fully loaded');