import { v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery, QueryCtx, MutationCtx } from './_generated/server'
import { Id } from './_generated/dataModel'
import { getAuthUserId } from './auth'

/**
 * Verify the current user has access to a thread.
 * - If thread has userId: only that authenticated user can access
 * - If thread has no userId (anonymous): sessionId must match
 * Throws an error if access is denied.
 */
async function verifyThreadAccess(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<'threads'>,
  sessionId?: string
): Promise<void> {
  const thread = await ctx.db.get(threadId)
  if (!thread) {
    throw new Error('Thread not found')
  }

  const userId = await getAuthUserId(ctx)

  // If thread belongs to an authenticated user
  if (thread.userId) {
    if (!userId || thread.userId !== userId) {
      console.log('[SECURITY] Message access denied:', {
        threadId,
        threadOwner: thread.userId,
        requestingUser: userId ?? 'anonymous',
        timestamp: new Date().toISOString(),
      })
      throw new Error("Access denied: You don't have permission to access this thread")
    }
  } else {
    // Anonymous thread - sessionId is required and must match
    if (!sessionId || thread.sessionId !== sessionId) {
      console.log('[SECURITY] Anonymous message access denied:', {
        threadId,
        threadSession: thread.sessionId,
        requestingSession: sessionId ?? 'none',
        timestamp: new Date().toISOString(),
      })
      throw new Error("Access denied: You don't have permission to access this thread")
    }
  }
}

/**
 * Verify access to a message by checking its parent thread ownership.
 */
async function verifyMessageAccess(
  ctx: QueryCtx | MutationCtx,
  messageId: Id<'messages'>,
  sessionId?: string
): Promise<void> {
  const message = await ctx.db.get(messageId)
  if (!message) {
    throw new Error('Message not found')
  }
  await verifyThreadAccess(ctx, message.threadId, sessionId)
}

export const list = query({
  args: { threadId: v.id('threads'), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before returning messages
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .collect()

    return Promise.all(
      messages.map(async (msg) => {
        if (!msg.attachments || msg.attachments.length === 0) return msg
        const attachments = await Promise.all(
          msg.attachments.map(async (att) => ({
            ...att,
            url: await ctx.storage.getUrl(att.storageId).catch(() => null),
          })),
        )
        return { ...msg, attachments }
      }),
    )
  },
})

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const send = mutation({
  args: {
    threadId: v.id('threads'),
    content: v.string(),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('system'),
      v.literal('tool'),
    ),
    status: v.optional(
      v.union(
        v.literal('streaming'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('aborted'),
      ),
    ),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id('_storage'),
          type: v.string(),
          name: v.string(),
          size: v.number(),
        }),
      ),
    ),
    toolCallId: v.optional(v.string()),
    name: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before sending message
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    const { sessionId: _, ...messageData } = args
    const messageId = await ctx.db.insert('messages', {
      ...messageData,
      status: args.status ?? 'completed',
    })

    // Update thread last active
    await ctx.db.patch(args.threadId, {
      lastMessageAt: Date.now(),
    })

    return messageId
  },
})

export const saveToolCalls = mutation({
  args: {
    messageId: v.id('messages'),
    toolCalls: v.array(
      v.object({
        id: v.string(),
        type: v.literal('function'),
        function: v.object({
          name: v.string(),
          arguments: v.string(),
        }),
      }),
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    const existing = await ctx.db.get(args.messageId)
    const toolCalls = [...(existing?.toolCalls || []), ...args.toolCalls]
    await ctx.db.patch(args.messageId, { toolCalls })
  },
})

export const saveReasoningContent = mutation({
  args: {
    messageId: v.id('messages'),
    reasoningContent: v.string(),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    const existing = await ctx.db.get(args.messageId)
    const reasoningContent = (existing?.reasoningContent || '') + args.reasoningContent
    await ctx.db.patch(args.messageId, { reasoningContent })
  },
})

export const saveProducts = mutation({
  args: {
    messageId: v.id('messages'),
    products: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        price: v.string(),
        image: v.string(),
        url: v.string(),
        sellerName: v.optional(v.string()),
        sellerFeedback: v.optional(v.string()),
        condition: v.optional(v.string()),
        rating: v.optional(v.number()),
        reviews: v.optional(v.number()),
      }),
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    await ctx.db.patch(args.messageId, { products: args.products })
  },
})

export const initializeAssistantMessage = mutation({
  args: {
    threadId: v.id('threads'),
    modelId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before creating message
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    return await ctx.db.insert('messages', {
      threadId: args.threadId,
      role: 'assistant',
      content: '',
      modelId: args.modelId,
      status: 'streaming',
    })
  },
})

export const appendContent = mutation({
  args: {
    messageId: v.id('messages'),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal('streaming'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('aborted'),
      ),
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ aborted: boolean }> => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error('Message not found')

    if (message.status === 'aborted') {
      return { aborted: true } // Signal that message was aborted
    }

    await ctx.db.patch(args.messageId, {
      content: message.content + args.content,
    })

    return { aborted: false }
  },
})

export const updateStatus = mutation({
  args: {
    messageId: v.id('messages'),
    status: v.union(
      v.literal('streaming'),
      v.literal('completed'),
      v.literal('error'),
      v.literal('aborted'),
    ),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    await ctx.db.patch(args.messageId, { status: args.status })
  },
})

export const abort = mutation({
  args: { messageId: v.id('messages'), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    await ctx.db.patch(args.messageId, { status: 'aborted' })
  },
})

