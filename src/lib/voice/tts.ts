// ElevenLabs TTS Integration for MIRA

export type VoiceType = 'mi' | 'ra';

// ElevenLabs voice IDs - MUST be configured via environment variables
// No fallbacks - will throw error if not configured
const getVoiceId = (voice: VoiceType): string => {
  const voiceId = voice === 'mi' 
    ? process.env.ELEVENLABS_VOICE_MI 
    : process.env.ELEVENLABS_VOICE_RA;
  
  if (!voiceId) {
    throw new Error(`ELEVENLABS_VOICE_${voice.toUpperCase()} environment variable not configured`);
  }
  return voiceId;
};

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

// Languages that need multilingual model
const MULTILINGUAL_LANGUAGES = ['hi', 'zh', 'ja', 'ko', 'ar', 'ru', 'es', 'fr', 'de', 'pt', 'it'];

// Common Hindi words romanized -> Devanagari mapping
// This helps ElevenLabs pronounce Hindi words correctly
const HINDI_WORD_MAP: Record<string, string> = {
  // MIRA Agent Names - CRITICAL for correct pronunciation
  'mi': 'मी', 'MI': 'मी',
  'ra': 'रा', 'RA': 'रा',
  'mira': 'मीरा', 'MIRA': 'मीरा', 'Mira': 'मीरा',
  'meera': 'मीरा', 'Meera': 'मीरा',
  
  // Greetings & Common Phrases
  'namaste': 'नमस्ते', 'namaskar': 'नमस्कार', 'dhanyawad': 'धन्यवाद', 'dhanyavaad': 'धन्यवाद',
  'shukriya': 'शुक्रिया', 'alvida': 'अलविदा', 'swagat': 'स्वागत', 'aabhar': 'आभार',
  
  // Question words
  'kya': 'क्या', 'kaise': 'कैसे', 'kaisa': 'कैसा', 'kaisi': 'कैसी', 'kab': 'कब',
  'kahan': 'कहाँ', 'kahaan': 'कहाँ', 'kyun': 'क्यों', 'kyon': 'क्यों', 'kaun': 'कौन',
  'kitna': 'कितना', 'kitni': 'कितनी', 'kitne': 'कितने', 'konsa': 'कौनसा', 'konsi': 'कौनसी',
  
  // Pronouns
  'main': 'मैं', 'mai': 'मैं', 'mein': 'मैं', 'tum': 'तुम', 'aap': 'आप', 'hum': 'हम',
  'woh': 'वो', 'wo': 'वो', 'yeh': 'ये', 'ye': 'ये', 'mera': 'मेरा', 'meri': 'मेरी',
  'tera': 'तेरा', 'teri': 'तेरी', 'tumhara': 'तुम्हारा', 'tumhari': 'तुम्हारी',
  'aapka': 'आपका', 'aapki': 'आपकी', 'hamara': 'हमारा', 'hamari': 'हमारी',
  'uska': 'उसका', 'uski': 'उसकी', 'unka': 'उनका', 'unki': 'उनकी',
  
  // Verbs (common forms)
  'hai': 'है', 'hain': 'हैं', 'tha': 'था', 'thi': 'थी', 'the': 'थे', 'hoon': 'हूँ', 'hun': 'हूँ', 'hu': 'हूँ',
  'ho': 'हो', 'hota': 'होता', 'hoti': 'होती', 'hoga': 'होगा', 'hogi': 'होगी',
  'kar': 'कर', 'karo': 'करो', 'karna': 'करना', 'karunga': 'करूँगा', 'karungi': 'करूँगी',
  'karta': 'करता', 'karti': 'करती', 'karte': 'करते', 'kiya': 'किया', 'ki': 'की',
  'ja': 'जा', 'jao': 'जाओ', 'jana': 'जाना', 'jata': 'जाता', 'jati': 'जाती',
  'gaya': 'गया', 'gayi': 'गई', 'gaye': 'गए', 'jayega': 'जाएगा', 'jayegi': 'जाएगी',
  'aa': 'आ', 'aao': 'आओ', 'aana': 'आना', 'aaya': 'आया', 'aayi': 'आई', 'aaye': 'आए',
  'bol': 'बोल', 'bolo': 'बोलो', 'bolna': 'बोलना', 'bola': 'बोला', 'boli': 'बोली',
  'dekh': 'देख', 'dekho': 'देखो', 'dekhna': 'देखना', 'dekha': 'देखा', 'dekhi': 'देखी',
  'sun': 'सुन', 'suno': 'सुनो', 'sunna': 'सुनना', 'suna': 'सुना', 'suni': 'सुनी',
  'de': 'दे', 'dena': 'देना', 'diya': 'दिया', 'di': 'दी', 'diye': 'दिए',
  'le': 'ले', 'lo': 'लो', 'lena': 'लेना', 'liya': 'लिया', 'li': 'ली', 'liye': 'लिए',
  'mil': 'मिल', 'mila': 'मिला', 'mili': 'मिली', 'milte': 'मिलते', 'milega': 'मिलेगा',
  'samajh': 'समझ', 'samjha': 'समझा', 'samjhi': 'समझी', 'samjhe': 'समझे',
  'soch': 'सोच', 'socho': 'सोचो', 'socha': 'सोचा', 'sochti': 'सोचती',
  'rakh': 'रख', 'rakho': 'रखो', 'rakhna': 'रखना', 'rakha': 'रखा',
  'baith': 'बैठ', 'baitho': 'बैठो', 'baithna': 'बैठना', 'baitha': 'बैठा',
  'khel': 'खेल', 'khelo': 'खेलो', 'khelna': 'खेलना', 'khela': 'खेला',
  'padh': 'पढ़', 'padho': 'पढ़ो', 'padhna': 'पढ़ना', 'padha': 'पढ़ा',
  'likh': 'लिख', 'likho': 'लिखो', 'likhna': 'लिखना', 'likha': 'लिखा',
  'kha': 'खा', 'khao': 'खाओ', 'khana': 'खाना', 'khaya': 'खाया',
  'pi': 'पी', 'piyo': 'पियो', 'pina': 'पीना', 'piya': 'पिया',
  'so': 'सो', 'sona': 'सोना', 'soya': 'सोया', 'soyi': 'सोई',
  'uth': 'उठ', 'utho': 'उठो', 'uthna': 'उठना', 'utha': 'उठा',
  'chal': 'चल', 'chalo': 'चलो', 'chalna': 'चलना', 'chala': 'चला', 'chali': 'चली',
  'ruk': 'रुक', 'ruko': 'रुको', 'rukna': 'रुकना', 'ruka': 'रुका',
  'bata': 'बता', 'batao': 'बताओ', 'batana': 'बताना', 'bataya': 'बताया',
  'puch': 'पूछ', 'pucho': 'पूछो', 'puchna': 'पूछना', 'pucha': 'पूछा',
  'chahiye': 'चाहिए', 'chahte': 'चाहते', 'chahti': 'चाहती', 'chahunga': 'चाहूँगा',
  'sakta': 'सकता', 'sakti': 'सकती', 'sakte': 'सकते', 'pata': 'पता',
  
  // Common Adjectives
  'accha': 'अच्छा', 'acha': 'अच्छा', 'acchi': 'अच्छी', 'achi': 'अच्छी', 'acche': 'अच्छे',
  'bura': 'बुरा', 'buri': 'बुरी', 'bure': 'बुरे',
  'bada': 'बड़ा', 'badi': 'बड़ी', 'bade': 'बड़े', 'bara': 'बड़ा',
  'chhota': 'छोटा', 'chhoti': 'छोटी', 'chhote': 'छोटे',
  'naya': 'नया', 'nayi': 'नई', 'naye': 'नए', 'purana': 'पुराना', 'purani': 'पुरानी',
  'sundar': 'सुंदर', 'khubsurat': 'खूबसूरत', 'pyara': 'प्यारा', 'pyari': 'प्यारी',
  'theek': 'ठीक', 'thik': 'ठीक', 'sahi': 'सही', 'galat': 'गलत',
  'mushkil': 'मुश्किल', 'aasan': 'आसान', 'asaan': 'आसान',
  'khush': 'खुश', 'udas': 'उदास', 'pareshan': 'परेशान',
  
  // Adverbs & Conjunctions
  'bahut': 'बहुत', 'bohot': 'बहुत', 'boht': 'बहुत', 'thoda': 'थोड़ा', 'thodi': 'थोड़ी',
  'zyada': 'ज़्यादा', 'jyada': 'ज़्यादा', 'kam': 'कम', 'bilkul': 'बिल्कुल',
  'abhi': 'अभी', 'ab': 'अब', 'tab': 'तब', 'jab': 'जब', 'phir': 'फिर', 'fir': 'फिर',
  'kabhi': 'कभी', 'hamesha': 'हमेशा', 'humesha': 'हमेशा', 'aksar': 'अक्सर',
  'sirf': 'सिर्फ', 'bas': 'बस', 'bhi': 'भी', 'hi': 'ही', 'to': 'तो', 'toh': 'तो',
  'aur': 'और', 'ya': 'या', 'lekin': 'लेकिन', 'par': 'पर', 'per': 'पर', 'magar': 'मगर',
  'kyunki': 'क्योंकि', 'isliye': 'इसलिए', 'islye': 'इसलिए', 'agar': 'अगर', 'warna': 'वरना',
  'yahan': 'यहाँ', 'yahaan': 'यहाँ', 'wahan': 'वहाँ', 'wahaan': 'वहाँ',
  'andar': 'अंदर', 'bahar': 'बाहर', 'upar': 'ऊपर', 'niche': 'नीचे', 'neeche': 'नीचे',
  'pehle': 'पहले', 'baad': 'बाद', 'saath': 'साथ', 'sath': 'साथ', 'bina': 'बिना',
  'shayad': 'शायद', 'zaroor': 'ज़रूर', 'jaroor': 'ज़रूर',
  
  // Nouns
  'naam': 'नाम', 'kaam': 'काम', 'ghar': 'घर', 'din': 'दिन', 'raat': 'रात',
  'subah': 'सुबह', 'shaam': 'शाम', 'dopahar': 'दोपहर', 'waqt': 'वक़्त', 'samay': 'समय',
  'paani': 'पानी', 'pani': 'पानी', 'doodh': 'दूध', 'chai': 'चाय', 'roti': 'रोटी',
  'dost': 'दोस्त', 'yaar': 'यार', 'bhai': 'भाई', 'behen': 'बहन', 'behn': 'बहन',
  'papa': 'पापा', 'mummy': 'मम्मी', 'maa': 'माँ', 'ma': 'माँ', 'baap': 'बाप',
  'baccha': 'बच्चा', 'bacche': 'बच्चे', 'ladka': 'लड़का', 'ladki': 'लड़की',
  'aadmi': 'आदमी', 'aurat': 'औरत', 'log': 'लोग', 'insaan': 'इंसान',
  'dil': 'दिल', 'pyaar': 'प्यार', 'pyar': 'प्यार', 'zindagi': 'ज़िंदगी', 'jindagi': 'ज़िंदगी',
  'duniya': 'दुनिया', 'desh': 'देश', 'shahar': 'शहर', 'gaon': 'गाँव', 'gaanv': 'गाँव',
  'paisa': 'पैसा', 'paise': 'पैसे', 'rupya': 'रुपया', 'rupaye': 'रुपये',
  'school': 'स्कूल', 'kitaab': 'किताब', 'kitab': 'किताब', 'kalam': 'कलम',
  'mobile': 'मोबाइल', 'phone': 'फ़ोन', 'gaadi': 'गाड़ी', 'gadi': 'गाड़ी',
  
  // Numbers
  'ek': 'एक', 'do': 'दो', 'teen': 'तीन', 'char': 'चार', 'paanch': 'पाँच', 'panch': 'पांच',
  'cheh': 'छह', 'che': 'छह', 'saat': 'सात', 'aath': 'आठ', 'nau': 'नौ', 'das': 'दस',
  
  // Expressions & Interjections
  'haan': 'हाँ', 'han': 'हाँ', 'nahi': 'नहीं', 'nai': 'नहीं', 'na': 'ना',
  'koi': 'कोई', 'kuch': 'कुछ', 'sab': 'सब', 'sabhi': 'सभी',
  'waise': 'वैसे', 'aise': 'ऐसे', 'jaise': 'जैसे',
  'matlab': 'मतलब', 'yaani': 'यानी', 'yani': 'यानी',
  'arre': 'अरे', 'are': 'अरे', 'arrey': 'अरे', 'oye': 'ओए', 'oi': 'ओए',
  'achha': 'अच्छा', 'hmmm': 'हम्म',
  'sorry': 'सॉरी', 'please': 'प्लीज़', 'thanks': 'थैंक्स', 'thankyou': 'थैंक्यू',
  'okay': 'ओके', 'ok': 'ओके', 'bye': 'बाय', 'hello': 'हैलो', 'hii': 'हाय',
};

