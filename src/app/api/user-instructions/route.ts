import { NextRequest, NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import UserInstruction from '@/models/UserInstruction';
import { verifyToken } from '@/lib/auth';
import { generateEmbedding } from '@/lib/ai/embeddings';
import mongoose from 'mongoose';

/**
 * GET /api/user-instructions
 * Retrieve all active instructions for the current user
 * Used on session start to personalize MIRA's behavior
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const format = searchParams.get('format'); // 'raw' or 'formatted'
    const limit = parseInt(searchParams.get('limit') || '100');

    const userId = new mongoose.Types.ObjectId(decoded.userId);

    // If formatted response requested, return MIRA-ready string
    if (format === 'formatted') {
      const formatted = await (UserInstruction as any).getFormattedInstructions(userId);
      return NextResponse.json({
        formatted,
        success: true,
      });
    }

    // Build query
    const query: Record<string, unknown> = {
      userId,
      isActive: true,
    };

    if (category) {
      query.category = category;
    }

    const instructions = await UserInstruction.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // Group by category for easier consumption
    const grouped: Record<string, typeof instructions> = {};
    for (const inst of instructions) {
      const cat = inst.category;
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push(inst);
    }

    return NextResponse.json({
      instructions,
      grouped,
      total: instructions.length,
      success: true,
    });
  } catch (error) {
    console.error('[User Instructions] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch instructions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user-instructions
 * Create a new user instruction
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const body = await request.json();
    const {
      category,
      instruction,
      originalContext,
      priority = 5,
      source = 'explicit',
      confidence = 1,
      tags = [],
      conversationId,
    } = body;

    if (!category || !instruction) {
      return NextResponse.json(
        { error: 'Category and instruction are required' },
        { status: 400 }
      );
    }

    const userId = new mongoose.Types.ObjectId(decoded.userId);

    // Check for duplicate/similar instructions
    const existing = await UserInstruction.findOne({
      userId,
      category,
      instruction: { $regex: new RegExp(instruction.substring(0, 50), 'i') },
      isActive: true,
    });

    if (existing) {
      // Update priority if new one is higher
      if (priority > existing.priority) {
        existing.priority = priority;
        existing.confidence = Math.max(existing.confidence, confidence);
        await existing.save();
      }
      return NextResponse.json({
        instruction: existing,
        updated: true,
        message: 'Similar instruction exists, updated if needed',
      });
    }

    // Generate embedding for semantic search
    let embedding: number[] | undefined;
    try {
      embedding = await generateEmbedding(instruction);
    } catch (err) {
      console.warn('[User Instructions] Could not generate embedding:', err);
    }

    const newInstruction = new UserInstruction({
      userId,
      category,
      instruction,
      originalContext,
      priority,
      source,
      confidence,
      tags,
      conversationId: conversationId ? new mongoose.Types.ObjectId(conversationId) : undefined,
      embedding,
    });

    await newInstruction.save();

    console.log('[User Instructions] ✓ Saved:', category, '-', instruction.substring(0, 50));

    return NextResponse.json({
      instruction: newInstruction,
      created: true,
      success: true,
    });
  } catch (error) {
    console.error('[User Instructions] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create instruction' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/user-instructions
 * Update an existing instruction
 */
export async function PATCH(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const body = await request.json();
    const { instructionId, updates } = body;

    if (!instructionId) {
      return NextResponse.json(
        { error: 'Instruction ID is required' },
        { status: 400 }
      );
    }

    const userId = new mongoose.Types.ObjectId(decoded.userId);

    const instruction = await UserInstruction.findOne({
      _id: new mongoose.Types.ObjectId(instructionId),
      userId,
    });

    if (!instruction) {
      return NextResponse.json(
        { error: 'Instruction not found' },
        { status: 404 }
      );
    }

    // Apply updates
    const allowedUpdates = ['instruction', 'priority', 'isActive', 'tags', 'category'];
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        (instruction as any)[key] = updates[key];
      }
    }

    // Regenerate embedding if instruction text changed
    if (updates.instruction) {
      try {
        instruction.embedding = await generateEmbedding(updates.instruction);
      } catch (err) {
        console.warn('[User Instructions] Could not regenerate embedding:', err);
      }
    }

    await instruction.save();

    return NextResponse.json({
      instruction,
      success: true,
    });
  } catch (error) {
    console.error('[User Instructions] PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update instruction' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user-instructions
 * Deactivate an instruction (soft delete)
 */
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('authorization')?.replace('Bearer ', '');
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    await connectToDatabase();

    const { searchParams } = new URL(request.url);
    const instructionId = searchParams.get('id');

    if (!instructionId) {
      return NextResponse.json(
        { error: 'Instruction ID is required' },
        { status: 400 }
      );
    }

    const userId = new mongoose.Types.ObjectId(decoded.userId);

    const result = await UserInstruction.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(instructionId),
        userId,
      },
      { isActive: false },
      { new: true }
    );

    if (!result) {
      return NextResponse.json(
        { error: 'Instruction not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: 'Instruction deactivated',
      success: true,
    });
  } catch (error) {
    console.error('[User Instructions] DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete instruction' },
      { status: 500 }
    );
  }
}
