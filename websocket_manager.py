import os
import logging
import uuid
from typing import Dict, Optional
from fastapi import WebSocket
from dotenv import load_dotenv
from utils.chatbot import CareerGuidanceCounselor


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()


class ConnectionManager:
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.career_counselors: Dict[str, CareerGuidanceCounselor] = {}
        
        logger.info(" ConnectionManager initialized for Career Guidance Platform")
    
    def generate_session_id(self) -> str:
        """Generate unique session ID"""
        session_id = str(uuid.uuid4())
        logger.info(f"Generated new session ID: {session_id}")
        return session_id
    
    async def connect(self, websocket: WebSocket, session_id: str = None):
        if not session_id:
            session_id = self.generate_session_id()
        
        self.active_connections[session_id] = websocket
        
        # Initialize AI Career Counselor if not already created
        if session_id not in self.career_counselors:
            try:
                self.career_counselors[session_id] = CareerGuidanceCounselor(session_id)
                logger.info(f" Created new AI Career Counselor for session {session_id}")
            except Exception as e:
                logger.error(f" Failed to create AI Career Counselor: {e}")
                raise
        
        logger.info(f" Session connected: {session_id}")
        logger.info(f"Active sessions: {self.get_active_session_count()}")
        return session_id
    
    def disconnect(self, session_id: str):
        if session_id in self.active_connections:
            del self.active_connections[session_id]
            logger.info(f" Removed connection for session {session_id}")
        
        if session_id in self.career_counselors:
            try:
                stats = self.career_counselors[session_id].get_stats()
                logger.info(f" Session {session_id} stats: {stats['user_messages']} user messages, Phase: {stats['current_phase']}")
            except Exception as e:
                logger.warning(f" Could not retrieve stats for session {session_id}: {e}")
            
            del self.career_counselors[session_id]
            logger.info(f" Removed AI Career Counselor for session {session_id}")
        
        logger.info(f" Remaining active sessions: {self.get_active_session_count()}")
    
    async def send_message(self, session_id: str, message: dict):
        """Send a JSON message to a specific connected session"""
        websocket = self.active_connections.get(session_id)
        if websocket:
            try:
                await websocket.send_json(message)
                logger.info(f" Sent message to session {session_id}: {message.get('type', 'unknown')}")
            except Exception as e:
                logger.error(f" Error sending message to session {session_id}: {e}")
                self.disconnect(session_id)
        else:
            logger.warning(f" No active connection for session {session_id}")
    
    async def send_text(self, session_id: str, text: str):
        """Send a plain text message to a specific connected session"""
        websocket = self.active_connections.get(session_id)
        if websocket:
            try:
                await websocket.send_text(text)
                logger.info(f" Sent text to session {session_id}: {text[:50]}...")
            except Exception as e:
                logger.error(f" Error sending text to session {session_id}: {e}")
                self.disconnect(session_id)
        else:
            logger.warning(f" No active connection for session {session_id}")
    
    def get_counselor(self, session_id: str) -> Optional[CareerGuidanceCounselor]:
        """Retrieve the AI Career Counselor instance for the given session"""
        counselor = self.career_counselors.get(session_id)
        if not counselor:
            logger.warning(f" No AI Career Counselor found for session {session_id}")
        return counselor
    
    def get_active_session_count(self) -> int:
        """Get number of active connections"""
        return len(self.active_connections)
    
    def get_all_session_ids(self) -> list:
        return list(self.active_connections.keys())
    
    def is_session_active(self, session_id: str) -> bool:
        """Check if a session is currently active"""
        return session_id in self.active_connections
    
    def get_session_stats(self, session_id: str) -> Optional[Dict]:
        counselor = self.get_counselor(session_id)
        if counselor:
            try:
                return counselor.get_stats()
            except Exception as e:
                logger.error(f" Error getting stats for session {session_id}: {e}")
                return None
        return None
    
    def get_all_sessions_stats(self) -> Dict:
        all_stats = {}
        for session_id in self.get_all_session_ids():
            stats = self.get_session_stats(session_id)
            if stats:
                all_stats[session_id] = stats
        return all_stats
    
    async def broadcast_message(self, message: dict, exclude_session: str = None):
        disconnected_sessions = []
        
        for session_id, websocket in self.active_connections.items():
            if exclude_session and session_id == exclude_session:
                continue
            
            try:
                await websocket.send_json(message)
                logger.info(f" Broadcasted message to session {session_id}")
            except Exception as e:
                logger.error(f" Error broadcasting to session {session_id}: {e}")
                disconnected_sessions.append(session_id)
        
        # Clean up disconnected sessions
        for session_id in disconnected_sessions:
            self.disconnect(session_id)
        
        if disconnected_sessions:
            logger.warning(f" Removed {len(disconnected_sessions)} disconnected sessions during broadcast")
    
    def clear_inactive_sessions(self):
        """Remove sessions that have connections but no counselor (cleanup utility)"""
        sessions_to_remove = []
        
        for session_id in self.active_connections.keys():
            if session_id not in self.career_counselors:
                sessions_to_remove.append(session_id)
        
        for session_id in sessions_to_remove:
            logger.warning(f" Clearing inactive session {session_id} (no counselor)")
            if session_id in self.active_connections:
                del self.active_connections[session_id]
        
        if sessions_to_remove:
            logger.info(f"🧹 Cleared {len(sessions_to_remove)} inactive sessions")
    
    def get_manager_stats(self) -> Dict:
        """Get overall manager statistics"""
        total_sessions = self.get_active_session_count()
        sessions_with_counselors = len(self.career_counselors)
        
        phases_count = {}
        languages_count = {}
        
        for session_id in self.get_all_session_ids():
            stats = self.get_session_stats(session_id)
            if stats:
                phase = stats.get('current_phase', 'unknown')
                phases_count[phase] = phases_count.get(phase, 0) + 1
                
                language = stats.get('current_language', 'unknown')
                languages_count[language] = languages_count.get(language, 0) + 1
        
        return {
            "total_active_sessions": total_sessions,
            "sessions_with_counselors": sessions_with_counselors,
            "phases_distribution": phases_count,
            "languages_distribution": languages_count,
            "all_session_ids": self.get_all_session_ids()
        }


manager = ConnectionManager()



