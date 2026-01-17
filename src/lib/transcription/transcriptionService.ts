// Background Transcription Service - Continuous listening with speaker detection
import Transcript, { ISpeaker, ITranscriptEntry } from '@/models/Transcript';
import { connectToDatabase } from '@/lib/mongodb';
import mongoose from 'mongoose';

// MIRA trigger keywords
const MIRA_KEYWORDS = [
  'mira', 'hey mira', 'hi mira', 'hello mira',
  'meera', 'maya', 'myra', 'mia', 'miri',
];

// Check if message is directed at MIRA
export function isDirectedAtMira(text: unknown): boolean {
  if (typeof text !== 'string' || !text) {
    return false;
  }
  
  const lower = text.toLowerCase().trim();
  
  return MIRA_KEYWORDS.some(keyword => {
    if (lower.startsWith(keyword + ' ') || lower.startsWith(keyword + ',')) return true;
    if (/^(hey|hi|hello)\s+/.test(lower) && lower.includes(keyword)) return true;
    if (lower.endsWith(keyword) || lower.endsWith(keyword + '?') || lower.endsWith(keyword + '!')) return true;
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
    return keywordRegex.test(lower);
  });
}

// Speaker tracking state
interface SpeakerTracker {
  currentOtherPersonCount: number;
  speakerMap: Map<string, ISpeaker>;
}

export function createSpeakerTracker(): SpeakerTracker {
  return {
    currentOtherPersonCount: 0,
    speakerMap: new Map(),
  };
}

export function createUserSpeaker(userName: string): ISpeaker {
  return {
    id: 'user',
    name: userName,
    type: 'user',
    isKnown: true,
  };
}

export function createMiraSpeaker(_agent?: 'mira' | string): ISpeaker {
  return {
    id: 'mira',
    name: 'MIRA',
    type: 'mira',
    isKnown: true,
  };
}

export function getOrCreateOtherSpeaker(
  tracker: SpeakerTracker,
  recognizedPersonId?: string,
  recognizedName?: string
): ISpeaker {
  if (recognizedPersonId && recognizedName) {
    const existingKey = `known_${recognizedPersonId}`;
    if (!tracker.speakerMap.has(existingKey)) {
      tracker.speakerMap.set(existingKey, {
        id: recognizedPersonId,
        name: recognizedName,
        type: 'other',
        isKnown: true,
      });
    }
    return tracker.speakerMap.get(existingKey)!;
  }
  
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

// Save transcript entry to database
export async function saveTranscriptEntry(
  userId: string,
  sessionId: string,
  entry: ITranscriptEntry
): Promise<void> {
  await connectToDatabase();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
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
  
  transcript.entries.push(entry);
  
  transcript.metadata.totalEntries++;
  if (entry.speaker.type === 'user') {
    transcript.metadata.userMessages++;
  } else if (entry.speaker.type === 'mira') {
    transcript.metadata.miraMessages++;
  } else {
    transcript.metadata.otherPeopleMessages++;
  }
  
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
  limit: number = 50
): Promise<ITranscriptEntry[]> {
  await connectToDatabase();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const transcript = await Transcript.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    sessionId,
    date: today,
  });
  
  if (!transcript || !transcript.entries || transcript.entries.length === 0) {
    return [];
  }
  
  return transcript.entries.slice(-limit);
}

export async function generateTranscriptSummary(
  transcriptId: string,
  userId: string
): Promise<string> {
  const transcript = await getTranscriptById(userId, transcriptId);
  if (!transcript) return '';
  
  const stats = transcript.metadata;
  return `Conversation with ${stats.uniqueSpeakers.length} participants. ${stats.totalEntries} total messages.`;
}

export default {
  isDirectedAtMira,
  createSpeakerTracker,
  createUserSpeaker,
  createMiraSpeaker,
  getOrCreateOtherSpeaker,
  saveTranscriptEntry,
  getTranscripts,
  getTranscriptById,
  getRecentTranscriptEntries,
  generateTranscriptSummary,
};
