import os
import json
import asyncio
import logging
import re
import base64
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from io import BytesIO

import google.generativeai as genai
from gtts import gTTS
from dotenv import load_dotenv

from utils.prompt import CareerGuidancePrompts


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
load_dotenv()


class UserIntent:
    """Intent classification for user inputs"""
    GREETING = "greeting"
    CAREER_EXPLORATION = "career_exploration"
    SKILL_INQUIRY = "skill_inquiry"
    EDUCATION_QUESTION = "education_question"
    SALARY_QUESTION = "salary_question"
    APPLICATION_HELP = "application_help"
    CLARIFICATION_QUESTION = "clarification_question"
    UNCERTAINTY = "uncertainty"
    PARENTAL_PRESSURE = "parental_pressure"
    COMPARISON_REQUEST = "comparison_request"
    OFF_TOPIC = "off_topic"
    GRATITUDE = "gratitude"
    READY_TO_START = "ready_to_start"
    REQUEST_EXAMPLES = "request_examples"
    GENERAL_QUESTION = "general_question"


class CareerGuidanceCounselor:
    """AI Career Counselor using Gemini for autonomous guidance"""
    
    def __init__(self, session_id: str):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not found in .env file!")
        
        genai.configure(api_key=api_key)
        
        self.model = genai.GenerativeModel(
            "gemini-2.5-flash-lite",
            generation_config={
                "temperature": 0.7,
                "max_output_tokens": 3000
            },
            system_instruction=CareerGuidancePrompts.SYSTEM_PROMPT
        )
        
        self.session_id = session_id
        self.conversation: List[Dict] = []
        self.discovery_started = False
        self.exploration_completed = False
        self.current_language = "en"
        self.current_phase = "initial"  # initial, discovery, exploration, deep_dive, planning
        
        # Student profile data
        self.student_profile = {
            "grade": None,
            "interests": [],
            "strengths": [],
            "constraints": [],
            "selected_career": None
        }
        
        logger.info(f" CareerGuidanceCounselor initialized for session {session_id}")
    
    # ==================== LANGUAGE DETECTION ====================
    
    def _detect_language(self, text: str) -> str:
        """Detect if input is Hindi, Hinglish, or English"""
        try:
            text = text.strip()
            if not text:
                return "en"
            
            # Check for Hindi (Devanagari) characters
            hindi_chars = sum(1 for c in text if '\u0900' <= c <= '\u097F')
            total_alpha = len([c for c in text if c.isalpha()])
            
            if total_alpha > 0:
                hindi_ratio = hindi_chars / total_alpha
                
                # Pure Hindi (>30% Devanagari)
                if hindi_ratio > 0.3:
                    logger.info(f" Detected Hindi ({hindi_ratio:.0%} Devanagari)")
                    return "hi"
                
                # Hinglish (some Devanagari + English)
                if hindi_ratio > 0.05:
                    logger.info(f" Detected Hinglish ({hindi_ratio:.0%} Devanagari)")
                    return "hinglish"
            
            # Check for common Hinglish patterns (romanized Hindi)
            hinglish_patterns = [
                r'\b(kya|kaise|kitna|kitne|kab|kahan|kyun|aur|hai|hain|ho|hoon)\b',
                r'\b(mujhe|mera|mere|apna|apne|tum|aap|yeh|woh|kuch)\b',
                r'\b(chahiye|rakhna|dena|lena|samajh|batao|bolo)\b',
                r'\b(bilkul|bahut|thoda|zyada|sab|koi|kaun)\b',
                r'\b(namaste|shukriya|dhanyavaad|theek|acha|haan|nahi)\b'
            ]
            
            text_lower = text.lower()
            hinglish_matches = sum(1 for p in hinglish_patterns if re.search(p, text_lower))
            
            total_words = len(text_lower.split())
            if total_words > 0:
                hinglish_ratio = hinglish_matches / total_words
                if hinglish_ratio > 0.25:
                    logger.info(f" Detected Hinglish (patterns: {hinglish_matches}/{total_words})")
                    return "hinglish"
            
            return "en"
            
        except Exception as e:
            logger.warning(f" Language detection failed: {e}")
            return "en"
    
    # ==================== TEXT TO SPEECH ====================
    
    async def text_to_speech(self, text: str, language: str = None) -> Optional[str]:
        """Convert text to speech using gTTS with language support"""
        try:
            if language is None:
                language = self.current_language
            
            clean_text = re.sub(r'[*_`\[\]#{}()\|]', '', text)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            
            if not clean_text or len(clean_text) < 3:
                logger.warning(" Text too short for TTS")
                return None
            
            if len(clean_text) > 3000:
                clean_text = clean_text[:2997] + "..."
            
            # Set language for TTS
            lang_code = 'hi' if language in ['hi', 'hinglish'] else 'en'
            
            tts = gTTS(text=clean_text, lang=lang_code, tld='com' if lang_code == 'en' else 'co.in', slow=False)
            audio_buffer = BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_buffer.seek(0)
            audio_base64 = base64.b64encode(audio_buffer.read()).decode('utf-8')
            
            logger.info(f"🔊 Generated TTS in {language}: {len(clean_text)} chars")
            return audio_base64
            
        except Exception as e:
            logger.error(f" TTS error: {e}")
            return None
    
    # ==================== INTENT DETECTION ====================
    
    async def _classify_intent(self, user_input: str) -> Dict:
        """Classify user intent with language detection"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        
        prompt = CareerGuidancePrompts.INTENT_DETECTION_PROMPT.format(
            user_input=user_input,
            context=context
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            result_text = response.text.strip()
            
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
            else:
                result = {
                    "intent": "general_question",
                    "confidence": 0.5,
                    "language": self.current_language,
                    "detected_interests": [],
                    "detected_constraints": []
                }
            
            return result
            
        except Exception as e:
            logger.error(f" Intent classification failed: {e}")
            return {
                "intent": UserIntent.GENERAL_QUESTION,
                "confidence": 0.5,
                "language": self.current_language
            }
    
    # ==================== FIRST MESSAGE HANDLER ====================
    
    async def _handle_first_message(self, user_input: str) -> str:
        """Generate personalized first response"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        prompt = CareerGuidancePrompts.FIRST_MESSAGE_PROMPT.format(
            user_input=user_input,
            context=context
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return response.text.strip()
        except Exception as e:
            logger.error(f" First message generation failed: {e}")
            # Fallback
            fallbacks = {
                "en": "Hi! I'm your AI career counselor. I help high school students discover exciting career paths. What grade are you in?",
                "hi": "नमस्ते! मैं आपका AI करियर काउंसलर हूँ। मैं हाई स्कूल के छात्रों को करियर मार्ग खोजने में मदद करता हूँ। आप किस कक्षा में हैं?",
                "hinglish": "Namaste! Main aapka AI career counselor hoon. Main students ko career paths discover karne mein help karta hoon. Aap kis grade mein ho?"
            }
            return fallbacks.get(self.current_language, fallbacks["en"])
    
    # ==================== DISCOVERY QUESTION GENERATOR ====================
    
    async def _generate_discovery_question(self) -> str:
        """Generate next discovery question"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        prompt = CareerGuidancePrompts.DISCOVERY_QUESTION_PROMPT.format(context=context)
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            question = response.text.strip()
            
            # Clean the question
            question = re.sub(r'["\*]', '', question).strip()
            
            if not question or len(question.split()) > 35:
                return self._get_fallback_discovery_question()
            
            return question
            
        except Exception as e:
            logger.error(f" Discovery question generation failed: {e}")
            return self._get_fallback_discovery_question()
    
    def _get_fallback_discovery_question(self) -> str:
        """Get fallback discovery question"""
        user_responses = len([m for m in self.conversation if m['role'] == 'user'])
        
        fallback_questions = {
            "en": [
                "What grade are you in?",
                "Which subjects do you enjoy most in school?",
                "Tell me about your hobbies or interests outside school.",
                "What are you naturally good at?",
                "Are there any career fields you're curious about?"
            ],
            "hi": [
                "आप किस कक्षा में हैं?",
                "स्कूल में आपको कौन से विषय सबसे अधिक पसंद हैं?",
                "स्कूल के बाहर अपने शौक या रुचियों के बारे में बताएं।",
                "आप स्वाभाविक रूप से किस चीज़ में अच्छे हैं?",
                "क्या कोई करियर क्षेत्र है जिसके बारे में आप उत्सुक हैं?"
            ],
            "hinglish": [
                "Aap kis class mein ho?",
                "School mein aapko konse subjects sabse zyada pasand hain?",
                "School ke bahar apne hobbies ya interests ke baare mein batao.",
                "Aap naturally kis cheez mein acche ho?",
                "Kya koi career field hai jiske baare mein aap curious ho?"
            ]
        }
        
        questions = fallback_questions.get(self.current_language, fallback_questions["en"])
        idx = min(user_responses, len(questions) - 1)
        return questions[idx]
    
    # ==================== CAREER MATCHING ====================
    
    async def _generate_career_matches(self) -> str:
        """Generate career stream suggestions"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        
        # Extract student info from conversation
        grade = self.student_profile.get("grade", "Not specified")
        interests = ", ".join(self.student_profile.get("interests", ["exploring"]))
        strengths = ", ".join(self.student_profile.get("strengths", ["to be discovered"]))
        constraints = ", ".join(self.student_profile.get("constraints", ["none mentioned"]))
        
        prompt = CareerGuidancePrompts.CAREER_MATCHING_PROMPT.format(
            context=context,
            grade=grade,
            interests=interests,
            strengths=strengths,
            constraints=constraints
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return response.text.strip()
        except Exception as e:
            logger.error(f" Career matching failed: {e}")
            return self._get_fallback_career_match()
    
    def _get_fallback_career_match(self) -> str:
        """Fallback career suggestions"""
        fallbacks = {
            "en": "Based on what you've told me, here are some exciting career paths to explore: Technology (Software, Data Science), Healthcare (Medicine, Biotech), Business (Marketing, Finance), or Creative fields (Design, Content). Which interests you most?",
            "hi": "आपने जो बताया उसके आधार पर, यहां कुछ रोमांचक करियर पथ हैं: टेक्नोलॉजी (सॉफ्टवेयर, डेटा साइंस), हेल्थकेयर (मेडिसिन, बायोटेक), बिजनेस (मार्केटिंग, फाइनेंस), या क्रिएटिव फील्ड (डिज़ाइन, कंटेंट)। कौन सा आपको सबसे अधिक रुचिकर लगता है?",
            "hinglish": "Aapne jo bataya uske basis par, yahan kuch exciting career paths hain: Technology (Software, Data Science), Healthcare (Medicine, Biotech), Business (Marketing, Finance), ya Creative fields (Design, Content). Kaunsa aapko sabse zyada interesting lagta hai?"
        }
        return fallbacks.get(self.current_language, fallbacks["en"])
    
    # ==================== UNCERTAINTY HANDLER ====================
    
    async def _handle_uncertainty(self, user_input: str) -> str:
        """Handle student uncertainty with supportive guidance"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        prompt = CareerGuidancePrompts.UNCERTAINTY_PROMPT.format(
            user_input=user_input,
            context=context
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return response.text.strip()
        except Exception as e:
            logger.error(f" Uncertainty handling failed: {e}")
            fallbacks = {
                "en": "That's completely normal! Most students feel this way. Let's explore together. What grade are you in?",
                "hi": "यह बिल्कुल सामान्य है! अधिकांश छात्र ऐसा महसूस करते हैं। चलिए साथ मिलकर खोजते हैं। आप किस कक्षा में हैं?",
                "hinglish": "Yeh bilkul normal hai! Zyada tar students aisa feel karte hain. Chalo saath mein explore karte hain. Aap kis class mein ho?"
            }
            return fallbacks.get(self.current_language, fallbacks["en"])
    
    # ==================== PROGRESS CHECK ====================
    
    async def _check_phase_progress(self) -> Dict:
        """Check conversation progress and determine next phase"""
        user_responses = len([m for m in self.conversation if m['role'] == 'user'])
        
        if user_responses < 2:
            return {"phase": "discovery", "ready_for_matching": False}
        
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        prompt = CareerGuidancePrompts.PROGRESS_CHECK_PROMPT.format(
            context=context,
            message_count=user_responses
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            result_text = response.text.strip()
            
            # Extract JSON
            json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group())
                return result
            
            return {"phase": "discovery", "ready_for_matching": False}
            
        except Exception as e:
            logger.error(f" Progress check failed: {e}")
            # Fallback logic
            if user_responses >= 3:
                return {"phase": "exploration", "ready_for_matching": True}
            return {"phase": "discovery", "ready_for_matching": False}
    
    # ==================== CASUAL CHAT HANDLER ====================
    
    async def _handle_casual_chat(self, user_input: str) -> str:
        """Handle casual conversation"""
        context = CareerGuidancePrompts.build_context_prompt(self.conversation)
        prompt = CareerGuidancePrompts.CASUAL_CHAT_PROMPT.format(
            user_input=user_input,
            context=context
        )
        
        try:
            response = await asyncio.to_thread(self.model.generate_content, prompt)
            return response.text.strip()
        except Exception as e:
            logger.error(f" Casual chat failed: {e}")
            fallbacks = {
                "en": "I'm here to help with your career exploration. What would you like to know?",
                "hi": "मैं आपके करियर अन्वेषण में मदद करने के लिए यहाँ हूँ। आप क्या जानना चाहेंगे?",
                "hinglish": "Main aapke career exploration mein help karne ke liye yahan hoon. Aap kya jaanna chahte ho?"
            }
            return fallbacks.get(self.current_language, fallbacks["en"])
    
    # ==================== MAIN PROCESSING ====================
    
    async def process_response(self, user_input: str) -> Tuple[str, Optional[str], Optional[Dict]]:
        """
        Main processing: Language-first, intent-based, phase-aware responses
        """
        try:
            logger.info(f" Processing: '{user_input[:50]}...'")
            
            # Skip empty inputs
            if not user_input or len(user_input.strip()) < 1:
                response = self._get_empty_response()
                audio_base64 = await self.text_to_speech(response)
                return response, audio_base64, None
            
            # STEP 1: Detect language
            detected_language = self._detect_language(user_input)
            self.current_language = detected_language
            logger.info(f" Language: {detected_language}")
            
            # STEP 2: Detect intent
            intent_data = await self._classify_intent(user_input)
            intent = intent_data.get("intent", UserIntent.GENERAL_QUESTION)
            logger.info(f" Intent: {intent} | Phase: {self.current_phase}")
            
            # Update student profile with detected interests/constraints
            if "detected_interests" in intent_data:
                self.student_profile["interests"].extend(intent_data["detected_interests"])
            if "detected_constraints" in intent_data:
                self.student_profile["constraints"].extend(intent_data["detected_constraints"])
            
            # Save user message
            self.conversation.append({
                "role": "user",
                "content": user_input,
                "language": detected_language,
                "intent": intent,
                "timestamp": datetime.now().isoformat()
            })
            
            # STEP 3: Handle based on intent and phase
            response = ""
            metadata = None
            
            if intent == UserIntent.GREETING and not self.discovery_started:
                # First greeting
                response = await self._handle_first_message(user_input)
                self.discovery_started = True
                self.current_phase = "discovery"
                
            elif intent == UserIntent.READY_TO_START:
                # Ready to start
                if not self.discovery_started:
                    response = await self._handle_first_message("ready")
                    self.discovery_started = True
                    self.current_phase = "discovery"
                else:
                    response = await self._generate_discovery_question()
                
            elif intent == UserIntent.CAREER_EXPLORATION:
                # Student exploring careers
                if not self.discovery_started:
                    self.discovery_started = True
                    self.current_phase = "discovery"
                
                # Check if we have enough info for career matching
                progress = await self._check_phase_progress()
                if progress.get("ready_for_matching", False):
                    response = await self._generate_career_matches()
                    self.current_phase = "exploration"
                else:
                    response = await self._generate_discovery_question()
                
            elif intent == UserIntent.UNCERTAINTY:
                # Handle uncertainty
                response = await self._handle_uncertainty(user_input)
                if not self.discovery_started:
                    self.discovery_started = True
                    self.current_phase = "discovery"
                
            elif intent == UserIntent.PARENTAL_PRESSURE:
                # Handle parental pressure specifically
                response = self._get_parental_pressure_response()
                
            elif intent == UserIntent.GRATITUDE:
                # Thank you response
                if self.current_phase == "initial":
                    response = self._get_gratitude_response() + " " + await self._handle_first_message("thanks")
                    self.discovery_started = True
                    self.current_phase = "discovery"
                else:
                    response = self._get_gratitude_response() + " " + self._get_continue_prompt()
                
            elif intent == UserIntent.CLARIFICATION_QUESTION:
                # Clarification needed
                response = await self._handle_casual_chat(user_input)
                
            elif intent in [UserIntent.OFF_TOPIC, UserIntent.GENERAL_QUESTION]:
                # Off-topic or general
                response = await self._handle_casual_chat(user_input)
                
            else:
                # Default: Continue discovery or exploration
                if self.current_phase == "initial" or not self.discovery_started:
                    self.discovery_started = True
                    self.current_phase = "discovery"
                    response = await self._generate_discovery_question()
                else:
                    # Check progress
                    progress = await self._check_phase_progress()
                    if progress.get("ready_for_matching", False) and self.current_phase == "discovery":
                        response = await self._generate_career_matches()
                        self.current_phase = "exploration"
                    else:
                        response = await self._generate_discovery_question()
            
            # STEP 4: Save and convert to speech
            self.conversation.append({
                "role": "assistant",
                "content": response,
                "language": detected_language,
                "phase": self.current_phase,
                "timestamp": datetime.now().isoformat()
            })
            
            audio_base64 = await self.text_to_speech(response, detected_language)
            return response, audio_base64, metadata
            
        except Exception as e:
            logger.error(f" Error processing response: {e}")
            error_msg = self._get_error_message()
            audio_base64 = await self.text_to_speech(error_msg)
            return error_msg, audio_base64, None
    
    # ==================== HELPER METHODS ====================
    
    def _get_empty_response(self) -> str:
        """Get message for empty input"""
        messages = {
            "en": "I didn't catch that. Could you say something?",
            "hi": "मुझे वह समझ नहीं आया। क्या आप कुछ कह सकते हैं?",
            "hinglish": "Mujhe samajh nahi aaya. Kuch bolo na?"
        }
        return messages.get(self.current_language, messages["en"])
    
    def _get_gratitude_response(self) -> str:
        """Get gratitude response"""
        messages = {
            "en": "You're welcome!",
            "hi": "आपका स्वागत है!",
            "hinglish": "Bilkul welcome!"
        }
        return messages.get(self.current_language, messages["en"])
    
    def _get_continue_prompt(self) -> str:
        """Get prompt to continue conversation"""
        messages = {
            "en": "What else would you like to explore?",
            "hi": "आप और क्या खोजना चाहेंगे?",
            "hinglish": "Aur kya explore karna hai?"
        }
        return messages.get(self.current_language, messages["en"])
    
    def _get_parental_pressure_response(self) -> str:
        """Get response for parental pressure"""
        messages = {
            "en": "I understand - family expectations are important. Let's find careers that align with both your interests and provide the stability your parents value. Tell me what YOU enjoy, and I'll show you secure career options in that field.",
            "hi": "मैं समझता हूं - परिवार की अपेक्षाएं महत्वपूर्ण हैं। चलिए ऐसे करियर खोजें जो आपकी रुचियों और आपके माता-पिता की स्थिरता दोनों के अनुरूप हों। मुझे बताएं कि आप क्या पसंद करते हैं, और मैं आपको उस क्षेत्र में सुरक्षित करियर विकल्प दिखाऊंगा।",
            "hinglish": "Main samajhta hoon - family expectations important hote hain. Chalo aise careers dhoondhein jo aapki interests aur aapke parents ki stability dono ke saath align karein. Mujhe batao ki aap kya enjoy karte ho, aur main aapko us field mein secure career options dikhaaunga."
        }
        return messages.get(self.current_language, messages["en"])
    
    def _get_error_message(self) -> str:
        """Get error message"""
        messages = {
            "en": "I apologize, I encountered an error. Could you repeat that?",
            "hi": "मैं माफी चाहता हूँ, मुझे एक त्रुटि का सामना करना पड़ा। क्या आप दोबारा कह सकते हैं?",
            "hinglish": "Sorry, mujhe error aaya. Thoda aur clear bolo na?"
        }
        return messages.get(self.current_language, messages["en"])
    
    # ==================== UTILITY METHODS ====================
    
    def get_conversation_history(self) -> List[Dict]:
        """Get full conversation history"""
        return self.conversation
    
    def clear_conversation(self):
        """Reset conversation"""
        self.conversation = []
        self.discovery_started = False
        self.exploration_completed = False
        self.current_language = "en"
        self.current_phase = "initial"
        self.student_profile = {
            "grade": None,
            "interests": [],
            "strengths": [],
            "constraints": [],
            "selected_career": None
        }
        logger.info(" Conversation cleared")
    
    def get_stats(self) -> Dict:
        """Get conversation statistics"""
        user_msgs = [m for m in self.conversation if m.get('role') == 'user']
        assistant_msgs = [m for m in self.conversation if m.get('role') == 'assistant']
        
        return {
            "session_id": self.session_id,
            "total_messages": len(self.conversation),
            "user_messages": len(user_msgs),
            "assistant_messages": len(assistant_msgs),
            "discovery_started": self.discovery_started,
            "current_phase": self.current_phase,
            "current_language": self.current_language,
            "student_profile": self.student_profile,
            "last_interaction": self.conversation[-1]['timestamp'] if self.conversation else None
        }


