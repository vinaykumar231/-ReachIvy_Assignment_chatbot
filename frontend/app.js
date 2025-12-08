const WS_URL = 'ws://localhost:8000/ws';

let state = {
    ws: null,
    sessionId: null,
    questionCount: 0,
    totalQuestions: 7,
    isRecording: false,
    isConversationStarted: false,
    sessionStartTime: null,
    timerInterval: null,
    currentPlan: null,
    lastInputMethod: 'text',
    
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
    
    // Student profile data
    studentProfile: {
        grade: null,
        age: null,
        interests: [],
        strengths: [],
        constraints: [],
        career_interests: []
    },
    
    // Browser capabilities
    browserCapabilities: {
        hasSpeechRecognition: false,
        hasMediaRecorder: false,
        hasAudioContext: false
    }
};

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
    checkBrowserCapabilities();
    initWebSocket();
    setupEventListeners();
    startSessionTimer();
    checkMicrophonePermission();
    
    if (state.browserCapabilities.hasSpeechRecognition) {
        initSpeechRecognition();
    } else {
        showStatus('info', 'Voice input not available. Please type your responses.');
        updateVoiceUIForNoSupport();
    }
});

// ==================== WEBSOCKET HANDLING ====================

function initWebSocket() {
    console.log('🔌 Connecting to WebSocket:', WS_URL);
    
    state.ws = new WebSocket(WS_URL);
    
    state.ws.onopen = () => {
        console.log(' WebSocket connected');
        showStatus('connected', 'Connecting to career counselor...');
        
        // Send connect message
        state.ws.send(JSON.stringify({ type: 'connect' }));
    };
    
    state.ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log(' Received:', data.type);
            handleWebSocketMessage(data);
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    state.ws.onerror = (error) => {
        console.error(' WebSocket error:', error);
        showStatus('error', 'Connection error - Using limited mode');
    };
    
    state.ws.onclose = () => {
        console.log('🔌 WebSocket closed');
        showStatus('error', 'Disconnected. Reconnecting...');
        setTimeout(initWebSocket, 3000);
    };
}

function handleWebSocketMessage(data) {
    switch(data.type) {
        case 'connected':
            state.sessionId = data.session_id;
            console.log(' Session ID:', state.sessionId);
            showStatus('connected', 'Ready to start career discovery');
            updateStatusText('Ready to start');
            setTimeout(hideStatus, 2000);
            break;
        
        case 'response':
            handleResponse(data);
            break;
        
        case 'plan_generated':
            handlePlanGenerated(data);
            break;
        
        case 'career_suggestions':
            addMessage('ai', data.text);
            if (data.audio && state.lastInputMethod === 'voice') {
                playAudio(data.audio);
            }
            hideStatus();
            break;
        
        case 'career_comparison':
            addMessage('ai', data.text);
            if (data.audio && state.lastInputMethod === 'voice') {
                playAudio(data.audio);
            }
            hideStatus();
            break;
        
        case 'profile':
            updateStudentProfile(data.student_profile);
            break;
        
        case 'history':
            console.log('Conversation history:', data.conversation);
            break;
        
        case 'stats':
            console.log('Session stats:', data.stats);
            break;
        
        case 'status':
            showStatus(data.status || 'thinking', data.message);
            break;
        
        case 'error':
            showStatus('error', data.message);
            addMessage('ai', 'I encountered an error: ' + data.message);
            hideStatus();
            break;
        
        case 'conversation_cleared':
            addMessage('system', data.message);
            break;
        
        case 'pong':
            console.log('Pong received');
            break;
        
        default:
            console.log('Unknown message type:', data.type);
    }
}

