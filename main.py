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
from utils.chatbot import CareerGuidanceCounselor
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
    
    session_id = None
    
    try:
        await websocket.accept()
        logger.info(" WebSocket connection accepted")
        
        initial_data = await websocket.receive_text()
        initial_msg = json.loads(initial_data)
        
        session_id = manager.generate_session_id()
        
        counselor = CareerGuidanceCounselor(session_id)
        manager.connect_counselor(websocket, session_id, counselor)
        
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
                    
                    # Check if user is requesting a plan
                    plan_keywords = [
                        'create a career plan', 'generate career plan', 'make a plan',
                        'career plan', 'detailed plan', 'comprehensive plan',
                        'roadmap', 'structured plan', 'request plan', 'get plan'
                    ]
                    
                    lower_text = user_text.lower()
                    is_plan_request = any(keyword in lower_text for keyword in plan_keywords)
                    
                    # Show thinking status
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "thinking",
                        "message": "AI is analyzing your response..."
                    })
                    
                    if is_plan_request:
                        # Check if we have enough conversation
                        stats = counselor.get_stats()
                        user_responses = stats.get("user_messages", 0)
                        
                        if user_responses < 3:
                            await manager.send_message(session_id, {
                                "type": "response",
                                "text": "I'd love to create a career plan for you! First, I need to know a bit more about you. Could you tell me:\n1. What grade are you in?\n2. What subjects do you enjoy?\n3. What are your hobbies or interests?",
                                "phase": stats.get("current_phase", "discovery"),
                                "language": stats.get("current_language", "en"),
                                "timestamp": datetime.now().isoformat()
                            })
                        else:
                            # Process as regular message first, then generate plan
                            response_text, audio_base64, metadata = await counselor.process_response(user_text)
                            
                            # Send initial response
                            await manager.send_message(session_id, {
                                "type": "response",
                                "text": response_text,
                                "audio": audio_base64,
                                "phase": stats.get("current_phase", "discovery"),
                                "language": stats.get("current_language", "en"),
                                "metadata": metadata,
                                "timestamp": datetime.now().isoformat()
                            })
                            
                            # Then generate and send plan
                            await manager.send_message(session_id, {
                                "type": "status",
                                "status": "planning",
                                "message": "Generating your comprehensive career plan..."
                            })
                            
                            career_plan, plan_message = await counselor.generate_career_plan()
                            
                            if career_plan:
                                await manager.send_message(session_id, {
                                    "type": "plan_generated",
                                    "text": plan_message,
                                    "plan": career_plan,
                                    "timestamp": datetime.now().isoformat()
                                })
                            else:
                                await manager.send_message(session_id, {
                                    "type": "response",
                                    "text": plan_message,
                                    "timestamp": datetime.now().isoformat()
                                })
                    else:
                        # Regular message processing
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
                
                elif msg_type == "request_plan":  # NEW MESSAGE TYPE
                    counselor = manager.get_counselor(session_id)
                    if not counselor:
                        await manager.send_message(session_id, {
                            "type": "error",
                            "message": "AI Career Counselor not initialized"
                        })
                        continue
                    
                    # Check if we have enough conversation
                    stats = counselor.get_stats()
                    user_responses = stats.get("user_messages", 0)
                    
                    if user_responses < 3:
                        await manager.send_message(session_id, {
                            "type": "response",
                            "text": "I'd love to create a career plan for you! First, I need to know a bit more about you. Could you tell me:\n1. What grade are you in?\n2. What subjects do you enjoy?\n3. What are your hobbies or interests?",
                            "phase": stats.get("current_phase", "discovery"),
                            "language": stats.get("current_language", "en"),
                            "timestamp": datetime.now().isoformat()
                        })
                        continue
                    
                    await manager.send_message(session_id, {
                        "type": "status",
                        "status": "planning",
                        "message": "Generating your comprehensive career plan..."
                    })
                    
                    career_plan, plan_message = await counselor.generate_career_plan()
                    
                    if career_plan:
                        await manager.send_message(session_id, {
                            "type": "plan_generated",
                            "text": plan_message,
                            "plan": career_plan,
                            "timestamp": datetime.now().isoformat()
                        })
                    else:
                        await manager.send_message(session_id, {
                            "type": "response",
                            "text": plan_message,
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
                            "ping", "text", "audio", "request_plan",  # Added request_plan
                            "explore_careers", "compare_careers", 
                            "history", "profile", "stats", "clear"
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
    
    uvicorn.run("main:app", host=host, port=port, reload=True)