// Convert romanized Hindi words to Devanagari in mixed text
function convertHindiToDevanagari(text: string): string {
  // First, check if text is primarily English (has mostly ASCII letters)
  const asciiLetters = text.match(/[a-zA-Z]/g)?.length || 0;
  const totalChars = text.replace(/\s/g, '').length;
  
  // If less than 30% ASCII, probably already in Devanagari or other script
  if (asciiLetters / totalChars < 0.3) {
    return text;
  }
  
  let result = text;
  
  // Sort by length (longer words first) to avoid partial replacements
  const sortedWords = Object.entries(HINDI_WORD_MAP).sort((a, b) => b[0].length - a[0].length);
  
  for (const [romanized, devanagari] of sortedWords) {
    // Create regex that matches the word with word boundaries
    // Case insensitive, but preserve surrounding text
    const regex = new RegExp(`\\b${romanized}\\b`, 'gi');
    result = result.replace(regex, devanagari);
  }
  
  return result;
}

// Fix phonetic pronunciation for agent names
function fixPronunciation(text: string): string {
  // First convert Hindi words to Devanagari for proper pronunciation
  let processed = convertHindiToDevanagari(text);
  
  // Check if the text contains Devanagari - if so, use Hindi pronunciation
  const hasDevanagari = /[\u0900-\u097F]/.test(processed);
  
  if (hasDevanagari) {
    // Use Devanagari script for agent names in Hindi context
    return processed
      // MIRA/Meera -> मीरा
      .replace(/\bMIRA\b/gi, 'मीरा')
      .replace(/\bMeera\b/gi, 'मीरा')
      // MI -> मी
      .replace(/\bMI\b/g, 'मी')
      .replace(/\bMi\b/g, 'मी')
      // RA -> रा
      .replace(/\bRA\b/g, 'रा')
      .replace(/\bRa\b/g, 'रा');
  }
  
  // For English text, use phonetic pronunciation
  return processed
    // MIRA pronounced as "Meera" (मीरा)
    .replace(/\bMIRA\b/gi, 'Meera')
    // MI pronounced as "Mee" (मी)
    .replace(/\bMI\b/g, 'Mee')
    .replace(/\bMi\b/g, 'Mee')
    // RA pronounced as "Raa" (रा)
    .replace(/\bRA\b/g, 'Raa')
    .replace(/\bRa\b/g, 'Raa');
}

