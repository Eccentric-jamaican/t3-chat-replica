import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

export const start = mutation({
  args: {
    threadId: v.id('threads'),
    messageId: v.id('messages'),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId)
    if (!message) throw new Error('Message not found')

    const sessionId = await ctx.db.insert('streamSessions', {
      threadId: args.threadId,
      messageId: args.messageId,
      status: 'streaming',
      startedAt: Date.now(),
    })

    await ctx.db.patch(args.messageId, { status: 'streaming' })

    return sessionId
  },
})

export const getStatus = query({
  args: { sessionId: v.id('streamSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    return session?.status
  },
})

export const abort = mutation({
  args: { sessionId: v.id('streamSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return

    await ctx.db.patch(args.sessionId, {
      status: 'aborted',
      endedAt: Date.now(),
    })
  },
})

export const abortLatestByThread = mutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query('streamSessions')
      .withIndex('by_thread_status', (q) =>
        q.eq('threadId', args.threadId).eq('status', 'streaming'),
      )
      .order('desc')
      .first()

    if (!latest) return

    await ctx.db.patch(latest._id, {
      status: 'aborted',
      endedAt: Date.now(),
    })
  },
})

export const complete = mutation({
  args: { sessionId: v.id('streamSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return

    await ctx.db.patch(args.sessionId, {
      status: 'completed',
      endedAt: Date.now(),
    })

    await ctx.db.patch(session.messageId, { status: 'completed' })
  },
})

export const error = mutation({
  args: { sessionId: v.id('streamSessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId)
    if (!session) return

    await ctx.db.patch(args.sessionId, {
      status: 'error',
      endedAt: Date.now(),
    })

    await ctx.db.patch(session.messageId, { status: 'error' })
  },
})

export const heartbeat = mutation({
  args: { sessionId: v.id('streamSessions') },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, { lastHeartbeat: Date.now() })
  },
})