function handleResponse(data) {
    addMessage('ai', data.text);
    
    // Only play audio if last input was voice
    if (data.audio && state.lastInputMethod === 'voice') {
        playAudio(data.audio);
    }
    
    // Update progress
    state.questionCount++;
    updateProgress();
    
    // Update student profile from metadata if available
    if (data.metadata?.profile_update) {
        updateStudentProfile(data.metadata.profile_update);
    }
    
    // Show plan button after sufficient conversation
    if (state.questionCount >= 3) {
        const planBtn = document.getElementById('planBtn');
        if (planBtn) {
            planBtn.disabled = false;
            planBtn.style.display = 'inline-flex';
        }
    }
    
    hideStatus();
}

function handlePlanGenerated(data) {
    state.currentPlan = data.plan;
    
    let planMessage = "✅ I've generated a comprehensive career plan for you! ";
    if (data.plan?.career_recommendation?.primary_career) {
        planMessage += `I recommend **${data.plan.career_recommendation.primary_career}** as your primary path. `;
    }
    planMessage += "Click 'View Career Plan' to see the details.";
    
    addMessage('ai', planMessage);
    
    if (data.audio && state.lastInputMethod === 'voice') {
        playAudio(data.audio);
    }
    
    const planBtn = document.getElementById('planBtn');
    if (planBtn) {
        planBtn.disabled = false;
        planBtn.style.display = 'inline-flex';
        planBtn.innerHTML = '<i class="fas fa-eye"></i> View Career Plan';
    }
    
    showStatus('success', 'Career plan generated!');
    setTimeout(hideStatus, 3000);
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
            state.lastInputMethod = 'text';
            sendMessage();
        });
    }
    
    // Enter key in textarea
    const messageInput = document.getElementById('messageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                state.lastInputMethod = 'text';
                sendMessage();
            }
        });
        
        messageInput.addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        });
    }
    
    // Start button
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', startConversation);
    }
    
    // Restart button
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) {
        restartBtn.addEventListener('click', resetSession);
        restartBtn.style.display = 'none';
    }
    
    // Plan button
    const planBtn = document.getElementById('planBtn');
    if (planBtn) {
        planBtn.addEventListener('click', () => {
            if (state.currentPlan) {
                showPlanModal(state.currentPlan);
            } else {
                requestCareerPlan();
            }
        });
        planBtn.style.display = 'none';
    }
    
    // Stats button
    const statsBtn = document.getElementById('statsBtn');
    if (statsBtn) {
        statsBtn.addEventListener('click', () => {
            if (state.ws && state.ws.readyState === WebSocket.OPEN) {
                state.ws.send(JSON.stringify({ type: 'stats' }));
            }
        });
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
    
    // Download buttons
    const downloadPlanBtn = document.getElementById('downloadPlanBtn');
    if (downloadPlanBtn) {
        downloadPlanBtn.addEventListener('click', downloadCareerPlan);
    }
    
    const downloadPDFBtn = document.getElementById('downloadPDFBtn');
    if (downloadPDFBtn) {
        downloadPDFBtn.addEventListener('click', downloadCareerPlanPDF);
    }
    
    // Stats modal close
    const closeStatsBtn = document.getElementById('closeStatsBtn');
    if (closeStatsBtn) {
        closeStatsBtn.addEventListener('click', closeStatsModal);
    }
    
    const closeStatsModalBtn = document.getElementById('closeStatsModal');
    if (closeStatsModalBtn) {
        closeStatsModalBtn.addEventListener('click', closeStatsModal);
    }
    
    // Audio visualization
    if (state.browserCapabilities.hasAudioContext) {
        initAudioVisualization();
    }
}

// ==================== CONVERSATION MANAGEMENT ====================

function startConversation() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        showStatus('error', 'Not connected to server. Please wait...');
        return;
    }
    
    console.log('🎬 Starting career conversation');
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
        startBtn.disabled = true;
    }
    
    startBtn.style.display = 'none';
    const restartBtn = document.getElementById('restartBtn');
    if (restartBtn) restartBtn.style.display = 'inline-flex';
    
    state.ws.send(JSON.stringify({ 
        type: 'text',
        message: 'ready',
        wants_audio: state.lastInputMethod === 'voice'
    }));
    
    showStatus('thinking', 'Starting career discovery...');
    state.isConversationStarted = true;
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    addMessage('user', message);
    input.value = '';
    input.style.height = 'auto';
    
    showStatus('thinking', 'AI counselor is thinking...');
    
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({
            type: 'text',
            message: message,
            wants_audio: state.lastInputMethod === 'voice'
        }));
    } else {
        setTimeout(() => {
            processOfflineResponse(message);
        }, 1500);
    }
}