// Detect if text contains non-English characters
function detectLanguageFromText(text: string): string {
  // Hindi (Devanagari)
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  // Chinese
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  // Japanese
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  // Korean
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  // Arabic
  if (/[\u0600-\u06FF]/.test(text)) return 'ar';
  // Cyrillic (Russian)
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  
  // Check for romanized Hindi words (Hinglish detection)
  const hindiWords = Object.keys(HINDI_WORD_MAP);
  const words = text.toLowerCase().split(/\s+/);
  let hindiWordCount = 0;
  for (const word of words) {
    if (hindiWords.includes(word.replace(/[.,!?]/g, ''))) {
      hindiWordCount++;
    }
  }
  // If more than 20% are Hindi words, treat as Hindi
  if (hindiWordCount / words.length > 0.2) return 'hi';
  
  return 'en';
}

export async function generateSpeech(
  text: string,
  voice: VoiceType,
  language?: string
): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const voiceId = getVoiceId(voice);
  const correctedText = fixPronunciation(text);
  
  // Auto-detect language from text if not provided
  const detectedLang = language || detectLanguageFromText(text);
  
  // Use multilingual model for non-English languages
  const useMultilingual = MULTILINGUAL_LANGUAGES.includes(detectedLang);
  const modelId = useMultilingual ? 'eleven_multilingual_v2' : 'eleven_turbo_v2_5';
  
  console.log(`TTS: Using ${modelId} for language: ${detectedLang}`);
  
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: correctedText,
        model_id: modelId,
        voice_settings: {
          stability: voice === 'mi' ? 0.5 : 0.7,
          similarity_boost: 0.8,
          style: voice === 'mi' ? 0.4 : 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('ElevenLabs error:', error);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function generateSpeechHD(
  text: string,
  voice: VoiceType
): Promise<Buffer> {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const voiceId = getVoiceId(voice);
  const correctedText = fixPronunciation(text);
  
  // Always use multilingual for HD (better quality for all languages)
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: correctedText,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: voice === 'mi' ? 0.5 : 0.7,
          similarity_boost: 0.85,
          style: voice === 'mi' ? 0.4 : 0.2,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('ElevenLabs HD error:', error);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Keep OpenAI Whisper for transcription
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Supported languages for auto-detection
const SUPPORTED_LANGUAGES = ['en', 'hi', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'ar', 'pt', 'ru', 'it'];

export async function transcribeAudio(
  audioBuffer: Buffer,
  language?: string // If not provided, Whisper auto-detects
): Promise<{ text: string; detectedLanguage?: string }> {
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
  const file = new File([blob], 'audio.webm', { type: 'audio/webm' });

  // Use verbose_json to get detected language
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    ...(language ? { language } : {}), // Let Whisper auto-detect if no language specified
    response_format: 'verbose_json',
  });

  // Extract language from verbose response
  const verboseResponse = transcription as unknown as { text: string; language?: string };
  
  return {
    text: verboseResponse.text,
    detectedLanguage: verboseResponse.language || 'en',
  };
}

