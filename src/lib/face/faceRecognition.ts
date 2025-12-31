// Face Recognition Service - Uses Gemini Vision with direct image comparison
import FaceData, { IFaceData } from '@/models/FaceData';
import { connectToDatabase } from '@/lib/mongodb';
import mongoose from 'mongoose';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Cache for recent recognitions to avoid repeated expensive comparisons
interface RecognitionCache {
  personId: string;
  name: string;
  timestamp: number;
  confidence: number;
}

const recognitionCache: Map<string, RecognitionCache> = new Map();
const CACHE_DURATION_MS = 60000; // Cache recognition for 60 seconds

// Clear old cache entries
function cleanCache() {
  const now = Date.now();
  for (const [key, value] of recognitionCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION_MS) {
      recognitionCache.delete(key);
    }
  }
}

export interface DetectedFace {
  id: string;
  description: string;
  distinctiveFeatures: string[];
  expression: string;
  estimatedAge: string;
  gender: string;
  isLookingAtCamera: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface RecognizedPerson {
  personId: string;
  name: string;
  relationship: string;
  confidence: number;
  context: string;
  lastSeen: Date;
  matchedFeatures: string[];
}

export interface FaceAnalysisResult {
  detectedFaces: DetectedFace[];
  recognizedPeople: RecognizedPerson[];
  unknownFaces: DetectedFace[];
  speakingPerson?: RecognizedPerson | DetectedFace;
}

// Clean and validate base64 image data
function cleanBase64(imageBase64: string): { data: string; mimeType: string } {
  const cleanedData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const mimeType = imageBase64.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
  return { data: cleanedData, mimeType };
}

// Compare a face in the current image against a known person's stored image
export async function compareFaces(
  currentImageBase64: string,
  storedImageBase64: string,
  personName: string,
  personFeatures: string[]
): Promise<{ isMatch: boolean; confidence: number; matchedFeatures: string[] }> {
  if (!GEMINI_API_KEY) {
    return { isMatch: false, confidence: 0, matchedFeatures: [] };
  }

  const current = cleanBase64(currentImageBase64);
  const stored = cleanBase64(storedImageBase64);

  const prompt = `You are a face recognition expert. Compare the person in IMAGE 1 (current camera) with the person in IMAGE 2 (stored reference photo of "${personName}").

Known features of ${personName}: ${personFeatures.join(', ')}

CRITICAL: Look at the actual facial structure, not just clothing or background:
- Face shape (oval, round, square, etc.)
- Eye shape, spacing, and color
- Nose shape and size
- Mouth/lip shape
- Facial hair (beard, mustache)
- Distinctive features (glasses, moles, scars, dimples)
- Hair color and style (but note: hair can change)

Respond in EXACT JSON format:
{
  "isMatch": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "matchedFeatures": ["feature1", "feature2"]
}

Be STRICT but REASONABLE:
- Same person with different expressions = MATCH
- Same person with different lighting = MATCH
- Same person with glasses on/off = likely MATCH (check other features)
- Different people who look similar = NO MATCH
- If uncertain, set confidence low (0.3-0.5)`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { text: "IMAGE 1 (Current camera):" },
            { inline_data: { mime_type: current.mimeType, data: current.data } },
            { text: "IMAGE 2 (Stored reference of " + personName + "):" },
            { inline_data: { mime_type: stored.mimeType, data: stored.data } }
          ]
        }],
        generationConfig: {
          temperature: 0.1, // Low temperature for consistent matching
          maxOutputTokens: 300
        }
      }),
    });

    if (!response.ok) {
      console.error('Face comparison error:', response.status);
      return { isMatch: false, confidence: 0, matchedFeatures: [] };
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { isMatch: false, confidence: 0, matchedFeatures: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isMatch: parsed.isMatch === true && parsed.confidence >= 0.65,
      confidence: parsed.confidence || 0,
      matchedFeatures: parsed.matchedFeatures || [],
    };
  } catch (error) {
    console.error('Face comparison error:', error);
    return { isMatch: false, confidence: 0, matchedFeatures: [] };
  }
}

