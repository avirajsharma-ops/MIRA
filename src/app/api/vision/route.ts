import { NextRequest, NextResponse } from 'next/server';
import { analyzeImageWithGemini, analyzeScreenWithGemini, detectGestureWithGemini } from '@/lib/vision';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import { detectFacesWithGemini, getKnownPeople, updatePersonSeen } from '@/lib/face/faceRecognition';

export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { imageBase64, type, context, detectGestures, detectSpeakers } = await request.json();

    if (!imageBase64) {
      return NextResponse.json(
        { error: 'Image is required' },
        { status: 400 }
      );
    }

    let analysis;
    if (type === 'screen') {
      // Use Gemini for screen analysis
      analysis = await analyzeScreenWithGemini(imageBase64);
    } else {
      // Use Gemini for image analysis
      analysis = await analyzeImageWithGemini(imageBase64, context);
      
      // If gesture detection is enabled, add gesture info using Gemini
      if (detectGestures) {
        const gesture = await detectGestureWithGemini(imageBase64);
        analysis = { ...analysis, gesture };
      }
      
      // If speaker detection is enabled, detect faces and who is speaking
      if (detectSpeakers) {
        try {
          const knownPeople = await getKnownPeople(payload.userId);
          const faceResult = await detectFacesWithGemini(imageBase64, knownPeople);
          
          // Update lastSeen for recognized people
          for (const person of faceResult.recognizedPeople) {
            await updatePersonSeen(person.personId);
          }
          
          analysis = {
            ...analysis,
            speakers: {
              detectedFaces: faceResult.detectedFaces,
              recognizedPeople: faceResult.recognizedPeople,
              unknownFaces: faceResult.unknownFaces,
              speakingPerson: faceResult.speakingPerson,
            }
          };
        } catch (err) {
          console.error('Speaker detection error:', err);
        }
      }
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('Vision analysis error:', error);
    // Return a default analysis instead of error to prevent frontend crashes
    return NextResponse.json({ 
      analysis: {
        description: 'Vision analysis temporarily unavailable',
        objects: [],
        people: { count: 0, descriptions: [], faces: [] },
        activities: [],
        mood: 'neutral',
        gesture: 'none',
        context: 'Unable to analyze image at this time'
      }
    });
  }
}
