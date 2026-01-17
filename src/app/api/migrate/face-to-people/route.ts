import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import { verifyToken, getTokenFromHeader } from '@/lib/auth';
import Person from '@/models/Person';
import mongoose from 'mongoose';

/**
 * Migration API: Move face data to people collection
 * This migrates the facedatas collection to the people collection
 * 
 * POST /api/migrate/face-to-people - Run the migration
 * GET /api/migrate/face-to-people - Check migration status
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
    const collections = await db.listCollections().toArray();
    const faceDataExists = collections.some(c => c.name === 'facedatas');

    // Count documents
    const faceDataCount = faceDataExists 
      ? await db.collection('facedatas').countDocuments()
      : 0;
    
    const peopleCount = await Person.countDocuments();

    return NextResponse.json({
      faceDataCollection: {
        exists: faceDataExists,
        documentCount: faceDataCount,
      },
      peopleCollection: {
        documentCount: peopleCount,
      },
      migrationNeeded: faceDataExists && faceDataCount > 0,
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

    const { deleteAfterMigration = false } = await request.json().catch(() => ({}));

    // Check if facedatas collection exists
    const collections = await db.listCollections().toArray();
    const faceDataExists = collections.some(c => c.name === 'facedatas');

    if (!faceDataExists) {
      return NextResponse.json({
        message: 'No facedatas collection found',
        migrated: 0,
      });
    }

    // Get all face data documents
    const faceDataDocs = await db.collection('facedatas').find({}).toArray();

    if (faceDataDocs.length === 0) {
      return NextResponse.json({
        message: 'No face data documents to migrate',
        migrated: 0,
      });
    }

    console.log('[Migration] Found', faceDataDocs.length, 'face data documents to migrate');

    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    const migratedNames: string[] = [];

    for (const faceData of faceDataDocs) {
      try {
        // Check if person with this name already exists for this user
        const existingPerson = await Person.findOne({
          userId: faceData.userId,
          name: { $regex: `^${faceData.name}$`, $options: 'i' },
        });

        if (existingPerson) {
          // Update existing person with any additional info from face data
          if (faceData.description && !existingPerson.description) {
            existingPerson.description = faceData.description;
            await existingPerson.save();
          }
          skipped++;
          console.log('[Migration] Skipped (already exists):', faceData.name);
          continue;
        }

        // Create new person from face data
        const personData: any = {
          userId: faceData.userId,
          name: faceData.name || faceData.label || 'Unknown',
          description: faceData.description || faceData.notes || `Migrated from face recognition data`,
          relationship: faceData.relationship || faceData.category || undefined,
          tags: [],
        };

        // Add any relevant tags
        if (faceData.category) {
          personData.tags.push(faceData.category);
        }
        if (faceData.label && faceData.label !== faceData.name) {
          personData.tags.push(faceData.label);
        }

        // Preserve timestamps if available
        if (faceData.createdAt) {
          personData.createdAt = faceData.createdAt;
        }
        if (faceData.updatedAt) {
          personData.updatedAt = faceData.updatedAt;
        }

        await Person.create(personData);
        migrated++;
        migratedNames.push(personData.name);
        console.log('[Migration] Migrated:', personData.name);
      } catch (err) {
        console.error('[Migration] Error migrating face data:', faceData.name, err);
        errors++;
      }
    }

    // Optionally delete the facedatas collection after successful migration
    if (deleteAfterMigration && migrated > 0 && errors === 0) {
      await db.collection('facedatas').drop();
      console.log('[Migration] Dropped facedatas collection');
    }

    return NextResponse.json({
      message: 'Migration completed',
      stats: {
        total: faceDataDocs.length,
        migrated,
        skipped,
        errors,
      },
      migratedNames,
      collectionDeleted: deleteAfterMigration && errors === 0,
    });
  } catch (error) {
    console.error('[Migration] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