function requestCareerPlan() {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        showStatus('error', 'Not connected. Please check connection.');
        return;
    }
    
    if (state.questionCount < 3) {
        showStatus('warning', 'I need more information first. Please answer a few more questions.');
        return;
    }
    
    showStatus('thinking', 'Generating comprehensive career plan...');
    
    state.ws.send(JSON.stringify({
        type: 'request_plan',
        wants_audio: state.lastInputMethod === 'voice'
    }));
}

// ==================== BROWSER CAPABILITIES CHECK ====================

function checkBrowserCapabilities() {
    state.browserCapabilities.hasSpeechRecognition = 
        'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    state.browserCapabilities.hasMediaRecorder = 
        'MediaRecorder' in window;
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

// ==================== SPEECH RECOGNITION ====================

function initSpeechRecognition() {
    if (state.browserCapabilities.hasSpeechRecognition) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        state.speechRecognition = new SpeechRecognition();
        
        state.speechRecognition.continuous = false;
        state.speechRecognition.interimResults = true;
        state.speechRecognition.lang = 'en-US';
        state.speechRecognition.maxAlternatives = 1;
        
        state.speechRecognition.onstart = () => {
            console.log('🎤 Speech recognition started');
            state.isTranscribing = true;
            state.lastInputMethod = 'voice';
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
            
            if (interimTranscript) {
                const messageInput = document.getElementById('messageInput');
                if (messageInput) {
                    messageInput.value = interimTranscript;
                }
            }
            
            if (finalTranscript) {
                console.log(' Final transcript:', finalTranscript);
                const messageInput = document.getElementById('messageInput');
                if (messageInput) {
                    messageInput.value = finalTranscript;
                }
                
                setTimeout(() => {
                    sendMessage();
                }, 500);
            }
        };
        
        state.speechRecognition.onerror = (event) => {
            console.error(' Speech recognition error:', event.error);
            state.isTranscribing = false;
            state.lastInputMethod = 'text';
            showVoiceIndicator(false);
            updateVoiceStatus('Tap to speak');
            stopAudioVisualization();
            
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                showStatus('error', 'Speech recognition denied. Please allow microphone access.');
            }
        };
        
        state.speechRecognition.onend = () => {
            console.log('🎤 Speech recognition ended');
            state.isTranscribing = false;
            showVoiceIndicator(false);
            updateVoiceStatus('Tap to speak');
            stopAudioVisualization();
        };
    }
}

// ==================== VOICE RECORDING ====================

async function toggleVoiceRecording() {
    if (!state.browserCapabilities.hasSpeechRecognition) {
        showStatus('error', 'Voice input not supported. Please type your response.');
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
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        state.audioStream = stream;
        state.speechRecognition.start();
        
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            voiceButton.classList.add('recording');
        }
        
    } catch (error) {
        console.error(' Microphone access error:', error);
        showStatus('error', 'Error accessing microphone. Please use text input.');
    }
}

function stopVoiceRecording() {
    if (state.speechRecognition && state.isTranscribing) {
        state.speechRecognition.stop();
    }
    
    if (state.audioStream) {
        state.audioStream.getTracks().forEach(track => track.stop());
        state.audioStream = null;
    }
    
    const voiceButton = document.getElementById('voiceButton');
    if (voiceButton) {
        voiceButton.classList.remove('recording');
    }
}

// ==================== AUDIO VISUALIZATION ====================