// Analyze image and detect faces, then compare against known people
export async function detectFacesWithGemini(
  imageBase64: string,
  knownPeople: IFaceData[]
): Promise<FaceAnalysisResult> {
  if (!GEMINI_API_KEY) {
    return { detectedFaces: [], recognizedPeople: [], unknownFaces: [] };
  }

  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  // First, detect faces in the current image
  const detectPrompt = `Analyze this image for face detection.

For EACH face visible in the image, provide:
1. Detailed description (hair, skin tone, facial features)
2. Distinctive features that help identify this person
3. Expression (happy, neutral, focused, talking, etc.)
4. Estimated age range
5. Gender appearance
6. Are they looking at camera?
7. Are they currently speaking? (mouth open in speech position)

Respond in EXACT JSON format:
{
  "faces": [
    {
      "id": "face_1",
      "description": "Detailed appearance description",
      "distinctiveFeatures": ["brown curly hair", "wears glasses", "has beard"],
      "expression": "smiling",
      "estimatedAge": "30s",
      "gender": "male",
      "isLookingAtCamera": true,
      "isSpeaking": false
    }
  ],
  "speakingPersonIndex": 0 or null,
  "totalFaces": 1
}`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: detectPrompt },
            { inline_data: { mime_type: mimeType, data: cleanedData } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800
        }
      }),
    });

    if (!response.ok) {
      console.error('Gemini face detection error:', response.status);
      return { detectedFaces: [], recognizedPeople: [], unknownFaces: [] };
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { detectedFaces: [], recognizedPeople: [], unknownFaces: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const faces = parsed.faces || [];

    if (faces.length === 0) {
      return { detectedFaces: [], recognizedPeople: [], unknownFaces: [] };
    }

    const detectedFaces: DetectedFace[] = faces.map((face: any) => ({
      id: face.id,
      description: face.description,
      distinctiveFeatures: face.distinctiveFeatures || [],
      expression: face.expression,
      estimatedAge: face.estimatedAge,
      gender: face.gender,
      isLookingAtCamera: face.isLookingAtCamera,
    }));

    const recognizedPeople: RecognizedPerson[] = [];
    const unknownFaces: DetectedFace[] = [];

    // Clean old cache entries
    cleanCache();

    // Compare each detected face against known people using direct image comparison
    // Only do comparison if we have known people AND at least one face
    if (knownPeople.length > 0 && faces.length > 0) {
      // Check if we have a recent cache hit - if someone was recognized in last 60s,
      // likely they're still there (reduces API calls)
      const cachedRecognitions = Array.from(recognitionCache.values())
        .filter(c => Date.now() - c.timestamp < CACHE_DURATION_MS);
      
      for (const face of detectedFaces) {
        let bestMatch: { person: IFaceData; confidence: number; matchedFeatures: string[] } | null = null;
        
        // First, check if we have a recent cache hit for any known person
        // This helps when the same person is still in frame
        if (cachedRecognitions.length > 0) {
          const cachedPerson = knownPeople.find(p => 
            cachedRecognitions.some(c => c.personId === p._id.toString())
          );
          
          if (cachedPerson) {
            // Quick verify - compare against cached person first
            const storedImage = cachedPerson.photos?.[0]?.url;
            if (storedImage && storedImage.length >= 100) {
              const comparison = await compareFaces(
                imageBase64,
                storedImage,
                cachedPerson.personName,
                cachedPerson.distinctiveFeatures
              );
              
              if (comparison.isMatch && comparison.confidence >= 0.6) {
                bestMatch = {
                  person: cachedPerson,
                  confidence: comparison.confidence,
                  matchedFeatures: comparison.matchedFeatures,
                };
                // Refresh cache
                recognitionCache.set(cachedPerson._id.toString(), {
                  personId: cachedPerson._id.toString(),
                  name: cachedPerson.personName,
                  timestamp: Date.now(),
                  confidence: comparison.confidence,
                });
              }
            }
          }
        }
        
        // If no cache hit, compare against all known people
        if (!bestMatch) {
          for (const person of knownPeople) {
            // Get the stored image for this person
            const storedImage = person.photos?.[0]?.url;
            if (!storedImage || storedImage.length < 100) continue; // Skip if no valid image

            const comparison = await compareFaces(
              imageBase64,
              storedImage,
              person.personName,
              person.distinctiveFeatures
            );

            if (comparison.isMatch && comparison.confidence > (bestMatch?.confidence || 0)) {
              bestMatch = {
                person,
                confidence: comparison.confidence,
                matchedFeatures: comparison.matchedFeatures,
              };
            }
          }
        }

        if (bestMatch && bestMatch.confidence >= 0.65) {
          recognizedPeople.push({
            personId: bestMatch.person._id.toString(),
            name: bestMatch.person.personName,
            relationship: bestMatch.person.relationship,
            confidence: bestMatch.confidence,
            context: bestMatch.person.metadata?.context || '',
            lastSeen: bestMatch.person.metadata?.lastSeen || new Date(),
            matchedFeatures: bestMatch.matchedFeatures,
          });
          
          // Update cache
          recognitionCache.set(bestMatch.person._id.toString(), {
            personId: bestMatch.person._id.toString(),
            name: bestMatch.person.personName,
            timestamp: Date.now(),
            confidence: bestMatch.confidence,
          });
        } else {
          unknownFaces.push(face);
        }
      }
    } else {
      // No known people to compare against - all faces are unknown
      unknownFaces.push(...detectedFaces);
    }

    // Determine who is speaking
    let speakingPerson: RecognizedPerson | DetectedFace | undefined;
    if (parsed.speakingPersonIndex !== null && parsed.speakingPersonIndex !== undefined) {
      const speakingFaceId = faces[parsed.speakingPersonIndex]?.id;
      
      // Check if the speaking person was recognized
      const recognizedSpeaker = recognizedPeople.find(p => 
        detectedFaces.findIndex(f => f.id === speakingFaceId) !== -1
      );
      
      if (recognizedSpeaker) {
        speakingPerson = recognizedSpeaker;
      } else {
        speakingPerson = detectedFaces[parsed.speakingPersonIndex];
      }
    }

    return {
      detectedFaces,
      recognizedPeople,
      unknownFaces,
      speakingPerson,
    };
  } catch (error) {
    console.error('Face detection error:', error);
    return { detectedFaces: [], recognizedPeople: [], unknownFaces: [] };
  }
}

