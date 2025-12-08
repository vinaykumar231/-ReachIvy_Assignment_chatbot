#  CareerGuide AI - AI-Powered Career & Essay Guidance Platform

**Production-ready FastAPI backend with Google Gemini AI for high school career exploration and essay brainstorming**

##  Overview

CareerGuide AI is an autonomous voice-first platform that helps high school students explore career streams, understand job possibilities across industries, identify required skills, and craft compelling application essays—all through natural voice conversation. Powered by Google's Gemini AI, it provides personalized guidance with zero human intervention required.

### Key Features

- **Career Exploration**: Discover career paths based on interests and skills
- **Industry Insights**: Understand job possibilities across 50+ industries
- **Skill Mapping**: Identify and develop skills for chosen careers
- **Essay Brainstorming**: Create strategic 350-word application essays
- **Voice-First Interface**: Natural spoken conversation with TTS/STT
- **Fully Autonomous**: No human intervention needed
- **Structured Guidance**: Step-by-step career and application strategy
- **Production-Ready**: FastAPI, WebSockets, session management
- **Multi-Language**: Supports English, Hindi, and Hinglish

---

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────────┐
│   Client    │◄──────────────────►│    FastAPI       │
│ (Browser/   │    Audio/JSON      │    Backend       │
│   Mobile)   │                    │                  │
└─────────────┘                    └──────────────────┘
                                             │
                    ┌────────────────────────┼──────────────────────┐
                    │                        │                      │
            ┌───────▼──────┐          ┌──────▼──────┐        ┌──────▼──────┐
            │   Google     │          │   Google    │        │ Session     │
            │   Gemini AI  │          │     TTS     │        │ Management  │
            │              │          │             │        │             │
            └──────────────┘          └─────────────┘        └─────────────┘
```

### Technology Stack

**Backend Framework**
- FastAPI (async Python web framework)
- Uvicorn (ASGI server)
- WebSockets (real-time bidirectional communication)

**AI & Speech Services**
- Google Gemini 2.5 Flash (conversation AI & career analysis)
- Google Cloud Text-to-Speech (voice synthesis in multiple languages)
- Google Cloud Speech-to-Text (voice transcription)

**Core Features**
- Intent detection & natural language understanding
- Dynamic conversation flow management
- Multi-language support (English/Hindi/Hinglish)
- Essay structure generation with word allocation
- Career path recommendation engine

**Session Management**
- Redis for session caching (optional)
- In-memory session management
- Conversation history tracking
- Progress monitoring

---

##  Prerequisites

### 1. Required Accounts
- **Google AI Studio Account** for Gemini API
- **Google Cloud Account** for TTS/STT (optional for MVP)
- Python 3.11+ environment

### 2. API Keys Required
1. **Gemini API Key** (Required)
   - Get from: https://makersuite.google.com/app/apikey
   - Supports: Gemini 2.5 Flash/Pro

2. **Google Cloud Credentials** (Optional for TTS)
   - Enable: Text-to-Speech API
   - Download: Service account JSON key

---

##  Quick Start (5 Minutes)

### 1. Clone & Setup

```bash
# Clone repository
git https://github.com/vinaykumar231/-ReachIvy_Assignment_chatbot.git
cd careerguide-ai

# Create virtual environment
python -m venv venv

# Activate (Linux/Mac)
source venv/bin/activate

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Configuration

Create `.env` file:

```bash
# Required - Gemini API Key
GEMINI_API_KEY=your_gemini_api_key_here

# Optional - Google Cloud (for enhanced TTS)
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json

# Server Configuration
HOST=0.0.0.0
PORT=8000
DEBUG=true
```

### 3. Get Your API Key

1. **Gemini API Key:**
   ```bash
   # Visit: https://makersuite.google.com/app/apikey
   # Click "Create API Key"
   # Copy and paste in .env file
   ```

2. **Google Cloud (Optional):**
   ```bash
   # 1. Create project at console.cloud.google.com
   # 2. Enable "Text-to-Speech API"
   # 3. Create service account
   # 4. Download JSON key
   ```

### 4. Run the Server

```bash

# Or using uvicorn directly
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```





**CareerGuide AI** - Empowering the next generation of professionals through AI-powered guidance and mentorship.