function initAudioVisualization() {
    if (!state.browserCapabilities.hasAudioContext) return;
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
        state.dataArray = new Uint8Array(state.analyser.frequencyBinCount);
        
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
    
    const bars = document.querySelectorAll('.voice-bars .bar');
    bars.forEach(bar => {
        bar.style.height = '20px';
        bar.style.opacity = '0.5';
    });
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
        questionCountEl.textContent = `${state.questionCount} questions answered`;
    }
    
    const progressBadge = document.getElementById('progressBadge');
    if (progressBadge) {
        progressBadge.textContent = `${state.questionCount}/${state.totalQuestions}`;
    }
    
    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
        progressFill.style.width = percent + '%';
    }
}

function updateStudentProfile(profile) {
    // Merge profile updates
    Object.keys(profile).forEach(key => {
        if (Array.isArray(state.studentProfile[key])) {
            state.studentProfile[key] = [...new Set([...state.studentProfile[key], ...profile[key]])];
        } else {
            state.studentProfile[key] = profile[key];
        }
    });
    
    const studentProfileEl = document.getElementById('studentProfile');
    const profileDetailsEl = document.getElementById('profileDetails');
    
    if (studentProfileEl && profileDetailsEl) {
        let html = '';
        
        if (state.studentProfile.grade) {
            html += `<div><strong>Grade:</strong> ${state.studentProfile.grade}</div>`;
        }
        
        if (state.studentProfile.interests.length > 0) {
            html += `<div><strong>Interests:</strong> ${state.studentProfile.interests.join(', ')}</div>`;
        }
        
        if (state.studentProfile.strengths.length > 0) {
            html += `<div><strong>Strengths:</strong> ${state.studentProfile.strengths.join(', ')}</div>`;
        }
        
        if (html) {
            studentProfileEl.style.display = 'block';
            profileDetailsEl.innerHTML = html;
        }
    }
}