// Save a new person to the database with their face image
export async function savePerson(
  userId: string,
  name: string,
  imageBase64: string,
  relationship: string = 'unknown',
  context: string = ''
): Promise<IFaceData | null> {
  if (!GEMINI_API_KEY) {
    return null;
  }

  await connectToDatabase();

  // Get detailed description from Gemini
  const { data: cleanedData, mimeType } = cleanBase64(imageBase64);

  const prompt = `Analyze this person's face for identification purposes.

Provide a DETAILED description that will help recognize this person later:
1. Hair: color, style, length
2. Face shape and skin tone
3. Facial features: eyes, nose, mouth shape
4. Distinctive features: glasses, beard, moustache, piercings, scars, moles
5. Estimated age range
6. Any other identifying characteristics

Respond in this EXACT JSON format:
{
  "description": "Full detailed description for identification",
  "distinctiveFeatures": ["feature1", "feature2", "feature3"],
  "estimatedAge": "30s",
  "gender": "male/female"
}`;

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: cleanedData } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500
        }
      }),
    });

    if (!response.ok) {
      console.error('Gemini description error:', response.status);
      return null;
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const jsonMatch = textContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // IMPORTANT: Store the FULL base64 image for later face comparison
    // This is critical for face recognition to work!
    const faceData = new FaceData({
      userId: new mongoose.Types.ObjectId(userId),
      personName: name,
      relationship,
      geminiDescription: parsed.description,
      distinctiveFeatures: parsed.distinctiveFeatures || [],
      faceDescriptor: [],
      photos: [{
        url: imageBase64, // Store FULL image, not truncated!
        uploadedAt: new Date(),
        isPrimary: true,
      }],
      metadata: {
        firstSeen: new Date(),
        lastSeen: new Date(),
        seenCount: 1,
        notes: '',
        context,
        learnedInfo: [],
      },
      isOwner: false,
    });

    await faceData.save();
    console.log(`[Face] Saved person "${name}" with full image (${imageBase64.length} chars)`);
    return faceData;
  } catch (error) {
    console.error('Save person error:', error);
    return null;
  }
}

// Update person's last seen and increment count
// Returns greeting info if this is first time today or after a long gap
export interface GreetingInfo {
  shouldGreet: boolean;
  personName: string;
  isOwner: boolean;
  relationship: string;
  timeSinceLastSeen: number; // in milliseconds
  isFirstTimeToday: boolean;
  greetingType: 'morning' | 'afternoon' | 'evening' | 'night' | 'welcome_back';
}