export function detectAgentMention(text: string): 'mi' | 'ra' | 'mira' | null {
  const lower = text.toLowerCase();
  
  // Check for MIRA first (both agents)
  if (
    lower.includes('mira') ||
    lower.includes('meera') ||
    lower.includes('both of you') ||
    lower.includes('you both') ||
    lower.includes('you guys') ||
    lower.includes('you two')
  ) {
    return 'mira';
  }
  
  // Check for MI (female agent) - "hey mi", "mi,", "mi ", addressing MI
  if (
    /\b(hey |hi |ok |okay )?mi[,\s!?.]/i.test(lower) ||
    /\bmi\b.*(?:what|how|can|tell|help|think|say)/i.test(lower) ||
    lower.startsWith('mi ') ||
    lower.startsWith('mi,') ||
    /\bask mi\b/i.test(lower)
  ) {
    return 'mi';
  }
  
  // Check for RA (male agent) - "hey ra", "ra,", "ra ", addressing RA  
  if (
    /\b(hey |hi |ok |okay )?ra[,\s!?.]/i.test(lower) ||
    /\bra\b.*(?:what|how|can|tell|help|think|say)/i.test(lower) ||
    lower.startsWith('ra ') ||
    lower.startsWith('ra,') ||
    /\bask ra\b/i.test(lower)
  ) {
    return 'ra';
  }
  
  return null;
}

export async function detectLanguage(audioBuffer: Buffer): Promise<string> {
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/webm' });
  const file = new File([blob], 'audio.webm', { type: 'audio/webm' });

  const transcription = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
  });

  return (transcription as unknown as { language: string }).language || 'en';
}

export default {
  generateSpeech,
  generateSpeechHD,
  transcribeAudio,
  detectAgentMention,
};