export const abortLatestInThread = mutation({
  args: { threadId: v.id('threads'), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    console.log('abortLatestInThread called for thread:', args.threadId)
    const latest = await ctx.db
      .query('messages')
      .withIndex('by_thread_status', (q) =>
        q.eq('threadId', args.threadId).eq('status', 'streaming'),
      )
      .order('desc')
      .first()

    console.log('Found latest streaming message:', latest?._id)

    if (latest) {
      await ctx.db.patch(latest._id, { status: 'aborted' })
      console.log('Patched status to aborted')
    } else {
      console.log('No streaming message found to abort')
    }
  },
})

export const getStatus = query({
  args: { messageId: v.id('messages'), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before returning status
    await verifyMessageAccess(ctx, args.messageId, args.sessionId)

    const msg = await ctx.db.get(args.messageId)
    return msg?.status
  },
})

export const isThreadStreaming = query({
  args: { threadId: v.optional(v.id('threads')), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.threadId) return false

    // Verify ownership before checking streaming status
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    const latest = await ctx.db
      .query('messages')
      .withIndex('by_thread_status', (q) =>
        q.eq('threadId', args.threadId!).eq('status', 'streaming'),
      )
      .order('desc')
      .first()
    return !!latest
  },
})

export const update = mutation({
  args: { id: v.id('messages'), content: v.string(), sessionId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // Verify ownership before modifying
    await verifyMessageAccess(ctx, args.id, args.sessionId)

    await ctx.db.patch(args.id, { content: args.content })
  },
})

// Delete all messages after a given message (for retry functionality)
export const deleteAfter = mutation({
  args: {
    threadId: v.id('threads'),
    afterMessageId: v.id('messages'),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify ownership before deleting
    await verifyThreadAccess(ctx, args.threadId, args.sessionId)

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .collect()

    // Find the index of the target message
    const targetIndex = messages.findIndex((m) => m._id === args.afterMessageId)
    if (targetIndex === -1) return

    // Delete all messages after the target
    for (let i = targetIndex + 1; i < messages.length; i++) {
      await ctx.db.delete(messages[i]._id)
    }
  },
})

// ============================================================
// Internal mutations/queries for server-side streaming hot path.
// These skip auth verification since the calling action already
// verified access when the stream started.
// ============================================================

export const internalList = internalQuery({
  args: { threadId: v.id('threads') },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', args.threadId))
      .order('asc')
      .collect()

    return Promise.all(
      messages.map(async (msg) => {
        if (!msg.attachments || msg.attachments.length === 0) return msg
        const attachments = await Promise.all(
          msg.attachments.map(async (att) => ({
            ...att,
            url: await ctx.storage.getUrl(att.storageId).catch(() => null),
          })),
        )
        return { ...msg, attachments }
      }),
    )
  },
})

export const internalAppendContent = internalMutation({
  args: {
    messageId: v.id('messages'),
    content: v.string(),
  },
  handler: async (ctx, args): Promise<{ aborted: boolean }> => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error('Message not found')
    if (message.status === 'aborted') return { aborted: true }
    await ctx.db.patch(args.messageId, {
      content: message.content + args.content,
    })
    return { aborted: false }
  },
})

export const internalGetStatus = internalQuery({
  args: { messageId: v.id('messages') },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId)
    return msg?.status
  },
})

export const internalUpdateStatus = internalMutation({
  args: {
    messageId: v.id('messages'),
    status: v.union(
      v.literal('streaming'),
      v.literal('completed'),
      v.literal('error'),
      v.literal('aborted'),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { status: args.status })
  },
})

export const internalInitializeAssistantMessage = internalMutation({
  args: {
    threadId: v.id('threads'),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert('messages', {
      threadId: args.threadId,
      role: 'assistant',
      content: '',
      modelId: args.modelId,
      status: 'streaming',
    })
  },
})

export const internalSaveReasoningContent = internalMutation({
  args: {
    messageId: v.id('messages'),
    reasoningContent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.messageId)
    const reasoningContent = (existing?.reasoningContent || '') + args.reasoningContent
    await ctx.db.patch(args.messageId, { reasoningContent })
  },
})

export const internalSaveToolCalls = internalMutation({
  args: {
    messageId: v.id('messages'),
    toolCalls: v.array(
      v.object({
        id: v.string(),
        type: v.literal('function'),
        function: v.object({
          name: v.string(),
          arguments: v.string(),
        }),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.messageId)
    const toolCalls = [...(existing?.toolCalls || []), ...args.toolCalls]
    await ctx.db.patch(args.messageId, { toolCalls })
  },
})

export const internalSaveProducts = internalMutation({
  args: {
    messageId: v.id('messages'),
    products: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        price: v.string(),
        image: v.string(),
        url: v.string(),
        sellerName: v.optional(v.string()),
        sellerFeedback: v.optional(v.string()),
        condition: v.optional(v.string()),
        rating: v.optional(v.number()),
        reviews: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.messageId, { products: args.products })
  },
})

export const internalSend = internalMutation({
  args: {
    threadId: v.id('threads'),
    content: v.string(),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('system'),
      v.literal('tool'),
    ),
    status: v.optional(
      v.union(
        v.literal('streaming'),
        v.literal('completed'),
        v.literal('error'),
        v.literal('aborted'),
      ),
    ),
    toolCallId: v.optional(v.string()),
    name: v.optional(v.string()),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert('messages', {
      ...args,
      status: args.status ?? 'completed',
    })
    await ctx.db.patch(args.threadId, { lastMessageAt: Date.now() })
    return messageId
  },
})