export async function updatePersonSeen(personId: string): Promise<GreetingInfo | null> {
  try {
    await connectToDatabase();
    
    // Get the current person data first
    const person = await FaceData.findById(personId);
    if (!person) return null;
    
    const now = new Date();
    const lastSeen = person.metadata.lastSeen;
    const timeSinceLastSeen = now.getTime() - lastSeen.getTime();
    
    // Check if this is the first time today
    const lastSeenDate = new Date(lastSeen);
    const isFirstTimeToday = lastSeenDate.toDateString() !== now.toDateString();
    
    // Consider a "long gap" as more than 4 hours (14400000 ms)
    const longGapThreshold = 4 * 60 * 60 * 1000; // 4 hours
    const isLongGap = timeSinceLastSeen > longGapThreshold;
    
    // Determine if we should greet
    const shouldGreet = isFirstTimeToday || isLongGap;
    
    // Determine greeting type based on time of day
    const hour = now.getHours();
    let greetingType: GreetingInfo['greetingType'];
    if (hour >= 5 && hour < 12) {
      greetingType = 'morning';
    } else if (hour >= 12 && hour < 17) {
      greetingType = 'afternoon';
    } else if (hour >= 17 && hour < 21) {
      greetingType = 'evening';
    } else {
      greetingType = 'night';
    }
    
    // If it's been more than a day, make it a "welcome back"
    if (timeSinceLastSeen > 24 * 60 * 60 * 1000) {
      greetingType = 'welcome_back';
    }
    
    // Update the database
    await FaceData.findByIdAndUpdate(personId, {
      $set: { 'metadata.lastSeen': now },
      $inc: { 'metadata.seenCount': 1 },
    });
    
    if (shouldGreet) {
      return {
        shouldGreet: true,
        personName: person.personName,
        isOwner: person.isOwner || false,
        relationship: person.relationship,
        timeSinceLastSeen,
        isFirstTimeToday,
        greetingType,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Update person seen error:', error);
    return null;
  }
}

// Add learned info about a person
export async function addLearnedInfo(personId: string, info: string): Promise<void> {
  try {
    await connectToDatabase();
    await FaceData.findByIdAndUpdate(personId, {
      $push: { 'metadata.learnedInfo': info },
    });
  } catch (error) {
    console.error('Add learned info error:', error);
  }
}

// Update person context
export async function updatePersonContext(personId: string, context: string): Promise<void> {
  try {
    await connectToDatabase();
    await FaceData.findByIdAndUpdate(personId, {
      $set: { 'metadata.context': context },
    });
  } catch (error) {
    console.error('Update person context error:', error);
  }
}

// Get all known people for a user (with their stored images for comparison)
export async function getKnownPeople(userId: string): Promise<IFaceData[]> {
  try {
    await connectToDatabase();
    const people = await FaceData.find({ userId }).sort({ 'metadata.lastSeen': -1 });
    console.log(`[Face] Found ${people.length} known people for user`);
    return people;
  } catch (error) {
    console.error('Get known people error:', error);
    return [];
  }
}

// Add an additional photo for a person (improves recognition accuracy)
export async function addPersonPhoto(
  personId: string,
  userId: string,
  imageBase64: string
): Promise<boolean> {
  try {
    await connectToDatabase();
    const result = await FaceData.findOneAndUpdate(
      { _id: personId, userId },
      {
        $push: {
          photos: {
            url: imageBase64,
            uploadedAt: new Date(),
            isPrimary: false,
          }
        },
        $set: { 'metadata.lastSeen': new Date() },
        $inc: { 'metadata.seenCount': 1 },
      }
    );
    return !!result;
  } catch (error) {
    console.error('Add person photo error:', error);
    return false;
  }
}

// Delete a person
export async function deletePerson(personId: string, userId: string): Promise<boolean> {
  try {
    await connectToDatabase();
    const result = await FaceData.deleteOne({ _id: personId, userId });
    return result.deletedCount > 0;
  } catch (error) {
    console.error('Delete person error:', error);
    return false;
  }
}

// Check if we should prompt user about unknown face
export function shouldPromptForUnknownFace(
  unknownFaces: DetectedFace[],
  lastPromptTime: Date | null,
  promptCooldownMs: number = 30000 // 30 seconds cooldown
): boolean {
  if (unknownFaces.length === 0) return false;
  if (!lastPromptTime) return true;
  
  const timeSinceLastPrompt = Date.now() - lastPromptTime.getTime();
  return timeSinceLastPrompt > promptCooldownMs;
}

export default {
  detectFacesWithGemini,
  compareFaces,
  savePerson,
  updatePersonSeen,
  addLearnedInfo,
  updatePersonContext,
  getKnownPeople,
  addPersonPhoto,
  deletePerson,
  shouldPromptForUnknownFace,
};
