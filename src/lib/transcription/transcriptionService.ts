// Background Transcription Service - Continuous listening with speaker detection
import Transcript, { ISpeaker, ITranscriptEntry } from '@/models/Transcript';
import { detectFacesWithGemini, getKnownPeople } from '@/lib/face/faceRecognition';
import { connectToDatabase } from '@/lib/mongodb';
import mongoose from 'mongoose';

// MIRA trigger keywords
const MIRA_KEYWORDS = [
  'mira', 'hey mira', 'hi mira', 'hello mira',
  'mi', 'hey mi', 'hi mi',
  'ra', 'hey ra', 'hi ra',
  'meera', 'maya', // Common mispronunciations
];

// Check if message is directed at MIRA
export function isDirectedAtMira(text: string): boolean {
  const lower = text.toLowerCase().trim();
  
  // Check for MIRA keywords at the start or anywhere in the message
  return MIRA_KEYWORDS.some(keyword => {
    // Check if starts with keyword
    if (lower.startsWith(keyword + ' ') || lower.startsWith(keyword + ',')) return true;
    // Check if keyword is at the beginning after "hey", "hi", "hello"
    if (/^(hey|hi|hello)\s+/.test(lower) && lower.includes(keyword)) return true;
    // Check if ends with keyword (e.g., "what do you think, mira?")
    if (lower.endsWith(keyword) || lower.endsWith(keyword + '?') || lower.endsWith(keyword + '!')) return true;
    // Check if keyword is standalone or followed by punctuation
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
    return keywordRegex.test(lower);
  });
}

// Speaker tracking state
interface SpeakerTracker {
  currentOtherPersonCount: number;
  speakerMap: Map<string, ISpeaker>; // Maps voice/face ID to speaker info
}

// Create a new speaker tracker for a session
export function createSpeakerTracker(): SpeakerTracker {
  return {
    currentOtherPersonCount: 0,
    speakerMap: new Map(),
  };
}

// Create speaker object for the user
export function createUserSpeaker(userName: string): ISpeaker {
  return {
    id: 'user',
    name: userName,
    type: 'user',
    isKnown: true,
  };
}

// Create speaker object for MIRA
export function createMiraSpeaker(agent: 'mi' | 'ra' | 'mira'): ISpeaker {
  return {
    id: `mira_${agent}`,
    name: agent.toUpperCase(),
    type: 'mira',
    isKnown: true,
  };
}

// Create or get speaker for an unknown/recognized person
export function getOrCreateOtherSpeaker(
  tracker: SpeakerTracker,
  recognizedPersonId?: string,
  recognizedName?: string
): ISpeaker {
  // If recognized, use their ID
  if (recognizedPersonId && recognizedName) {
    const existingKey = `known_${recognizedPersonId}`;
    if (!tracker.speakerMap.has(existingKey)) {
      tracker.speakerMap.set(existingKey, {
        id: recognizedPersonId,
        name: recognizedName,
        type: 'other',
        isKnown: true,
        faceDataId: recognizedPersonId,
      });
    }
    return tracker.speakerMap.get(existingKey)!;
  }
  
  // Unknown person - assign Person X
  tracker.currentOtherPersonCount++;
  const personId = `person_${tracker.currentOtherPersonCount}`;
  const speaker: ISpeaker = {
    id: personId,
    name: `Person ${tracker.currentOtherPersonCount}`,
    type: 'other',
    isKnown: false,
  };
  tracker.speakerMap.set(personId, speaker);
  return speaker;
}

// Detect who is speaking using camera (visual) and assign speaker
export async function detectSpeakerFromCamera(
  imageBase64: string,
  userId: string,
  tracker: SpeakerTracker
): Promise<{ speaker: ISpeaker | null; otherPeopleInFrame: number; speakerLookingAtCamera: boolean }> {
  try {
    const knownPeople = await getKnownPeople(userId);
    const result = await detectFacesWithGemini(imageBase64, knownPeople);
    
    // Check if any person is speaking (mouth open, talking gesture)
    if (result.speakingPerson) {
      // If it's a recognized person
      if ('personId' in result.speakingPerson) {
        const speaker = getOrCreateOtherSpeaker(
          tracker,
          result.speakingPerson.personId,
          result.speakingPerson.name
        );
        return {
          speaker,
          otherPeopleInFrame: result.detectedFaces.length - 1, // Exclude the speaker
          speakerLookingAtCamera: result.speakingPerson.confidence > 0.7,
        };
      }
      
      // Unknown person speaking
      const speaker = getOrCreateOtherSpeaker(tracker);
      return {
        speaker,
        otherPeopleInFrame: result.detectedFaces.length - 1,
        speakerLookingAtCamera: result.speakingPerson.isLookingAtCamera,
      };
    }
    
    // Check for unknown faces that might be speaking
    if (result.unknownFaces.length > 0) {
      return {
        speaker: null, // Can't determine who's speaking
        otherPeopleInFrame: result.unknownFaces.length,
        speakerLookingAtCamera: false,
      };
    }
    
    return {
      speaker: null,
      otherPeopleInFrame: 0,
      speakerLookingAtCamera: false,
    };
  } catch (error) {
    console.error('Error detecting speaker from camera:', error);
    return {
      speaker: null,
      otherPeopleInFrame: 0,
      speakerLookingAtCamera: false,
    };
  }
}

