import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Person from '@/models/Person';
import mongoose from 'mongoose';

/**
 * API to migrate facedata collection to people collection
 * 
 * POST /api/migrate/facedata - Migrate all facedata to people
 * GET /api/migrate/facedata - Check migration status
 */

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromHeader(request.headers.get('authorization'));
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database not connected' }, { status: 500 });
    }

    // Check if facedatas collection exists
    const collections = await db.listCollections({ name: 'facedatas' }).toArray();
    const facedataExists = collections.length > 0;

    let facedataCount = 0;
    if (facedataExists) {
      facedataCount = await db.collection('facedatas').countDocuments();
    }

    const peopleCount = await Person.countDocuments();
    const migratedCount = await Person.countDocuments({ source: 'migrated' });

    return NextResponse.json({
      facedataExists,
      facedataCount,
      peopleCount,
      migratedCount,
      canMigrate: facedataExists && facedataCount > 0,
    });
  } catch (error) {
    console.error('[Migration] Status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

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

    await connectToDatabase();
    const db = mongoose.connection.db;
    
    if (!db) {
      return NextResponse.json({ error: 'Database not connected' }, { status: 500 });
    }

    // Get all facedata documents
    const facedataCollection = db.collection('facedatas');
    const facedatas = await facedataCollection.find({}).toArray();

    if (facedatas.length === 0) {
      return NextResponse.json({
        message: 'No facedata to migrate',
        migrated: 0,
      });
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const facedata of facedatas) {
      try {
        // Check if person with same name already exists for this user
        const existingPerson = await Person.findOne({
          userId: facedata.userId,
          name: { $regex: `^${facedata.name}$`, $options: 'i' },
        });

        if (existingPerson) {
          // Update existing person with face descriptor if they don't have one
          if (!existingPerson.faceDescriptor && facedata.descriptor) {
            await Person.updateOne(
              { _id: existingPerson._id },
              { 
                $set: { faceDescriptor: facedata.descriptor },
                $addToSet: { tags: 'has-face' },
              }
            );
            console.log('[Migration] Updated existing person with face:', existingPerson.name);
          }
          skipped++;
          continue;
        }

        // Create new person from facedata
        await Person.create({
          userId: facedata.userId,
          name: facedata.name || facedata.label || 'Unknown',
          description: facedata.description || `Person detected and saved. Created from face recognition data.`,
          relationship: facedata.relationship || undefined,
          tags: ['migrated-from-facedata', 'has-face'],
          faceDescriptor: facedata.descriptor || facedata.descriptors?.[0],
          mentionCount: facedata.seenCount || 1,
          lastMentionedAt: facedata.lastSeen || facedata.updatedAt || new Date(),
          isFullyAccounted: !!(facedata.description),
          source: 'migrated',
        });

        migrated++;
        console.log('[Migration] Migrated facedata:', facedata.name);
      } catch (err) {
        console.error('[Migration] Error migrating facedata:', facedata.name, err);
        errors++;
      }
    }

    // Optionally delete the facedata collection after successful migration
    const { deleteOriginal } = await request.json().catch(() => ({ deleteOriginal: false }));
    
    if (deleteOriginal && errors === 0) {
      await facedataCollection.drop();
      console.log('[Migration] Dropped facedatas collection');
    }

    return NextResponse.json({
      message: 'Migration completed',
      total: facedatas.length,
      migrated,
      skipped,
      errors,
      deletedOriginal: deleteOriginal && errors === 0,
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