function showPlanModal(plan) {
    const modal = document.getElementById('planModal');
    const content = document.getElementById('planContent');
    
    if (!modal || !content) return;
    
    let html = '';
    
    if (plan.student_profile) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-user-graduate"></i> Student Profile</h3>
                <div class="profile-grid">
                    ${plan.student_profile.grade ? `<div><strong>Grade:</strong> ${plan.student_profile.grade}</div>` : ''}
                    ${plan.student_profile.age_range ? `<div><strong>Age Range:</strong> ${plan.student_profile.age_range}</div>` : ''}
                    ${plan.student_profile.location ? `<div><strong>Location:</strong> ${plan.student_profile.location}</div>` : ''}
                    ${plan.student_profile.learning_style ? `<div><strong>Learning Style:</strong> ${plan.student_profile.learning_style}</div>` : ''}
                </div>
                
                ${plan.student_profile.interests?.length > 0 ? 
                    `<div class="interests"><strong>Interests:</strong> ${plan.student_profile.interests.join(', ')}</div>` : ''}
                
                ${plan.student_profile.strengths?.length > 0 ? 
                    `<div class="strengths"><strong>Strengths:</strong> ${plan.student_profile.strengths.join(', ')}</div>` : ''}
            </div>
        `;
    }
    
    if (plan.career_recommendation) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-bullseye"></i> Career Recommendation</h3>
                <div class="recommendation">
                    <div class="primary-career">
                        <h4>Primary Career: ${plan.career_recommendation.primary_career || 'Not specified'}</h4>
                        ${plan.career_recommendation.alignment_score ? 
                            `<div class="score">Alignment Score: ${plan.career_recommendation.alignment_score}/10</div>` : ''}
                    </div>
                    
                    ${plan.career_recommendation.rationale ? 
                        `<div class="rationale"><strong>Rationale:</strong> ${plan.career_recommendation.rationale}</div>` : ''}
                    
                    ${plan.career_recommendation.alternative_careers?.length > 0 ? 
                        `<div class="alternatives"><strong>Alternative Careers:</strong> ${plan.career_recommendation.alternative_careers.join(', ')}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    if (plan.education_path) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-university"></i> Education Path</h3>
                <div class="education-path">
                    ${plan.education_path.recommended_degree ? 
                        `<div><strong>Recommended Degree:</strong> ${plan.education_path.recommended_degree}</div>` : ''}
                    
                    ${plan.education_path.entrance_exams?.length > 0 ? 
                        `<div><strong>Entrance Exams:</strong> ${plan.education_path.entrance_exams.join(', ')}</div>` : ''}
                    
                    ${plan.education_path.top_institutions_india?.length > 0 ? `
                        <div class="institutions">
                            <strong>Top Institutions (India):</strong>
                            <div class="institution-list">
                                ${plan.education_path.top_institutions_india.map(inst => `
                                    <div class="institution">
                                        <strong>${inst.name}</strong> (${inst.location})<br>
                                        ${inst.program || ''}
                                        ${inst.fees_total_inr ? `<br>Fees: ₹${inst.fees_total_inr.toLocaleString()}` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    if (plan.skill_development_roadmap) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-road"></i> Skill Development Roadmap</h3>
                <div class="roadmap">
                    ${plan.skill_development_roadmap.current_skills?.length > 0 ? 
                        `<div><strong>Current Skills:</strong> ${plan.skill_development_roadmap.current_skills.join(', ')}</div>` : ''}
                    
                    ${plan.skill_development_roadmap.priority_1_immediate?.length > 0 ? `
                        <div class="priority">
                            <h4>Immediate Priorities (Next 3 months):</h4>
                            ${plan.skill_development_roadmap.priority_1_immediate.map(skill => `
                                <div class="skill-item">
                                    <strong>${skill.skill}:</strong> ${skill.why || ''}
                                    ${skill.resource ? `<br>Resource: ${skill.resource}` : ''}
                                    ${skill.timeline_weeks ? `<br>Timeline: ${skill.timeline_weeks} weeks` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                    
                    ${plan.skill_development_roadmap.projects_to_build?.length > 0 ? `
                        <div class="projects">
                            <h4>Recommended Projects:</h4>
                            ${plan.skill_development_roadmap.projects_to_build.map(project => `
                                <div class="project">
                                    <strong>${project.project_name}</strong>
                                    ${project.skills_demonstrated?.length > 0 ? 
                                        `<br>Skills: ${project.skills_demonstrated.join(', ')}` : ''}
                                    ${project.timeline_weeks ? `<br>Timeline: ${project.timeline_weeks} weeks` : ''}
                                    ${project.difficulty ? `<br>Difficulty: ${project.difficulty}` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    if (plan.financial_planning) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-coins"></i> Financial Planning</h3>
                <div class="financial">
                    ${plan.financial_planning.total_education_cost_inr ? 
                        `<div><strong>Estimated Total Cost:</strong> ₹${plan.financial_planning.total_education_cost_inr.toLocaleString()}</div>` : ''}
                    
                    ${plan.financial_planning.scholarship_opportunities?.length > 0 ? `
                        <div class="scholarships">
                            <h4>Scholarship Opportunities:</h4>
                            ${plan.financial_planning.scholarship_opportunities.map(scholarship => `
                                <div class="scholarship">
                                    <strong>${scholarship.name}</strong>
                                    ${scholarship.amount_inr ? `<br>Amount: ₹${scholarship.amount_inr.toLocaleString()}` : ''}
                                    ${scholarship.eligibility ? `<br>Eligibility: ${scholarship.eligibility}` : ''}
                                    ${scholarship.deadline ? `<br>Deadline: ${scholarship.deadline}` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    if (plan.success_metrics) {
        html += `
            <div class="plan-section">
                <h3><i class="fas fa-chart-line"></i> Success Metrics</h3>
                <div class="metrics">
                    ${plan.success_metrics.career_match_confidence ? 
                        `<div class="metric-bar">
                            <span>Career Match Confidence:</span>
                            <div class="bar-bg">
                                <div class="bar-fill" style="width: ${plan.success_metrics.career_match_confidence * 10}%">
                                    ${plan.success_metrics.career_match_confidence}/10
                                </div>
                            </div>
                        </div>` : ''}
                    
                    ${plan.success_metrics.readiness_for_application ? 
                        `<div class="metric-bar">
                            <span>Readiness for Application:</span>
                            <div class="bar-bg">
                                <div class="bar-fill" style="width: ${plan.success_metrics.readiness_for_application}%">
                                    ${plan.success_metrics.readiness_for_application}%
                                </div>
                            </div>
                        </div>` : ''}
                    
                    ${plan.success_metrics.missing_research?.length > 0 ? `
                        <div class="missing-research">
                            <h4>Areas for Further Research:</h4>
                            <ul>
                                ${plan.success_metrics.missing_research.map(item => `<li>${item}</li>`).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    content.innerHTML = html;
    modal.classList.add('show');
}

function displayStats(stats) {
    const modal = document.getElementById('statsModal');
    const content = document.getElementById('statsContent');
    
    if (!modal || !content) return;
    
    let html = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${stats.total_messages || 0}</div>
                <div class="stat-label">Total Messages</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.user_messages || 0}</div>
                <div class="stat-label">Your Messages</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.assistant_messages || 0}</div>
                <div class="stat-label">AI Responses</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.current_phase || 'initial'}</div>
                <div class="stat-label">Current Phase</div>
            </div>
        </div>
        
        <div class="stats-details">
            <h3>Session Details</h3>
            
            ${stats.session_id ? `<p><strong>Session ID:</strong> ${stats.session_id}</p>` : ''}
            
            ${stats.discovery_started !== undefined ? 
                `<p><strong>Discovery Started:</strong> ${stats.discovery_started ? 'Yes' : 'No'}</p>` : ''}
            
            ${stats.current_language ? `<p><strong>Language:</strong> ${stats.current_language}</p>` : ''}
            
            ${stats.plan_generated !== undefined ? 
                `<p><strong>Plan Generated:</strong> ${stats.plan_generated ? 'Yes' : 'No'}</p>` : ''}
            
            ${stats.last_interaction ? 
                `<p><strong>Last Interaction:</strong> ${new Date(stats.last_interaction).toLocaleTimeString()}</p>` : ''}
            
            ${stats.student_profile ? `
                <div class="student-profile-stats">
                    <h4>Student Profile Summary</h4>
                    ${stats.student_profile.grade ? `<p><strong>Grade:</strong> ${stats.student_profile.grade}</p>` : ''}
                    
                    ${stats.student_profile.interests?.length > 0 ? 
                        `<p><strong>Interests:</strong> ${stats.student_profile.interests.join(', ')}</p>` : ''}
                    
                    ${stats.student_profile.strengths?.length > 0 ? 
                        `<p><strong>Strengths:</strong> ${stats.student_profile.strengths.join(', ')}</p>` : ''}
                </div>
            ` : ''}
        </div>
    `;
    
    content.innerHTML = html;
    modal.classList.add('show');
}

function downloadCareerPlan() {
    if (!state.currentPlan) {
        showStatus('error', 'No career plan available to download');
        return;
    }
    
    const dataStr = JSON.stringify(state.currentPlan, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `career-plan-${state.sessionId || 'session'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showStatus('success', 'Career plan downloaded!');
}

function downloadCareerPlanPDF() {
    showStatus('info', 'PDF generation coming soon!');
}

function showStatus(type, text) {
    const indicator = document.getElementById('statusIndicator');
    const statusMessage = document.getElementById('statusMessage');
    
    if (!indicator || !statusMessage) return;
    
    indicator.className = `status-indicator show ${type}`;
    statusMessage.textContent = text;
}

function updateStatusText(text) {
    const statusText = document.getElementById('statusText');
    if (statusText) {
        statusText.textContent = text;
    }
    
    const chatStatus = document.getElementById('chatStatus');
    if (chatStatus) {
        if (text.toLowerCase().includes('ready')) {
            chatStatus.className = 'chat-status connected';
        } else if (text.toLowerCase().includes('thinking') || text.toLowerCase().includes('generating')) {
            chatStatus.className = 'chat-status thinking';
        } else if (text.toLowerCase().includes('error') || text.toLowerCase().includes('disconnected')) {
            chatStatus.className = 'chat-status error';
        }
    }
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

function closeModal() {
    const modal = document.getElementById('planModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function closeStatsModal() {
    const modal = document.getElementById('statsModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function startSessionTimer() {
    state.sessionStartTime = Date.now();
    
    state.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        
        const timerDisplay = document.getElementById('timerDisplay');
        if (timerDisplay) {
            timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        
        const timerBtn = document.getElementById('timer');
        if (timerBtn) {
            timerBtn.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

function resetSession() {
    if (confirm('Are you sure you want to reset? All progress will be lost.')) {
        if (state.isTranscribing) {
            stopVoiceRecording();
        }
        
        state.questionCount = 0;
        state.studentProfile = {
            grade: null,
            age: null,
            interests: [],
            strengths: [],
            constraints: [],
            career_interests: []
        };
        state.currentPlan = null;
        state.isConversationStarted = false;
        state.lastInputMethod = 'text';
        
        const messagesContainer = document.getElementById('chatMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        
        const startBtn = document.getElementById('startBtn');
        if (startBtn) {
            startBtn.style.display = 'inline-flex';
            startBtn.innerHTML = '<i class="fas fa-play"></i> Start Career Discovery';
            startBtn.disabled = false;
        }
        
        const restartBtn = document.getElementById('restartBtn');
        if (restartBtn) {
            restartBtn.style.display = 'none';
        }
        
        const planBtn = document.getElementById('planBtn');
        if (planBtn) {
            planBtn.disabled = true;
            planBtn.style.display = 'none';
        }
        
        const studentProfileEl = document.getElementById('studentProfile');
        if (studentProfileEl) {
            studentProfileEl.style.display = 'none';
        }
        
        updateProgress();
        
        clearInterval(state.timerInterval);
        state.sessionStartTime = Date.now();
        startSessionTimer();
        
        if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
            initWebSocket();
        }
        
        showStatus('success', 'Session reset. Ready to start fresh!');
    }
}

// ==================== OFFLINE MODE ====================

function processOfflineResponse(userInput) {
    state.questionCount++;
    updateProgress();
    
    const offlineQuestions = [
        "Great! What grade are you currently in?",
        "What subjects or activities do you enjoy most in school?",
        "Tell me about your hobbies or interests outside of school.",
        "What are you naturally good at?",
        "Are there any career fields you're curious about?",
        "Do you have any constraints or considerations (like location, budget, etc.)?",
        "Where do you see yourself in 5 years?"
    ];
    
    if (state.questionCount < state.totalQuestions) {
        const nextQuestion = offlineQuestions[state.questionCount - 1];
        
        setTimeout(() => {
            addMessage('ai', nextQuestion);
            if (state.lastInputMethod === 'voice') {
                speakText(nextQuestion);
            }
            hideStatus();
        }, 1000);
    } else {
        const finalMessage = "Excellent! We've gathered enough information. I can now create a career plan for you.";
        setTimeout(() => {
            addMessage('ai', finalMessage);
            if (state.lastInputMethod === 'voice') {
                speakText(finalMessage);
            }
            const planBtn = document.getElementById('planBtn');
            if (planBtn) {
                planBtn.disabled = false;
                planBtn.style.display = 'inline-flex';
            }
            
            setTimeout(() => {
                showStatus('success', 'Ready to generate career plan!');
            }, 2000);
        }, 1000);
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

// ==================== KEEP ALIVE ====================

setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify({ type: 'ping' }));
    }
}, 30000);

window.addEventListener('beforeunload', () => {
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

console.log('AI Career Counselor frontend loaded');