// Save transcript entry to database
export async function saveTranscriptEntry(
  userId: string,
  sessionId: string,
  entry: ITranscriptEntry
): Promise<void> {
  await connectToDatabase();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Find or create transcript for today's session
  let transcript = await Transcript.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    sessionId,
    date: today,
  });
  
  if (!transcript) {
    transcript = new Transcript({
      userId: new mongoose.Types.ObjectId(userId),
      sessionId,
      date: today,
      entries: [],
      metadata: {
        totalEntries: 0,
        userMessages: 0,
        miraMessages: 0,
        otherPeopleMessages: 0,
        uniqueSpeakers: [],
      },
    });
  }
  
  // Add entry
  transcript.entries.push(entry);
  
  // Update metadata
  transcript.metadata.totalEntries++;
  if (entry.speaker.type === 'user') {
    transcript.metadata.userMessages++;
  } else if (entry.speaker.type === 'mira') {
    transcript.metadata.miraMessages++;
  } else {
    transcript.metadata.otherPeopleMessages++;
  }
  
  // Track unique speakers
  if (!transcript.metadata.uniqueSpeakers.includes(entry.speaker.id)) {
    transcript.metadata.uniqueSpeakers.push(entry.speaker.id);
  }
  
  await transcript.save();
}

// Get transcripts for a user
export async function getTranscripts(
  userId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    sessionId?: string;
    limit?: number;
    skip?: number;
  } = {}
): Promise<{ transcripts: any[]; total: number }> {
  await connectToDatabase();
  
  const query: any = { userId: new mongoose.Types.ObjectId(userId) };
  
  if (options.startDate || options.endDate) {
    query.date = {};
    if (options.startDate) query.date.$gte = options.startDate;
    if (options.endDate) query.date.$lte = options.endDate;
  }
  
  if (options.sessionId) {
    query.sessionId = options.sessionId;
  }
  
  const total = await Transcript.countDocuments(query);
  const transcripts = await Transcript.find(query)
    .sort({ date: -1, createdAt: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 20);
  
  return { transcripts, total };
}

// Get transcript by ID
export async function getTranscriptById(
  userId: string,
  transcriptId: string
): Promise<any | null> {
  await connectToDatabase();
  
  return Transcript.findOne({
    _id: transcriptId,
    userId: new mongoose.Types.ObjectId(userId),
  });
}

// Get recent transcript entries (for context in chat)
export async function getRecentTranscriptEntries(
  userId: string,
  sessionId: string,
  limit: number = 15
): Promise<ITranscriptEntry[]> {
  await connectToDatabase();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Find today's transcript for this session
  const transcript = await Transcript.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    sessionId,
    date: today,
  });
  
  if (!transcript || !transcript.entries || transcript.entries.length === 0) {
    return [];
  }
  
  // Return the most recent entries (last N entries)
  const entries = transcript.entries.slice(-limit);
  return entries;
}

// Generate AI summary for a transcript
export async function generateTranscriptSummary(
  transcriptId: string,
  userId: string
): Promise<string> {
  const transcript = await getTranscriptById(userId, transcriptId);
  if (!transcript) return '';
  
  // Get conversation content
  const conversationText = transcript.entries
    .map((e: ITranscriptEntry) => `${e.speaker.name}: ${e.content}`)
    .join('\n');
  
  // TODO: Call AI to generate summary
  // For now, return a basic summary
  const stats = transcript.metadata;
  return `Conversation with ${stats.uniqueSpeakers.length} participants. ${stats.totalEntries} total messages.`;
}

export default {
  isDirectedAtMira,
  createSpeakerTracker,
  createUserSpeaker,
  createMiraSpeaker,
  getOrCreateOtherSpeaker,
  detectSpeakerFromCamera,
  saveTranscriptEntry,
  getTranscripts,
  getTranscriptById,
  getRecentTranscriptEntries,
  generateTranscriptSummary,
};
