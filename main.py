import os
import json
import logging
import base64
from datetime import datetime
from typing import Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from websocket_manager import manager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(title="AI Career Guidance Platform API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== WEBSOCKET ENDPOINT ====================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    Main WebSocket endpoint for career guidance interaction (Session-based - NO AUTH)
    
    Expected message formats:
    
    1. Initialize connection (first message):
       {"type": "connect"}
       -> Server responds with session_id
    
    2. Send text message:
       {"type": "text", "message": "I'm interested in technology careers"}
    
    3. Send audio (base64):
       {"type": "audio", "data": "base64_audio_data", "format": "webm"}
    
    4. Request career exploration:
       {"type": "explore_careers", "interests": ["technology", "design"]}
    
    5. Request career comparison:
       {"type": "compare_careers", "career1": "Software Engineer", "career2": "Data Scientist"}
    
    6. Get conversation history:
       {"type": "history"}
    
    7. Get student profile:
       {"type": "profile"}
    
    8. Get stats:
       {"type": "stats"}
    
    9. Clear conversation:
       {"type": "clear"}
    
    10. Ping:
        {"type": "ping"}
    """
    session_id = None
    
    try:
        await websocket.accept()
        logger.info(" WebSocket connection accepted")
        
        initial_data = await websocket.receive_text()
        initial_msg = json.loads(initial_data)
        
        session_id = manager.generate_session_id()
        await manager.connect(websocket, session_id)
        
        await manager.send_message(session_id, {
            "type": "connected",
            "session_id": session_id,
            "message": "Connected to AI Career Guidance Platform",
            "platform": "career_guidance",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat()
        })
        
        logger.info(f" New career guidance session created: {session_id}")
        
        while True:
            try:
                data = await websocket.receive_text()
                message = json.loads(data)
                msg_type = message.get("type", "")
                
                logger.info(f"Received from session {session_id}: {msg_type}")
                
                if msg_type == "ping":
                    await manager.send_message(session_id, {
                        "type": "pong",
                        "timestamp": datetime.now().isoformat()
                    })
                
                elif msg_type == "text":
                    counselor = manager.get_counselor(session_id)
                    if not counselor:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                        continue
                    
                    user_text = message.get("message", "").strip()
                    if not user_text:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "Empty message"
                        })
                        continue
                    
                    # Show thinking status
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "thinking",
                        "message": "AI is analyzing your response..."
                    })
                    
                    response_text, audio_base64, metadata = await counselor.process_response(user_text)
                    
                    stats = counselor.get_stats()
                    
                    await manager.send_message(session_id, {
                        "type": "response",
                        "text": response_text,
                        "audio": audio_base64,
                        "audio_format": "mp3",
                        "phase": stats.get("current_phase", "discovery"),
                        "language": stats.get("current_language", "en"),
                        "metadata": metadata,
                        "timestamp": datetime.now().isoformat()
                    })
                
                elif msg_type == "audio":
                    counselor = manager.get_counselor(session_id)
                    if not counselor:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                        continue
                    
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "transcribing",
                        "message": "Transcribing audio..."
                    })
                    
                    await manager.send_message(session_id, {
                        "type": "error",
                        "message": "Audio transcription not yet implemented. Please use text input for now."
                    })
                    
                elif msg_type == "explore_careers":
                    counselor = manager.get_counselor(session_id)
                    if not counselor:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                        continue
                    
                    interests = message.get("interests", [])
                    user_input = f"I'm interested in {', '.join(interests)}"
                    
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "matching",
                        "message": "Finding matching careers..."
                    })
                    
                    response_text, audio_base64, metadata = await counselor.process_response(user_input)
                    
                    await manager.send_message(session_id, {
                        "type": "career_suggestions",
                        "text": response_text,
                        "audio": audio_base64,
                        "interests": interests,
                        "timestamp": datetime.now().isoformat()
                    })
                
                elif msg_type == "compare_careers":
                    counselor = manager.get_counselor(session_id)
                    if not counselor:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                        continue
                    
                    career1 = message.get("career1", "")
                    career2 = message.get("career2", "")
                    
                    if not career1 or not career2:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "Please provide both careers to compare"
                        })
                        continue
                    
                    user_input = f"Compare {career1} vs {career2}"
                    
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "comparing",
                        "message": f"Comparing {career1} and {career2}..."
                    })
                    
                    response_text, audio_base64, metadata = await counselor.process_response(user_input)
                    
                    await manager.send_message(session_id, {
                        "type": "career_comparison",
                        "text": response_text,
                        "audio": audio_base64,
                        "career1": career1,
                        "career2": career2,
                        "timestamp": datetime.now().isoformat()
                    })
                
                elif msg_type == "history":
                    counselor = manager.get_counselor(session_id)
                    if counselor:
                        history = counselor.get_conversation_history()
                        await manager.send_message(session_id, {
                            "type": "history",
                            "conversation": history,
                            "total_messages": len(history),
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                
                elif msg_type == "profile":
                    counselor = manager.get_counselor(session_id)
                    if counselor:
                        stats = counselor.get_stats()
                        await manager.send_message(session_id, {
                            "type": "profile",
                            "student_profile": stats.get("student_profile", {}),
                            "current_phase": stats.get("current_phase", "initial"),
                            "language": stats.get("current_language", "en"),
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                
                elif msg_type == "stats":
                    counselor = manager.get_counselor(session_id)
                    if counselor:
                        stats = counselor.get_stats()
                        await manager.send_message(session_id, {
                            "type": "stats",
                            "stats": stats,
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                
                elif msg_type == "clear":
                    counselor = manager.get_counselor(session_id)
                    if counselor:
                        counselor.clear_conversation()
                        await manager.send_message(session_id, {
                            "type": "conversation_cleared",
                            "message": "Conversation history cleared. Starting fresh!",
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                
                else:
                    await manager.send_message(session_id, {
                        "type": "error",
                        "message": f"Unknown message type: {msg_type}",
                        "supported_types": [
                            "ping", "text", "audio", "explore_careers",
                            "compare_careers", "history", "profile", "stats", "clear"
                        ]
                    })
            
            except WebSocketDisconnect:
                logger.info(f"🔌 WebSocket disconnected for session {session_id}")
                break
            except json.JSONDecodeError as e:
                logger.error(f" JSON decode error: {e}")
                await manager.send_message(session_id, {
                    "type": "error",
                    "message": "Invalid JSON format"
                })
            except Exception as e:
                logger.error(f" Error processing message: {e}")
                import traceback
                traceback.print_exc()
                await manager.send_message(session_id, {
                    "type": "error",
                    "message": f"Error: {str(e)}"
                })
    
    except WebSocketDisconnect:
        if session_id:
            manager.disconnect(session_id)
        logger.info(f"🔌 Session {session_id} disconnected")
    except Exception as e:
        if session_id:
            manager.disconnect(session_id)
        logger.error(f" WebSocket error for session {session_id}: {e}", exc_info=True)




# ==================== RUN SERVER ====================

if __name__ == "__main__":
    import uvicorn
    
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    
    
    uvicorn.run( "main:app",host=host,port=port,reload=True)