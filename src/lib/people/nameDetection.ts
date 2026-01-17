import { connectToDatabase } from '@/lib/mongodb';
import Person from '@/models/Person';
import UnknownPerson from '@/models/UnknownPerson';
import mongoose from 'mongoose';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Common words that are NOT names
const NON_NAME_WORDS = new Set([
  'mira', 'mirror', 'hey', 'hi', 'hello', 'okay', 'ok', 'yes', 'no', 'yeah', 'nope',
  'thanks', 'thank', 'please', 'sorry', 'sure', 'maybe', 'probably', 'definitely',
  'today', 'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'morning', 'afternoon', 'evening', 'night', 'noon',
  'google', 'amazon', 'apple', 'microsoft', 'facebook', 'meta', 'twitter', 'instagram', 'whatsapp',
  'uber', 'lyft', 'netflix', 'spotify', 'youtube', 'tiktok',
  'india', 'usa', 'america', 'china', 'japan', 'germany', 'france', 'uk', 'england',
  'delhi', 'mumbai', 'bangalore', 'chennai', 'kolkata', 'hyderabad', 'pune', 'ahmedabad',
  'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'san francisco', 'seattle', 'boston',
]);

// Relationship keywords to detect context
const RELATIONSHIP_KEYWORDS: { [key: string]: string[] } = {
  family: ['mom', 'mother', 'dad', 'father', 'brother', 'sister', 'son', 'daughter', 'wife', 'husband', 'uncle', 'aunt', 'cousin', 'grandma', 'grandpa', 'grandmother', 'grandfather', 'nephew', 'niece'],
  friend: ['friend', 'buddy', 'pal', 'mate', 'bestie', 'bff'],
  colleague: ['colleague', 'coworker', 'boss', 'manager', 'team', 'work', 'office', 'employee', 'intern'],
  romantic: ['girlfriend', 'boyfriend', 'partner', 'fiance', 'fiancee', 'date', 'crush'],
  professional: ['doctor', 'lawyer', 'accountant', 'dentist', 'therapist', 'teacher', 'professor'],
};

/**
 * Extract names from text using AI
 */
export async function extractNamesFromText(text: string): Promise<{
  names: string[];
  nameContexts: { name: string; context: string; possibleRelationship?: string }[];
}> {
  if (!text || text.length < 10) {
    return { names: [], nameContexts: [] };
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a name extraction assistant. Extract all person names mentioned in the text.
DO NOT include:
- AI assistants (Mira, Alexa, Siri, etc.)
- Company names (Google, Amazon, etc.)
- Place names (cities, countries)
- Common words or greetings

For each name found, try to determine the relationship context if mentioned.

Respond in JSON format:
{
  "names": [
    {
      "name": "Name",
      "context": "brief snippet where name appears",
      "possibleRelationship": "friend|family|colleague|romantic|professional|unknown"
    }
  ]
}

If no names found, return {"names": []}`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || '{"names":[]}';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));
    
    const validNames = (parsed.names || []).filter((n: { name: string }) => {
      const nameLower = n.name.toLowerCase();
      return (
        n.name.length >= 2 &&
        !NON_NAME_WORDS.has(nameLower) &&
        !/^\d+$/.test(n.name) // Not just numbers
      );
    });

    return {
      names: validNames.map((n: { name: string }) => n.name),
      nameContexts: validNames,
    };
  } catch (error) {
    console.error('[NameDetection] AI extraction failed:', error);
    return { names: [], nameContexts: [] };
  }
}

/**
 * Process detected names - add to known or unknown people
 */
export async function processDetectedNames(
  userId: string,
  nameContexts: { name: string; context: string; possibleRelationship?: string }[]
): Promise<{
  knownPeople: string[];
  newUnknownPeople: string[];
  updatedUnknownPeople: string[];
}> {
  if (!nameContexts || nameContexts.length === 0) {
    return { knownPeople: [], newUnknownPeople: [], updatedUnknownPeople: [] };
  }

  await connectToDatabase();
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const knownPeople: string[] = [];
  const newUnknownPeople: string[] = [];
  const updatedUnknownPeople: string[] = [];

  for (const { name, context, possibleRelationship } of nameContexts) {
    const normalizedName = name.trim();
    
    // Check if this person is already known
    const existingPerson = await Person.findOne({
      userId: userObjectId,
      $or: [
        { name: { $regex: `^${normalizedName}$`, $options: 'i' } },
        { aliases: { $regex: `^${normalizedName}$`, $options: 'i' } },
      ],
    });

    if (existingPerson) {
      // Update mention count and last mentioned
      await Person.updateOne(
        { _id: existingPerson._id },
        {
          $inc: { mentionCount: 1 },
          $set: { lastMentionedAt: new Date() },
        }
      );
      knownPeople.push(normalizedName);
      continue;
    }

    // Check if already in unknown people
    const existingUnknown = await UnknownPerson.findOne({
      userId: userObjectId,
      name: { $regex: `^${normalizedName}$`, $options: 'i' },
    });

    if (existingUnknown) {
      // Update existing unknown person
      const updateData: any = {
        $inc: { mentionCount: 1 },
        $set: { lastMentionedAt: new Date() },
        $push: { contexts: context.substring(0, 200) },
      };
      
      if (possibleRelationship && possibleRelationship !== 'unknown') {
        updateData.$addToSet = { possibleRelationships: possibleRelationship };
      }
      
      await UnknownPerson.updateOne({ _id: existingUnknown._id }, updateData);
      updatedUnknownPeople.push(normalizedName);
    } else {
      // Create new unknown person
      await UnknownPerson.create({
        userId: userObjectId,
        name: normalizedName,
        mentionCount: 1,
        firstMentionedAt: new Date(),
        lastMentionedAt: new Date(),
        contexts: [context.substring(0, 200)],
        possibleRelationships: possibleRelationship && possibleRelationship !== 'unknown' 
          ? [possibleRelationship] 
          : [],
        status: 'unknown',
      });
      newUnknownPeople.push(normalizedName);
    }
  }

  console.log('[NameDetection] Processed:', {
    known: knownPeople.length,
    newUnknown: newUnknownPeople.length,
    updatedUnknown: updatedUnknownPeople.length,
  });

  return { knownPeople, newUnknownPeople, updatedUnknownPeople };
}

/**
 * Get unknown people that MIRA should ask about
 * Prioritizes people mentioned multiple times who haven't been asked about recently
 */
export async function getUnknownPeopleToAskAbout(
  userId: string,
  limit: number = 3
): Promise<IUnknownPerson[]> {
  await connectToDatabase();
  const userObjectId = new mongoose.Types.ObjectId(userId);
  
  // Get unknown people who:
  // - Have been mentioned at least 2 times
  // - Haven't been asked about in the last 24 hours (or never)
  // - Status is still 'unknown'
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const unknownPeople = await UnknownPerson.find({
    userId: userObjectId,
    status: 'unknown',
    mentionCount: { $gte: 2 },
    $or: [
      { lastAskedAt: { $exists: false } },
      { lastAskedAt: { $lt: oneDayAgo } },
    ],
  })
    .sort({ mentionCount: -1, lastMentionedAt: -1 })
    .limit(limit)
    .lean();

  return unknownPeople as unknown as IUnknownPerson[];
}

interface IUnknownPerson {
  _id: mongoose.Types.ObjectId;
  name: string;
  mentionCount: number;
  contexts: string[];
  possibleRelationships: string[];
}

/**
 * Mark that MIRA asked about an unknown person
 */
export async function markAskedAboutPerson(personId: string): Promise<void> {
  await UnknownPerson.updateOne(
    { _id: new mongoose.Types.ObjectId(personId) },
    {
      $inc: { askedCount: 1 },
      $set: { lastAskedAt: new Date() },
    }
  );
}

/**
 * Identify an unknown person - move to known people
 */
export async function identifyUnknownPerson(
  unknownPersonId: string,
  description: string,
  relationship?: string
): Promise<mongoose.Types.ObjectId | null> {
  await connectToDatabase();
  
  const unknownPerson = await UnknownPerson.findById(unknownPersonId);
  if (!unknownPerson) return null;

  // Create a new Person entry
  const newPerson = await Person.create({
    userId: unknownPerson.userId,
    name: unknownPerson.name,
    description,
    relationship: relationship || unknownPerson.possibleRelationships[0] || undefined,
    tags: unknownPerson.possibleRelationships,
    mentionCount: unknownPerson.mentionCount,
    lastMentionedAt: unknownPerson.lastMentionedAt,
    isFullyAccounted: true,
    source: 'detected',
  });

  // Update unknown person status
  await UnknownPerson.updateOne(
    { _id: unknownPerson._id },
    {
      $set: {
        status: 'identified',
        linkedPersonId: newPerson._id,
      },
    }
  );

  console.log('[NameDetection] Identified person:', unknownPerson.name, '→', newPerson._id);
  
  return newPerson._id;
}

/**
 * Generate a proactive question about an unknown person
 */
export function generateQuestionAboutPerson(person: IUnknownPerson): string {
  const name = person.name;
  const mentions = person.mentionCount;
  const contexts = person.contexts.slice(-2).join(' ... ');
  const relationship = person.possibleRelationships[0];

  // Different question styles
  const questions = [
    `I've heard you mention ${name} ${mentions} times. Who is ${name}?`,
    `You've talked about ${name} a few times. Can you tell me more about them?`,
    `I noticed you mentioned ${name} recently. Are they a ${relationship || 'friend or colleague'}?`,
    `By the way, who is ${name}? You've mentioned them before.`,
  ];

  // Pick a random question style
  return questions[Math.floor(Math.random() * questions.length)];
}

export default {
  extractNamesFromText,
  processDetectedNames,
  getUnknownPeopleToAskAbout,
  markAskedAboutPerson,
  identifyUnknownPerson,
  generateQuestionAboutPerson,
};
